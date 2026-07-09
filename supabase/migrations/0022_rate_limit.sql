-- =============================================================================
-- Migration 0022: Rate limiting (Track S1.3)
-- =============================================================================
-- Postgres-backed fixed-window rate limiter for login, signup, search, and the
-- vendor job-token page — no new service (no Upstash/Vercel WAF), so it behaves
-- identically self-hosted and survives serverless instance churn (an in-memory
-- limiter would reset per cold start).
--
-- -----------------------------------------------------------------------------
-- RLS: ENABLED, WITH ZERO POLICIES — same lock as vendor_job_tokens (0014).
-- -----------------------------------------------------------------------------
-- Default-deny for both `anon` and `authenticated`: no create policy statements
-- means PostgREST cannot SELECT/INSERT/UPDATE/DELETE a single row of this table
-- through the public API. The ONLY principal that touches it is service_role, via
-- the SECURITY DEFINER function below (called from src/lib/rate-limit.ts using the
-- service client — SUPABASE_SERVICE_ROLE_KEY is server-only). DO NOT add policies.
--
-- Fully idempotent: safe to paste into the Supabase SQL editor and safe to re-run.
-- =============================================================================

create table if not exists public.rate_limit_buckets (
  -- e.g. 'login:203.0.113.4' or 'search:<user-id>' — caller-chosen, opaque to this table.
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.rate_limit_buckets enable row level security;

-- Fixed-window check-and-increment, atomic per key via ON CONFLICT DO UPDATE (the
-- upsert locks the row, so concurrent callers for the same key can't race each other).
-- If the existing window is older than p_window_seconds, it resets to a fresh window
-- of count 1; otherwise the count increments. Returns true iff the request is allowed
-- (count <= p_max) — false means the caller should reject/throttle.
--
-- Also does a best-effort purge of rows stale by more than a day, so the table doesn't
-- grow unbounded — cheap at this scale, no cron needed.
create or replace function public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';

  insert into public.rate_limit_buckets (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case
          when public.rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
          else public.rate_limit_buckets.window_start
        end,
        count = case
          when public.rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
          else public.rate_limit_buckets.count + 1
        end
  returning window_start, count into v_window_start, v_count;

  return v_count <= p_max;
end;
$$;

-- SECURITY-CRITICAL: lock this SECURITY DEFINER function to server-side callers, same
-- reasoning as log_ticket_event (0012) — Postgres grants EXECUTE to PUBLIC by default,
-- and PostgREST auto-exposes public functions as RPCs. Without this revoke, any tenant
-- could call supabase.rpc('check_rate_limit', {...}) to inspect or manipulate arbitrary
-- buckets (including other users'/IPs' counters). Revoked from public, explicitly
-- granted to service_role (revoking from public also removes it from `authenticated`
-- and `anon`, which inherit PUBLIC's grants — the explicit grant is what keeps the
-- intended server-side caller working).
revoke execute on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- =============================================================================
-- SMOKE TESTS — run these manually once applied:
-- =============================================================================
-- 1. NOT CALLABLE BY ANON/AUTHENTICATED: supabase.rpc('check_rate_limit', ...) from a
--    browser-facing client (anon or authenticated role) fails with "permission denied
--    for function check_rate_limit" — only service_role can invoke it.
-- 2. WINDOW RESETS: calling with the same key after p_window_seconds has elapsed
--    returns true again with count reset to 1 (verify window_start advanced).
-- 3. WINDOW BLOCKS: calling more than p_max times within the window returns false on
--    the (p_max + 1)th call and beyond, until the window rolls over.
-- 4. STALE PURGE: a row with window_start older than 1 day is deleted by the next call
--    to check_rate_limit (any key) — inspect row count before/after.
-- =============================================================================

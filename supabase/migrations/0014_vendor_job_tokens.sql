-- =============================================================================
-- Migration 0014: Vendor job tokens (no-login capability links)  [P3.8]
-- =============================================================================
-- Adds `public.vendor_job_tokens` — the storage behind the vendor SECURE LINK feature.
-- A vendor is NOT a platform user (no auth.uid(), no session, no profile). Instead a
-- manager generates a secret link `${NEXT_PUBLIC_SITE_URL}/job/<token>` and shares it
-- with the vendor. Whoever holds that raw token can act on ONE ticket, with LIMITED
-- actions (accept / decline / mark complete), until it expires or is revoked.
--
-- THE TOKEN IS A BEARER CAPABILITY. Because there is NO authenticated vendor identity,
-- RLS (which keys off auth.uid()) CANNOT be the security boundary for vendor access.
-- The boundary is instead, in order:
--   (1) token ENTROPY            — 256 random bits (crypto.randomBytes(32)); unguessable.
--   (2) HASH-ONLY STORAGE        — only the SHA-256 hex of the raw token is stored here.
--                                  The RAW TOKEN IS NEVER PERSISTED. A DB/leak of this
--                                  table does not yield a usable link (preimage-resistant).
--   (3) EXPIRY / REVOCATION      — every access checks expires_at > now AND revoked_at IS
--                                  NULL; declined/completed links are revoked so they die.
--   (4) SERVICE-ROLE-ONLY ACCESS — all vendor logic runs in trusted Next.js server
--                                  actions using the service-role client. This table is
--                                  NEVER read/written by a browser-facing role.
--   (5) SINGLE-TICKET BINDING    — a row binds exactly one ticket_id + vendor_id; a token
--                                  for ticket A can never act on ticket B.
--
-- -----------------------------------------------------------------------------
-- RLS: ENABLED, WITH ZERO POLICIES  — THIS IS INTENTIONAL AND LOAD-BEARING.
-- -----------------------------------------------------------------------------
-- Every other domain table in this project enables RLS *and then adds permissive
-- policies* so authenticated roles can read/write their own rows. This table does the
-- OPPOSITE ON PURPOSE: `enable row level security` with NO `create policy` statements
-- means default-DENY for BOTH `anon` AND `authenticated`. PostgREST (the auto REST API
-- Supabase exposes) runs queries AS the caller's role, so with zero policies neither an
-- anonymous visitor nor a logged-in user can SELECT, INSERT, UPDATE, or DELETE a single
-- row of vendor_job_tokens through the API — the request matches no policy and returns
-- nothing / is rejected.
--
-- The ONLY principal that touches this table is `service_role`, which BYPASSES RLS
-- entirely and is used exclusively server-side (SUPABASE_SERVICE_ROLE_KEY is server-only,
-- never NEXT_PUBLIC; see src/lib/supabase/service.ts). The table holds security material
-- (token hashes) and must never be exposed via PostgREST to a client role. Enabling RLS
-- with zero policies is the lock that guarantees that. DO NOT add policies here.
--
-- MIGRATION NUMBERING: existing files are 0001..0013. 0013 is the tenant-portal
-- migration (0013_tenant_sees_on_behalf). Next free lexical number is 0014.
-- Additive; no data exists. Idempotent-safe guards (`if not exists`) on a re-run.
-- =============================================================================

create table if not exists public.vendor_job_tokens (
  id uuid primary key default gen_random_uuid(),

  -- workspace_id: the tenant boundary. NOT NULL, cascades if the workspace is deleted.
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- ticket_id: the ONE ticket this capability is bound to. Composite FK
  -- (ticket_id, workspace_id) -> tickets(id, workspace_id) reuses the
  -- tickets_id_workspace_unique constraint (0011). This is what makes a token
  -- SINGLE-TICKET: the row names exactly one ticket, and the ticket must live in the
  -- SAME workspace as the token — a cross-workspace token row cannot be inserted (the
  -- composite FK has no matching (id, workspace_id) pair). on delete cascade: if the
  -- ticket is deleted, its outstanding links die with it.
  ticket_id uuid not null,

  -- vendor_id: the vendor this link is FOR. Composite FK (vendor_id, workspace_id) ->
  -- vendors(id, workspace_id) reuses vendors_id_workspace_unique (added in 0011). Same
  -- cross-workspace-integrity guarantee as ticket_id: the vendor must be in this
  -- workspace. on delete cascade: removing the vendor invalidates its links.
  vendor_id uuid not null,

  -- token_hash: SHA-256 hex (64 chars) of the RAW token. The raw token is NEVER stored.
  -- UNIQUE both to prevent duplicate hashes and because getValidVendorJob looks a token
  -- up by this column — the unique constraint already creates the backing index, so no
  -- separate index is needed on token_hash.
  token_hash text not null unique,

  -- created_by_user_id: the manager who generated the link. Plain FK to profiles(id)
  -- (profiles is not workspace-scoped in the composite sense; the action validates the
  -- manager is in-workspace via requirePermission before inserting). NOT NULL.
  created_by_user_id uuid not null references public.profiles (id),

  -- expires_at: hard expiry. Every access checks now() < expires_at. NOT NULL — a link
  -- with no expiry is a permanent capability, which we never want.
  expires_at timestamptz not null,

  -- revoked_at: early kill switch. A manager can revoke a link before it expires; the
  -- decline/complete actions also set this so a used link cannot be replayed. NULL =
  -- not revoked. Every access checks revoked_at IS NULL.
  revoked_at timestamptz,

  -- Vendor lifecycle stamps. Each is set once, by the corresponding vendor action, and
  -- also serves as the DOUBLE-ACTION GUARD: the action layer refuses to accept twice, to
  -- complete a declined job, etc., by inspecting whether these are already set.
  accepted_at timestamptz,
  declined_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz not null default now(),

  -- Composite FK: (ticket_id, workspace_id) must exist as a tickets (id, workspace_id)
  -- pair — token/ticket workspace consistency + single-ticket binding. Both columns are
  -- NOT NULL so the pair is always fully checked.
  constraint vendor_job_tokens_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete cascade,

  -- Composite FK: (vendor_id, workspace_id) must exist as a vendors (id, workspace_id)
  -- pair — token/vendor workspace consistency. Both NOT NULL, always fully checked.
  constraint vendor_job_tokens_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id)
    on delete cascade
);

-- Lookup index for the manager-side "links for this ticket" query and revocation.
-- (token_hash already has a unique index from its constraint, so the raw-token lookup
-- path is covered.)
create index if not exists vendor_job_tokens_workspace_ticket_idx
  on public.vendor_job_tokens (workspace_id, ticket_id);

-- -----------------------------------------------------------------------------
-- RLS: enable, add NO policies. Default-deny for anon AND authenticated. See the
-- header — this is the security lock, not an oversight. service_role bypasses RLS and
-- is the only principal that ever touches this table (server-side actions only).
-- -----------------------------------------------------------------------------
alter table public.vendor_job_tokens enable row level security;

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. NOT SELECTABLE BY ANON: an anonymous PostgREST GET on vendor_job_tokens returns
--    ZERO rows (no SELECT policy). The token table is invisible to the public API.
-- 2. NOT SELECTABLE/WRITABLE BY AUTHENTICATED: a logged-in user (any role, even OWNER)
--    hitting vendor_job_tokens via PostgREST also gets nothing / is rejected — there is
--    NO policy for `authenticated` either. Only service_role (server-side) can read it.
-- 3. EXPIRED TOKEN REJECTED: insert a row with expires_at in the past; the app's
--    getValidVendorJob (expires_at > now check) returns null → the /job page shows the
--    generic "invalid or expired" page, no ticket detail.
-- 4. REVOKED TOKEN REJECTED: set revoked_at on a row; getValidVendorJob (revoked_at IS
--    NULL check) returns null → generic invalid page. Declined/completed links are
--    revoked, so they cannot be replayed.
-- 5. TOKEN A CANNOT ACT ON TICKET B: a token row binds ONE ticket_id. An action loads
--    the row by token_hash and uses ITS ticket_id; there is no parameter by which a
--    holder of token-for-A can target ticket B. Binding is structural.
-- 6. CROSS-WORKSPACE TOKEN ROWS BLOCKED: attempting to insert a row whose ticket_id
--    belongs to workspace X but workspace_id = Y fails the (ticket_id, workspace_id)
--    composite FK (no matching tickets pair); likewise for (vendor_id, workspace_id).
--    A token can never straddle workspaces.
-- 7. RAW TOKEN NEVER STORED: only token_hash (SHA-256 hex) is present; there is no
--    column holding the raw token. A dump of this table does not yield usable links.
-- =============================================================================

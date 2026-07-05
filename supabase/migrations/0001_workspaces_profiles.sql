create extension if not exists "pgcrypto";

-- WARNING: RLS is NOT enabled on workspaces/profiles until migration 0002 runs.
-- Do not apply this migration alone against a live project with real credentials —
-- Supabase auto-exposes public schema tables via PostgREST as soon as they exist,
-- so without 0002 immediately following, any authenticated client could read/write
-- every workspace's data.

create type public.user_role as enum (
  'SUPER_ADMIN',
  'OWNER',
  'OPERATOR',
  'ACCOUNTANT',
  'TENANT',
  'GUEST',
  'VENDOR'
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  address text,
  city text,
  country text,
  timezone text not null default 'Europe/Vienna',
  currency text not null default 'EUR',
  language text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  role public.user_role not null default 'OPERATOR',
  full_name text not null default '',
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_workspace_id_idx on public.profiles (workspace_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new auth.users row gets a matching profile row (no workspace yet).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

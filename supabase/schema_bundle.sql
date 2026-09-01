-- =============================================================================
-- Property Operations Platform — CONSOLIDATED SCHEMA BUNDLE
-- =============================================================================
-- Single-paste, IDEMPOTENT equivalent of migrations 0001–0015. Defines the FINAL
-- state of every object (skips the intermediate drop/recreate churn from 0007/0013),
-- so it applies cleanly in one run against a freshly-reset `public` schema AND is
-- safe to re-run. The numbered files in supabase/migrations/ remain the documented
-- source of truth (rationale, smoke tests); THIS file is the apply artifact.
--
-- Guard strategy:
--   enums       -> DO block, swallow duplicate_object (re-runnable)
--   tables      -> create table if not exists (constraints live inline)
--   indexes     -> create index if not exists
--   functions   -> create or replace
--   triggers    -> drop trigger if exists ... ; create trigger ...
--   policies    -> drop policy if exists ... ; create policy ...
--   RLS enable  -> naturally idempotent
--   grants      -> naturally idempotent
--   storage     -> on conflict do nothing / drop policy if exists
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================
do $do$ begin
  create type public.user_role as enum
    ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT','TENANT','GUEST','VENDOR');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.property_type as enum
    ('APARTMENT_BUILDING','SINGLE_APARTMENT','MIXED_USE','OFFICE','OTHER');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.entity_status as enum ('ACTIVE','ARCHIVED');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.occupancy_type as enum ('LONG_TERM','SHORT_TERM','VACANT','MIXED');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.unit_status as enum ('OCCUPIED','VACANT','MAINTENANCE','BLOCKED');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.vendor_category as enum
    ('PLUMBING','HEATING','ELECTRICAL','CLEANING','LOCKSMITH',
     'APPLIANCE_REPAIR','HANDYMAN','PEST_CONTROL','OTHER');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.ticket_category as enum
    ('PLUMBING','HEATING','ELECTRICAL','CLEANING','APPLIANCE',
     'INTERNET','KEYS','DAMAGE','NOISE','BILLING','OTHER');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.ticket_priority as enum ('LOW','NORMAL','HIGH','URGENT');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.ticket_status as enum
    ('NEW','TRIAGE','WAITING_FOR_INFO','ASSIGNED','SCHEDULED',
     'IN_PROGRESS','RESOLVED','CLOSED','CANCELLED');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.actor_type as enum ('USER','SYSTEM','AI','AUTOMATION');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.ticket_event_type as enum
    ('TICKET_CREATED','STATUS_CHANGED','PRIORITY_CHANGED','CATEGORY_CHANGED',
     'OPERATOR_ASSIGNED','VENDOR_ASSIGNED','COMMENT_ADDED','ATTACHMENT_UPLOADED',
     'AI_CLASSIFICATION_GENERATED','EXPENSE_LINKED','INVOICE_UPLOADED','TICKET_CLOSED');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.comment_visibility as enum ('PUBLIC','INTERNAL');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.comment_type as enum ('MESSAGE','SYSTEM_NOTE','AI_NOTE');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.attachment_type as enum
    ('PHOTO','INVOICE','RECEIPT','CONTRACT','REPORT','OTHER');
exception when duplicate_object then null; end $do$;

-- =============================================================================
-- CORE: workspaces + profiles (0001)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create table if not exists public.workspaces (
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

create table if not exists public.profiles (
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

create index if not exists profiles_workspace_id_idx on public.profiles (workspace_id);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new auth.users row gets a matching profile row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- RLS HELPER FUNCTIONS (0002 + is_active-aware finals from 0007/0008)
-- All SECURITY DEFINER + pinned search_path (break policy recursion / block shadowing).
-- =============================================================================
create or replace function public.current_workspace_id()
returns uuid language sql stable security definer set search_path = public as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select is_active from public.profiles where id = auth.uid()
$$;

-- FINAL (0008): is_active-aware.
create or replace function public.is_workspace_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR')
     and coalesce(public.current_is_active(), false)
$$;

-- FINAL (0008): is_active-aware. Narrower than is_workspace_manager (no OPERATOR).
create or replace function public.can_manage_users()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('SUPER_ADMIN','OWNER')
     and coalesce(public.current_is_active(), false)
$$;

-- (0017): finance write helper. INVERTED role set vs. is_workspace_manager —
-- INCLUDES ACCOUNTANT (owns the books), EXCLUDES OPERATOR (read-only). is_active-aware.
create or replace function public.can_manage_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('SUPER_ADMIN','OWNER','ACCOUNTANT')
     and coalesce(public.current_is_active(), false)
$$;

-- =============================================================================
-- RLS: workspaces + profiles (0002, profiles_update_self FINAL from 0007)
-- =============================================================================
alter table public.workspaces enable row level security;
alter table public.profiles   enable row level security;

drop policy if exists "workspaces_select_own" on public.workspaces;
create policy "workspaces_select_own"
  on public.workspaces for select
  using (id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

drop policy if exists "workspaces_insert_authenticated" on public.workspaces;
create policy "workspaces_insert_authenticated"
  on public.workspaces for insert
  with check (
    auth.uid() is not null
    and (public.current_workspace_id() is null or public.current_role() = 'SUPER_ADMIN')
  );

drop policy if exists "workspaces_update_owner" on public.workspaces;
create policy "workspaces_update_owner"
  on public.workspaces for update
  using (
    id = public.current_workspace_id()
    and public.current_role() in ('SUPER_ADMIN','OWNER')
  );

drop policy if exists "profiles_select_self_or_workspace" on public.profiles;
create policy "profiles_select_self_or_workspace"
  on public.profiles for select
  using (
    id = auth.uid()
    or workspace_id = public.current_workspace_id()
    or public.current_role() = 'SUPER_ADMIN'
  );

-- FINAL (0007): role, workspace_id AND is_active pinned in WITH CHECK.
drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from public.current_role()
    and workspace_id is not distinct from public.current_workspace_id()
    and is_active is not distinct from public.current_is_active()
  );

drop policy if exists "profiles_update_by_manager" on public.profiles;
create policy "profiles_update_by_manager"
  on public.profiles for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_users());

-- =============================================================================
-- Workspace claim RPC (0006)
-- =============================================================================
create or replace function public.create_workspace_and_claim_owner(
  workspace_name text,
  workspace_currency text default 'EUR',
  workspace_language text default 'en'
)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare
  new_workspace public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if public.current_workspace_id() is not null then
    raise exception 'User already belongs to a workspace';
  end if;

  insert into public.workspaces (name, currency, language)
  values (workspace_name, workspace_currency, workspace_language)
  returning * into new_workspace;

  update public.profiles
  set workspace_id = new_workspace.id, role = 'OWNER'
  where id = auth.uid();

  if not found then
    raise exception 'No profile row for current user';
  end if;

  return new_workspace;
end;
$$;

grant execute on function public.create_workspace_and_claim_owner(text, text, text) to authenticated;

-- =============================================================================
-- PROPERTIES (0003) — carries unique(id, workspace_id) for composite FKs.
-- =============================================================================
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  postal_code text not null,
  country text not null,
  property_type public.property_type not null default 'OTHER',
  notes text,
  status public.entity_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_id_workspace_unique unique (id, workspace_id)
);

create index if not exists properties_workspace_id_idx on public.properties (workspace_id);

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

drop policy if exists "properties_select_workspace" on public.properties;
create policy "properties_select_workspace"
  on public.properties for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

drop policy if exists "properties_insert_manager" on public.properties;
create policy "properties_insert_manager"
  on public.properties for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "properties_update_manager" on public.properties;
create policy "properties_update_manager"
  on public.properties for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- =============================================================================
-- UNITS (0009) — composite FK to properties; carries own unique(id, workspace_id).
-- =============================================================================
create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  label text not null,
  floor text,
  staircase text,
  size_m2 numeric,
  room_count int,
  occupancy_type public.occupancy_type not null default 'VACANT',
  status public.unit_status not null default 'VACANT',
  access_notes text,
  wifi_info text,
  heating_info text,
  general_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_id_workspace_unique unique (id, workspace_id),
  constraint units_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete cascade
);

create index if not exists units_workspace_id_idx on public.units (workspace_id);
create index if not exists units_property_id_idx on public.units (property_id);

-- usable_area_m2 (0031, Betriebskosten U-A) — Nutzflaeche, the MRG section 17
-- allocation key. A NEW column, NOT a reuse of size_m2 above (see 0031's
-- header: size_m2 is untyped/freely-entered, Nutzflaeche is legally defined).
-- NULL = not yet surveyed, never "excluded from the key". `alter table ... add
-- column if not exists` (not inline in the create table above) because that
-- create table is itself `if not exists` and would otherwise never apply this
-- column to an already-existing units table — same idiom as billing_period
-- (0027) / geocoding columns (0024) below.
alter table public.units add column if not exists usable_area_m2 numeric;

do $do$ begin
  alter table public.units
    add constraint units_usable_area_positive
    check (usable_area_m2 is null or usable_area_m2 > 0);
exception when duplicate_object or duplicate_table then null; end $do$;

-- Feeds the U-A pre-run validation "which units of this property still lack a
-- Nutzflaeche" (0031).
create index if not exists units_missing_usable_area_idx
  on public.units (workspace_id, property_id)
  where usable_area_m2 is null;

drop trigger if exists units_set_updated_at on public.units;
create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

alter table public.units enable row level security;

drop policy if exists "units_select_workspace" on public.units;
create policy "units_select_workspace"
  on public.units for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

drop policy if exists "units_insert_manager" on public.units;
create policy "units_insert_manager"
  on public.units for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "units_update_manager" on public.units;
create policy "units_update_manager"
  on public.units for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- =============================================================================
-- VENDORS (0010) — carries unique(id, workspace_id) for ticket composite FKs.
-- =============================================================================
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  service_category public.vendor_category not null default 'OTHER',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_id_workspace_unique unique (id, workspace_id)
);

create index if not exists vendors_workspace_id_idx on public.vendors (workspace_id);

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;

drop policy if exists "vendors_select_workspace" on public.vendors;
create policy "vendors_select_workspace"
  on public.vendors for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

drop policy if exists "vendors_insert_manager" on public.vendors;
create policy "vendors_insert_manager"
  on public.vendors for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "vendors_update_manager" on public.vendors;
create policy "vendors_update_manager"
  on public.vendors for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- =============================================================================
-- TICKETS (0011) — carries inline unique(id, workspace_id).
-- =============================================================================
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  unit_id uuid,
  created_by_user_id uuid not null references public.profiles (id),
  created_for_user_id uuid references public.profiles (id),
  assigned_operator_id uuid references public.profiles (id),
  assigned_vendor_id uuid,
  title text not null,
  description text not null,
  category public.ticket_category not null default 'OTHER',
  priority public.ticket_priority not null default 'NORMAL',
  status public.ticket_status not null default 'NEW',
  estimated_cost numeric,
  actual_cost numeric,
  scheduled_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade,
  constraint tickets_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete set null,
  constraint tickets_vendor_fk
    foreign key (assigned_vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete set null,
  constraint tickets_id_workspace_unique unique (id, workspace_id)
);

create index if not exists tickets_workspace_status_idx on public.tickets (workspace_id, status);
create index if not exists tickets_workspace_assigned_operator_idx on public.tickets (workspace_id, assigned_operator_id);
create index if not exists tickets_workspace_created_by_idx on public.tickets (workspace_id, created_by_user_id);
create index if not exists tickets_workspace_property_idx on public.tickets (workspace_id, property_id);

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- Non-managers: force safe INSERT defaults (status NEW, no assignment/cost/schedule).
create or replace function public.tickets_force_safe_insert_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_workspace_manager() then
    new.status := 'NEW';
    new.assigned_operator_id := null;
    new.assigned_vendor_id := null;
    new.scheduled_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.estimated_cost := null;
    new.actual_cost := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_force_safe_insert_defaults on public.tickets;
create trigger tickets_force_safe_insert_defaults
  before insert on public.tickets
  for each row execute function public.tickets_force_safe_insert_defaults();

alter table public.tickets enable row level security;

drop policy if exists "tickets_select_manager_or_accountant" on public.tickets;
create policy "tickets_select_manager_or_accountant"
  on public.tickets for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- FINAL (0013): widened to created_by OR created_for (on-behalf visibility).
drop policy if exists "tickets_select_own" on public.tickets;
create policy "tickets_select_own"
  on public.tickets for select
  using (
    workspace_id = public.current_workspace_id()
    and (created_by_user_id = auth.uid() or created_for_user_id = auth.uid())
  );

drop policy if exists "tickets_insert_own" on public.tickets;
create policy "tickets_insert_own"
  on public.tickets for insert
  with check (
    workspace_id = public.current_workspace_id()
    and created_by_user_id = auth.uid()
    and coalesce(public.current_is_active(), false)
  );

drop policy if exists "tickets_update_manager" on public.tickets;
create policy "tickets_update_manager"
  on public.tickets for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- =============================================================================
-- TICKET EVENTS (0012) — append-only audit log.
-- =============================================================================
create table if not exists public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ticket_id uuid not null,
  actor_user_id uuid references public.profiles (id),
  actor_type public.actor_type not null default 'USER',
  event_type public.ticket_event_type not null,
  old_value_json jsonb,
  new_value_json jsonb,
  metadata_json jsonb,
  created_at timestamptz not null default now(),
  constraint ticket_events_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade
);

create index if not exists ticket_events_workspace_ticket_idx
  on public.ticket_events (workspace_id, ticket_id);

-- FINAL (0013): user_owns_ticket widened to created_by OR created_for. Needs tickets.
create or replace function public.user_owns_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tickets
    where id = p_ticket_id
      and (created_by_user_id = auth.uid() or created_for_user_id = auth.uid())
  )
$$;

-- Append-only enforcement: block UPDATE/DELETE for EVERY role incl. definer/service_role.
create or replace function public.ticket_events_prevent_mutation()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'ticket_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists ticket_events_no_mutation on public.ticket_events;
create trigger ticket_events_no_mutation
  before update or delete on public.ticket_events
  for each row execute function public.ticket_events_prevent_mutation();

alter table public.ticket_events enable row level security;

drop policy if exists "ticket_events_select_manager_or_accountant" on public.ticket_events;
create policy "ticket_events_select_manager_or_accountant"
  on public.ticket_events for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "ticket_events_insert_manager" on public.ticket_events;
create policy "ticket_events_insert_manager"
  on public.ticket_events for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- Controlled definer funnel for event logging (service-role only).
create or replace function public.log_ticket_event(
  p_workspace_id uuid,
  p_ticket_id uuid,
  p_event_type public.ticket_event_type,
  p_actor_user_id uuid default null,
  p_actor_type public.actor_type default 'USER',
  p_old_value_json jsonb default null,
  p_new_value_json jsonb default null,
  p_metadata_json jsonb default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.ticket_events (
    workspace_id, ticket_id, actor_user_id, actor_type, event_type,
    old_value_json, new_value_json, metadata_json
  ) values (
    p_workspace_id, p_ticket_id, p_actor_user_id, p_actor_type, p_event_type,
    p_old_value_json, p_new_value_json, p_metadata_json
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.log_ticket_event(
  uuid, uuid, public.ticket_event_type, uuid, public.actor_type, jsonb, jsonb, jsonb
) from public;
grant execute on function public.log_ticket_event(
  uuid, uuid, public.ticket_event_type, uuid, public.actor_type, jsonb, jsonb, jsonb
) to service_role;

-- =============================================================================
-- TICKET COMMENTS (0012) — public/internal visibility.
-- =============================================================================
create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ticket_id uuid not null,
  author_user_id uuid not null references public.profiles (id),
  body text not null,
  visibility public.comment_visibility not null default 'PUBLIC',
  type public.comment_type not null default 'MESSAGE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_comments_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade
);

create index if not exists ticket_comments_workspace_ticket_idx
  on public.ticket_comments (workspace_id, ticket_id);

drop trigger if exists ticket_comments_set_updated_at on public.ticket_comments;
create trigger ticket_comments_set_updated_at
  before update on public.ticket_comments
  for each row execute function public.set_updated_at();

alter table public.ticket_comments enable row level security;

drop policy if exists "comments_select_manager" on public.ticket_comments;
create policy "comments_select_manager"
  on public.ticket_comments for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "comments_select_own_public" on public.ticket_comments;
create policy "comments_select_own_public"
  on public.ticket_comments for select
  using (visibility = 'PUBLIC' and public.user_owns_ticket(ticket_id));

drop policy if exists "comments_insert_own_public" on public.ticket_comments;
create policy "comments_insert_own_public"
  on public.ticket_comments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
    and visibility = 'PUBLIC'
    and public.user_owns_ticket(ticket_id)
    and coalesce(public.current_is_active(), false)
  );

drop policy if exists "comments_insert_manager" on public.ticket_comments;
create policy "comments_insert_manager"
  on public.ticket_comments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
    and public.is_workspace_manager()
  );

-- =============================================================================
-- VENDOR JOB TOKENS (0014) — RLS enabled, ZERO policies (service_role only).
-- =============================================================================
create table if not exists public.vendor_job_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ticket_id uuid not null,
  vendor_id uuid not null,
  token_hash text not null unique,
  created_by_user_id uuid not null references public.profiles (id),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint vendor_job_tokens_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade,
  constraint vendor_job_tokens_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete cascade
);

create index if not exists vendor_job_tokens_workspace_ticket_idx
  on public.vendor_job_tokens (workspace_id, ticket_id);

alter table public.vendor_job_tokens enable row level security;
-- Intentionally NO policies: default-deny for anon + authenticated.

-- =============================================================================
-- ATTACHMENTS (0015) — metadata table + private Storage bucket + storage RLS.
-- =============================================================================
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ticket_id uuid not null,
  uploaded_by_user_id uuid references public.profiles (id),
  file_name text not null,
  storage_path text not null unique,
  file_type text not null,
  file_size bigint not null,
  attachment_type public.attachment_type not null default 'OTHER',
  created_at timestamptz not null default now(),
  constraint attachments_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade
);

create index if not exists attachments_workspace_ticket_idx
  on public.attachments (workspace_id, ticket_id);

alter table public.attachments enable row level security;

drop policy if exists "attachments_select_manager_or_accountant" on public.attachments;
create policy "attachments_select_manager_or_accountant"
  on public.attachments for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "attachments_select_own_ticket" on public.attachments;
create policy "attachments_select_own_ticket"
  on public.attachments for select
  using (
    workspace_id = public.current_workspace_id()
    and public.user_owns_ticket(ticket_id)
  );

drop policy if exists "attachments_insert_manager" on public.attachments;
create policy "attachments_insert_manager"
  on public.attachments for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "attachments_insert_own_ticket" on public.attachments;
create policy "attachments_insert_own_ticket"
  on public.attachments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and uploaded_by_user_id = auth.uid()
    and public.user_owns_ticket(ticket_id)
    and coalesce(public.current_is_active(), false)
  );

-- Private Storage bucket.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- storage.objects RLS — keyed on object PATH: workspace_id/ticket_id/<uuid>-<file>.
drop policy if exists "attachments_objects_select" on storage.objects;
create policy "attachments_objects_select"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists "attachments_objects_insert" on storage.objects;
create policy "attachments_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and coalesce(public.current_is_active(), false)
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

-- =============================================================================
-- TENANCIES (0016) — time-ranged occupancy; composite FK to units. PII: role-gated
-- SELECT (NOT open-select), manager-only write, no DELETE.
-- =============================================================================
create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  unit_id uuid not null,
  tenant_name text not null,
  tenant_contact text,
  start_date date not null,
  end_date date,
  rent_amount numeric,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenancies_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete cascade
);

create index if not exists tenancies_workspace_unit_idx
  on public.tenancies (workspace_id, unit_id);

drop trigger if exists tenancies_set_updated_at on public.tenancies;
create trigger tenancies_set_updated_at
  before update on public.tenancies
  for each row execute function public.set_updated_at();

alter table public.tenancies enable row level security;

-- SELECT: ROLE-GATED (tenant PII), NOT open-select. Manager+accountant only, plus
-- SUPER_ADMIN platform read override. TENANT/GUEST/VENDOR get zero rows.
drop policy if exists "tenancies_select_manager_or_accountant" on public.tenancies;
create policy "tenancies_select_manager_or_accountant"
  on public.tenancies for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "tenancies_insert_manager" on public.tenancies;
create policy "tenancies_insert_manager"
  on public.tenancies for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "tenancies_update_manager" on public.tenancies;
create policy "tenancies_update_manager"
  on public.tenancies for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — end a tenancy via end_date; default-deny delete.

-- =============================================================================
-- FINANCE (0017) — income_records + expense_records. Nullable composite FKs to
-- properties/units (+ tickets on expenses). Role-gated SELECT (SUPER_ADMIN/OWNER/
-- OPERATOR/ACCOUNTANT); writes via can_manage_finance() (INCLUDES ACCOUNTANT,
-- EXCLUDES OPERATOR — the inverse of manager writes). No DELETE.
-- =============================================================================
do $do$ begin
  create type public.income_category as enum ('RENT','DEPOSIT','FEE','OTHER');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.expense_category as enum
    ('MAINTENANCE','UTILITIES','TAX','INSURANCE','MANAGEMENT','OTHER');
exception when duplicate_object then null; end $do$;

create table if not exists public.income_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid,
  unit_id uuid,
  amount numeric not null,
  currency text not null default 'EUR',
  category public.income_category not null default 'RENT',
  period_start date not null,
  period_end date,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint income_records_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete set null,
  constraint income_records_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete set null
);

create index if not exists income_records_workspace_id_idx
  on public.income_records (workspace_id);

drop trigger if exists income_records_set_updated_at on public.income_records;
create trigger income_records_set_updated_at
  before update on public.income_records
  for each row execute function public.set_updated_at();

create table if not exists public.expense_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid,
  unit_id uuid,
  ticket_id uuid,
  amount numeric not null,
  currency text not null default 'EUR',
  category public.expense_category not null default 'MAINTENANCE',
  incurred_on date not null,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expense_records_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete set null,
  constraint expense_records_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete set null,
  constraint expense_records_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete set null
);

create index if not exists expense_records_workspace_id_idx
  on public.expense_records (workspace_id);

drop trigger if exists expense_records_set_updated_at on public.expense_records;
create trigger expense_records_set_updated_at
  before update on public.expense_records
  for each row execute function public.set_updated_at();

alter table public.income_records  enable row level security;
alter table public.expense_records enable row level security;

-- SELECT: role-gated (SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT) + SUPER_ADMIN platform
-- read override. OPERATOR reads (cost visibility) but does NOT write (see below).
drop policy if exists "income_records_select_finance" on public.income_records;
create policy "income_records_select_finance"
  on public.income_records for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT/UPDATE: can_manage_finance() (SUPER_ADMIN/OWNER/ACCOUNTANT, NOT OPERATOR).
drop policy if exists "income_records_insert_finance" on public.income_records;
create policy "income_records_insert_finance"
  on public.income_records for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "income_records_update_finance" on public.income_records;
create policy "income_records_update_finance"
  on public.income_records for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "expense_records_select_finance" on public.expense_records;
create policy "expense_records_select_finance"
  on public.expense_records for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "expense_records_insert_finance" on public.expense_records;
create policy "expense_records_insert_finance"
  on public.expense_records for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "expense_records_update_finance" on public.expense_records;
create policy "expense_records_update_finance"
  on public.expense_records for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy on either finance table — default-deny.

-- =============================================================================
-- DOCUMENTS HUB (0018) — general documents repo attached to any entity via per-entity
-- nullable composite-FK columns (property/unit/tenancy/vendor/ticket) — NO polymorphic
-- entity_id, to preserve multi-tenant integrity. PRIVATE Storage bucket + storage RLS.
-- Role-gated SELECT (SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT); writes via
-- is_workspace_manager() (managers incl. OPERATOR; ACCOUNTANT is read-only here — the
-- inverse of finance). No DELETE. Path: workspace_id/<uuid>-<file>.
-- =============================================================================

-- PREREQUISITE: tenancies needs unique(id, workspace_id) for the (tenancy_id,
-- workspace_id) composite FK below. Wrapped in a DO block that swallows
-- duplicate_object/duplicate_table so a re-run (constraint already present) is a no-op.
do $do$ begin
  alter table public.tenancies
    add constraint tenancies_id_workspace_unique unique (id, workspace_id);
exception when duplicate_object or duplicate_table then null; end $do$;

do $do$ begin
  create type public.document_type as enum
    ('LEASE','CONTRACT','PERMIT','CERTIFICATE','INSURANCE','ID','INVOICE','OTHER');
exception when duplicate_object then null; end $do$;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid,
  unit_id uuid,
  tenancy_id uuid,
  vendor_id uuid,
  ticket_id uuid,
  document_type public.document_type not null default 'OTHER',
  title text not null,
  storage_path text not null unique,
  file_type text not null,
  file_size bigint not null,
  expires_at date,
  notes text,
  uploaded_by_user_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade,
  constraint documents_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade,
  constraint documents_tenancy_fk
    foreign key (tenancy_id, workspace_id)
    references public.tenancies (id, workspace_id) on delete cascade,
  constraint documents_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete cascade,
  constraint documents_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade
);

-- documents_id_workspace_unique (0031, Betriebskosten U-A) — additive prerequisite
-- so settlement_cost_positions.document_id can composite-FK back to documents.
-- documents is the only one of properties/units/vendors/tickets/tenancies/
-- invoices/tenants/documents that didn't already carry unique(id, workspace_id).
do $do$ begin
  alter table public.documents
    add constraint documents_id_workspace_unique unique (id, workspace_id);
exception when duplicate_object or duplicate_table then null; end $do$;

create index if not exists documents_workspace_id_idx on public.documents (workspace_id);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

-- SELECT: role-gated (SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT) + SUPER_ADMIN platform
-- read override. TENANT/GUEST/VENDOR get zero rows.
drop policy if exists "documents_select_manager_or_accountant" on public.documents;
create policy "documents_select_manager_or_accountant"
  on public.documents for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT/UPDATE: is_workspace_manager() (SUPER_ADMIN/OWNER/OPERATOR — accountant is
-- read-only here, the inverse of finance). EXPLICIT WITH CHECK blocks workspace-hop.
drop policy if exists "documents_insert_manager" on public.documents;
create policy "documents_insert_manager"
  on public.documents for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "documents_update_manager" on public.documents;
create policy "documents_update_manager"
  on public.documents for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — default-deny.

-- Private Storage bucket.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- storage.objects RLS — keyed on object PATH: workspace_id/<uuid>-<file>. First segment
-- = workspace_id (the cross-workspace lock). SELECT: manager+accountant; INSERT: manager.
drop policy if exists "documents_objects_select" on storage.objects;
create policy "documents_objects_select"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT')
  );

drop policy if exists "documents_objects_insert" on storage.objects;
create policy "documents_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.is_workspace_manager()
  );

-- =============================================================================
-- INVOICES (0019) — flexible invoicing: owner statements, tenant rent invoices, and
-- inbound vendor bills in ONE schema, discriminated by invoice_party_type + direction.
-- Header (invoices) + lines (invoice_line_items, generated amount). Finance-gated writes
-- via can_manage_finance() (OWNER/ACCOUNTANT own the books; OPERATOR read-only). Five
-- nullable composite-FK attribution links. No DELETE on invoices (void via status);
-- line items DO get a gated DELETE (invoice content is editable). All parent
-- unique(id, workspace_id) constraints already exist above (0009/0011/0018).
-- =============================================================================

do $do$ begin
  create type public.invoice_party_type as enum ('OWNER','TENANT','VENDOR','OTHER');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type public.invoice_direction as enum ('OUTBOUND','INBOUND');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type public.invoice_status as enum ('DRAFT','SENT','PARTIAL','PAID','OVERDUE','VOID');
exception when duplicate_object then null; end $do$;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_number text not null,
  party_type public.invoice_party_type not null,
  party_name text not null,
  direction public.invoice_direction not null default 'OUTBOUND',
  status public.invoice_status not null default 'DRAFT',
  property_id uuid,
  unit_id uuid,
  tenancy_id uuid,
  vendor_id uuid,
  ticket_id uuid,
  currency text not null default 'EUR',
  tax_rate numeric not null default 0,
  issue_date date not null default current_date,
  due_date date,
  paid_at timestamptz,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_workspace_unique unique (workspace_id, invoice_number),
  constraint invoices_id_workspace_unique unique (id, workspace_id),
  constraint invoices_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  constraint invoices_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete set null,
  constraint invoices_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete set null,
  constraint invoices_tenancy_fk
    foreign key (tenancy_id, workspace_id)
    references public.tenancies (id, workspace_id) on delete set null,
  constraint invoices_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete set null,
  constraint invoices_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete set null
);

create index if not exists invoices_workspace_id_idx on public.invoices (workspace_id);
create index if not exists invoices_status_idx on public.invoices (workspace_id, status);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null,
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null,
  amount numeric generated always as (quantity * unit_amount) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_line_items_quantity_positive check (quantity > 0),
  constraint invoice_line_items_invoice_fk
    foreign key (invoice_id, workspace_id)
    references public.invoices (id, workspace_id) on delete cascade
);

create index if not exists invoice_line_items_workspace_id_idx on public.invoice_line_items (workspace_id);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);

alter table public.invoices enable row level security;

drop policy if exists "invoices_select_finance" on public.invoices;
create policy "invoices_select_finance"
  on public.invoices for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "invoices_insert_finance" on public.invoices;
create policy "invoices_insert_finance"
  on public.invoices for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "invoices_update_finance" on public.invoices;
create policy "invoices_update_finance"
  on public.invoices for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy on invoices — void via status.

alter table public.invoice_line_items enable row level security;

drop policy if exists "invoice_line_items_select_finance" on public.invoice_line_items;
create policy "invoice_line_items_select_finance"
  on public.invoice_line_items for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "invoice_line_items_insert_finance" on public.invoice_line_items;
create policy "invoice_line_items_insert_finance"
  on public.invoice_line_items for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "invoice_line_items_update_finance" on public.invoice_line_items;
create policy "invoice_line_items_update_finance"
  on public.invoice_line_items for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "invoice_line_items_delete_finance" on public.invoice_line_items;
create policy "invoice_line_items_delete_finance"
  on public.invoice_line_items for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- =============================================================================
-- SEARCH + PERF INDEXES (0020) — trigram GIN for the command-palette ILIKE search +
-- composite btrees for the paginated ticket inbox. Purely additive; idempotent.
-- =============================================================================
create extension if not exists pg_trgm;

create index if not exists properties_name_trgm on public.properties using gin (name gin_trgm_ops);
create index if not exists properties_address_trgm on public.properties using gin (address_line1 gin_trgm_ops);
create index if not exists properties_city_trgm on public.properties using gin (city gin_trgm_ops);
create index if not exists units_label_trgm on public.units using gin (label gin_trgm_ops);
create index if not exists tickets_title_trgm on public.tickets using gin (title gin_trgm_ops);
create index if not exists vendors_company_trgm on public.vendors using gin (company_name gin_trgm_ops);
create index if not exists vendors_contact_trgm on public.vendors using gin (contact_name gin_trgm_ops);
create index if not exists vendors_email_trgm on public.vendors using gin (email gin_trgm_ops);
create index if not exists tenancies_tenant_name_trgm on public.tenancies using gin (tenant_name gin_trgm_ops);
create index if not exists invoices_number_trgm on public.invoices using gin (invoice_number gin_trgm_ops);
create index if not exists invoices_party_name_trgm on public.invoices using gin (party_name gin_trgm_ops);
create index if not exists documents_title_trgm on public.documents using gin (title gin_trgm_ops);

create index if not exists tickets_workspace_created_idx on public.tickets (workspace_id, created_at desc);
create index if not exists tickets_workspace_status_idx on public.tickets (workspace_id, status);

-- INVOICE DELIVERY (0021) — optional recipient email so invoices can be emailed.
alter table public.invoices add column if not exists recipient_email text;

-- RECURRING RENT (0027) — billing_period (first day of the billed month; null for
-- every non-rent invoice) + the partial unique index that is the actual dedupe
-- mechanism for "Generate rent" (src/lib/invoices/recurring.ts plans, the DB
-- guarantees no double-bill even under concurrent clicks). No policy changes —
-- billing_period rides the existing finance-gated invoice policies above (RLS is
-- row-level, not column-level). See migration 0027 for full rationale.
alter table public.invoices add column if not exists billing_period date;

create unique index if not exists invoices_tenancy_period_unique
  on public.invoices (workspace_id, tenancy_id, billing_period)
  where tenancy_id is not null and billing_period is not null and status <> 'VOID';

-- =============================================================================
-- RATE LIMITING (0022) — Postgres-backed fixed-window limiter for login/signup/
-- search/job-token. RLS enabled with ZERO policies (default-deny for anon +
-- authenticated, same lock as vendor_job_tokens/0014) — only service_role, via the
-- SECURITY DEFINER function below, ever touches this table. DO NOT add policies.
-- =============================================================================
create table if not exists public.rate_limit_buckets (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
alter table public.rate_limit_buckets enable row level security;

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

revoke execute on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- =============================================================================
-- DEMO MODE (0023, tenants wipe added in 0025, notifications wipe added in
-- 0026, meters/meter_readings wipe added in 0032) — is_demo workspace flag,
-- synthetic seed identity, the reset_demo_workspace() wipe+reseed function
-- (service_role-only), and demo-workspace exclusion on the storage INSERT
-- policies. See migration 0023's header for the full rationale. Order
-- matters: workspace before profile attach (FK). The function body below is
-- the FINAL state (0023 + 0025's `delete from public.tenants` line + 0026's
-- `delete from public.notifications` line + 0032's meters/meter_readings
-- lines), not the 0023 original — see 0025/0026/0032's headers for why each
-- addition needs wiping too.
-- =============================================================================
alter table public.workspaces add column if not exists is_demo boolean not null default false;
alter table public.workspaces add column if not exists demo_reset_at timestamptz;

insert into public.workspaces (id, name, is_active, is_demo)
values ('11111111-1111-1111-1111-111111111111'::uuid, 'Demo Properties', true, true)
on conflict (id) do update set is_demo = true;

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-00000000d3d0',
  'authenticated', 'authenticated',
  'demo-seed@property-ops.internal',
  null, null,
  '{"provider":"internal","providers":["internal"]}'::jsonb,
  '{"full_name":"Demo Seed"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

update public.profiles
set workspace_id = '11111111-1111-1111-1111-111111111111'::uuid,
    role = 'OWNER',
    is_active = true
where id = '00000000-0000-0000-0000-00000000d3d0'::uuid;

create or replace function public.reset_demo_workspace() returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  demo_ws uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  seed_user uuid := '00000000-0000-0000-0000-00000000d3d0'::uuid;
  prop_ring uuid := '11111111-1111-1111-1111-111111110001'::uuid;
  prop_mhof uuid := '11111111-1111-1111-1111-111111110002'::uuid;
  unit_top1 uuid := '11111111-1111-1111-1111-111111110011'::uuid;
  unit_top2 uuid := '11111111-1111-1111-1111-111111110012'::uuid;
  unit_shop uuid := '11111111-1111-1111-1111-111111110013'::uuid;
  unit_buero uuid := '11111111-1111-1111-1111-111111110014'::uuid;
  vendor_plumb uuid := '11111111-1111-1111-1111-111111110021'::uuid;
  vendor_elec uuid := '11111111-1111-1111-1111-111111110022'::uuid;
  ticket_heat uuid := '11111111-1111-1111-1111-111111110031'::uuid;
  ticket_elec uuid := '11111111-1111-1111-1111-111111110032'::uuid;
  ticket_water uuid := '11111111-1111-1111-1111-111111110033'::uuid;
  tenancy_berger uuid := '11111111-1111-1111-1111-111111110041'::uuid;
  tenancy_cafe uuid := '11111111-1111-1111-1111-111111110042'::uuid;
  invoice_ring uuid := '11111111-1111-1111-1111-111111110051'::uuid;
begin
  delete from public.invoice_line_items where workspace_id = demo_ws;
  delete from public.invoices where workspace_id = demo_ws;
  delete from public.documents where workspace_id = demo_ws;
  delete from public.announcements where workspace_id = demo_ws;
  delete from public.expense_records where workspace_id = demo_ws;
  delete from public.income_records where workspace_id = demo_ws;
  delete from public.notifications where workspace_id = demo_ws;
  delete from public.ticket_comments where workspace_id = demo_ws;
  delete from public.ticket_events where workspace_id = demo_ws;
  delete from public.vendor_job_tokens where workspace_id = demo_ws;
  delete from public.attachments where workspace_id = demo_ws;
  delete from public.tenancies where workspace_id = demo_ws;
  delete from public.tenants where workspace_id = demo_ws;
  delete from public.tickets where workspace_id = demo_ws;
  -- Betriebskosten U-A (0031) — children before parents: unit_allocations
  -- references BOTH settlement_periods and units; allocation_rules and
  -- cost_positions reference settlement_periods; settlement_periods references
  -- properties. No demo seed rows are added for these (operator-only, nothing
  -- to demo yet) — only the wipe needs to happen, same as notifications (0026).
  delete from public.settlement_unit_allocations where workspace_id = demo_ws;
  delete from public.settlement_allocation_rules where workspace_id = demo_ws;
  delete from public.settlement_cost_positions where workspace_id = demo_ws;
  delete from public.settlement_periods where workspace_id = demo_ws;
  -- Betriebskosten U-B (0032) — children before parents: meter_readings
  -- references meters, meters references properties/units. No demo seed rows
  -- are added for these (operator-only, nothing to demo yet) — only the wipe
  -- needs to happen, same as U-A (0031) above.
  delete from public.meter_readings where workspace_id = demo_ws;
  delete from public.meters where workspace_id = demo_ws;
  delete from public.units where workspace_id = demo_ws;
  delete from public.vendors where workspace_id = demo_ws;
  delete from public.properties where workspace_id = demo_ws;

  insert into public.properties (id, workspace_id, name, address_line1, city, postal_code, country, property_type, status)
  values
    (prop_ring, demo_ws, 'Ringstrasse Residenz', 'Ringstrasse 12', 'Wien', '1010', 'Austria', 'APARTMENT_BUILDING', 'ACTIVE'),
    (prop_mhof, demo_ws, 'Mariahilfer Hof', 'Mariahilfer Strasse 88', 'Wien', '1070', 'Austria', 'MIXED_USE', 'ACTIVE');

  insert into public.units (id, workspace_id, property_id, label, floor, occupancy_type, status)
  values
    (unit_top1, demo_ws, prop_ring, 'Top 1', '1', 'LONG_TERM', 'OCCUPIED'),
    (unit_top2, demo_ws, prop_ring, 'Top 2', '2', 'VACANT', 'VACANT'),
    (unit_shop, demo_ws, prop_mhof, 'Shop EG', '0', 'LONG_TERM', 'OCCUPIED'),
    (unit_buero, demo_ws, prop_mhof, 'Buero 1.OG', '1', 'VACANT', 'VACANT');

  insert into public.vendors (id, workspace_id, company_name, contact_name, service_category, is_active)
  values
    (vendor_plumb, demo_ws, 'Wiener Rohrservice GmbH', 'Hans Gruber', 'PLUMBING', true),
    (vendor_elec, demo_ws, 'Elektro Bauer', 'Eva Bauer', 'ELECTRICAL', true);

  -- Tickets
  -- The tickets_force_safe_insert_defaults BEFORE-INSERT trigger treats auth.uid()=null
  -- (true inside this SECURITY DEFINER function) as a non-manager and would flatten the
  -- seeded statuses/costs to NEW/null - disable it around the seed insert (the exact
  -- gotcha hit during the original live seeding; see the demo-mode spec section 2).
  alter table public.tickets disable trigger tickets_force_safe_insert_defaults;

  insert into public.tickets (
    id, workspace_id, property_id, unit_id, created_by_user_id, title, description,
    category, priority, status, assigned_vendor_id, estimated_cost, actual_cost, resolved_at, created_at
  ) values
    (ticket_heat, demo_ws, prop_ring, unit_top1, seed_user, 'Heizung faellt aus',
     'Heating stopped working overnight, tenant reports no hot water either.',
     'HEATING', 'HIGH', 'ASSIGNED', vendor_plumb, 200, null, null, now() - interval '3 days'),
    (ticket_elec, demo_ws, prop_mhof, unit_shop, seed_user, 'Steckdose defekt Kueche',
     'One socket in the shop kitchenette has stopped working.',
     'ELECTRICAL', 'NORMAL', 'NEW', null, null, null, null, now() - interval '1 day'),
    (ticket_water, demo_ws, prop_ring, unit_top1, seed_user, 'Wasserschaden im Bad',
     'Water damage found under the bathroom sink, now repaired.',
     'DAMAGE', 'URGENT', 'RESOLVED', vendor_plumb, 400, 450, now() - interval '2 days', now() - interval '5 days');

  alter table public.tickets enable trigger tickets_force_safe_insert_defaults;

  insert into public.ticket_events (workspace_id, ticket_id, actor_user_id, actor_type, event_type, created_at)
  values
    (demo_ws, ticket_heat, seed_user, 'USER', 'TICKET_CREATED', now() - interval '3 days'),
    (demo_ws, ticket_heat, seed_user, 'USER', 'VENDOR_ASSIGNED', now() - interval '2 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CREATED', now() - interval '5 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CLOSED', now() - interval '2 days');

  insert into public.ticket_comments (workspace_id, ticket_id, author_user_id, body, visibility, type)
  values (demo_ws, ticket_heat, seed_user, 'Vendor scheduled for tomorrow morning.', 'PUBLIC', 'MESSAGE');

  insert into public.tenancies (id, workspace_id, unit_id, tenant_name, start_date, end_date, rent_amount, created_by_user_id)
  values
    (tenancy_berger, demo_ws, unit_top1, 'Familie Berger', current_date - interval '18 months', null, 1250, seed_user),
    (tenancy_cafe, demo_ws, unit_shop, 'Cafe Sonne GmbH', current_date - interval '13 months', current_date + interval '45 days', 2400, seed_user);

  insert into public.income_records (workspace_id, unit_id, amount, category, period_start, period_end, notes, created_by_user_id)
  values
    (demo_ws, unit_top1, 1250, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user),
    (demo_ws, unit_shop, 2400, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user);

  insert into public.expense_records (workspace_id, property_id, unit_id, ticket_id, amount, category, incurred_on, notes, created_by_user_id)
  values
    (demo_ws, null, unit_top1, ticket_water, 450, 'MAINTENANCE', current_date - 2, 'Plumber invoice — water damage repair', seed_user),
    (demo_ws, prop_mhof, null, null, 180, 'UTILITIES', current_date - 5, 'Common-area electricity', seed_user);

  insert into public.documents (workspace_id, document_type, title, storage_path, file_type, file_size, expires_at, tenancy_id, unit_id, uploaded_by_user_id)
  values
    (demo_ws, 'LEASE', 'Lease - Familie Berger (Top 1)', demo_ws::text || '/demo-lease-top1.pdf', 'application/pdf', 210000, null, tenancy_berger, null, seed_user),
    (demo_ws, 'CERTIFICATE', 'Gas safety certificate - Top 1', demo_ws::text || '/demo-cert-top1.pdf', 'application/pdf', 88000, current_date + 25, null, unit_top1, seed_user);

  insert into public.invoices (id, workspace_id, invoice_number, party_type, party_name, direction, status, property_id, issue_date, due_date, created_by_user_id)
  values (invoice_ring, demo_ws, 'DEMO-2026-0001', 'OWNER', 'Demo Owner Co', 'OUTBOUND', 'SENT', prop_ring, current_date - 5, current_date + 25, seed_user);

  insert into public.invoice_line_items (workspace_id, invoice_id, description, quantity, unit_amount, sort_order)
  values (demo_ws, invoice_ring, 'Property management fee — July', 1, 500, 0);

  update public.workspaces set demo_reset_at = now() where id = demo_ws;
end;
$$;

revoke execute on function public.reset_demo_workspace() from public;
grant execute on function public.reset_demo_workspace() to service_role;

-- SEED CALL DEFERRED TO THE END OF THIS BUNDLE: reset_demo_workspace()'s body wipes
-- public.tenants (0025), public.notifications (0026), and public.announcements
-- (0030), all created in later sections below. Defining the function here is fine
-- (plpgsql defers name resolution), but CALLING it must wait until every table it
-- references exists — see the deferred `select public.reset_demo_workspace();` at
-- the very end of the file. (Applying the numbered migrations 0023→0030 in
-- sequence never hit this: each redefinition of the function only referenced
-- tables that already existed at that point.)

drop policy if exists "attachments_objects_insert" on storage.objects;
create policy "attachments_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and coalesce(public.current_is_active(), false)
    and not exists (
      select 1 from public.workspaces w
      where w.id = public.current_workspace_id() and w.is_demo
    )
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists "documents_objects_insert" on storage.objects;
create policy "documents_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.is_workspace_manager()
    and not exists (
      select 1 from public.workspaces w
      where w.id = public.current_workspace_id() and w.is_demo
    )
  );

-- =============================================================================
-- MAP VIEW (0024) — nullable geocode columns on properties (lat/lng + last-success
-- timestamp). NO RLS change: rides the existing properties_select_workspace /
-- properties_insert_manager / properties_update_manager policies (0003) like every
-- other column on this table. See migration 0024 for full rationale.
-- =============================================================================
alter table public.properties add column if not exists latitude    double precision;
alter table public.properties add column if not exists longitude   double precision;
alter table public.properties add column if not exists geocoded_at timestamptz;

-- =============================================================================
-- TENANT DIRECTORY (0025) — `public.tenants`, a directory of tenant CONTACT
-- records (distinct from `tenancies`, the time-ranged LEASE record). PII posture
-- identical to tenancies (0016): role-gated SELECT (manager+accountant, NOT
-- open-select), manager-only write, no DELETE. tenancies.tenant_id is an optional
-- composite FK back to (id, workspace_id) here, `on delete set null`; a NULL
-- tenant_id (every pre-0025 tenancy, and any tenancy left unlinked going forward)
-- keeps tenant_name as the display fallback. See migration 0025 for full rationale
-- (including why the reset_demo_workspace() body above already carries the
-- tenants wipe line as part of its FINAL state).
-- =============================================================================
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  language text,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_id_workspace_unique unique (id, workspace_id)
);

create index if not exists tenants_workspace_id_idx on public.tenants (workspace_id);
create index if not exists tenants_full_name_trgm on public.tenants using gin (full_name gin_trgm_ops);
create index if not exists tenants_email_trgm on public.tenants using gin (email gin_trgm_ops);

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

alter table public.tenants enable row level security;

-- SELECT: ROLE-GATED (tenant PII), NOT open-select. Manager+accountant only, plus
-- SUPER_ADMIN platform read override. TENANT/GUEST/VENDOR get zero rows.
drop policy if exists "tenants_select_manager_or_accountant" on public.tenants;
create policy "tenants_select_manager_or_accountant"
  on public.tenants for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "tenants_insert_manager" on public.tenants;
create policy "tenants_insert_manager"
  on public.tenants for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "tenants_update_manager" on public.tenants;
create policy "tenants_update_manager"
  on public.tenants for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — directory entries are history-bearing; default-deny delete.

-- PREREQUISITE for the link below: tenants needs unique(id, workspace_id), added
-- inline above. Wrapped in a DO block that swallows duplicate_object/
-- duplicate_table so a re-run (column/constraint already present) is a no-op —
-- same guard shape as the tenancies_id_workspace_unique prerequisite in 0018.
alter table public.tenancies add column if not exists tenant_id uuid;

do $do$ begin
  alter table public.tenancies
    add constraint tenancies_tenant_fk
    foreign key (tenant_id, workspace_id)
    references public.tenants (id, workspace_id)
    on delete set null;
exception when duplicate_object or duplicate_table then null; end $do$;

-- =============================================================================
-- NOTIFICATIONS (0026) — `public.notifications`, a per-user inbox of in-app
-- pings for events the system already emits (ticket assignment, status
-- change, comment). Written by src/lib/notifications/notify-inapp.ts, called
-- from the same src/app/(app)/tickets/actions.ts server actions that already
-- fire the Phase-4 email hooks. RLS is STRICTLY OWN-INBOX — a deliberate
-- deviation from the tenants/tenancies PII pattern: no manager/SUPER_ADMIN
-- read-all override. INSERT is ZERO POLICY (service_role-only, same lock as
-- vendor_job_tokens/0014); no DELETE policy. See migration 0026 for full
-- rationale (including the ACCEPTED LIMITATION on the UPDATE policy's WITH
-- CHECK, and why the reset_demo_workspace() body above already carries the
-- notifications wipe line as part of its FINAL state).
-- =============================================================================
do $do$ begin
  create type public.notification_type as enum
    ('TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_COMMENT',
     'ANNOUNCEMENT_PUBLISHED');  -- 0034 (fresh installs get it here; the 0034
                                 -- section at the end covers existing databases)
exception when duplicate_object then null; end $do$;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text,
  href text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- SELECT: strictly own-inbox. NO manager/SUPER_ADMIN override (deliberate).
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select
  using (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  );

-- UPDATE (mark-read): same predicate on both sides.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update
  using (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  )
  with check (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  );

-- INSERT: ZERO POLICY — intentional, service_role-only. No DELETE policy.

-- =============================================================================
-- AUTH AUDIT TRAIL (0028) — `public.auth_events`, an append-only security
-- audit log for auth-adjacent actions (login/signup/sign-out, password
-- change, MFA challenge outcomes, invite, deactivation). Written by
-- src/lib/audit/log-auth-event.ts (`logAuthEvent`), best-effort/never-throw
-- (a write failure must never block/delay/error the auth action that
-- triggered it — see migration 0028 header). SELECT is admin-only
-- (can_manage_users() — SUPER_ADMIN/OWNER, matching how /settings/users
-- gates its own admin surface) plus a SUPER_ADMIN platform-wide override;
-- INSERT is ZERO POLICY (service_role-only, same lock as notifications/
-- rate_limit_buckets/vendor_job_tokens); UPDATE/DELETE are blocked by BOTH
-- RLS (no policy for either) AND a hard append-only trigger, mirroring
-- ticket_events. See migration 0028 for full rationale, including why the
-- enum here is a superset of the security-hardening spec's §S2.2 event list.
-- =============================================================================
do $do$ begin
  create type public.auth_event_type as enum (
    'LOGIN_SUCCESS',
    'LOGIN_FAILURE',
    'SIGNUP_SUCCESS',
    'SIGN_OUT',
    'PASSWORD_CHANGE',
    'INVITE_SENT',
    'DEACTIVATION',
    'MFA_CHALLENGE_SUCCESS',
    'MFA_CHALLENGE_FAILURE'
  );
exception when duplicate_object then null; end $do$;

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  actor_user_id uuid references public.profiles (id) on delete set null,
  event_type public.auth_event_type not null,
  email text,
  ip text,
  user_agent text,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_events_workspace_created_idx
  on public.auth_events (workspace_id, created_at desc);

-- APPEND-ONLY ENFORCEMENT — mirrors ticket_events_prevent_mutation.
create or replace function public.auth_events_prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'auth_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists auth_events_no_mutation on public.auth_events;
create trigger auth_events_no_mutation
  before update or delete on public.auth_events
  for each row execute function public.auth_events_prevent_mutation();

alter table public.auth_events enable row level security;

-- SELECT: admin-only (can_manage_users()), own workspace, plus SUPER_ADMIN
-- platform-wide override (also covers workspace_id IS NULL rows — see 0028).
drop policy if exists "auth_events_select_admin" on public.auth_events;
create policy "auth_events_select_admin"
  on public.auth_events for select
  using (
    (workspace_id = public.current_workspace_id() and public.can_manage_users())
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT: ZERO POLICY — intentional, service_role-only.
-- No UPDATE/DELETE policy — intentional; reinforced by the trigger above.

-- =============================================================================
-- TENANT PORTAL LINK (0029) — links a `tenants` directory CONTACT (0025) to a real
-- Supabase Auth account so a resident can reach /portal. Additive: the 0025
-- manager/accountant-read + manager-write policies are untouched; this only ADDS a
-- tenant-own-row SELECT. The own-row policy conjoins workspace_id =
-- current_workspace_id() (beyond a bare auth_user_id = auth.uid()) so a stale link
-- can never leak another workspace's contact PII after a profile is moved. Written
-- only by the manager-gated inviteTenantToPortal action (service role); no tenant
-- write policy of any kind. See migration 0029 for full rationale.
-- =============================================================================
alter table public.tenants
  add column if not exists auth_user_id uuid references auth.users (id) on delete set null;

create unique index if not exists tenants_auth_user_unique
  on public.tenants (workspace_id, auth_user_id)
  where auth_user_id is not null;

drop policy if exists "tenants_select_own" on public.tenants;
create policy "tenants_select_own"
  on public.tenants for select
  using (
    auth_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
  );

-- =============================================================================
-- TENANT PORTAL READ-SURFACES (0030) — Phase 1B. A linked tenant (0029 gave them a
-- portal LOGIN) still could not read their OWN lease, documents, or invoices —
-- those tables are role-gated to managers+accountant, correctly excluding TENANT/
-- GUEST from the workspace ROSTER but also excluding a tenant from their own
-- single row. Four ADDITIVE tenant SELECT policies (tenancies, documents,
-- invoices, invoice_line_items) + one new table (announcements). TENANT holds
-- ZERO app-layer permissions; every guarantee here is RLS-enforced. See migration
-- 0030 for full rationale (this section must be placed AFTER the TENANT PORTAL
-- LINK (0029) block above: current_tenant_id() reads tenants.auth_user_id, which
-- that block is what adds).
-- =============================================================================

-- --- SECTION A: MY HOME — a tenant reads their OWN tenancy/tenancies ----------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.tenants
  where auth_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    -- LOW finding (RLS review 0030): a DEACTIVATED tenant (profiles.is_active=false)
    -- reads nothing. Gating here fails closed for BOTH tenancies_select_own_tenant and
    -- the invoice helper (both resolve the caller via current_tenant_id()), matching
    -- Section D's explicit is_active gate. requireUser already blocks the app pages;
    -- this is the RLS-layer defense in depth.
    and coalesce(public.current_is_active(), false)
$$;

drop policy if exists "tenancies_select_own_tenant" on public.tenancies;
create policy "tenancies_select_own_tenant"
  on public.tenancies for select
  using (
    workspace_id = public.current_workspace_id()
    and tenant_id is not null
    and tenant_id = public.current_tenant_id()
  );

-- --- SECTION B: DOCUMENTS — a tenant reads documents attached to their OWN
--     tenancy / unit / property -------------------------------------------------
create or replace function public.tenant_can_read_document(
  p_property_id uuid, p_unit_id uuid, p_tenancy_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_is_active(), false) and exists (
    select 1
    from public.tenants t
    join public.tenancies tn
      on tn.tenant_id = t.id and tn.workspace_id = t.workspace_id
    left join public.units u
      on u.id = tn.unit_id and u.workspace_id = tn.workspace_id
    where t.auth_user_id = auth.uid()
      and t.workspace_id = public.current_workspace_id()
      and (
           -- own lease: exact tenancy match, current OR past — a resident always sees
           -- their OWN historical lease (tenancy_id is a single-row identifier, safe).
           (p_tenancy_id is not null and p_tenancy_id = tn.id)
           -- HIGH finding (RLS review 0030): unit/property attribution is a SHARED
           -- identifier, so gate these arms to an ACTIVE tenancy (same start/end filter
           -- as Section D's announcements). Otherwise a FORMER tenant of the unit keeps
           -- reading documents a manager later attaches at the unit/property level for
           -- the NEW occupant (lease, ID, insurance) — a cross-tenant PII leak.
        or (p_unit_id is not null and p_unit_id = tn.unit_id
            and tn.start_date <= current_date
            and (tn.end_date is null or tn.end_date >= current_date))
        or (p_property_id is not null and p_property_id = u.property_id
            and tn.start_date <= current_date
            and (tn.end_date is null or tn.end_date >= current_date))
      )
  )
$$;

drop policy if exists "documents_select_own_tenant" on public.documents;
create policy "documents_select_own_tenant"
  on public.documents for select
  using (
    workspace_id = public.current_workspace_id()
    and public.tenant_can_read_document(property_id, unit_id, tenancy_id)
  );

-- --- SECTION C: MY CHARGES — a tenant reads their OWN invoices + line items ---
create or replace function public.invoice_visible_to_current_tenant(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices inv
    join public.tenancies tn
      on tn.id = inv.tenancy_id
     and tn.workspace_id = inv.workspace_id
    where inv.id = p_invoice_id
      and inv.workspace_id = public.current_workspace_id()
      and inv.direction = 'OUTBOUND'
      and inv.status <> 'DRAFT'
      and tn.tenant_id = public.current_tenant_id()
  )
$$;

drop policy if exists "invoices_select_own_tenant" on public.invoices;
create policy "invoices_select_own_tenant"
  on public.invoices for select
  using (public.invoice_visible_to_current_tenant(id));

drop policy if exists "invoice_line_items_select_own_tenant" on public.invoice_line_items;
create policy "invoice_line_items_select_own_tenant"
  on public.invoice_line_items for select
  using (public.invoice_visible_to_current_tenant(invoice_id));

-- --- SECTION D: ANNOUNCEMENTS — manager-composed, tenant-read building notices -
do $do$ begin
  create type public.announcement_status as enum ('DRAFT', 'PUBLISHED');
exception when duplicate_object then null; end $do$;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid,
  title text not null,
  body  text not null,
  status public.announcement_status not null default 'DRAFT',
  published_at timestamptz,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade
);

create index if not exists announcements_workspace_status_idx
  on public.announcements (workspace_id, status, published_at desc);

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

create or replace function public.tenant_can_read_announcement(a_workspace_id uuid, a_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    a_workspace_id = public.current_workspace_id()
    and public.current_role() in ('TENANT', 'GUEST')
    and coalesce(public.current_is_active(), false)
    and (
      a_property_id is null
      or exists (
        select 1
        from public.tenants t
        join public.tenancies ten on ten.tenant_id = t.id and ten.workspace_id = t.workspace_id
        join public.units u       on u.id = ten.unit_id      and u.workspace_id = ten.workspace_id
        where t.auth_user_id = auth.uid()
          and t.workspace_id = a_workspace_id
          and u.property_id = a_property_id
          and ten.start_date <= current_date
          and (ten.end_date is null or ten.end_date >= current_date)
      )
    )
$$;

drop policy if exists "announcements_select_published_for_tenant" on public.announcements;
create policy "announcements_select_published_for_tenant"
  on public.announcements for select
  using (status = 'PUBLISHED' and public.tenant_can_read_announcement(workspace_id, property_id));

drop policy if exists "announcements_select_manager_or_accountant" on public.announcements;
create policy "announcements_select_manager_or_accountant"
  on public.announcements for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "announcements_insert_manager" on public.announcements;
create policy "announcements_insert_manager"
  on public.announcements for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

drop policy if exists "announcements_update_manager" on public.announcements;
create policy "announcements_update_manager"
  on public.announcements for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — matches the no-DELETE convention. See migration 0030 for
-- full smoke-test list (23 scenarios across sections A-D).

-- =============================================================================
-- BETRIEBSKOSTEN U-A (0031) — Austrian annual operating-cost settlement core,
-- OPERATOR-ONLY (finance-scoped RLS, no tenant-facing policy — that is U-C's
-- job). Four new tables (settlement_periods, settlement_cost_positions,
-- settlement_allocation_rules, settlement_unit_allocations) + units.usable_area_m2
-- (Nutzflaeche, MRG section 17 key) + the section 21 chargeable-cost catalog
-- enum (deliberately no 'OTHER' member — see migration 0031 for the full legal
-- spine and every risk/rationale note; this section is a byte-for-byte fold).
-- =============================================================================

do $do$ begin
  create type public.operating_cost_category as enum (
    'WATER_SEWER','DRAIN_CLEANING','WASTE_DISPOSAL','PEST_CONTROL','CHIMNEY_SWEEP',
    'COMMON_ELECTRICITY','INSURANCE_FIRE','INSURANCE_LIABILITY',
    'INSURANCE_WATER_DAMAGE','INSURANCE_OTHER','PUBLIC_CHARGES','MANAGEMENT_FEE',
    'CARETAKER','CLEANING','SNOW_REMOVAL','GARDEN_MAINTENANCE','ELEVATOR',
    'COMMON_FACILITY_OTHER'
  );
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.allocation_basis as enum ('USABLE_AREA', 'PER_UNIT');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.settlement_status as enum ('DRAFT', 'ALLOCATED', 'FINALIZED', 'VOID');
exception when duplicate_object then null; end $do$;

create table if not exists public.settlement_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  label text not null,
  period_start date not null,
  period_end   date not null,
  currency text not null default 'EUR',
  status public.settlement_status not null default 'DRAFT',
  disclosure_deadline date,
  finalized_at timestamptz,
  finalized_by_user_id uuid references public.profiles (id),
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_periods_id_workspace_unique unique (id, workspace_id),
  constraint settlement_periods_property_range_unique
    unique (workspace_id, property_id, period_start, period_end),
  constraint settlement_periods_range_valid
    check (period_end > period_start and period_end - period_start <= 366),
  constraint settlement_periods_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade
);

create index if not exists settlement_periods_workspace_property_idx
  on public.settlement_periods (workspace_id, property_id, period_start desc);
create index if not exists settlement_periods_workspace_status_idx
  on public.settlement_periods (workspace_id, status);

drop trigger if exists settlement_periods_set_updated_at on public.settlement_periods;
create trigger settlement_periods_set_updated_at
  before update on public.settlement_periods
  for each row execute function public.set_updated_at();

create table if not exists public.settlement_cost_positions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,
  category public.operating_cost_category not null,
  amount numeric not null,
  paid_on date not null,
  service_period_start date,
  service_period_end   date,
  supplier_name text,
  description text,
  note text,
  document_id uuid,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_cost_positions_amount_nonneg check (amount >= 0),
  constraint settlement_cost_positions_service_range
    check (service_period_end is null or service_period_start is null
           or service_period_end >= service_period_start),
  constraint settlement_cost_positions_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade,
  constraint settlement_cost_positions_document_fk
    foreign key (document_id, workspace_id)
    references public.documents (id, workspace_id) on delete set null
);

create index if not exists settlement_cost_positions_period_category_idx
  on public.settlement_cost_positions (workspace_id, settlement_period_id, category);

drop trigger if exists settlement_cost_positions_set_updated_at on public.settlement_cost_positions;
create trigger settlement_cost_positions_set_updated_at
  before update on public.settlement_cost_positions
  for each row execute function public.set_updated_at();

create table if not exists public.settlement_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,
  category public.operating_cost_category,
  basis public.allocation_basis not null default 'USABLE_AREA',
  owner_deduction_pct numeric not null default 0,
  consumption_split_pct numeric,
  base_split_basis public.allocation_basis,
  note text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_allocation_rules_owner_pct_range
    check (owner_deduction_pct >= 0 and owner_deduction_pct <= 100),
  constraint settlement_allocation_rules_consumption_pct_range
    check (consumption_split_pct is null
           or (consumption_split_pct >= 0 and consumption_split_pct <= 100)),
  constraint settlement_allocation_rules_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade
);

create unique index if not exists settlement_allocation_rules_default_unique
  on public.settlement_allocation_rules (workspace_id, settlement_period_id)
  where category is null;
create unique index if not exists settlement_allocation_rules_category_unique
  on public.settlement_allocation_rules (workspace_id, settlement_period_id, category)
  where category is not null;

drop trigger if exists settlement_allocation_rules_set_updated_at on public.settlement_allocation_rules;
create trigger settlement_allocation_rules_set_updated_at
  before update on public.settlement_allocation_rules
  for each row execute function public.set_updated_at();

create table if not exists public.settlement_unit_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,
  unit_id uuid not null,
  category public.operating_cost_category not null,
  basis public.allocation_basis not null,
  category_gross_amount numeric not null,
  owner_deduction_pct numeric not null default 0,
  allocatable_amount numeric not null,
  unit_basis_value numeric not null,
  total_basis_value numeric not null,
  share_pct numeric generated always as (
    case when total_basis_value = 0 then 0
         else unit_basis_value / total_basis_value * 100 end
  ) stored,
  amount numeric not null,
  computed_at timestamptz not null default now(),
  computed_by_user_id uuid not null references public.profiles (id),
  constraint settlement_unit_allocations_id_workspace_unique unique (id, workspace_id),
  constraint settlement_unit_allocations_grain_unique
    unique (workspace_id, settlement_period_id, unit_id, category),
  constraint settlement_unit_allocations_total_basis_positive
    check (total_basis_value > 0),
  constraint settlement_unit_allocations_unit_basis_nonneg
    check (unit_basis_value >= 0),
  constraint settlement_unit_allocations_owner_pct_range
    check (owner_deduction_pct >= 0 and owner_deduction_pct <= 100),
  constraint settlement_unit_allocations_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade,
  constraint settlement_unit_allocations_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade
);

create index if not exists settlement_unit_allocations_workspace_unit_idx
  on public.settlement_unit_allocations (workspace_id, unit_id);

-- --- Finalization lock — trigger guards (section 7 of migration 0031) --------
create or replace function public.settlement_period_is_locked(p_period_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.settlement_periods
    where id = p_period_id and workspace_id = p_workspace_id
      and status in ('FINALIZED', 'VOID')
  )
$$;

-- RLS-review finding (0031, cross-workspace lens): this helper is SECURITY DEFINER
-- and is NOT referenced from any USING/WITH CHECK clause -- its only caller is the
-- settlement_child_lock_guard() trigger below. Without an explicit revoke it keeps
-- Postgres's default PUBLIC EXECUTE grant, so PostgREST auto-exposes it as
-- rpc/settlement_period_is_locked, callable by anon/authenticated. Because it is
-- SECURITY DEFINER it bypasses RLS, so any caller supplying a (period_id,
-- workspace_id) pair from ANOTHER workspace could learn whether that period is
-- FINALIZED/VOID -- a cross-workspace authorization leak. Same revoke+grant pair as
-- log_ticket_event (0012), check_rate_limit (0022) and reset_demo_workspace (0023).
-- The trigger's internal call is unaffected: function-to-function calls are checked
-- against the definer/owner's privileges, not PUBLIC's. (The two trigger-returning
-- guards below need no revoke -- Postgres refuses to execute a `returns trigger`
-- function outside trigger context and PostgREST does not expose them as RPC, which
-- is why set_updated_at() and friends carry none either.)
revoke execute on function public.settlement_period_is_locked(uuid, uuid) from public;
grant execute on function public.settlement_period_is_locked(uuid, uuid) to service_role;

create or replace function public.settlement_child_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period uuid;
  v_ws uuid;
begin
  v_period := coalesce(new.settlement_period_id, old.settlement_period_id);
  v_ws     := coalesce(new.workspace_id, old.workspace_id);
  if public.settlement_period_is_locked(v_period, v_ws) then
    raise exception 'settlement period is finalized: % on % is not permitted', tg_op, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists settlement_cost_positions_lock_guard on public.settlement_cost_positions;
create trigger settlement_cost_positions_lock_guard
  before insert or update or delete on public.settlement_cost_positions
  for each row execute function public.settlement_child_lock_guard();

drop trigger if exists settlement_allocation_rules_lock_guard on public.settlement_allocation_rules;
create trigger settlement_allocation_rules_lock_guard
  before insert or update or delete on public.settlement_allocation_rules
  for each row execute function public.settlement_child_lock_guard();

drop trigger if exists settlement_unit_allocations_lock_guard on public.settlement_unit_allocations;
create trigger settlement_unit_allocations_lock_guard
  before insert or update or delete on public.settlement_unit_allocations
  for each row execute function public.settlement_child_lock_guard();

create or replace function public.settlement_cost_position_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
begin
  select period_start, period_end into v_start, v_end
    from public.settlement_periods
   where id = new.settlement_period_id and workspace_id = new.workspace_id;
  if v_start is not null and (new.paid_on < v_start or new.paid_on > v_end) then
    raise exception 'paid_on % is outside the settlement period % .. % (Abflussprinzip: a cost belongs to the year it was PAID)',
      new.paid_on, v_start, v_end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists settlement_cost_positions_period_guard on public.settlement_cost_positions;
create trigger settlement_cost_positions_period_guard
  before insert or update on public.settlement_cost_positions
  for each row execute function public.settlement_cost_position_period_guard();

-- --- RLS: finance-scoped (0019 invoices shape), NO tenant policy in this slice --
alter table public.settlement_periods enable row level security;

drop policy if exists "settlement_periods_select_finance" on public.settlement_periods;
create policy "settlement_periods_select_finance"
  on public.settlement_periods for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "settlement_periods_insert_finance" on public.settlement_periods;
create policy "settlement_periods_insert_finance"
  on public.settlement_periods for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_periods_update_finance" on public.settlement_periods;
create policy "settlement_periods_update_finance"
  on public.settlement_periods for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.settlement_cost_positions enable row level security;

drop policy if exists "settlement_cost_positions_select_finance" on public.settlement_cost_positions;
create policy "settlement_cost_positions_select_finance"
  on public.settlement_cost_positions for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "settlement_cost_positions_insert_finance" on public.settlement_cost_positions;
create policy "settlement_cost_positions_insert_finance"
  on public.settlement_cost_positions for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_cost_positions_update_finance" on public.settlement_cost_positions;
create policy "settlement_cost_positions_update_finance"
  on public.settlement_cost_positions for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_cost_positions_delete_finance" on public.settlement_cost_positions;
create policy "settlement_cost_positions_delete_finance"
  on public.settlement_cost_positions for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.settlement_allocation_rules enable row level security;

drop policy if exists "settlement_allocation_rules_select_finance" on public.settlement_allocation_rules;
create policy "settlement_allocation_rules_select_finance"
  on public.settlement_allocation_rules for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "settlement_allocation_rules_insert_finance" on public.settlement_allocation_rules;
create policy "settlement_allocation_rules_insert_finance"
  on public.settlement_allocation_rules for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_allocation_rules_update_finance" on public.settlement_allocation_rules;
create policy "settlement_allocation_rules_update_finance"
  on public.settlement_allocation_rules for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_allocation_rules_delete_finance" on public.settlement_allocation_rules;
create policy "settlement_allocation_rules_delete_finance"
  on public.settlement_allocation_rules for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.settlement_unit_allocations enable row level security;

drop policy if exists "settlement_unit_allocations_select_finance" on public.settlement_unit_allocations;
create policy "settlement_unit_allocations_select_finance"
  on public.settlement_unit_allocations for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "settlement_unit_allocations_insert_finance" on public.settlement_unit_allocations;
create policy "settlement_unit_allocations_insert_finance"
  on public.settlement_unit_allocations for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_unit_allocations_update_finance" on public.settlement_unit_allocations;
create policy "settlement_unit_allocations_update_finance"
  on public.settlement_unit_allocations for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "settlement_unit_allocations_delete_finance" on public.settlement_unit_allocations;
create policy "settlement_unit_allocations_delete_finance"
  on public.settlement_unit_allocations for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No tenant policy anywhere above — U-C's job (see migration 0031 for the
-- specified seam: an additive policy routed through a dedicated SECURITY
-- DEFINER helper, never an inline EXISTS against tenancies/units). See
-- migration 0031 for the full 12-scenario smoke-test list.

-- =============================================================================
-- Migration 0032: Betriebskosten U-B — meters, meter readings, measured
--                  consumption basis, and the HeizKG heat/hot-water split.
--                  See supabase/migrations/0032_betriebskosten_meters.sql for
--                  the full rationale (enum-value commit boundary, legal
--                  spine, structural-prevention design). OPERATOR-ONLY, same
--                  RLS shape as 0031 — NO tenant-facing policy in this file.
-- =============================================================================

-- PART 1: enum value additions. MUST commit before anything below uses them
-- (Postgres forbids using a freshly-added enum value inside the same
-- transaction that added it — see the migration file's PART 1 note; this
-- matters here specifically because the WHOLE bundle is one paste = one
-- implicit transaction unless a commit interrupts it).
alter type public.operating_cost_category add value if not exists 'HEATING';
alter type public.operating_cost_category add value if not exists 'HOT_WATER';
alter type public.allocation_basis add value if not exists 'CONSUMPTION';

commit;

do $do$ begin
  create type public.meter_kind as enum ('HEAT', 'HOT_WATER', 'COLD_WATER', 'ELECTRICITY', 'GAS');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.meter_reading_source as enum ('MANUAL', 'IMPORT');
exception when duplicate_object then null; end $do$;

-- PART 3: meters
create table if not exists public.meters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  unit_id uuid, -- null = a property/common-area meter
  kind public.meter_kind not null,
  serial_number text,
  unit_of_measure text not null,
  multiplier numeric not null default 1,
  is_active boolean not null default true,
  installed_at date,
  removed_at date,
  note text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meters_id_workspace_unique unique (id, workspace_id),
  constraint meters_multiplier_positive check (multiplier > 0 and multiplier is not null),
  constraint meters_removed_after_installed
    check (removed_at is null or installed_at is null or removed_at >= installed_at),

  constraint meters_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade,
  constraint meters_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade
);

create index if not exists meters_workspace_property_idx
  on public.meters (workspace_id, property_id);
create index if not exists meters_workspace_unit_idx
  on public.meters (workspace_id, unit_id) where unit_id is not null;

drop trigger if exists meters_set_updated_at on public.meters;
create trigger meters_set_updated_at
  before update on public.meters
  for each row execute function public.set_updated_at();

create or replace function public.meters_unit_property_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_property uuid;
begin
  if new.unit_id is null then
    return new;
  end if;
  select property_id into v_unit_property
    from public.units
   where id = new.unit_id and workspace_id = new.workspace_id;
  if v_unit_property is null or v_unit_property <> new.property_id then
    raise exception 'meter unit_id % does not belong to property %', new.unit_id, new.property_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists meters_unit_property_guard on public.meters;
create trigger meters_unit_property_guard
  before insert or update on public.meters
  for each row execute function public.meters_unit_property_guard();

-- RLS-review finding (0032): the guard above validates the unit/property pair at
-- ATTACH time, but it only fires on writes to `meters` -- nothing re-validates it
-- afterwards. `units_update_manager` (0009) carries no column restriction (RLS
-- cannot restrict columns, and there is no column-level GRANT), and the app talks
-- to PostgREST with the anon key, so `UpdateUnitInput` omitting propertyId is a
-- TypeScript-only convention, not an enforced one: any workspace manager can PATCH
-- /rest/v1/units and move a unit to another property. That leaves every meter on
-- that unit carrying a now-stale `property_id`, silently feeding the OLD property's
-- HeizKG settlement with the NEW property's measured consumption -- a misattributed
-- legal billing document, and precisely the failure the guard above claims to
-- prevent. The realistic trigger is not malice but a legitimate correction of a
-- data-entry error.
--
-- BLOCK rather than cascade, deliberately: silently rewriting meters.property_id
-- would move a meter into a different property's settlement with nobody noticing,
-- which is worse for a document someone is legally accountable for. Detach or
-- delete the meters first, then move the unit -- an explicit, auditable act.
create or replace function public.units_property_move_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meter_count integer;
begin
  if new.property_id is not distinct from old.property_id then
    return new;
  end if;
  select count(*) into v_meter_count
    from public.meters
   where unit_id = old.id and workspace_id = old.workspace_id;
  if v_meter_count > 0 then
    raise exception
      'cannot move unit % to another property while % meter(s) are attached to it; detach or delete them first',
      old.id, v_meter_count
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists units_property_move_guard on public.units;
create trigger units_property_move_guard
  before update on public.units
  for each row execute function public.units_property_move_guard();

alter table public.meters enable row level security;

drop policy if exists "meters_select_finance" on public.meters;
create policy "meters_select_finance"
  on public.meters for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "meters_insert_finance" on public.meters;
create policy "meters_insert_finance"
  on public.meters for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "meters_update_finance" on public.meters;
create policy "meters_update_finance"
  on public.meters for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "meters_delete_finance" on public.meters;
create policy "meters_delete_finance"
  on public.meters for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- PART 4: meter_readings
create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meter_id uuid not null,
  reading_date date not null,
  value numeric not null,
  source public.meter_reading_source not null default 'MANUAL',
  note text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meter_readings_id_workspace_unique unique (id, workspace_id),
  constraint meter_readings_value_nonneg check (value >= 0),
  constraint meter_readings_meter_date_unique unique (workspace_id, meter_id, reading_date),

  constraint meter_readings_meter_fk
    foreign key (meter_id, workspace_id)
    references public.meters (id, workspace_id) on delete cascade
);

drop trigger if exists meter_readings_set_updated_at on public.meter_readings;
create trigger meter_readings_set_updated_at
  before update on public.meter_readings
  for each row execute function public.set_updated_at();

alter table public.meter_readings enable row level security;

drop policy if exists "meter_readings_select_finance" on public.meter_readings;
create policy "meter_readings_select_finance"
  on public.meter_readings for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

drop policy if exists "meter_readings_insert_finance" on public.meter_readings;
create policy "meter_readings_insert_finance"
  on public.meter_readings for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "meter_readings_update_finance" on public.meter_readings;
create policy "meter_readings_update_finance"
  on public.meter_readings for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

drop policy if exists "meter_readings_delete_finance" on public.meter_readings;
create policy "meter_readings_delete_finance"
  on public.meter_readings for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- PART 5: settlement_allocation_rules — activate the U-B seam columns
alter table public.settlement_allocation_rules
  add column if not exists heat_split_min_pct numeric default 55,
  add column if not exists heat_split_max_pct numeric default 75;

do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_heat_split_bounds_sane
    check (
      -- RLS-review CRITICAL: these bounds used to be free-form 0..100, and the
      -- in-bounds check below only tested the configured share against the
      -- operator's OWN configured bound -- circular. min=0/max=100/split=0 passed
      -- every constraint and produced a heating statement billed 100% on area and
      -- 0% on measured consumption: exactly the unlawful pure-area heat statement
      -- HeizKG section 4 forbids and this migration claims to prevent. The bounds are
      -- now clamped to the STATUTORY ENVELOPE [50, 75] -- the union of Austria's
      -- HeizKG 55-75 and Germany's HeizkostenV 50-70 -- so a jurisdiction may NARROW
      -- the range but nobody can widen it into an unlawful configuration.
      heat_split_min_pct is null or heat_split_max_pct is null
      or (
        heat_split_min_pct >= 50 and heat_split_min_pct <= 75
        and heat_split_max_pct >= 50 and heat_split_max_pct <= 75
        and heat_split_min_pct <= heat_split_max_pct
      )
    );
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_consumption_pct_in_bounds
    check (
      consumption_split_pct is null
      or heat_split_min_pct is null or heat_split_max_pct is null
      or (consumption_split_pct >= heat_split_min_pct and consumption_split_pct <= heat_split_max_pct)
    );
exception when duplicate_object then null; end $do$;

-- ...and, independently of ANY operator-supplied bound, the share itself must sit
-- inside the statutory envelope. Belt-and-braces with the clamped bounds above: this
-- one still holds if a future migration ever loosens or drops them.
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_consumption_pct_statutory
    check (
      consumption_split_pct is null
      or (consumption_split_pct >= 50 and consumption_split_pct <= 75)
    );
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_heat_category_requires_consumption_basis
    check (category not in ('HEATING', 'HOT_WATER') or basis = 'CONSUMPTION');
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_consumption_basis_requires_fields
    check (
      basis <> 'CONSUMPTION'
      or (
        consumption_split_pct is not null
        and base_split_basis is not null
        and heat_split_min_pct is not null
        and heat_split_max_pct is not null
      )
    );
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_base_split_basis_supported
    check (base_split_basis is null or base_split_basis = 'USABLE_AREA');
exception when duplicate_object then null; end $do$;

-- PART 6: settlement_unit_allocations — loosen total_basis_value > 0 to allow
-- a transparent EUR 0 row for a zero-gross CONSUMPTION position.
alter table public.settlement_unit_allocations
  drop constraint if exists settlement_unit_allocations_total_basis_positive;

do $do$ begin
  alter table public.settlement_unit_allocations
    add constraint settlement_unit_allocations_total_basis_positive
    check (total_basis_value > 0 or allocatable_amount = 0);
exception when duplicate_object then null; end $do$;

-- No tenant policy anywhere above — U-C's job, same seam 0031 specifies. See
-- supabase/migrations/0032_betriebskosten_meters.sql for the full 14-scenario
-- smoke-test list.

-- =============================================================================
-- 0033: PERF INDEXES + TENANCY INTEGRITY (see supabase/migrations/0033 for the
-- full rationale). Appended here as a section: every statement is idempotent and
-- only references tables created above, so end-of-bundle placement is correct for
-- fresh installs.
-- =============================================================================

-- 0034: ANNOUNCEMENT_PUBLISHED notification type — for a database created from an
-- OLDER bundle whose enum predates the value (fresh installs already got it in the
-- 0026 section above; duplicate adds are no-ops). Safe inside the bundle's
-- transaction on PG 12+ because nothing below USES the value (the demo seed only
-- wipes notifications, never inserts them).
alter type public.notification_type add value if not exists 'ANNOUNCEMENT_PUBLISHED';

create index if not exists tickets_workspace_unit_idx
  on public.tickets (workspace_id, unit_id);
create index if not exists tickets_workspace_vendor_idx
  on public.tickets (workspace_id, assigned_vendor_id);
create index if not exists invoices_workspace_created_idx
  on public.invoices (workspace_id, created_at desc);
create index if not exists invoices_workspace_party_type_idx
  on public.invoices (workspace_id, party_type);
create index if not exists expense_records_workspace_unit_idx
  on public.expense_records (workspace_id, unit_id);
create index if not exists documents_workspace_property_idx
  on public.documents (workspace_id, property_id);
create index if not exists tenancies_workspace_tenant_idx
  on public.tenancies (workspace_id, tenant_id);
create index if not exists income_records_workspace_period_idx
  on public.income_records (workspace_id, period_start desc);
create index if not exists expense_records_workspace_incurred_idx
  on public.expense_records (workspace_id, incurred_on desc);

create extension if not exists btree_gist;

-- NOT VALID + VALIDATE split: the validation scan then runs without holding the
-- ACCESS EXCLUSIVE lock (see 0033's locking caveat).
do $do$ begin
  alter table public.tenancies
    add constraint tenancies_dates_ordered
    check (end_date is null or end_date >= start_date) not valid;
exception when duplicate_object then null; end $do$;

do $do$ begin
  alter table public.tenancies validate constraint tenancies_dates_ordered;
exception
  when others then
    raise notice 'tenancies_dates_ordered NOT validated (%).', sqlerrm;
end $do$;

do $do$ begin
  alter table public.tenancies
    add constraint tenancies_no_overlap
    exclude using gist (
      unit_id with =,
      daterange(start_date, end_date, '[]') with &&
    );
exception
  when duplicate_object then null;
  when others then
    raise notice 'tenancies_no_overlap NOT added (%).', sqlerrm;
end $do$;

-- =============================================================================
-- DEFERRED DEMO SEED — must run LAST (see the note in the DEMO MODE section).
-- reset_demo_workspace() wipes+reseeds the demo workspace, deleting from
-- public.tenants (0025), public.notifications (0026), public.announcements
-- (0030), the four Betriebskosten U-A settlement_* tables (0031), and
-- meters/meter_readings (0032) — all wipe-only, no seed rows for any of them.
-- All are created in sections above, so this seed call only succeeds here at
-- the end. Idempotent (wipe+reseed), so re-running the whole bundle is safe.
-- =============================================================================
select public.reset_demo_workspace();

-- =============================================================================
-- DONE. Verify: select count(*) from pg_tables where schemaname='public';  -- expect 27
-- =============================================================================

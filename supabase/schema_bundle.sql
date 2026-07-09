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
-- DONE. Verify: select count(*) from pg_tables where schemaname='public';  -- expect 17
-- =============================================================================

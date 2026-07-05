import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
// SHARED HARNESS for the env-gated RLS / security integration suite (P3.11).
//
// These helpers stand up TWO real workspaces (A + B) with users of every
// relevant role, plus properties/units/vendors/tickets in workspace A, then
// hand back authed Supabase clients (one per user) whose queries run UNDER THAT
// USER'S JWT — so RLS applies exactly as it would for a real logged-in caller.
//
// All setup uses the service-role client (bypasses RLS + Auth Admin API); each
// assertion in the suites uses an *authed* (anon-key + signed-in) client.
//
// Requires RLS_TEST_SUPABASE_URL / RLS_TEST_SERVICE_ROLE_KEY / RLS_TEST_ANON_KEY.
// With any missing, hasLiveCreds() is false and every suite skips.
// =============================================================================

export const TEST_PASSWORD = 'Test-Passw0rd!'

const URL = process.env.RLS_TEST_SUPABASE_URL
const SERVICE_KEY = process.env.RLS_TEST_SERVICE_ROLE_KEY
const ANON_KEY = process.env.RLS_TEST_ANON_KEY

export function hasLiveCreds(): boolean {
  return Boolean(URL && SERVICE_KEY && ANON_KEY)
}

/** Service-role client — bypasses RLS. Used only for setup/teardown + service-path asserts. */
export function svc(): SupabaseClient {
  return createClient(URL!, SERVICE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Anon-key client signed in as a specific user. Its queries carry that user's
 * JWT, so RLS treats it as that user (role `authenticated`).
 */
export async function authedClientFor(
  email: string,
  password: string = TEST_PASSWORD
): Promise<SupabaseClient> {
  const client = createClient(URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

// A unique run tag keeps parallel/repeat runs from colliding on emails.
const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const emailFor = (slug: string) => `rls-${slug}-${RUN}@example.test`

export interface RlsFixture {
  workspaceA: string
  workspaceB: string
  propertyA: string
  unitA: string
  vendorA: string
  ticketT1: string // reported by A-tenant1
  ticketT2: string // reported by A-tenant2
  ticketT3: string // created_by A-operator, created_for A-tenant1 (on-behalf)
  users: Record<UserKey, { id: string; email: string }>
  clients: Record<UserKey, SupabaseClient>
}

export type UserKey =
  | 'aOwner'
  | 'aOperator'
  | 'aAccountant'
  | 'aTenant1'
  | 'aTenant2'
  | 'bOwner'
  | 'bTenant'

const USER_SPECS: { key: UserKey; slug: string; role: string; ws: 'A' | 'B' }[] = [
  { key: 'aOwner', slug: 'a-owner', role: 'OWNER', ws: 'A' },
  { key: 'aOperator', slug: 'a-operator', role: 'OPERATOR', ws: 'A' },
  { key: 'aAccountant', slug: 'a-accountant', role: 'ACCOUNTANT', ws: 'A' },
  { key: 'aTenant1', slug: 'a-tenant1', role: 'TENANT', ws: 'A' },
  { key: 'aTenant2', slug: 'a-tenant2', role: 'TENANT', ws: 'A' },
  { key: 'bOwner', slug: 'b-owner', role: 'OWNER', ws: 'B' },
  { key: 'bTenant', slug: 'b-tenant', role: 'TENANT', ws: 'B' },
]

/**
 * Build the full two-workspace fixture. All via the service client so we can
 * set workspace_id/role directly (bypassing the self-update pins, since that is
 * exactly what a legit server admin path would do).
 */
export async function setupTwoWorkspaces(): Promise<RlsFixture> {
  const s = svc()

  // 1. Workspaces.
  const { data: wsRows, error: wsErr } = await s
    .from('workspaces')
    .insert([{ name: `RLS-A-${RUN}` }, { name: `RLS-B-${RUN}` }])
    .select('id, name')
  if (wsErr || !wsRows || wsRows.length !== 2) {
    throw new Error(`workspace insert failed: ${wsErr?.message}`)
  }
  const workspaceA = wsRows.find((r) => r.name === `RLS-A-${RUN}`)!.id as string
  const workspaceB = wsRows.find((r) => r.name === `RLS-B-${RUN}`)!.id as string

  // 2. Users (auth.admin.createUser → a profiles row is created by trigger).
  const users = {} as RlsFixture['users']
  for (const spec of USER_SPECS) {
    const email = emailFor(spec.slug)
    const { data, error } = await s.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    })
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`)
    users[spec.key] = { id: data.user.id, email }
  }

  // 3. Set each profile's workspace_id + role via service client.
  for (const spec of USER_SPECS) {
    const ws = spec.ws === 'A' ? workspaceA : workspaceB
    const { error } = await s
      .from('profiles')
      .update({ workspace_id: ws, role: spec.role, is_active: true })
      .eq('id', users[spec.key].id)
    if (error) throw new Error(`profile setup ${spec.key}: ${error.message}`)
  }

  // 4. Workspace A: property, unit (composite-FK correct), vendor.
  const { data: prop, error: propErr } = await s
    .from('properties')
    .insert({
      workspace_id: workspaceA,
      name: 'A Property',
      address_line1: '1 Test St',
      city: 'Vienna',
      postal_code: '1010',
      country: 'AT',
    })
    .select('id')
    .single()
  if (propErr || !prop) throw new Error(`property insert: ${propErr?.message}`)
  const propertyA = prop.id as string

  const { data: unit, error: unitErr } = await s
    .from('units')
    .insert({ workspace_id: workspaceA, property_id: propertyA, label: 'Unit 1' })
    .select('id')
    .single()
  if (unitErr || !unit) throw new Error(`unit insert: ${unitErr?.message}`)
  const unitA = unit.id as string

  const { data: vendor, error: vendErr } = await s
    .from('vendors')
    .insert({ workspace_id: workspaceA, company_name: 'A Plumbing GmbH' })
    .select('id')
    .single()
  if (vendErr || !vendor) throw new Error(`vendor insert: ${vendErr?.message}`)
  const vendorA = vendor.id as string

  // 5. Tickets.
  const { data: tickets, error: tErr } = await s
    .from('tickets')
    .insert([
      {
        workspace_id: workspaceA,
        property_id: propertyA,
        unit_id: unitA,
        created_by_user_id: users.aTenant1.id,
        title: 'T1 leak',
        description: 'reported by tenant1',
      },
      {
        workspace_id: workspaceA,
        property_id: propertyA,
        created_by_user_id: users.aTenant2.id,
        title: 'T2 heating',
        description: 'reported by tenant2',
      },
      {
        workspace_id: workspaceA,
        property_id: propertyA,
        unit_id: unitA,
        created_by_user_id: users.aOperator.id,
        created_for_user_id: users.aTenant1.id,
        title: 'T3 on-behalf',
        description: 'filed by operator for tenant1',
      },
    ])
    .select('id, title')
  if (tErr || !tickets || tickets.length !== 3) {
    throw new Error(`ticket insert: ${tErr?.message}`)
  }
  const byTitle = (needle: string) =>
    tickets.find((t) => (t.title as string).startsWith(needle))!.id as string
  const ticketT1 = byTitle('T1')
  const ticketT2 = byTitle('T2')
  const ticketT3 = byTitle('T3')

  // 6. Authed clients, one per user.
  const clients = {} as RlsFixture['clients']
  for (const spec of USER_SPECS) {
    clients[spec.key] = await authedClientFor(users[spec.key].email)
  }

  return {
    workspaceA,
    workspaceB,
    propertyA,
    unitA,
    vendorA,
    ticketT1,
    ticketT2,
    ticketT3,
    users,
    clients,
  }
}

/** Best-effort, idempotent teardown. Deletes auth users (cascades profiles) + workspaces. */
export async function teardown(fixture: RlsFixture | undefined): Promise<void> {
  if (!fixture) return
  const s = svc()
  for (const key of Object.keys(fixture.users) as UserKey[]) {
    try {
      await s.auth.admin.deleteUser(fixture.users[key].id)
    } catch {
      /* ignore not-found */
    }
  }
  try {
    await s.from('workspaces').delete().in('id', [fixture.workspaceA, fixture.workspaceB])
  } catch {
    /* ignore */
  }
}

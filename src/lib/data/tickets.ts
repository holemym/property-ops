import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role, TicketCategory, TicketPriority, TicketStatus } from '@/types/domain'
import { assertTransition } from '@/lib/tickets/status-flow'

export type Ticket = {
  id: string
  workspace_id: string
  property_id: string
  unit_id: string | null
  created_by_user_id: string
  created_for_user_id: string | null
  assigned_operator_id: string | null
  assigned_vendor_id: string | null
  title: string
  description: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  estimated_cost: number | null
  actual_cost: number | null
  scheduled_at: string | null
  resolved_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

export type TicketFilters = {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  propertyId?: string
  unitId?: string
  assignedOperatorId?: string
  assignedVendorId?: string
  createdByUserId?: string
  search?: string
}

// The eq/ilike filter predicates as PostgREST query-string fragments, reused by both
// ticket-list queries (kept as a fragment list rather than a generic builder helper to
// avoid Supabase builder-type variance friction). Applied via .or()-free chained .eq.
type FilterPair = [column: string, value: string]
function ticketFilterPairs(filters: TicketFilters): FilterPair[] {
  const pairs: FilterPair[] = []
  if (filters.status) pairs.push(['status', filters.status])
  if (filters.priority) pairs.push(['priority', filters.priority])
  if (filters.category) pairs.push(['category', filters.category])
  if (filters.propertyId) pairs.push(['property_id', filters.propertyId])
  if (filters.unitId) pairs.push(['unit_id', filters.unitId])
  if (filters.assignedOperatorId) pairs.push(['assigned_operator_id', filters.assignedOperatorId])
  if (filters.assignedVendorId) pairs.push(['assigned_vendor_id', filters.assignedVendorId])
  if (filters.createdByUserId) pairs.push(['created_by_user_id', filters.createdByUserId])
  return pairs
}

/**
 * Manager/operator inbox query. RLS already scopes WHICH rows come back per role
 * (managers/accountant see all workspace tickets; tenants see only their own via
 * 0011's split SELECT policies), so this layer just applies the workspace scope +
 * optional UI filters. Ordered newest-first. UNBOUNDED — use listTicketsPage for the
 * paged inbox; this stays for the curated dashboard/portal slices where the set is small.
 */
export async function listTickets(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: TicketFilters = {}
): Promise<Ticket[]> {
  let query = supabase.from('tickets').select('*').eq('workspace_id', workspaceId)
  for (const [col, val] of ticketFilterPairs(filters)) query = query.eq(col, val)
  if (filters.search) query = query.ilike('title', `%${filters.search}%`)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Ticket[]
}

export type TicketPage = {
  rows: Ticket[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export type ListTicketsPageParams = {
  filters?: TicketFilters
  // A `tickets` column to ORDER BY (defaults to created_at). Pass the value from
  // TICKET_DB_COLUMN — enum columns sort by declaration order (see sort.ts).
  orderBy?: string
  ascending?: boolean
  page?: number // 1-based
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 25

/**
 * Paginated + DB-sorted ticket inbox. Pushes ORDER BY and the row window to Postgres
 * (`.order().range()` with an exact count) instead of fetching the whole workspace table
 * and sorting/slicing in JS — bounding both the query and the payload as ticket volume
 * grows. A non-created sort adds created_at as a stable tiebreaker. The requested page is
 * clamped to the available range so an out-of-range ?page= never returns a confusing empty
 * table past the end.
 */
export async function listTicketsPage(
  supabase: SupabaseClient,
  workspaceId: string,
  params: ListTicketsPageParams = {}
): Promise<TicketPage> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE
  const orderBy = params.orderBy ?? 'created_at'
  const ascending = params.ascending ?? false

  // First get the exact count (cheap head request) so we can clamp the page and report
  // the page count, then fetch just the requested window.
  const filters = params.filters ?? {}
  const pairs = ticketFilterPairs(filters)

  let countQuery = supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  for (const [col, val] of pairs) countQuery = countQuery.eq(col, val)
  if (filters.search) countQuery = countQuery.ilike('title', `%${filters.search}%`)
  const { count, error: countError } = await countQuery
  if (countError) throw countError
  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, params.page ?? 1), pageCount)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase.from('tickets').select('*').eq('workspace_id', workspaceId)
  for (const [col, val] of pairs) query = query.eq(col, val)
  if (filters.search) query = query.ilike('title', `%${filters.search}%`)
  query = query.order(orderBy, { ascending })
  if (orderBy !== 'created_at') query = query.order('created_at', { ascending: false })
  const { data, error } = await query.range(from, to)
  if (error) throw error

  return { rows: (data ?? []) as Ticket[], total, page, pageSize, pageCount }
}

export async function getTicket(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('tickets').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Ticket
}

// Create input. Deliberately NARROW: no status/assignment/cost/schedule fields — a
// ticket is born 'NEW' and unassigned. The DB BEFORE-INSERT trigger (0011) forces
// these NULL for non-managers anyway; the app path simply never sends them, so a
// manager filing a ticket also gets a clean 'NEW' create (assignment/triage is a
// separate UPDATE via assignTicket/updateTicketStatus). created_for_user_id is the
// only optional "who" field (manager filing on behalf of a tenant).
export type CreateTicketInput = {
  workspaceId: string
  propertyId: string
  unitId?: string | null
  createdByUserId: string
  createdForUserId?: string | null
  title: string
  description: string
  category: TicketCategory
  priority: TicketPriority
}

export async function createTicket(
  supabase: SupabaseClient,
  input: CreateTicketInput
): Promise<Ticket> {
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId,
      unit_id: input.unitId ?? null,
      created_by_user_id: input.createdByUserId,
      created_for_user_id: input.createdForUserId ?? null,
      title: input.title,
      description: input.description,
      category: input.category,
      priority: input.priority,
      status: 'NEW',
    })
    .select()
    .single()
  if (error) throw error
  return data as Ticket
}

/**
 * Status transition (deferred obligation P3.3).
 *
 * Takes BOTH the nextStatus and the currentStatus — the P3.6 action already loaded
 * the ticket to render the legal-transition buttons, so it passes the current status
 * rather than forcing this layer to re-fetch. assertTransition() throws on an illegal
 * move (e.g. NEW -> CLOSED) BEFORE any write, so the DB is never touched on an illegal
 * transition. On entry to RESOLVED/CLOSED we stamp resolved_at/closed_at with now();
 * prior stamps are left intact (a reopen -> re-resolve keeps the original resolved_at
 * only if we skipped it — but we re-stamp on each entry, which is the desired "last
 * resolved" semantics). Double-scoped by workspace_id + id.
 */
export async function updateTicketStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  nextStatus: TicketStatus,
  currentStatus: TicketStatus
): Promise<Ticket> {
  assertTransition(currentStatus, nextStatus)
  const payload: Record<string, unknown> = { status: nextStatus }
  const now = new Date().toISOString()
  if (nextStatus === 'RESOLVED') payload.resolved_at = now
  if (nextStatus === 'CLOSED') payload.closed_at = now
  // Compare-and-swap: the `.eq('status', currentStatus)` predicate makes the UPDATE
  // atomic against concurrent writers. If another transaction changed the status
  // between the caller's read and this write, zero rows match, .single() errors, and
  // the caller surfaces a drift error — closing the TOCTOU window the app-layer
  // expectedCurrentStatus check alone left open (two divergent-but-legal concurrent
  // transitions from the same state can no longer both commit; last write no longer
  // silently wins). Also transition-validated by assertTransition above.
  const { data, error } = await supabase
    .from('tickets')
    .update(payload)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .eq('status', currentStatus)
    .select()
    .single()
  if (error) throw error
  return data as Ticket
}

// Assignment. undefined-skip / null-through: an explicit null unassigns; an omitted
// key is untouched. Setting an assignment does NOT auto-transition status — the P3.6
// action decides whether to also move the ticket to ASSIGNED (a separate,
// independently-audited mutation). Double-scoped.
export type AssignTicketInput = {
  assignedOperatorId?: string | null
  assignedVendorId?: string | null
}

export async function assignTicket(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: AssignTicketInput
): Promise<Ticket> {
  const payload: Record<string, unknown> = {}
  if (input.assignedOperatorId !== undefined) payload.assigned_operator_id = input.assignedOperatorId
  if (input.assignedVendorId !== undefined) payload.assigned_vendor_id = input.assignedVendorId
  const { data, error } = await supabase
    .from('tickets').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Ticket
}

// Edit path for the "content"/cost/schedule fields only. Status is updateTicketStatus,
// assignment is assignTicket — this separation keeps each mutation distinctly
// auditable (a STATUS_CHANGED event vs a PRIORITY_CHANGED event, etc.). undefined-skip
// / null-through, snake_case mapping.
export type UpdateTicketInput = {
  title?: string
  description?: string
  category?: TicketCategory
  priority?: TicketPriority
  estimatedCost?: number | null
  actualCost?: number | null
  scheduledAt?: string | null
}

export async function updateTicket(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateTicketInput
): Promise<Ticket> {
  const payload: Record<string, unknown> = {}
  if (input.title !== undefined) payload.title = input.title
  if (input.description !== undefined) payload.description = input.description
  if (input.category !== undefined) payload.category = input.category
  if (input.priority !== undefined) payload.priority = input.priority
  if (input.estimatedCost !== undefined) payload.estimated_cost = input.estimatedCost
  if (input.actualCost !== undefined) payload.actual_cost = input.actualCost
  if (input.scheduledAt !== undefined) payload.scheduled_at = input.scheduledAt
  const { data, error } = await supabase
    .from('tickets').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Ticket
}

export type WorkspaceProfile = {
  id: string
  full_name: string | null
  role: Role
}

// Manager roles eligible to own/triage a ticket (the operator-assign select). VENDOR
// work is a separate assignment (assigned_vendor_id); ACCOUNTANT is read-only and
// TENANT/GUEST are never assignees, so none of them appear here.
const OPERATOR_ROLES: Role[] = ['OWNER', 'OPERATOR', 'SUPER_ADMIN']

/**
 * The workspace's assignable operators — active profiles whose role can own a ticket
 * (OWNER/OPERATOR/SUPER_ADMIN). Feeds the P3.6 operator-assign select. Scoped by
 * workspace_id + is_active at the query layer; the manager-role filter is applied in JS
 * (the set-membership filter keeps this portable across the in-memory test client, which
 * models only eq-filters, and PostgREST). Ordered by name for a stable select.
 */
export async function listWorkspaceOperators(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<WorkspaceProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data as WorkspaceProfile[]).filter((p) => OPERATOR_ROLES.includes(p.role))
}

/**
 * Deferred-validation helper (P3.1 defer #2). assigned_operator_id and
 * created_for_user_id are PLAIN FKs to profiles(id) — they do NOT enforce that the
 * referenced profile is in THIS workspace. So before an assign/create-on-behalf action
 * sets one, it MUST call this to confirm the target user actually belongs to the
 * workspace. Returns null when the (id, workspace_id) pair does not exist — the caller
 * treats null as "not a member of this workspace, reject".
 *
 * P3.6 REQUIREMENT: assignTicket callers must first getWorkspaceProfile(operatorId)
 * and reject on null; likewise createTicket-on-behalf callers for createForUserId.
 */
export async function getWorkspaceProfile(
  supabase: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<WorkspaceProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', workspaceId)
    .eq('id', userId)
    .single()
  if (error) return null
  return data as WorkspaceProfile
}

/**
 * Dashboard status tally (P3.10). MVP implementation: fetch all workspace ticket
 * statuses and count them in JS. NOT optimized — a real deployment should use a
 * Postgres `group by status` aggregate (or a materialized count), but the in-memory
 * fake client can't express aggregate queries, and ticket volume per workspace is
 * small in the MVP, so a client-side tally is acceptable for now. Documented as a
 * known perf limitation for post-MVP.
 */
export async function countTicketsByStatus(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Partial<Record<TicketStatus, number>>> {
  const { data, error } = await supabase
    .from('tickets').select('status').eq('workspace_id', workspaceId)
  if (error) throw error
  const counts: Partial<Record<TicketStatus, number>> = {}
  for (const row of (data ?? []) as Array<{ status: TicketStatus }>) {
    counts[row.status] = (counts[row.status] ?? 0) + 1
  }
  return counts
}

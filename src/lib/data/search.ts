import type { SupabaseClient } from '@supabase/supabase-js'

// Cross-entity workspace search. Each entity is queried in parallel with an ilike scan
// scoped to the workspace; RLS additionally enforces per-role visibility, so a caller only
// ever gets rows they're allowed to see (finance/documents rows never surface to roles
// without those permissions). Trigram GIN indexes (migration 0020) make the ilike scans
// fast; the feature works without them, just slower.

export type SearchResultType =
  | 'property'
  | 'unit'
  | 'ticket'
  | 'vendor'
  | 'tenant'
  | 'invoice'
  | 'document'

export type SearchResult = {
  type: SearchResultType
  id: string
  title: string
  subtitle?: string
  href: string
}

const PER_TYPE_LIMIT = 6

// Sanitise the query for embedding in PostgREST `.or()` filter strings and ilike patterns.
// Strips the characters that would break the filter grammar (commas, parens) or act as
// wildcards (%, _, *), leaving a safe substring to match on. Exported for testing — this is
// the injection guard for the hand-built filter strings.
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()%*\\:_"]/g, ' ').trim()
}

type Row = Record<string, unknown>

async function run(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orFilter: string,
): Promise<Row[]> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .or(orFilter)
    .limit(PER_TYPE_LIMIT)
  if (error) {
    // A single entity failing (e.g. a table a role can't touch) must not sink the whole
    // search — log and return nothing for that group.
    console.error(`[search] ${table} query failed:`, error.message)
    return []
  }
  return (data ?? []) as unknown as Row[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Search across properties, units, tickets, vendors, tenants, invoices, and documents.
 * Returns a flat, ranked-ish list (grouped by the caller). Workspace-scoped; RLS-filtered.
 */
export async function searchWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResult[]> {
  const q = sanitizeSearch(rawQuery)
  if (q.length < 2) return []
  const like = `%${q}%`

  // Wrap each entity's column matches in `and(workspace_id.eq.<id>, or(<cols>))` so the
  // scan is explicitly workspace-scoped (RLS enforces it too, but the explicit predicate
  // lets the composite indexes help).
  const scoped = (cols: string) => `and(workspace_id.eq.${workspaceId},or(${cols}))`

  // 'tenant' results come from TWO sources: legacy tenancy-level free-text names
  // (tenancyMatches, href -> the unit) and directory records (tenants, P1-3, href ->
  // /people/[id]). Both feed the same result type/bucket in the palette.
  const [properties, units, tickets, vendors, tenancyMatches, tenants, invoices, documents] = await Promise.all([
    run(supabase, 'properties', 'id, name, address_line1, city', scoped(`name.ilike.${like},address_line1.ilike.${like},city.ilike.${like}`)),
    run(supabase, 'units', 'id, label, floor', scoped(`label.ilike.${like}`)),
    run(supabase, 'tickets', 'id, title, status', scoped(`title.ilike.${like}`)),
    run(supabase, 'vendors', 'id, company_name, contact_name, email', scoped(`company_name.ilike.${like},contact_name.ilike.${like},email.ilike.${like}`)),
    run(supabase, 'tenancies', 'id, tenant_name, unit_id', scoped(`tenant_name.ilike.${like}`)),
    run(supabase, 'tenants', 'id, full_name, email', scoped(`full_name.ilike.${like},email.ilike.${like}`)),
    run(supabase, 'invoices', 'id, invoice_number, party_name', scoped(`invoice_number.ilike.${like},party_name.ilike.${like}`)),
    run(supabase, 'documents', 'id, title, document_type', scoped(`title.ilike.${like}`)),
  ])

  const results: SearchResult[] = []

  for (const p of properties) {
    results.push({
      type: 'property',
      id: str(p.id),
      title: str(p.name),
      subtitle: [str(p.address_line1), str(p.city)].filter(Boolean).join(', ') || undefined,
      href: `/properties/${str(p.id)}`,
    })
  }
  for (const u of units) {
    results.push({
      type: 'unit',
      id: str(u.id),
      title: `Unit ${str(u.label)}`,
      subtitle: u.floor ? `Floor ${str(u.floor)}` : undefined,
      href: `/units/${str(u.id)}`,
    })
  }
  for (const t of tickets) {
    results.push({
      type: 'ticket',
      id: str(t.id),
      title: str(t.title),
      subtitle: str(t.status).replace(/_/g, ' ').toLowerCase() || undefined,
      href: `/tickets/${str(t.id)}`,
    })
  }
  for (const v of vendors) {
    results.push({
      type: 'vendor',
      id: str(v.id),
      title: str(v.company_name),
      subtitle: str(v.contact_name) || str(v.email) || undefined,
      href: `/vendors/${str(v.id)}`,
    })
  }
  for (const t of tenancyMatches) {
    results.push({
      type: 'tenant',
      id: str(t.id),
      title: str(t.tenant_name),
      subtitle: 'Tenant',
      href: `/units/${str(t.unit_id)}`,
    })
  }
  for (const t of tenants) {
    results.push({
      type: 'tenant',
      id: str(t.id),
      title: str(t.full_name),
      subtitle: str(t.email) || 'Person',
      href: `/people/${str(t.id)}`,
    })
  }
  for (const inv of invoices) {
    results.push({
      type: 'invoice',
      id: str(inv.id),
      title: str(inv.invoice_number),
      subtitle: str(inv.party_name) || undefined,
      href: `/invoices/${str(inv.id)}`,
    })
  }
  for (const d of documents) {
    results.push({
      type: 'document',
      id: str(d.id),
      title: str(d.title),
      subtitle: str(d.document_type).replace(/_/g, ' ').toLowerCase() || undefined,
      href: `/documents`,
    })
  }

  return results
}

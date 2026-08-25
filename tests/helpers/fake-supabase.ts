/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory test stub mimics the untyped Supabase query builder */
type Row = Record<string, any>

function matches(row: Row, filters: Array<[string, any]>) {
  return filters.every(([col, val]) => {
    if (typeof val === 'string' && val.includes('%')) {
      const needle = val.replace(/%/g, '').toLowerCase()
      return String(row[col] ?? '').toLowerCase().includes(needle)
    }
    return row[col] === val
  })
}

// Minimal `.or()` support — parses a PostgREST-style filter string
// ("full_name.ilike.%x%,email.ilike.%x%") into column/operator/value triples and
// matches if ANY clause matches (OR semantics), combined via AND with the plain
// `filters` list above (mirrors how a real chained `.eq(...).or(...)` call behaves).
// Added minimally for P1-1's listTenants search (src/lib/data/tenants.ts), the
// first data-layer function to need a multi-column ilike search — same "add as
// needed" precedent as `rpc` below.
function matchesOrFilter(row: Row, orFilter: string | null) {
  if (!orFilter) return true
  return orFilter.split(',').some((clause) => {
    const [col, op, ...rest] = clause.split('.')
    const val = rest.join('.')
    if (op === 'ilike') {
      const needle = val.replace(/%/g, '').toLowerCase()
      return String(row[col] ?? '').toLowerCase().includes(needle)
    }
    return row[col] === val
  })
}

export function createFakeSupabaseClient(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = seed
  let idCounter = 1

  function builder(table: string) {
    if (!tables[table]) tables[table] = []
    const filters: Array<[string, any]> = []
    const notEqFilters: Array<[string, any]> = []
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | null = null
    let single = false
    let maybeSingle = false
    let orderBy: string | null = null
    let ascending = true
    let orFilter: string | null = null
    let wantCount = false
    let rangeFrom: number | null = null
    let rangeTo: number | null = null
    let limitTo: number | null = null

    const api: any = {
      // Second arg mirrors the real client's `{ count: 'exact', head: true }` shape
      // (used by the listXPage house pagination pattern, e.g. listTicketsPage /
      // listNotificationsPage) — only `count === 'exact'` is modeled; `head` is
      // ignored since this stub always computes `data` anyway.
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        wantCount = opts?.count === 'exact'
        return api
      },
      eq(col: string, val: any) { filters.push([col, val]); return api },
      // Added minimally for Phase 1B's listTenantCharges (src/lib/data/invoices.ts) —
      // its DRAFT exclusion is a plain `!==`, matching PostgREST's `.neq()` semantics.
      neq(col: string, val: any) { notEqFilters.push([col, val]); return api },
      ilike(col: string, val: any) { filters.push([col, val]); return api },
      // `.is(col, null)` — added minimally for P2-1's notifications data layer
      // (read_at IS NULL). Reuses the plain equality filter list; matches() does
      // strict `===`, so seed fixtures must set the column explicitly to `null`
      // rather than omitting it (same convention every other fixture already follows).
      is(col: string, val: any) { filters.push([col, val]); return api },
      or(filterString: string) { orFilter = filterString; return api },
      order(col: string, opts?: { ascending?: boolean }) { orderBy = col; ascending = opts?.ascending ?? true; return api },
      // Added minimally for P2-1's listNotificationsPage (house `.range()` pattern,
      // same shape listTicketsPage already uses). Applied AFTER sort, like Postgrest.
      range(from: number, to: number) { rangeFrom = from; rangeTo = to; return api },
      // Added minimally for S2-2's listRecentAuthEvents (`.order().limit(n)`, no
      // pagination needed). Applied AFTER sort, like Postgrest's own LIMIT.
      limit(n: number) { limitTo = n; return api },
      single() { single = true; return api },
      // `.maybeSingle()` — added minimally for the Betriebskosten U-A data layer
      // (settlements.ts's setAllocationRule select-then-upsert): same "take the
      // first match" shape as `.single()`, but resolves `{ data: null, error:
      // null }` (no error) when zero rows match, instead of `.single()`'s
      // synthetic not-found error.
      maybeSingle() { maybeSingle = true; return api },
      insert(row: Row | Row[]) { op = 'insert'; payload = row as Row; return api },
      update(row: Row) { op = 'update'; payload = row; return api },
      // `.delete()` — added minimally for the Betriebskosten U-A data layer
      // (settlements.ts's persistAllocationRun re-run: delete-then-reinsert).
      delete() { op = 'delete'; return api },
      then(resolve: (v: { data: any; error: any; count?: number }) => void) {
        if (op === 'insert') {
          const rows = Array.isArray(payload) ? payload : [payload as Row]
          const newRows = rows.map((row) => ({
            id: `fake-${idCounter++}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...row,
          }))
          tables[table].push(...newRows)
          resolve({ data: single ? newRows[0] : newRows, error: null })
          return
        }
        if (op === 'update') {
          const targets = tables[table].filter((r) => matches(r, filters))
          targets.forEach((r) => Object.assign(r, payload, { updated_at: new Date().toISOString() }))
          if (single && targets.length === 0) { resolve({ data: null, error: new Error('not found') }); return }
          resolve({ data: single ? targets[0] : targets, error: null })
          return
        }
        if (op === 'delete') {
          const targets = tables[table].filter((r) => matches(r, filters))
          tables[table] = tables[table].filter((r) => !matches(r, filters))
          resolve({ data: targets, error: null })
          return
        }
        let found = tables[table].filter(
          (r) =>
            matches(r, filters) &&
            matchesOrFilter(r, orFilter) &&
            notEqFilters.every(([col, val]) => r[col] !== val)
        )
        if (orderBy) {
          found = [...found].sort((a, b) => {
            if (a[orderBy!] === b[orderBy!]) return 0
            const cmp = a[orderBy!] > b[orderBy!] ? 1 : -1
            return ascending ? cmp : -cmp
          })
        }
        const matchedCount = found.length
        if (rangeFrom !== null && rangeTo !== null) {
          found = found.slice(rangeFrom, rangeTo + 1)
        }
        if (limitTo !== null) {
          found = found.slice(0, limitTo)
        }
        if (single && found.length === 0) { resolve({ data: null, error: new Error('not found') }); return }
        if (maybeSingle) { resolve({ data: found[0] ?? null, error: null }); return }
        resolve({ data: single ? found[0] : found, error: null, count: wantCount ? matchedCount : undefined })
      },
    }
    return api
  }

  // Records every rpc call so tests can assert on the funnel. Added minimally for
  // P3.4's appendTicketEvent (log_ticket_event service-role RPC): the real client
  // returns { data, error }; here we just record (name, params) and resolve ok.
  const rpcCalls: Array<{ name: string; params: any }> = []
  function rpc(name: string, params: any) {
    rpcCalls.push({ name, params })
    return Promise.resolve({ data: null, error: null })
  }

  return { from(table: string) { return builder(table) }, rpc, _tables: tables, _rpcCalls: rpcCalls } as any
}

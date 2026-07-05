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

export function createFakeSupabaseClient(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = seed
  let idCounter = 1

  function builder(table: string) {
    if (!tables[table]) tables[table] = []
    const filters: Array<[string, any]> = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row | null = null
    let single = false
    let orderBy: string | null = null
    let ascending = true

    const api: any = {
      select() { return api },
      eq(col: string, val: any) { filters.push([col, val]); return api },
      ilike(col: string, val: any) { filters.push([col, val]); return api },
      order(col: string, opts?: { ascending?: boolean }) { orderBy = col; ascending = opts?.ascending ?? true; return api },
      single() { single = true; return api },
      insert(row: Row) { op = 'insert'; payload = row; return api },
      update(row: Row) { op = 'update'; payload = row; return api },
      then(resolve: (v: { data: any; error: any }) => void) {
        if (op === 'insert') {
          const newRow = { id: `fake-${idCounter++}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload }
          tables[table].push(newRow)
          resolve({ data: single ? newRow : [newRow], error: null })
          return
        }
        if (op === 'update') {
          const targets = tables[table].filter((r) => matches(r, filters))
          targets.forEach((r) => Object.assign(r, payload, { updated_at: new Date().toISOString() }))
          if (single && targets.length === 0) { resolve({ data: null, error: new Error('not found') }); return }
          resolve({ data: single ? targets[0] : targets, error: null })
          return
        }
        let found = tables[table].filter((r) => matches(r, filters))
        if (orderBy) {
          found = [...found].sort((a, b) => {
            if (a[orderBy!] === b[orderBy!]) return 0
            const cmp = a[orderBy!] > b[orderBy!] ? 1 : -1
            return ascending ? cmp : -cmp
          })
        }
        if (single && found.length === 0) { resolve({ data: null, error: new Error('not found') }); return }
        resolve({ data: single ? found[0] : found, error: null })
      },
    }
    return api
  }

  return { from(table: string) { return builder(table) }, _tables: tables } as any
}

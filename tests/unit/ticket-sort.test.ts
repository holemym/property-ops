import { describe, it, expect } from 'vitest'
import { sortTickets, isSortColumn } from '@/lib/tickets/sort'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketPriority, TicketStatus } from '@/types/domain'

// Minimal ticket factory — only the fields the sort touches matter.
function tkt(p: {
  id: string
  title?: string
  priority?: TicketPriority
  status?: TicketStatus
  created_at?: string
}): Ticket {
  return {
    id: p.id,
    title: p.title ?? p.id,
    priority: p.priority ?? 'NORMAL',
    status: p.status ?? 'NEW',
    created_at: p.created_at ?? '2026-01-01T00:00:00Z',
  } as Ticket
}

const ids = (rows: Ticket[]) => rows.map((r) => r.id)

describe('isSortColumn', () => {
  it('accepts known columns and rejects others', () => {
    expect(isSortColumn('created')).toBe(true)
    expect(isSortColumn('priority')).toBe(true)
    expect(isSortColumn('nope')).toBe(false)
    expect(isSortColumn(undefined)).toBe(false)
  })
})

describe('sortTickets', () => {
  const a = tkt({ id: 'a', title: 'Alpha', priority: 'LOW', status: 'NEW', created_at: '2026-03-01T00:00:00Z' })
  const b = tkt({ id: 'b', title: 'Bravo', priority: 'URGENT', status: 'RESOLVED', created_at: '2026-01-01T00:00:00Z' })
  const c = tkt({ id: 'c', title: 'Charlie', priority: 'HIGH', status: 'IN_PROGRESS', created_at: '2026-02-01T00:00:00Z' })
  const rows = [a, b, c]

  it('sorts by created desc (newest first) by default meaning', () => {
    expect(ids(sortTickets(rows, 'created', 'desc'))).toEqual(['a', 'c', 'b'])
    expect(ids(sortTickets(rows, 'created', 'asc'))).toEqual(['b', 'c', 'a'])
  })

  it('sorts by priority — desc surfaces URGENT first', () => {
    expect(ids(sortTickets(rows, 'priority', 'desc'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortTickets(rows, 'priority', 'asc'))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by status along the lifecycle', () => {
    // asc: NEW(a) < IN_PROGRESS(c) < RESOLVED(b)
    expect(ids(sortTickets(rows, 'status', 'asc'))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by title A→Z ascending', () => {
    expect(ids(sortTickets(rows, 'title', 'asc'))).toEqual(['a', 'b', 'c'])
    expect(ids(sortTickets(rows, 'title', 'desc'))).toEqual(['c', 'b', 'a'])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortTickets(rows, 'title', 'asc')
    expect(rows).toEqual(copy)
  })
})

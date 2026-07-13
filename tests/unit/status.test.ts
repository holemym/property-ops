import { describe, it, expect } from 'vitest'
import { isTicketOpen, TERMINAL_TICKET_STATUSES } from '@/lib/status'
import type { TicketStatus } from '@/types/domain'

const ALL_STATUSES: TicketStatus[] = [
  'NEW',
  'TRIAGE',
  'WAITING_FOR_INFO',
  'ASSIGNED',
  'SCHEDULED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
]

// H3: isTicketOpen is the single source of truth for the ticket open/done split, shared
// by the dashboard, occupancy, insights/analytics, property hub, unit hub, and map. The
// bug this fixed was the dashboard's local list omitting RESOLVED, so a resolved ticket
// read as "open" there and "done" everywhere else — these cases pin that regression.
describe('isTicketOpen', () => {
  it('treats RESOLVED as done, not open (the H3 regression case)', () => {
    expect(isTicketOpen('RESOLVED')).toBe(false)
  })

  it('treats CLOSED and CANCELLED as done', () => {
    expect(isTicketOpen('CLOSED')).toBe(false)
    expect(isTicketOpen('CANCELLED')).toBe(false)
  })

  it('treats every working status as open', () => {
    expect(isTicketOpen('NEW')).toBe(true)
    expect(isTicketOpen('TRIAGE')).toBe(true)
    expect(isTicketOpen('WAITING_FOR_INFO')).toBe(true)
    expect(isTicketOpen('ASSIGNED')).toBe(true)
    expect(isTicketOpen('SCHEDULED')).toBe(true)
    expect(isTicketOpen('IN_PROGRESS')).toBe(true)
  })

  it('is exhaustive and mutually exclusive with TERMINAL_TICKET_STATUSES over every status', () => {
    for (const status of ALL_STATUSES) {
      expect(isTicketOpen(status)).toBe(!TERMINAL_TICKET_STATUSES.includes(status))
    }
  })
})

describe('TERMINAL_TICKET_STATUSES', () => {
  it('is exactly RESOLVED, CLOSED, CANCELLED', () => {
    expect([...TERMINAL_TICKET_STATUSES].sort()).toEqual(
      ['CANCELLED', 'CLOSED', 'RESOLVED'].sort()
    )
  })
})

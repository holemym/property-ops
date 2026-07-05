import { describe, it, expect } from 'vitest'
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  assertTransition,
  nextStatuses,
} from '@/lib/tickets/status-flow'
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

describe('canTransition', () => {
  it('allows the default happy path', () => {
    expect(canTransition('NEW', 'TRIAGE')).toBe(true)
    expect(canTransition('TRIAGE', 'ASSIGNED')).toBe(true)
    expect(canTransition('ASSIGNED', 'SCHEDULED')).toBe(true)
    expect(canTransition('SCHEDULED', 'IN_PROGRESS')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(true)
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true)
  })

  it('allows the resolved -> in_progress reopen path', () => {
    expect(canTransition('RESOLVED', 'IN_PROGRESS')).toBe(true)
  })

  it('allows cancellation from every non-terminal pre-resolution state', () => {
    expect(canTransition('NEW', 'CANCELLED')).toBe(true)
    expect(canTransition('TRIAGE', 'CANCELLED')).toBe(true)
    expect(canTransition('WAITING_FOR_INFO', 'CANCELLED')).toBe(true)
    expect(canTransition('ASSIGNED', 'CANCELLED')).toBe(true)
    expect(canTransition('SCHEDULED', 'CANCELLED')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'CANCELLED')).toBe(true)
  })

  it('allows entering WAITING_FOR_INFO from working states', () => {
    expect(canTransition('TRIAGE', 'WAITING_FOR_INFO')).toBe(true)
    expect(canTransition('ASSIGNED', 'WAITING_FOR_INFO')).toBe(true)
    expect(canTransition('SCHEDULED', 'WAITING_FOR_INFO')).toBe(true)
    expect(canTransition('IN_PROGRESS', 'WAITING_FOR_INFO')).toBe(true)
  })

  it('allows exiting WAITING_FOR_INFO back to working states or cancel', () => {
    expect(canTransition('WAITING_FOR_INFO', 'TRIAGE')).toBe(true)
    expect(canTransition('WAITING_FOR_INFO', 'ASSIGNED')).toBe(true)
    expect(canTransition('WAITING_FOR_INFO', 'SCHEDULED')).toBe(true)
    expect(canTransition('WAITING_FOR_INFO', 'IN_PROGRESS')).toBe(true)
    expect(canTransition('WAITING_FOR_INFO', 'CANCELLED')).toBe(true)
  })

  it('allows TRIAGE -> SCHEDULED (scheduling implies assignment context)', () => {
    expect(canTransition('TRIAGE', 'SCHEDULED')).toBe(true)
  })

  it('rejects skipping triage', () => {
    expect(canTransition('NEW', 'IN_PROGRESS')).toBe(false)
    expect(canTransition('NEW', 'ASSIGNED')).toBe(false)
    expect(canTransition('NEW', 'CLOSED')).toBe(false)
  })

  it('treats CLOSED as terminal', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('CLOSED', to)).toBe(false)
    }
  })

  it('treats CANCELLED as terminal', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false)
    }
  })

  it('rejects a status transitioning to itself', () => {
    expect(canTransition('NEW', 'NEW')).toBe(false)
    expect(canTransition('IN_PROGRESS', 'IN_PROGRESS')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('does not throw on a legal transition', () => {
    expect(() => assertTransition('NEW', 'TRIAGE')).not.toThrow()
  })

  it('throws with a clear message on an illegal transition', () => {
    expect(() => assertTransition('NEW', 'CLOSED')).toThrow(
      'Illegal ticket status transition: NEW → CLOSED'
    )
  })
})

describe('nextStatuses', () => {
  it('returns the legal next statuses for a working state', () => {
    expect(nextStatuses('IN_PROGRESS')).toEqual([
      'RESOLVED',
      'WAITING_FOR_INFO',
      'CANCELLED',
    ])
  })

  it('returns an empty array for terminal states', () => {
    expect(nextStatuses('CLOSED')).toEqual([])
    expect(nextStatuses('CANCELLED')).toEqual([])
  })
})

describe('ALLOWED_TRANSITIONS', () => {
  it('defines an entry for every TicketStatus (exhaustiveness)', () => {
    for (const status of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined()
      expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true)
    }
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort()
    )
  })

  it('never lists a status as its own successor', () => {
    for (const status of ALL_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).not.toContain(status)
    }
  })
})

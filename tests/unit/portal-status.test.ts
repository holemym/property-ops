import { describe, it, expect } from 'vitest'
import { tenantProgress, tenantStatusLabel, tenantInvoiceStatusLabel, TENANT_STAGES } from '@/lib/portal-status'
import type { InvoiceStatus, TicketStatus } from '@/types/domain'

describe('tenantProgress', () => {
  it('maps early statuses to the Received stage', () => {
    expect(tenantProgress('NEW')).toEqual({ kind: 'active', stageIndex: 0 })
    expect(tenantProgress('TRIAGE')).toEqual({ kind: 'active', stageIndex: 0 })
  })

  it('maps ASSIGNED/SCHEDULED to the Scheduled stage', () => {
    expect(tenantProgress('ASSIGNED')).toEqual({ kind: 'active', stageIndex: 1 })
    expect(tenantProgress('SCHEDULED')).toEqual({ kind: 'active', stageIndex: 1 })
  })

  it('maps IN_PROGRESS to the In progress stage', () => {
    expect(tenantProgress('IN_PROGRESS')).toEqual({ kind: 'active', stageIndex: 2 })
  })

  it('marks RESOLVED and CLOSED as done', () => {
    expect(tenantProgress('RESOLVED')).toEqual({ kind: 'done', stageIndex: 3 })
    expect(tenantProgress('CLOSED')).toEqual({ kind: 'done', stageIndex: 3 })
  })

  it('flags WAITING_FOR_INFO as waiting on the tenant', () => {
    expect(tenantProgress('WAITING_FOR_INFO')).toEqual({ kind: 'waiting', stageIndex: 0 })
  })

  it('treats CANCELLED as its own state', () => {
    expect(tenantProgress('CANCELLED')).toEqual({ kind: 'cancelled' })
  })
})

describe('tenantStatusLabel', () => {
  it('never leaks operator jargon', () => {
    const statuses: TicketStatus[] = [
      'NEW', 'TRIAGE', 'WAITING_FOR_INFO', 'ASSIGNED', 'SCHEDULED',
      'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED',
    ]
    for (const s of statuses) {
      const label = tenantStatusLabel(s)
      expect(label).toBeTruthy()
      // No raw enum tokens or underscores surface to the tenant.
      expect(label).not.toMatch(/[A-Z]{2,}|_/)
    }
  })

  it('renames jargon statuses to plain language', () => {
    expect(tenantStatusLabel('TRIAGE')).toBe('Received')
    expect(tenantStatusLabel('WAITING_FOR_INFO')).toBe('Waiting for your reply')
    expect(tenantStatusLabel('ASSIGNED')).toBe('Being arranged')
    expect(tenantStatusLabel('CLOSED')).toBe('Completed')
  })
})

describe('TENANT_STAGES', () => {
  it('has the four journey stages in order', () => {
    expect(TENANT_STAGES).toEqual(['Received', 'Scheduled', 'In progress', 'Resolved'])
  })
})

describe('tenantInvoiceStatusLabel', () => {
  it('renames VOID to Cancelled (a tenant would not recognise "Void")', () => {
    expect(tenantInvoiceStatusLabel('VOID')).toBe('Cancelled')
  })

  it('gives a plain label for every invoice status', () => {
    const statuses: InvoiceStatus[] = ['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID']
    for (const s of statuses) {
      expect(tenantInvoiceStatusLabel(s)).toBeTruthy()
    }
  })

  it('labels SENT as Due and PARTIAL as Partially paid', () => {
    expect(tenantInvoiceStatusLabel('SENT')).toBe('Due')
    expect(tenantInvoiceStatusLabel('PARTIAL')).toBe('Partially paid')
  })

  it('labels PAID and OVERDUE plainly', () => {
    expect(tenantInvoiceStatusLabel('PAID')).toBe('Paid')
    expect(tenantInvoiceStatusLabel('OVERDUE')).toBe('Overdue')
  })
})

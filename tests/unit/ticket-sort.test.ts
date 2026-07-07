import { describe, it, expect } from 'vitest'
import { isSortColumn, SORT_COLUMNS, TICKET_DB_COLUMN } from '@/lib/tickets/sort'

describe('isSortColumn', () => {
  it('accepts known columns and rejects others', () => {
    expect(isSortColumn('created')).toBe(true)
    expect(isSortColumn('priority')).toBe(true)
    expect(isSortColumn('nope')).toBe(false)
    expect(isSortColumn(undefined)).toBe(false)
  })
})

describe('TICKET_DB_COLUMN', () => {
  it('maps every sort column to a DB column', () => {
    for (const col of SORT_COLUMNS) {
      expect(typeof TICKET_DB_COLUMN[col]).toBe('string')
      expect(TICKET_DB_COLUMN[col].length).toBeGreaterThan(0)
    }
  })

  it('maps created to created_at and passes enum columns through by name', () => {
    expect(TICKET_DB_COLUMN.created).toBe('created_at')
    expect(TICKET_DB_COLUMN.priority).toBe('priority')
    expect(TICKET_DB_COLUMN.status).toBe('status')
    expect(TICKET_DB_COLUMN.title).toBe('title')
  })
})

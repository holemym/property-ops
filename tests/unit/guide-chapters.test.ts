import { describe, it, expect } from 'vitest'
import { operatorChapters, RESIDENT_CHAPTERS, visibleChapters } from '@/components/guide/chapters'
import type { GuideState } from '@/lib/data/guide'

const EMPTY: GuideState = {
  units: 0,
  tenancies: 0,
  invitedResidents: 0,
  properties: 0,
  propertiesWithoutLocation: 0,
  firstPropertyId: null,
  people: 0,
  vendors: 0,
  tickets: {},
  invoices: {},
  announcements: 0,
  documents: 0,
}

const hrefs = (chapters: ReturnType<typeof visibleChapters>) =>
  chapters.flatMap((c) => c.steps.map((s) => s.href).filter(Boolean))

describe('guide chapters', () => {
  it('gives an owner every operator chapter, numbered in order', () => {
    const chapters = visibleChapters(operatorChapters(EMPTY), 'OWNER')
    expect(chapters.map((c) => c.id)).toEqual(['portfolio', 'residents', 'portal', 'tickets', 'rent', 'records', 'team'])
    expect(chapters.map((c) => c.number)).toEqual(['01', '02', '03', '04', '05', '06', '07'])
  })

  // A guide that links someone into a screen their role cannot open is a dead end of its
  // own; every link must survive the same permission matrix the pages enforce.
  it('never links an accountant into create screens it cannot use', () => {
    const links = hrefs(visibleChapters(operatorChapters(EMPTY), 'ACCOUNTANT'))
    expect(links).not.toContain('/properties/new')
    expect(links).not.toContain('/tickets/new')
    expect(links).not.toContain('/settings/users')
    expect(links).toContain('/invoices')
  })

  it('keeps the invite step to roles that can invite', () => {
    const operator = visibleChapters(operatorChapters(EMPTY), 'OPERATOR')
    expect(operator.find((c) => c.id === 'portal')?.steps.some((s) => s.href === '/people')).toBe(false)
  })

  it('deep-links "Add a unit" to the first property when one exists', () => {
    const chapters = visibleChapters(operatorChapters({ ...EMPTY, properties: 1, firstPropertyId: 'p-1' }), 'OWNER')
    expect(hrefs(chapters)).toContain('/units/new?propertyId=p-1')
  })

  it('states the workspace numbers and points unlocated properties at the map', () => {
    const portfolio = operatorChapters({ ...EMPTY, properties: 3, units: 1, propertiesWithoutLocation: 1 })[0]
    expect(portfolio.state).toEqual({ done: true, line: '3 properties · 1 unit · 1 not on the map yet', href: '/map' })
  })

  it('counts open tickets including ones waiting for information', () => {
    const tickets = operatorChapters({ ...EMPTY, tickets: { NEW: 2, WAITING_FOR_INFO: 1, RESOLVED: 5 } }).find(
      (c) => c.id === 'tickets'
    )
    expect(tickets?.state?.line).toBe('3 open tickets')
    // An empty inbox is not a finished setup step, so tickets never carry a done-check.
    expect(tickets?.state?.done).toBeUndefined()
  })

  it('gives residents only portal screens', () => {
    const links = hrefs(visibleChapters(RESIDENT_CHAPTERS, 'TENANT'))
    expect(links.length).toBeGreaterThan(0)
    for (const href of links) {
      expect(href === '/auth/set-password' || href!.startsWith('/portal')).toBe(true)
    }
  })
})

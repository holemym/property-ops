import { describe, it, expect } from 'vitest'
import {
  suggestTriageHeuristic,
  normalizeSuggestion,
  isAiTriageEnabled,
  classifyTicket,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
} from '@/lib/ai/triage'

describe('suggestTriageHeuristic', () => {
  it('classifies a plumbing leak', () => {
    const s = suggestTriageHeuristic({
      title: 'Leaking pipe under the sink',
      description: 'Water is dripping from the drain pipe into the cabinet.',
    })
    expect(s.category).toBe('PLUMBING')
    expect(s.source).toBe('heuristic')
    expect(s.confidence).toBeGreaterThan(0.5)
  })

  it('prefers HEATING over PLUMBING for "no hot water"', () => {
    const s = suggestTriageHeuristic({
      title: 'No hot water',
      description: 'The boiler stopped and there is no hot water in the flat.',
    })
    expect(s.category).toBe('HEATING')
  })

  it('flags an emergency as URGENT', () => {
    const s = suggestTriageHeuristic({
      title: 'Gas smell in kitchen',
      description: 'Strong gas smell, this is an emergency.',
    })
    expect(s.priority).toBe('URGENT')
  })

  it('marks a cosmetic request LOW', () => {
    const s = suggestTriageHeuristic({
      title: 'Minor paint scuff',
      description: 'Small cosmetic scuff on the wall, no rush, whenever convenient.',
    })
    expect(s.priority).toBe('LOW')
  })

  it('falls back to OTHER / NORMAL with low confidence when nothing matches', () => {
    const s = suggestTriageHeuristic({
      title: 'General question',
      description: 'Just wanted to ask something unrelated.',
    })
    expect(s.category).toBe('OTHER')
    expect(s.priority).toBe('NORMAL')
    expect(s.confidence).toBeLessThanOrEqual(0.2)
  })

  it('always returns a valid enum category and priority', () => {
    const s = suggestTriageHeuristic({ title: '', description: '' })
    expect(TICKET_CATEGORIES).toContain(s.category)
    expect(TICKET_PRIORITIES).toContain(s.priority)
  })
})

describe('normalizeSuggestion', () => {
  it('coerces unknown enums to safe defaults and clamps confidence', () => {
    const s = normalizeSuggestion(
      { category: 'BOGUS', priority: 'MEGA', note: 'x'.repeat(500), confidence: 5 },
      'ai'
    )
    expect(s.category).toBe('OTHER')
    expect(s.priority).toBe('NORMAL')
    expect(s.confidence).toBe(1)
    expect(s.note.length).toBeLessThanOrEqual(160)
    expect(s.source).toBe('ai')
  })

  it('passes through valid values', () => {
    const s = normalizeSuggestion(
      { category: 'ELECTRICAL', priority: 'HIGH', note: 'ok', confidence: 0.8 },
      'ai'
    )
    expect(s).toMatchObject({ category: 'ELECTRICAL', priority: 'HIGH', confidence: 0.8 })
  })

  it('clamps a negative confidence to 0', () => {
    expect(normalizeSuggestion({ confidence: -3 }, 'ai').confidence).toBe(0)
  })
})

describe('isAiTriageEnabled / classifyTicket (disconnected)', () => {
  it('reports disabled and uses the heuristic when no key is set', async () => {
    const prev = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      expect(isAiTriageEnabled()).toBe(false)
      const s = await classifyTicket({
        title: 'Broken window',
        description: 'A cracked, broken window pane in the bedroom.',
      })
      // With no key the Claude path is never touched — heuristic result only.
      expect(s.source).toBe('heuristic')
      expect(s.category).toBe('DAMAGE')
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev
    }
  })
})

import { describe, it, expect } from 'vitest'
import { computeMeterConsumption, type MeterConsumptionInput } from '@/lib/betriebskosten/consumption'

// consumption = (reading at/before periodEnd - reading at/before periodStart) x
// multiplier. Emphasis on FAIL-CLOSED behaviour: every "we don't actually know
// this meter's consumption" case must degrade into a blocking diagnostic +
// consumptionUnits: null, NEVER a silent 0 (see allocate.ts's identical
// reasoning for usableAreaM2/consumption — a silently-zeroed meter would
// redistribute that unit's true consumption cost onto everyone else).

const PERIOD_START = '2026-01-01'
const PERIOD_END = '2026-12-31'

const meter = (over: Partial<MeterConsumptionInput> = {}): MeterConsumptionInput => ({
  meterId: 'm1',
  unitId: 'u1',
  multiplier: 1,
  readings: [
    { readingDate: '2026-01-01', value: 100 },
    { readingDate: '2026-12-31', value: 350 },
  ],
  ...over,
})

describe('computeMeterConsumption - happy path', () => {
  it('computes (current - previous) x multiplier', () => {
    const r = computeMeterConsumption([meter()], PERIOD_START, PERIOD_END)
    expect(r.ok).toBe(true)
    expect(r.results).toEqual([
      {
        meterId: 'm1',
        unitId: 'u1',
        ok: true,
        consumptionUnits: 250,
        baselineReading: { date: '2026-01-01', value: 100 },
        currentReading: { date: '2026-12-31', value: 350 },
      },
    ])
  })

  it('applies a CT-style multiplier', () => {
    const r = computeMeterConsumption([meter({ multiplier: 20 })], PERIOD_START, PERIOD_END)
    expect(r.ok).toBe(true)
    expect(r.results[0].consumptionUnits).toBe(250 * 20)
  })

  it('picks the LATEST reading at/before periodStart as the baseline, and the LATEST at/before periodEnd as current', () => {
    const r = computeMeterConsumption(
      [
        meter({
          readings: [
            { readingDate: '2025-06-01', value: 10 }, // older, before period
            { readingDate: '2026-01-01', value: 100 }, // the real baseline
            { readingDate: '2026-06-15', value: 220 }, // mid-period
            { readingDate: '2026-12-31', value: 350 }, // the real current
            { readingDate: '2027-03-01', value: 500 }, // after period, ignored
          ],
        }),
      ],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(true)
    expect(r.results[0].baselineReading).toEqual({ date: '2026-01-01', value: 100 })
    expect(r.results[0].currentReading).toEqual({ date: '2026-12-31', value: 350 })
    expect(r.results[0].consumptionUnits).toBe(250)
  })

  it('accepts readings supplied out of order (sorts internally)', () => {
    const ordered = computeMeterConsumption([meter()], PERIOD_START, PERIOD_END)
    const shuffled = computeMeterConsumption(
      [meter({ readings: [meter().readings[1], meter().readings[0]] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(shuffled.results[0].consumptionUnits).toBe(ordered.results[0].consumptionUnits)
  })

  it('allows zero consumption (current === baseline)', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '2026-01-01', value: 100 }, { readingDate: '2026-12-31', value: 100 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(true)
    expect(r.results[0].consumptionUnits).toBe(0)
  })

  it('carries a null unitId through for a property/common meter', () => {
    const r = computeMeterConsumption([meter({ unitId: null })], PERIOD_START, PERIOD_END)
    expect(r.ok).toBe(true)
    expect(r.results[0].unitId).toBeNull()
  })

  it('one meter failing does not block another meter in the same call', () => {
    const r = computeMeterConsumption(
      [
        meter({ meterId: 'good', unitId: 'u1' }),
        meter({ meterId: 'bad', unitId: 'u2', readings: [{ readingDate: '2026-06-01', value: 5 }] }), // no baseline
      ],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false) // top-level ok is all-or-nothing...
    const good = r.results.find((x) => x.meterId === 'good')
    const bad = r.results.find((x) => x.meterId === 'bad')
    expect(good?.ok).toBe(true) // ...but each meter's OWN result is independent.
    expect(good?.consumptionUnits).toBe(250)
    expect(bad?.ok).toBe(false)
    expect(bad?.consumptionUnits).toBeNull()
  })
})

describe('computeMeterConsumption - fail-closed data quality', () => {
  it('BLOCKS on no baseline reading (nothing at or before periodStart)', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '2026-06-01', value: 100 }, { readingDate: '2026-12-31', value: 200 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'METER_MISSING_BASELINE_READING', blocking: true, meterId: 'm1' })
    expect(r.results[0].consumptionUnits).toBeNull()
  })

  it('BLOCKS on no reading taken DURING the period (only a baseline exists)', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '2025-12-31', value: 100 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'METER_NO_READINGS_IN_PERIOD', blocking: true, meterId: 'm1' })
  })

  it('a baseline reading dated EXACTLY periodStart with nothing after it still counts as "no readings in period"', () => {
    // The baseline cutoff is <= periodStart; "current" requires a reading
    // STRICTLY after periodStart — a meter read once, on the first day, and
    // never again, must not be assumed to have consumed nothing all year.
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: PERIOD_START, value: 100 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'METER_NO_READINGS_IN_PERIOD', blocking: true, meterId: 'm1' })
  })

  it('BLOCKS on negative consumption (meter rollover or physical replacement)', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '2026-01-01', value: 900 }, { readingDate: '2026-12-31', value: 50 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'METER_NEGATIVE_CONSUMPTION',
      blocking: true,
      meterId: 'm1',
      baselineValue: 900,
      currentValue: 50,
    })
    expect(r.results[0].consumptionUnits).toBeNull()
    // The readings themselves are still surfaced — an operator resolving
    // this needs to SEE the two values, not just "it's broken".
    expect(r.results[0].baselineReading).toEqual({ date: '2026-01-01', value: 900 })
    expect(r.results[0].currentReading).toEqual({ date: '2026-12-31', value: 50 })
  })

  it('BLOCKS on a non-finite or non-positive multiplier', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeMeterConsumption([meter({ multiplier: bad })], PERIOD_START, PERIOD_END)
      expect(r.ok).toBe(false)
      expect(r.diagnostics.some((d) => d.code === 'METER_INVALID_MULTIPLIER')).toBe(true)
    }
  })

  it('BLOCKS on a negative or non-finite raw reading value', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = computeMeterConsumption(
        [meter({ readings: [{ readingDate: '2026-01-01', value: 100 }, { readingDate: '2026-12-31', value: bad }] })],
        PERIOD_START,
        PERIOD_END,
      )
      expect(r.ok).toBe(false)
      expect(r.diagnostics.some((d) => d.code === 'METER_INVALID_READING_VALUE')).toBe(true)
    }
  })

  it('BLOCKS on a malformed reading date', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '01.01.2026', value: 100 }, { readingDate: '2026-12-31', value: 200 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'METER_INVALID_READING_DATE')).toBe(true)
  })

  it('BLOCKS on two readings sharing the same date (ambiguous baseline/current)', () => {
    const r = computeMeterConsumption(
      [meter({ readings: [{ readingDate: '2026-06-01', value: 100 }, { readingDate: '2026-06-01', value: 105 }] })],
      PERIOD_START,
      PERIOD_END,
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'METER_DUPLICATE_READING_DATE')).toBe(true)
  })

  it('a meter with zero readings at all BLOCKS (no baseline)', () => {
    const r = computeMeterConsumption([meter({ readings: [] })], PERIOD_START, PERIOD_END)
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'METER_MISSING_BASELINE_READING', blocking: true, meterId: 'm1' })
  })
})

describe('computeMeterConsumption - contract violations THROW', () => {
  it('throws on a malformed period', () => {
    expect(() => computeMeterConsumption([meter()], '01.01.2026', PERIOD_END)).toThrow()
    expect(() => computeMeterConsumption([meter()], PERIOD_START, 'not-a-date')).toThrow()
  })

  it('throws when periodEnd is before periodStart', () => {
    expect(() => computeMeterConsumption([meter()], '2026-12-31', '2026-01-01')).toThrow()
  })

  it('throws on a duplicate meterId in the input', () => {
    expect(() => computeMeterConsumption([meter(), meter()], PERIOD_START, PERIOD_END)).toThrow()
  })

  it('is deterministic - identical input yields identical output', () => {
    const meters = [meter({ meterId: 'm1', unitId: 'u1' }), meter({ meterId: 'm2', unitId: 'u2' })]
    const a = computeMeterConsumption(meters, PERIOD_START, PERIOD_END)
    const b = computeMeterConsumption(meters, PERIOD_START, PERIOD_END)
    expect(a).toEqual(b)
  })
})

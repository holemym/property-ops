// Pure meter-reading -> consumption computation (Betriebskosten U-B, migration
// 0032). No Supabase import, no clock, no Math.random — same pure-module
// discipline as src/lib/betriebskosten/allocate.ts (which this module feeds:
// its output becomes an allocate.ts CostPositionInput's `consumption` /
// `heatSplit.consumption` entries). The caller supplies every meter's readings
// and the period; this module only computes.
//
// consumption = (reading at/before periodEnd - reading at/before periodStart)
//               x meter.multiplier
//
// FAIL-CLOSED, same philosophy as allocate.ts's area handling: a missing
// baseline reading, a period with no reading taken DURING it, a negative delta
// (meter rollover or physical replacement), a non-finite/negative raw reading
// value, or a non-positive multiplier all BLOCK that meter's result — never
// silently 0, which would understate that unit's consumption and quietly
// redistribute its true share onto every other participating unit.

export type IsoDate = string // 'YYYY-MM-DD'

export type MeterReadingInput = {
  readingDate: IsoDate
  /** Cumulative counter value — NEVER a delta. */
  value: number
}

export type MeterConsumptionInput = {
  meterId: string
  /** Display only, carried into the output. */
  unitId: string | null
  /** > 0. CT-style meters read a sample; the true consumption is
   * (current - previous) x multiplier. */
  multiplier: number
  /** Order does not matter — this module sorts by date itself. */
  readings: MeterReadingInput[]
}

export type ConsumptionDiagnostic =
  | { code: 'METER_INVALID_MULTIPLIER'; blocking: true; meterId: string; value: number }
  | { code: 'METER_INVALID_READING_VALUE'; blocking: true; meterId: string; readingDate: string; value: number }
  | { code: 'METER_INVALID_READING_DATE'; blocking: true; meterId: string; readingDate: string }
  | { code: 'METER_DUPLICATE_READING_DATE'; blocking: true; meterId: string; readingDate: string }
  // No reading at or before periodStart — there is no baseline to subtract
  // from, so "consumption so far" is genuinely unknown, not zero.
  | { code: 'METER_MISSING_BASELINE_READING'; blocking: true; meterId: string }
  // A baseline exists, but nothing was read DURING the period itself — a
  // meter that was simply never read this year must not be assumed to have
  // consumed nothing.
  | { code: 'METER_NO_READINGS_IN_PERIOD'; blocking: true; meterId: string }
  // current < previous: a rollover (the counter wrapped) or a physical
  // meter replacement (a new device starts its OWN count from near-zero
  // while still logged under the same meter_id). Never silently 0 — an
  // operator must resolve this (e.g. record the old meter's final reading
  // and start a fresh meter row for the replacement).
  | { code: 'METER_NEGATIVE_CONSUMPTION'; blocking: true; meterId: string; baselineValue: number; currentValue: number }

export type MeterConsumptionResult = {
  meterId: string
  unitId: string | null
  ok: boolean
  /** null when !ok. */
  consumptionUnits: number | null
  baselineReading: { date: IsoDate; value: number } | null
  currentReading: { date: IsoDate; value: number } | null
}

export type ComputeConsumptionResult = {
  periodStart: IsoDate
  periodEnd: IsoDate
  results: MeterConsumptionResult[]
  diagnostics: ConsumptionDiagnostic[]
  /** true iff every meter resolved (results.every(r => r.ok)). */
  ok: boolean
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidIsoDate(value: string): boolean {
  return typeof value === 'string' && ISO_DATE_RE.test(value)
}

function assertIsoDate(name: string, value: string): void {
  if (!isValidIsoDate(value)) {
    throw new Error(`computeMeterConsumption: ${name} must be 'YYYY-MM-DD', got '${value}'`)
  }
}

/**
 * Compute one settlement period's consumption for a set of meters. See the
 * module header for the money-free unit conventions (this module never
 * touches cents — allocate.ts's CONSUMPTION-basis / heatSplit legs convert
 * `consumptionUnits` into an integer weight themselves).
 *
 * CONTRACT ERRORS (programmer/caller mistakes) THROW:
 *   - periodStart/periodEnd not 'YYYY-MM-DD', or periodEnd < periodStart.
 *   - a duplicate meterId in the input (a caller bug — meters are looked up
 *     by id downstream; two entries for the same id is ambiguous).
 *
 * DATA-QUALITY problems DEGRADE into per-meter diagnostics + that meter's
 * `ok: false` and NEVER throw, NEVER return NaN — see ConsumptionDiagnostic.
 * One meter's failure does not block another meter's result (unlike
 * allocate.ts's area key, consumption is meter-scoped, not shared across the
 * whole run) — the top-level `ok` is simply `results.every(r => r.ok)`, for a
 * caller that wants an all-or-nothing gate.
 */
export function computeMeterConsumption(
  meters: MeterConsumptionInput[],
  periodStart: IsoDate,
  periodEnd: IsoDate,
): ComputeConsumptionResult {
  assertIsoDate('periodStart', periodStart)
  assertIsoDate('periodEnd', periodEnd)
  if (periodEnd < periodStart) {
    throw new Error(`computeMeterConsumption: periodEnd (${periodEnd}) is before periodStart (${periodStart})`)
  }

  const seenMeterIds = new Set<string>()
  for (const m of meters) {
    if (seenMeterIds.has(m.meterId)) {
      throw new Error(`computeMeterConsumption: duplicate meterId '${m.meterId}' in input`)
    }
    seenMeterIds.add(m.meterId)
  }

  const diagnostics: ConsumptionDiagnostic[] = []
  const results: MeterConsumptionResult[] = []

  for (const meter of meters) {
    const blockMeter = (
      diag: ConsumptionDiagnostic,
    ): void => {
      diagnostics.push(diag)
    }
    let meterBlocked = false

    if (!Number.isFinite(meter.multiplier) || meter.multiplier <= 0) {
      blockMeter({ code: 'METER_INVALID_MULTIPLIER', blocking: true, meterId: meter.meterId, value: meter.multiplier })
      meterBlocked = true
    }

    // Validate every reading up front — an invalid reading anywhere in the
    // set makes the whole meter's baseline/current selection untrustworthy.
    const seenDates = new Set<string>()
    for (const r of meter.readings) {
      if (!isValidIsoDate(r.readingDate)) {
        blockMeter({ code: 'METER_INVALID_READING_DATE', blocking: true, meterId: meter.meterId, readingDate: r.readingDate })
        meterBlocked = true
        continue
      }
      if (seenDates.has(r.readingDate)) {
        blockMeter({ code: 'METER_DUPLICATE_READING_DATE', blocking: true, meterId: meter.meterId, readingDate: r.readingDate })
        meterBlocked = true
        continue
      }
      seenDates.add(r.readingDate)
      if (!Number.isFinite(r.value) || r.value < 0) {
        blockMeter({
          code: 'METER_INVALID_READING_VALUE',
          blocking: true,
          meterId: meter.meterId,
          readingDate: r.readingDate,
          value: r.value,
        })
        meterBlocked = true
      }
    }

    if (meterBlocked) {
      results.push({ meterId: meter.meterId, unitId: meter.unitId, ok: false, consumptionUnits: null, baselineReading: null, currentReading: null })
      continue
    }

    const sorted = [...meter.readings].sort((a, b) => (a.readingDate < b.readingDate ? -1 : a.readingDate > b.readingDate ? 1 : 0))

    // baseline: the latest reading with date <= periodStart.
    let baseline: MeterReadingInput | null = null
    for (const r of sorted) {
      if (r.readingDate <= periodStart) baseline = r
      else break
    }
    if (!baseline) {
      blockMeter({ code: 'METER_MISSING_BASELINE_READING', blocking: true, meterId: meter.meterId })
      results.push({ meterId: meter.meterId, unitId: meter.unitId, ok: false, consumptionUnits: null, baselineReading: null, currentReading: null })
      continue
    }

    // current: the latest reading with periodStart < date <= periodEnd — a
    // reading taken DURING the period, strictly after the baseline's cutoff.
    let current: MeterReadingInput | null = null
    for (const r of sorted) {
      if (r.readingDate > periodStart && r.readingDate <= periodEnd) current = r
    }
    if (!current) {
      blockMeter({ code: 'METER_NO_READINGS_IN_PERIOD', blocking: true, meterId: meter.meterId })
      results.push({
        meterId: meter.meterId,
        unitId: meter.unitId,
        ok: false,
        consumptionUnits: null,
        baselineReading: { date: baseline.readingDate, value: baseline.value },
        currentReading: null,
      })
      continue
    }

    const delta = current.value - baseline.value
    if (delta < 0) {
      blockMeter({
        code: 'METER_NEGATIVE_CONSUMPTION',
        blocking: true,
        meterId: meter.meterId,
        baselineValue: baseline.value,
        currentValue: current.value,
      })
      results.push({
        meterId: meter.meterId,
        unitId: meter.unitId,
        ok: false,
        consumptionUnits: null,
        baselineReading: { date: baseline.readingDate, value: baseline.value },
        currentReading: { date: current.readingDate, value: current.value },
      })
      continue
    }

    results.push({
      meterId: meter.meterId,
      unitId: meter.unitId,
      ok: true,
      consumptionUnits: delta * meter.multiplier,
      baselineReading: { date: baseline.readingDate, value: baseline.value },
      currentReading: { date: current.readingDate, value: current.value },
    })
  }

  return {
    periodStart,
    periodEnd,
    results,
    diagnostics,
    ok: results.every((r) => r.ok),
  }
}

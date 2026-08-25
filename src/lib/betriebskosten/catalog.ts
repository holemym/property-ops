// Reviewable, translatable, lawyer-checkable metadata for the section-21 MRG
// chargeable-cost catalog (migration 0031). The Postgres enum
// (`operating_cost_category`) is the CONSTRAINT (a non-passable cost cannot be
// entered at all); this map is the companion documentation of WHY each
// admitted value is chargeable and what caveat it carries — kept in code, not
// a DB reference table, matching the house pattern of storing enum semantics in
// TS (src/types/domain.ts comments, src/lib/status.ts-style helpers) rather than
// introducing a global table that would need its own RLS for no isolation
// benefit. `Record<OperatingCostCategory, CategoryMeta>` is exhaustiveness-
// checked by `tsc` — a future `alter type ... add value` therefore fails the
// build until this map is updated, which IS the enforcement.

import type { OperatingCostCategory, AllocationBasis } from '@/types/domain'

export type CategoryMeta = {
  /** German label (de-AT) — display only, never stored (next-intl renders it;
   * the DB/enum always carries the ASCII identifier). */
  de: string
  /** English label (en-IE) — display only. */
  en: string
  /** The statutory basis this cost is chargeable under. HEIZKG (migration
   * 0032, U-B) is the ONE basis whose category is structurally forced onto
   * the measured-consumption split — see settlement_allocation_rules_
   * heat_category_requires_consumption_basis (0032) and
   * src/lib/betriebskosten/allocate.ts's heat-split contract. */
  legalBasis: 'MRG_21_1' | 'MRG_21_2' | 'MRG_22' | 'MRG_23' | 'MRG_24' | 'HEIZKG'
  /** The section-17 basis this category defaults to when no period/category
   * override rule exists (settlement_allocation_rules). */
  defaultBasis: AllocationBasis
  /** section 21(1) Z6 (optional insurance) requires consent from tenants
   * holding >50% of the Nutzflaeche. No enum/check constraint can enforce
   * that — this flag drives a UI nudge; a real consent record is a later
   * table. */
  requiresTenantConsent: boolean
  /** section 22 Verwaltungshonorar is capped at a statutory, annually-revised
   * per-m2 amount. This engine does NOT enforce the cap (the current
   * Kategoriebetrag is a yearly data feed, deliberately out of U-A) — the flag
   * exists so a UI can surface "subject to the section 22 cap — verify" rather
   * than imply full compliance. */
  statutoryCap: 'PER_M2_PER_YEAR' | null
  /** section 24 Gemeinschaftsanlagen distribute among the units that actually
   * USE the facility, not necessarily all units of the property — legally
   * distinct from the section 21 "every unit" default. `true` is a nudge to
   * scope the position via `CostPositionInput.participatingUnitIds`, not an
   * enforced constraint. */
  scopedToUsers: boolean
}

export const BETRIEBSKOSTEN_CATALOG: Record<OperatingCostCategory, CategoryMeta> = {
  WATER_SEWER: {
    de: 'Wasserversorgung / Abwasser',
    en: 'Water supply / sewage',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  DRAIN_CLEANING: {
    de: 'Kanalraeumung',
    en: 'Drain / sewer cleaning',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  WASTE_DISPOSAL: {
    de: 'Muell- / Unratabfuhr',
    en: 'Waste disposal',
    legalBasis: 'MRG_21_2',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  PEST_CONTROL: {
    de: 'Schaedlingsbekaempfung',
    en: 'Pest control',
    legalBasis: 'MRG_21_2',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  CHIMNEY_SWEEP: {
    de: 'Rauchfangkehrung',
    en: 'Chimney sweep',
    legalBasis: 'MRG_21_2',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  COMMON_ELECTRICITY: {
    de: 'Beleuchtung allgemeine Teile',
    en: 'Common-area electricity',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  INSURANCE_FIRE: {
    de: 'Feuerversicherung',
    en: 'Fire insurance',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  INSURANCE_LIABILITY: {
    de: 'Haftpflichtversicherung',
    en: 'Liability insurance',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  INSURANCE_WATER_DAMAGE: {
    de: 'Leitungswasserschadenversicherung',
    en: 'Water-damage insurance',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  INSURANCE_OTHER: {
    de: 'Sonstige Versicherung (z.B. Glasbruch, Sturmschaden)',
    en: 'Other insurance (e.g. glass breakage, storm damage)',
    legalBasis: 'MRG_21_1',
    defaultBasis: 'USABLE_AREA',
    // section 21(1) Z6 — a "Wahlversicherung" needs tenant-majority consent.
    requiresTenantConsent: true,
    statutoryCap: null,
    scopedToUsers: false,
  },
  PUBLIC_CHARGES: {
    de: 'Oeffentliche Abgaben (z.B. Grundsteuer)',
    en: 'Public charges (e.g. property tax)',
    legalBasis: 'MRG_21_2',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  MANAGEMENT_FEE: {
    de: 'Verwaltungshonorar',
    en: 'Management fee',
    legalBasis: 'MRG_22',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    // section 22 caps this at a statutory, annually-revised per-m2 amount —
    // NOT enforced by this engine (see the field doc above).
    statutoryCap: 'PER_M2_PER_YEAR',
    scopedToUsers: false,
  },
  CARETAKER: {
    de: 'Hausbesorger / Hausbetreuung',
    en: 'Caretaker / building management',
    legalBasis: 'MRG_23',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  CLEANING: {
    de: 'Hausreinigung',
    en: 'Building cleaning',
    legalBasis: 'MRG_23',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  SNOW_REMOVAL: {
    de: 'Schneeraeumung',
    en: 'Snow removal',
    legalBasis: 'MRG_23',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  GARDEN_MAINTENANCE: {
    de: 'Gartenbetreuung',
    en: 'Garden maintenance',
    legalBasis: 'MRG_23',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  ELEVATOR: {
    de: 'Aufzug',
    en: 'Elevator',
    // section 24 Gemeinschaftsanlage, NOT section 21 — a legally different
    // apportionment regime (ground-floor units can be exempt by agreement).
    legalBasis: 'MRG_24',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: true,
  },
  COMMON_FACILITY_OTHER: {
    de: 'Sonstige Gemeinschaftsanlage (z.B. Waschkueche, Spielplatz)',
    en: 'Other shared facility (e.g. laundry, playground)',
    legalBasis: 'MRG_24',
    defaultBasis: 'USABLE_AREA',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: true,
  },
  // HeizKG (migration 0032, U-B) — NOT MRG section 21. defaultBasis is
  // 'CONSUMPTION' because it is the ONLY basis these two categories can ever
  // resolve to (enforced by a DB CHECK constraint AND, redundantly, by
  // src/lib/betriebskosten/allocate.ts) — an operator can never produce a
  // pure-area heat statement, which is the entire compliance point of
  // deferring these two categories out of U-A in the first place.
  HEATING: {
    de: 'Heizung',
    en: 'Heating',
    legalBasis: 'HEIZKG',
    defaultBasis: 'CONSUMPTION',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
  HOT_WATER: {
    de: 'Warmwasser',
    en: 'Hot water',
    legalBasis: 'HEIZKG',
    defaultBasis: 'CONSUMPTION',
    requiresTenantConsent: false,
    statutoryCap: null,
    scopedToUsers: false,
  },
}

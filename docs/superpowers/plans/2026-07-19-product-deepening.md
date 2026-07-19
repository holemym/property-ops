# Property Ops — Product Deepening Plan (2026-07-19)

Driven by a directive to review usability/usefulness, complete features, build out the
**rentee (tenant) facing view**, add icons, reach parity with proper property-ops apps,
and design a **utility (electricity/gas/water) billing system** — the last gated on
explicit sign-off before any code.

Method: two read-only analysis passes — a **codebase audit** (feature completeness, tenant
surface, UX, icons, dead ends) and **competitive/market research** (AppFolio, Buildium,
DoorLoop, Yardi Breeze, Hemlane, Rentec, Rent Manager, +DACH tools; features, resident
portals, RUBS/sub-metering, and Austrian Betriebskosten/Heizkosten law).

---

## 1. Where the app actually stands

**The operator side is mature.** Properties, units, tenancies, tickets (list/detail/board/
calendar + vendor job portal), vendors, occupancy, rent roll, invoices (+recurring rent),
finance, owner statements, insights, documents, map, notifications, ⌘K search, TOTP MFA —
all built and, as of today, the migrations behind them are **applied to prod** (0022–0028,
20 tables). 481 tests green.

**The real gaps are three:**

1. **The rentee (tenant) view is a maintenance-ticket tracker and nothing else — and it has
   no front door.** A tenant can submit/track requests and message their manager. They
   *cannot* be created (the invite form only offers OPERATOR/ACCOUNTANT/OWNER — no TENANT
   role exists in the invite path), and the People directory is disconnected from portal
   logins. So in practice **no real resident can even reach the portal.** They also can't
   see their lease, rent, invoices, documents, announcements, or a contact.
2. **No utility/metering system** — the category's least-commoditized area and, for a Vienna
   market, the strongest differentiator (see §4).
3. **Polish + honesty gaps** — no error/not-found boundaries (bad ids escape the app shell
   into an unstyled 500), stale "preview" labels on shipped features (Occupancy, Rent roll),
   text-only create buttons (icons missing), payment tracking is status-only (no amounts).

Competitive parity gaps beyond the above (larger, external-integration-heavy, treated as
**Phase 3 / strategic backlog**): online rent payments + ACH/autopay, tenant screening +
applications, lease e-sign, listing syndication, broadcast comms, GL-grade accounting.

---

## 2. Phase 0 — Polish & completion (AUTONOMOUS, no sign-off; in flight)

Unambiguous improvements matching "add icons / complete features." Zero product-decision
risk. Building now, held for review before deploy.

- **P0-1 Error boundaries** — global `error.tsx` + `not-found.tsx` (and an `(app)`-scoped
  pair) so a bad id / thrown query stays inside the shell with a "back to dashboard"
  affordance instead of Next's unstyled 500. *(Audit §3.1 — worst dead end.)*
- **P0-2 Kill stale "preview" copy** — Occupancy header + legend, Rent roll subtitle. These
  are shipped, interactive features; the labels read as untrustworthy. *(Audit §3.2)*
- **P0-3 `/settings` index** — a real index (or redirect) so the bare path doesn't 404.
- **P0-4 Icon pass** — `Plus` on every New/Add button (Properties, Units, Vendors, People,
  Tickets, Invoices) to match the icon'd Export buttons; `CirclePlus` on tenant "Report an
  issue"; `UserPlus` on Invite; per-type icons on notification rows; icon on the Security
  "Recent activity" empty state; provider glyph on "Continue with Google". *(Audit §4)*
- **P0-5 Payment ledger (completion)** — replace status-only "Mark partial/paid" with an
  amount-tracked `invoice_payments` ledger so outstanding balances and owner "Paid" columns
  are real. `[rls]` (new table + migration). *(Audit §3.6 — this is the one Phase-0 item
  with a migration; RLS-reviewed before commit.)*

---

## 3. Phase 1 — The rentee (tenant) experience  ← the priority you named

The portal is well-built but unreachable and shallow. Two steps.

### 1A — Give it a front door (onboarding)  **[needs sign-off: scope only]**
- Extend the invite flow to create **TENANT** logins (schema + UI in Settings→Users).
- Add **"Invite to portal"** from a People directory person → links the `tenants` contact
  record to a real auth account (add an `auth_user_id` link), so the directory and the
  portal stop being two disconnected worlds. `[rls]`.

### 1B — Make the portal worth logging into
Surface what a resident expects, reusing data that already exists:
- **My home** — their tenancy: unit, rent, lease dates, manager/building contact block.
- **Documents** — their lease + certificates (tenant-scoped view of the Documents vault).
- **My charges** — read view of their own invoices + history. *(Actual in-app **payment**
  needs Stripe = Phase 3; this surfaces the bill + "how to pay" until then.)*
- **Announcements** — a lightweight building/property broadcast a resident can read (new
  `announcements` concept; operator composes, tenants read). `[rls]`.
- Broaden the tenant nav beyond the current two items; give it a real landing page.

**Decision for you:** portal depth now — (a) onboarding + read surfaces (home/lease/docs/
charges-view/announcements), deferring real online payment to Phase 3/Stripe; or (b) pull
Stripe forward and include actual rent payment now. Recommend **(a)** — it's fully buildable
today and makes the portal real; payment rails are a separate, larger integration.

---

## 4. Phase 2 — Utility / Betriebskosten engine  **[SIGN-OFF GATED — no code until approved]**

The differentiator. US tools do RUBS as a "black box" (AppFolio) or bolt on 3rd parties
(Conservice/SimpleBills); DACH tools do annual statements but aren't modern multi-tenant
SaaS. A **transparent, Austrian-law-compliant** engine is a genuine wedge for Vienna — and a
recurring-revenue line (per-door billing fee, as Propertyware/AppFolio monetize).

### Legal spine (why this is DACH-first, not US-RUBS-first)
- **Austria §21 MRG** exhaustively lists which operating costs may be passed through — nothing
  else is chargeable, even by contract. The engine encodes that catalog.
- **§17 MRG**: default distribution key = **Nutzfläche** (usable area): `unit share = (unit
  usable area / total usable area) × total operating cost`.
- **Heating (HeizKG)**: for central systems, **55–75% of heat cost must be billed on measured
  consumption**, remainder on heated area — so heat needs meters + a consumption/base split.
- Model is an **annual reconciliation**: tenants pay monthly **advance payments
  (Vorauszahlung)**; once a year, actual vs. advances → **Nachzahlung (owed)** or **Guthaben
  (refund)**, issued as a statement. (Germany's BetrKV/HeizkostenV is the adjacent 50–70% variant.)

### Data model (new tables, all workspace-scoped, composite-FK pattern)
- `utility_accounts` — property supply: `type` (WATER|ELECTRIC|GAS|HEAT|TRASH|OTHER),
  provider, `is_master_metered`.
- `meters` — unit or common; `utility_account_id`, type, serial, `multiplier`, unit-of-measure.
- `meter_readings` — `meter_id`, `reading_date`, `value`, `source` (MANUAL|IMPORT|MOBILE).
- `cost_positions` — master-bill items for a period; `category` constrained to the §21 MRG /
  BetrKV catalog; `period_start/end`, `amount`.
- `allocation_rules` — `basis` (AREA|OCCUPANCY|CONSUMPTION|HEADCOUNT|PER_UNIT|BLENDED),
  weights, `owner_deduction_pct`, `heat_consumption_split_pct` (HeizKG).
- `settlement_periods` (annual) + `settlement_runs` → produce `utility_charges` (unit/tenancy,
  period, basis snapshot, amount) → post to ledger + render a **transparent breakdown** (share
  math for RUBS/Betriebskosten; start/end readings + dates for sub-metering).

### Workflow
Configure accounts/meters/rules per property → each period capture readings *or* import the
master bill → deduct owner/common portion → run allocation (preview per-unit) → approve →
generate itemized tenant charges → (annually) reconcile advances vs actual → emit statement
PDF + cover letter.

### Phasing (build order once approved)
- **U-A (core Austrian Betriebskostenabrechnung):** cost positions + §21 MRG catalog +
  area-based allocation + itemized tenant statement PDF. Serves most of the real-world need
  with no hardware.
- **U-B (consumption):** meters + readings + consumption/blended allocation + HeizKG heat split
  (sub-metering + heating compliance).
- **U-C (reconciliation):** monthly Vorauszahlung + annual advance-vs-actual → Nachzahlung/
  Guthaben, surfaced in the tenant portal.

### UI
New **"Betriebskosten / Utilities"** nav section: per-property config (accounts, meters,
rules), a reading-entry surface, and an **allocation-run wizard** (select → basis → deduct
owner portion → review per-unit → post) — the bulk-action wizard pattern the category uses.
Portal shows the resident their itemized statement.

### Decisions for you (this is what "sign off" resolves)
1. **DACH-first** (Austrian Betriebskosten/§17 MRG + HeizKG) as the primary model, US
   RUBS/sub-metering as the `basis`-driven extension? *(recommend yes)*
2. Build **U-A first** (annual area-based statement, no hardware) as the MVP slice? *(recommend yes)*
3. Encode the **§21 MRG / BetrKV chargeable-cost catalog** as a constraint (block non-passable
   costs)? *(recommend yes — it's the compliance value)*
4. Statement output: generated **PDF + cover letter** (like Immoware24/vermieter1)?

---

## 5. Phase 3 — Strategic backlog (external-integration-heavy; flagged, not scheduled)

The competitive "money + leasing loop." Each needs a 3rd-party rail and its own decision:
online rent payments + ACH/autopay (Stripe), tenant screening/applications, lease e-sign,
listing syndication (willhaben/ImmoScout24 in DACH), broadcast email/SMS (Resend is wired but
disconnected; needs a key), GL-grade accounting depth. Also: connect email + run the pending
`[verify]` playbooks; live-session revocation on deactivate; CSP enforce (S2-3).

---

## 6. Sequencing & sign-off

```
Phase 0 (polish, autonomous, in flight)
  → Phase 1A onboarding → 1B portal surfaces   [1A scope needs a nod]
  → Phase 2 utility engine U-A → U-B → U-C      [GATED on sign-off]
  → Phase 3 backlog (per-item decisions)
```

**What I need from you to keep moving:**
- **A** — Phase 1 portal depth: read-surfaces now + Stripe later (recommended), or Stripe now?
- **B** — Phase 2 utility engine: approve the design + the four decisions in §4? DACH-first,
  U-A MVP first?
- **C** — anything to reprioritize, or features to add/drop from this plan?

Phase 0 runs regardless (you asked for icons + completion). Everything in Phase 1B's schema-
touching parts and all of Phase 2 waits for your answers.

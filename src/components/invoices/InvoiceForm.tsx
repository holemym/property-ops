'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { invoiceTotals } from '@/lib/invoices/compute'
import {
  invoicePartyTypeEnum,
  invoiceDirectionEnum,
} from '@/lib/validation/invoice'

// The InvoiceForm: party + direction + dates + tax on top, then a dynamic line-item editor
// with a live running subtotal/tax/total. Lines are serialised to JSON in a hidden `lines`
// field on submit (a hidden-input mirror kept in sync with the row state) — the action
// JSON.parses it back into the array invoiceFormSchema expects. The server action is passed
// in as a prop so this one component serves both create and edit.
//
// React Compiler is on: the plain handlers below are auto-memoised — no useCallback.

const PARTY_TYPES = invoicePartyTypeEnum.options
const DIRECTIONS = invoiceDirectionEnum.options

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

const DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: 'Outbound — we bill them',
  INBOUND: 'Inbound — they bill us',
}

type LineRow = { description: string; quantity: string; unitAmount: string }

export type AttributionOption = { id: string; label: string }

export type InvoiceFormDefaults = {
  partyType?: string
  partyName?: string
  direction?: string
  currency?: string
  taxRate?: string
  issueDate?: string
  dueDate?: string
  recipientEmail?: string
  notes?: string
  propertyId?: string
  unitId?: string
  tenancyId?: string
  vendorId?: string
  ticketId?: string
  lines?: LineRow[]
}

const EMPTY_LINE: LineRow = { description: '', quantity: '1', unitAmount: '0' }

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })
function fmt(value: number): string {
  return money.format(value)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function InvoiceForm({
  action,
  defaults = {},
  submitLabel = 'Create invoice',
  properties,
  units,
  tenancies,
  vendors,
  tickets,
}: {
  action: (formData: FormData) => void | Promise<void>
  defaults?: InvoiceFormDefaults
  submitLabel?: string
  properties: AttributionOption[]
  units: AttributionOption[]
  tenancies: AttributionOption[]
  vendors: AttributionOption[]
  tickets: AttributionOption[]
}) {
  const [lines, setLines] = useState<LineRow[]>(
    defaults.lines && defaults.lines.length > 0 ? defaults.lines : [{ ...EMPTY_LINE }],
  )
  const [taxRate, setTaxRate] = useState(defaults.taxRate ?? '0')

  function updateLine(index: number, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }])
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)))
  }

  // Live totals from the current rows. Non-numeric entries count as 0 so the preview never
  // NaNs while the user is typing; the server re-validates with zod on submit.
  const totalsLines = lines.map((l) => ({
    quantity: Number(l.quantity) || 0,
    unit_amount: Number(l.unitAmount) || 0,
  }))
  const totals = invoiceTotals(totalsLines, Number(taxRate) || 0)

  // The hidden field posts the lines the action parses. Coerce numeric strings to numbers so
  // the JSON matches invoiceLineSchema's shape (zod also coerces, this keeps the payload clean).
  const linesJson = JSON.stringify(
    lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unitAmount: Number(l.unitAmount) || 0,
    })),
  )

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6">
      <input type="hidden" name="lines" value={linesJson} />

      {/* Party + direction */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partyType">Party type</Label>
          <select
            id="partyType"
            name="partyType"
            defaultValue={defaults.partyType ?? 'TENANT'}
            className={SELECT_CLASS + ' capitalize'}
          >
            {PARTY_TYPES.map((p) => (
              <option key={p} value={p}>
                {p.toLowerCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partyName">Party name</Label>
          <Input
            id="partyName"
            name="partyName"
            required
            defaultValue={defaults.partyName ?? ''}
            placeholder="Who is being invoiced?"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="direction">Direction</Label>
          <select
            id="direction"
            name="direction"
            defaultValue={defaults.direction ?? 'OUTBOUND'}
            className={SELECT_CLASS}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABEL[d] ?? d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={defaults.currency ?? 'EUR'}
            maxLength={8}
          />
        </div>
      </div>

      {/* Dates + tax */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="issueDate">Issue date</Label>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            required
            defaultValue={defaults.issueDate ?? today()}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dueDate">Due date (optional)</Label>
          <Input id="dueDate" name="dueDate" type="date" defaultValue={defaults.dueDate ?? ''} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="taxRate">Tax rate (%)</Label>
          <Input
            id="taxRate"
            name="taxRate"
            type="number"
            min={0}
            max={100}
            step="0.01"
            value={taxRate}
            onChange={(e) => setTaxRate(e.target.value)}
          />
        </div>
      </div>

      {/* Delivery */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipientEmail">Recipient email (optional)</Label>
        <Input
          id="recipientEmail"
          name="recipientEmail"
          type="email"
          defaultValue={defaults.recipientEmail ?? ''}
          placeholder="billing@client.com — enables Send"
        />
      </div>

      {/* Optional attribution */}
      <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
        <legend className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Attribution (optional)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <AttributionSelect
            id="propertyId"
            label="Property"
            options={properties}
            defaultValue={defaults.propertyId}
          />
          <AttributionSelect id="unitId" label="Unit" options={units} defaultValue={defaults.unitId} />
          <AttributionSelect
            id="tenancyId"
            label="Tenancy"
            options={tenancies}
            defaultValue={defaults.tenancyId}
          />
          <AttributionSelect
            id="vendorId"
            label="Vendor"
            options={vendors}
            defaultValue={defaults.vendorId}
          />
          <AttributionSelect
            id="ticketId"
            label="Ticket"
            options={tickets}
            defaultValue={defaults.ticketId}
          />
        </div>
      </fieldset>

      {/* Line items */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Line items</h2>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="size-4" />
            Add line
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {/* Column headers */}
          <div className="hidden grid-cols-[1fr_5rem_7rem_7rem_2.25rem] items-center gap-2 px-1 text-xs text-muted-foreground sm:grid">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit amount</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          {lines.map((line, i) => {
            const amount = (Number(line.quantity) || 0) * (Number(line.unitAmount) || 0)
            return (
              <div
                key={i}
                className="grid grid-cols-1 items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_5rem_7rem_7rem_2.25rem] sm:border-0 sm:p-0"
              >
                <Input
                  aria-label={`Line ${i + 1} description`}
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(i, { description: e.target.value })}
                />
                <Input
                  aria-label={`Line ${i + 1} quantity`}
                  type="number"
                  min={0}
                  step="0.01"
                  className="sm:text-right"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
                <Input
                  aria-label={`Line ${i + 1} unit amount`}
                  type="number"
                  step="0.01"
                  className="sm:text-right"
                  value={line.unitAmount}
                  onChange={(e) => updateLine(i, { unitAmount: e.target.value })}
                />
                <span className="px-1 text-sm tabular-nums sm:text-right">{fmt(amount)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove line ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => removeLine(i)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )
          })}
        </div>

        {/* Running totals */}
        <div className="ml-auto flex w-full max-w-xs flex-col gap-1 border-t pt-3 text-sm">
          <TotalRow label="Subtotal" value={fmt(totals.subtotal)} />
          <TotalRow label={`Tax (${Number(taxRate) || 0}%)`} value={fmt(totals.tax)} />
          <TotalRow label="Total" value={fmt(totals.total)} strong />
        </div>
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea id="notes" name="notes" defaultValue={defaults.notes ?? ''} rows={3} />
      </div>

      <div>
        <SubmitButton pendingLabel="Saving">{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}

function AttributionSelect({
  id,
  label,
  options,
  defaultValue,
}: {
  id: string
  label: string
  options: AttributionOption[]
  defaultValue?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} name={id} defaultValue={defaultValue ?? ''} className={SELECT_CLASS}>
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        'flex items-center justify-between ' + (strong ? 'font-semibold text-foreground' : 'text-muted-foreground')
      }
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

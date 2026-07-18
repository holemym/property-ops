'use client'

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  invoiceStatusEnum,
  invoicePartyTypeEnum,
  invoiceDirectionEnum,
} from '@/lib/validation/invoice'

// Live, URL-driven invoice filters — the same pattern as TicketFilters: selects apply on
// change, all state lives in the URL query string (shareable/bookmarkable, re-read by the
// server component), and navigation runs inside a transition with a subtle "updating" cue.

const STATUSES = invoiceStatusEnum.options
const PARTY_TYPES = invoicePartyTypeEnum.options
const DIRECTIONS = invoiceDirectionEnum.options

const CONTROL_CLASS =
  'h-8 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

const DIRECTION_LABEL: Record<string, string> = {
  OUTBOUND: 'Outbound',
  INBOUND: 'Inbound',
}

const humanize = (v: string) => v.charAt(0) + v.slice(1).toLowerCase()

export function InvoiceFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const status = searchParams.get('status') ?? ''
  const partyType = searchParams.get('partyType') ?? ''
  const direction = searchParams.get('direction') ?? ''
  const overdue = searchParams.get('overdue') === '1'
  const hasFilters = Boolean(status || partyType || direction || overdue)

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete('page') // a changed filter resets to the first page
    const qs = next.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function toggleOverdue() {
    setParam('overdue', overdue ? '' : '1')
  }

  function clearAll() {
    startTransition(() => router.push(pathname))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => setParam('status', e.target.value)}
        className={cn(CONTROL_CLASS, 'capitalize')}
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {humanize(s)}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by party type"
        value={partyType}
        onChange={(e) => setParam('partyType', e.target.value)}
        className={cn(CONTROL_CLASS, 'capitalize')}
      >
        <option value="">All parties</option>
        {PARTY_TYPES.map((p) => (
          <option key={p} value={p}>
            {humanize(p)}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by direction"
        value={direction}
        onChange={(e) => setParam('direction', e.target.value)}
        className={CONTROL_CLASS}
      >
        <option value="">All directions</option>
        {DIRECTIONS.map((d) => (
          <option key={d} value={d}>
            {DIRECTION_LABEL[d] ?? d}
          </option>
        ))}
      </select>

      {/* Derived quick filter (Track P3, spec §3) — matches due_date < today AND status
          in (SENT, PARTIAL) server-side (listInvoicesPage); OVERDUE is never a stored
          status, so this can't be a plain <select> option alongside the others. */}
      <button
        type="button"
        onClick={toggleOverdue}
        aria-pressed={overdue}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-sm font-medium transition-colors',
          overdue
            ? 'border-transparent bg-foreground text-background'
            : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        Overdue
      </button>

      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-3.5" />
          Clear
        </button>
      )}

      <span
        className={cn(
          'ml-1 text-xs text-muted-foreground transition-opacity duration-[--duration-fast]',
          isPending ? 'opacity-100' : 'opacity-0',
        )}
        aria-live="polite"
      >
        Updating…
      </span>
    </div>
  )
}

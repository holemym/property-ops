'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ticketStatusEnum, ticketPriorityEnum } from '@/lib/validation/ticket'

// Live, URL-driven ticket filters (UX upgrade). Replaces the old submit-button form:
// selects apply on change, the search box applies debounced, and a clear affordance +
// quick-filter chips sit on top. All state lives in the URL query string (so views stay
// shareable/bookmarkable and the server component re-reads them); navigation runs inside
// a transition so the list can't flash and we can show a subtle "updating" cue.

const STATUSES = ticketStatusEnum.options
const PRIORITIES = ticketPriorityEnum.options

const CONTROL_CLASS =
  'h-8 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

// Quick chips — one-tap common views. Each sets a single param (clearing the other two
// scoping params) so the chips read as mutually-exclusive presets, not additive toggles.
const QUICK_FILTERS: Array<{ label: string; params: Record<string, string> }> = [
  { label: 'All', params: {} },
  { label: 'Needs triage', params: { status: 'NEW' } },
  { label: 'Urgent', params: { priority: 'URGENT' } },
  { label: 'Waiting', params: { status: 'WAITING_FOR_INFO' } },
  { label: 'In progress', params: { status: 'IN_PROGRESS' } },
]

const humanize = (v: string) => v.replace(/_/g, ' ')

export function TicketFilters({
  properties,
}: {
  properties: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const status = searchParams.get('status') ?? ''
  const priority = searchParams.get('priority') ?? ''
  const propertyId = searchParams.get('propertyId') ?? ''
  const q = searchParams.get('q') ?? ''
  const hasFilters = Boolean(status || priority || propertyId || q)

  function pushParams(next: URLSearchParams) {
    const qs = next.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    pushParams(next)
  }

  function applyQuick(params: Record<string, string>) {
    const next = new URLSearchParams()
    // Preserve a free-text search across preset switches; drop the scoping params.
    if (q) next.set('q', q)
    for (const [k, v] of Object.entries(params)) next.set(k, v)
    pushParams(next)
  }

  // Debounced search — controlled local state so focus/cursor never jump, with a ref timer
  // (no effect, so the URL push happens in the change handler, not a state-sync effect).
  const [search, setSearch] = useState(q)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function onSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (value.trim() !== q) setParam('q', value.trim())
    }, 300)
  }

  function clearAll() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearch('')
    startTransition(() => router.push(pathname))
  }

  // Clear the pending debounce timer on unmount (no state update — safe in an effect).
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const activeQuick = (params: Record<string, string>) => {
    const keys = Object.keys(params)
    if (keys.length === 0) return !status && !priority && !propertyId
    return keys.every((k) => searchParams.get(k) === params[k]) && !propertyId
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Quick-filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_FILTERS.map((chip) => {
          const active = activeQuick(chip.params)
          return (
            <button
              key={chip.label}
              type="button"
              onClick={() => applyQuick(chip.params)}
              aria-pressed={active}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-[--duration-fast] ease-[--ease-out]',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {chip.label}
            </button>
          )
        })}
        {/* Subtle "updating" cue while a navigation transition is in flight. */}
        <span
          className={cn(
            'ml-1 text-xs text-muted-foreground transition-opacity duration-[--duration-fast]',
            isPending ? 'opacity-100' : 'opacity-0'
          )}
          aria-live="polite"
        >
          Updating…
        </span>
      </div>

      {/* Detailed controls */}
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
          aria-label="Filter by priority"
          value={priority}
          onChange={(e) => setParam('priority', e.target.value)}
          className={cn(CONTROL_CLASS, 'capitalize')}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by property"
          value={propertyId}
          onChange={(e) => setParam('propertyId', e.target.value)}
          className={CONTROL_CLASS}
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search tickets by title"
            placeholder="Search by title"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className={cn(CONTROL_CLASS, 'w-full pl-8')}
          />
        </div>

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
      </div>
    </div>
  )
}

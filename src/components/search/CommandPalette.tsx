'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Building2,
  DoorOpen,
  Ticket,
  Wrench,
  User,
  Receipt,
  FileText,
  CornerDownLeft,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResult, SearchResultType } from '@/lib/data/search'

// Group order + presentation for each entity type.
const TYPE_ORDER: SearchResultType[] = [
  'property', 'unit', 'ticket', 'tenant', 'vendor', 'invoice', 'document',
]
const TYPE_META: Record<SearchResultType, { label: string; icon: LucideIcon }> = {
  property: { label: 'Properties', icon: Building2 },
  unit: { label: 'Units', icon: DoorOpen },
  ticket: { label: 'Tickets', icon: Ticket },
  tenant: { label: 'Tenants', icon: User },
  vendor: { label: 'Vendors', icon: Wrench },
  invoice: { label: 'Invoices', icon: Receipt },
  document: { label: 'Documents', icon: FileText },
}

function orderResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
}

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const ordered = orderResults(results)

  function close() {
    setOpen(false)
    setQuery('')
    setResults([])
    setActiveIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
  }

  // Global ⌘K / Ctrl+K to open; the listener only toggles state (no synchronous setState
  // in an effect body, so React Compiler is happy).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // Debounced fetch driven from the input's change handler (not an effect) so state updates
  // stay in event/async callbacks.
  function onQueryChange(value: string) {
    setQuery(value)
    setActiveIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      abortRef.current?.abort()
      setResults([])
      setLoading(false)
      return
    }
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setLoading(true)
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results?: SearchResult[] }) => {
          setResults(data.results ?? [])
          setActiveIndex(0)
          setLoading(false)
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setLoading(false)
        })
    }, 200)
  }

  function go(result: SearchResult) {
    close()
    router.push(result.href)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (ordered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, ordered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = ordered[activeIndex]
      if (chosen) go(chosen)
    }
  }

  return (
    <>
      {/* Trigger — a search-box-shaped button. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-8 w-56 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-sans text-[0.6875rem] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh] motion-safe:animate-in motion-safe:fade-in-0"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-lg motion-safe:animate-in motion-safe:zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-2.5 border-b px-3.5">
              {loading ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <Search className="size-4 shrink-0 text-muted-foreground" />
              )}
              <input
                autoFocus
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search properties, units, tickets, people, invoices…"
                className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-label="Search query"
              />
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto p-1.5">
              {query.trim().length < 2 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Type to search across your workspace.
                </p>
              ) : ordered.length === 0 && !loading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No matches for “{query.trim()}”.
                </p>
              ) : (
                <ResultList ordered={ordered} activeIndex={activeIndex} onPick={go} onHover={setActiveIndex} />
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-3 border-t px-3.5 py-2 text-[0.6875rem] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" /> open
              </span>
              <span>↑↓ navigate</span>
              <span>esc close</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ResultList({
  ordered,
  activeIndex,
  onPick,
  onHover,
}: {
  ordered: SearchResult[]
  activeIndex: number
  onPick: (r: SearchResult) => void
  onHover: (i: number) => void
}) {
  return (
    <ul className="flex flex-col">
      {ordered.map((r, i) => {
        // Header when this row starts a new type group (no render-time mutation).
        const showHeader = i === 0 || ordered[i - 1].type !== r.type
        const Icon = TYPE_META[r.type].icon
        const active = i === activeIndex
        return (
          <li key={`${r.type}-${r.id}`}>
            {showHeader && (
              <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {TYPE_META[r.type].label}
              </p>
            )}
            <button
              type="button"
              onClick={() => onPick(r)}
              onMouseMove={() => onHover(i)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              {r.subtitle && (
                <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground capitalize">
                  {r.subtitle}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

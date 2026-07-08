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
  LayoutDashboard,
  CalendarClock,
  ReceiptText,
  LayoutGrid,
  CalendarDays,
  ChartColumn,
  Wallet,
  Users,
  CirclePlus,
  CornerDownLeft,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can, type Permission } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'
import type { SearchResult, SearchResultType } from '@/lib/data/search'

// --- static commands (navigation + create) -----------------------------------
type Command = {
  id: string
  label: string
  icon: LucideIcon
  href: string
  group: 'Go to' | 'Create'
  permission?: Permission
}

const COMMANDS: Command[] = [
  { id: 'go-dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard', group: 'Go to' },
  { id: 'go-properties', label: 'Properties', icon: Building2, href: '/properties', group: 'Go to', permission: 'properties:read' },
  { id: 'go-units', label: 'Units', icon: DoorOpen, href: '/units', group: 'Go to', permission: 'units:read' },
  { id: 'go-occupancy', label: 'Occupancy', icon: CalendarClock, href: '/occupancy', group: 'Go to', permission: 'occupancy:read' },
  { id: 'go-rent-roll', label: 'Rent roll', icon: ReceiptText, href: '/rent-roll', group: 'Go to', permission: 'occupancy:read' },
  { id: 'go-vendors', label: 'Vendors', icon: Wrench, href: '/vendors', group: 'Go to', permission: 'vendors:read' },
  { id: 'go-tickets', label: 'Tickets', icon: Ticket, href: '/tickets', group: 'Go to', permission: 'tickets:read' },
  { id: 'go-board', label: 'Board', icon: LayoutGrid, href: '/tickets/board', group: 'Go to', permission: 'tickets:read' },
  { id: 'go-calendar', label: 'Calendar', icon: CalendarDays, href: '/calendar', group: 'Go to', permission: 'tickets:read' },
  { id: 'go-insights', label: 'Insights', icon: ChartColumn, href: '/insights', group: 'Go to', permission: 'analytics:read' },
  { id: 'go-finance', label: 'Finance', icon: Wallet, href: '/finance', group: 'Go to', permission: 'finance:read' },
  { id: 'go-invoices', label: 'Invoices', icon: Receipt, href: '/invoices', group: 'Go to', permission: 'finance:read' },
  { id: 'go-owners', label: 'Owners', icon: Users, href: '/owners', group: 'Go to', permission: 'finance:read' },
  { id: 'go-documents', label: 'Documents', icon: FileText, href: '/documents', group: 'Go to', permission: 'documents:read' },
  { id: 'new-ticket', label: 'New ticket', icon: CirclePlus, href: '/tickets/new', group: 'Create', permission: 'tickets:write' },
  { id: 'new-invoice', label: 'New invoice', icon: CirclePlus, href: '/invoices/new', group: 'Create', permission: 'finance:write' },
  { id: 'new-property', label: 'New property', icon: CirclePlus, href: '/properties/new', group: 'Create', permission: 'properties:write' },
  { id: 'new-unit', label: 'New unit', icon: CirclePlus, href: '/units/new', group: 'Create', permission: 'units:write' },
  { id: 'new-vendor', label: 'New vendor', icon: CirclePlus, href: '/vendors/new', group: 'Create', permission: 'vendors:write' },
]

// --- search result presentation ----------------------------------------------
const TYPE_ORDER: SearchResultType[] = ['property', 'unit', 'ticket', 'tenant', 'vendor', 'invoice', 'document']
const TYPE_META: Record<SearchResultType, { label: string; icon: LucideIcon }> = {
  property: { label: 'Properties', icon: Building2 },
  unit: { label: 'Units', icon: DoorOpen },
  ticket: { label: 'Tickets', icon: Ticket },
  tenant: { label: 'Tenants', icon: User },
  vendor: { label: 'Vendors', icon: Wrench },
  invoice: { label: 'Invoices', icon: Receipt },
  document: { label: 'Documents', icon: FileText },
}

// A unified row for both static commands and search results, so one flat list drives
// grouping + keyboard navigation.
type PaletteItem = {
  key: string
  group: string
  label: string
  subtitle?: string
  icon: LucideIcon
  href: string
}

export function CommandPalette({ role }: { role: Role }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()

  // Commands the role may use, filtered by the typed query (label substring).
  const commandItems: PaletteItem[] = COMMANDS.filter(
    (c) => (!c.permission || can(role, c.permission)) && (!lower || c.label.toLowerCase().includes(lower)),
  ).map((c) => ({ key: c.id, group: c.group, label: c.label, icon: c.icon, href: c.href }))

  const resultItems: PaletteItem[] = [...results]
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
    .map((r) => ({
      key: `${r.type}-${r.id}`,
      group: TYPE_META[r.type].label,
      label: r.title,
      subtitle: r.subtitle,
      icon: TYPE_META[r.type].icon,
      href: r.href,
    }))

  const items = [...commandItems, ...resultItems]

  function close() {
    setOpen(false)
    setQuery('')
    setResults([])
    setActiveIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
  }

  // Global ⌘K / Ctrl+K to open (listener only toggles state — no setState in effect body).
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

  // Debounced entity search, driven from the input change handler (state updates stay in
  // event/async callbacks). Commands filter instantly client-side; only entities are fetched.
  function onQueryChange(value: string) {
    setQuery(value)
    setActiveIndex(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const t = value.trim()
    if (t.length < 2) {
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
      fetch(`/api/search?q=${encodeURIComponent(t)}`, { signal: controller.signal })
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

  function go(item: PaletteItem) {
    close()
    router.push(item.href)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      close()
      return
    }
    if (items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = items[Math.min(activeIndex, items.length - 1)]
      if (chosen) go(chosen)
    }
  }

  const showNoMatches = trimmed.length >= 2 && items.length === 0 && !loading

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex h-8 w-56 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-accent"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left">Search or jump to…</span>
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
          aria-label="Command palette"
        >
          <div
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-lg motion-safe:animate-in motion-safe:zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
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
                placeholder="Search properties, units, tickets, people… or jump to a page"
                className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-label="Search query"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-1.5">
              {showNoMatches ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No matches for “{trimmed}”.
                </p>
              ) : (
                <PaletteList items={items} activeIndex={activeIndex} onPick={go} onHover={setActiveIndex} />
              )}
            </div>

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

function PaletteList({
  items,
  activeIndex,
  onPick,
  onHover,
}: {
  items: PaletteItem[]
  activeIndex: number
  onPick: (item: PaletteItem) => void
  onHover: (i: number) => void
}) {
  return (
    <ul className="flex flex-col">
      {items.map((item, i) => {
        // Header when this row starts a new group (no render-time mutation).
        const showHeader = i === 0 || items[i - 1].group !== item.group
        const Icon = item.icon
        const active = i === activeIndex
        return (
          <li key={item.key}>
            {showHeader && (
              <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {item.group}
              </p>
            )}
            <button
              type="button"
              onClick={() => onPick(item)}
              onMouseMove={() => onHover(i)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                active ? 'bg-accent text-accent-foreground' : 'text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.subtitle && (
                <span className="max-w-[40%] shrink-0 truncate text-xs capitalize text-muted-foreground">
                  {item.subtitle}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// Client-only persistence for the ⌘K command palette's "Recent" list.
//
// We store a small, capped, most-recent-first list of opened items in localStorage. We keep
// only the data needed to re-render a row and navigate — label, href, and group — and never
// the Lucide icon component (not serialisable); the palette maps the icon back from `group`
// or falls back to a generic Clock icon. All access is SSR-guarded: on the server there is no
// `window`/`localStorage`, so every function no-ops / returns `[]` there.

const KEY = 'property-ops:recent-searches'
const CAP = 6

export type RecentItem = {
  label: string
  href: string
  group: string
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

/** Read the recent list. Returns `[]` on the server or on any parse/storage error. */
export function readRecents(): RecentItem[] {
  if (!hasStorage()) return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as RecentItem).label === 'string' &&
          typeof (x as RecentItem).href === 'string' &&
          typeof (x as RecentItem).group === 'string',
      )
      .slice(0, CAP)
  } catch {
    return []
  }
}

/**
 * Prepend `item` to the recent list, de-duped by `href` (most-recent-first), capped at CAP.
 * Returns the new list so callers can update state without a re-read. No-ops on the server.
 */
export function pushRecent(item: RecentItem): RecentItem[] {
  if (!hasStorage()) return []
  const next = [item, ...readRecents().filter((r) => r.href !== item.href)].slice(0, CAP)
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage full / disabled — the in-memory list still updates for this session.
  }
  return next
}

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// URL-driven pager for server-paginated lists. `baseParams` carries every query param to
// preserve across pages (filters + sort); this component only sets `page`. Renders nothing
// for a single page, so short lists look unchanged.
export function Pagination({
  page,
  pageCount,
  total,
  baseParams,
  basePath,
}: {
  page: number
  pageCount: number
  total: number
  baseParams: Record<string, string>
  basePath: string
}) {
  if (pageCount <= 1) return null

  const hrefFor = (p: number) =>
    `${basePath}?${new URLSearchParams({ ...baseParams, page: String(p) }).toString()}`

  const linkClass =
    'inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground'
  const disabledClass = 'pointer-events-none opacity-40'

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {pageCount} · {total} total
      </p>
      <div className="flex items-center gap-1.5">
        <Link
          href={page > 1 ? hrefFor(page - 1) : '#'}
          aria-disabled={page <= 1}
          tabIndex={page <= 1 ? -1 : undefined}
          className={cn(linkClass, page <= 1 && disabledClass)}
        >
          <ChevronLeft className="size-4" />
          Previous
        </Link>
        <Link
          href={page < pageCount ? hrefFor(page + 1) : '#'}
          aria-disabled={page >= pageCount}
          tabIndex={page >= pageCount ? -1 : undefined}
          className={cn(linkClass, page >= pageCount && disabledClass)}
        >
          Next
          <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  )
}

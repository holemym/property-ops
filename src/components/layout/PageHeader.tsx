import Link from 'next/link'
import type { ReactNode } from 'react'

// Standard page header used on every surface. `title` is the page name, `subtitle`
// an optional one-line description, `actions` an optional slot for buttons (kept to
// the right on wide screens, wrapping below the title on narrow ones).
//
// `backHref`/`backLabel` render the house "← Parent" up-link above the title — the
// same affordance ticket/invoice detail pages hand-roll — so detail pages don't
// rely on browser-back. Pass both or neither.
export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
  backLabel,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  backHref?: string
  backLabel?: string
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        {backHref && backLabel && (
          <Link
            href={backHref}
            className="block w-fit text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {backLabel}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

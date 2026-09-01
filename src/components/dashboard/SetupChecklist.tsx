import Link from 'next/link'
import { CircleCheck, Circle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SetupProgress } from '@/lib/data/setup'

// "Finish setting up" — shown on the dashboard AFTER the first property exists but
// while the setup chain (units → tenancies → residents) is still incomplete. The
// zero-property dashboard has its own full-page empty state; without this card the
// moment one property existed all guidance vanished and the new owner faced six
// zero-count ticket cards. Derived state only — the card retires itself when every
// step has data, no dismissal persistence needed.
type Step = {
  label: string
  detail: string
  done: boolean
  href: string
  cta: string
}

export function SetupChecklist({ progress }: { progress: SetupProgress }) {
  const steps: Step[] = [
    // Rendering at all means ≥1 active property exists (the page gates on it).
    {
      label: 'Add a property',
      detail: 'Your portfolio has its first building.',
      done: true,
      href: '/properties/new',
      cta: 'Add another',
    },
    {
      label: 'Add units',
      detail: 'Break the property into rentable units.',
      done: progress.units > 0,
      href: '/units/new',
      cta: 'Add a unit',
    },
    {
      label: 'Record tenancies',
      detail: 'Who lives where, since when, at what rent.',
      done: progress.tenancies > 0,
      href: '/occupancy',
      cta: 'Record a tenancy',
    },
    {
      label: 'Invite residents',
      detail: 'Give tenants the portal for requests and charges.',
      done: progress.invitedResidents > 0,
      href: '/people',
      cta: 'Open People',
    },
  ]
  const firstPending = steps.find((s) => !s.done)

  return (
    <section className="mb-6 overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Finish setting up</h2>
        <p className="text-xs text-muted-foreground">
          Tickets, rent, and statements all build on these steps.
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {steps.map((step) => {
          const isNext = step === firstPending
          return (
            <li
              key={step.label}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 px-4 py-2.5',
                !step.done && !isNext && 'opacity-60'
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {step.done ? (
                  <CircleCheck className="size-4 shrink-0 text-foreground" />
                ) : (
                  <Circle className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex min-w-0 flex-col">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      step.done ? 'text-muted-foreground line-through decoration-border' : 'text-foreground'
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{step.detail}</span>
                </div>
              </div>
              {isNext && (
                <Link
                  href={step.href}
                  className="group inline-flex shrink-0 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {step.cta}
                  <ArrowRight className="size-3.5 transition-transform duration-[--duration-fast] ease-[--ease-out] group-hover:translate-x-0.5" />
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

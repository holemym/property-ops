import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, Circle, CircleCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type GuideStep = {
  text: ReactNode
  // The screen this step happens on. Steps without one are context, not actions.
  href?: string
  cta?: string
}

// `done` absent = a running count with no finish line (open tickets), shown without a check.
export type GuideStateLine = { done?: boolean; line: string; href: string }

// One chapter of /guide. Templated on purpose: every chapter repeats the same skeleton
// (number, title, purpose, the workspace's real state, then numbered steps), so readers
// learn the shape once. `specimen` is an optional slot for a REAL component of the app
// (status lifecycles, the resident progress tracker), never a drawing of one.
export function GuideChapter({
  id,
  number,
  title,
  purpose,
  state,
  specimen,
  steps,
}: {
  id: string
  number: string
  title: string
  purpose: string
  state?: GuideStateLine
  specimen?: ReactNode
  steps: GuideStep[]
}) {
  return (
    <section id={id} data-chapter className="scroll-mt-16 border-t pt-8 first:border-t-0 first:pt-0 lg:scroll-mt-6">
      <div className="flex items-baseline gap-3">
        <span className="tabular-nums text-sm text-muted-foreground">{number}</span>
        <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{purpose}</p>

      {state && (
        <Link
          href={state.href}
          className="group mt-4 inline-flex max-w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-foreground transition-colors duration-[--duration-fast] hover:bg-accent"
        >
          {state.done === true && <CircleCheck className="size-4 shrink-0" aria-label="Done" />}
          {state.done === false && (
            <Circle className="size-4 shrink-0 text-muted-foreground" aria-label="Not started" />
          )}
          <span className="min-w-0 break-words">{state.line}</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-[--duration-fast] group-hover:translate-x-0.5" />
        </Link>
      )}

      {specimen && <div className="mt-4">{specimen}</div>}

      <ol className="mt-5 flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {steps.map((step, i) => (
          <li key={i} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 gap-3">
              <span className="mt-0.5 shrink-0 tabular-nums text-xs text-muted-foreground">{i + 1}</span>
              <p className="min-w-0 break-words text-sm text-foreground">{step.text}</p>
            </div>
            {step.href && step.cta && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-center"
                render={<Link href={step.href} />}
                nativeButton={false}
              >
                {step.cta}
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

// Menu paths ("People → the resident → Portal access") read as UI, not prose.
export function Path({ children }: { children: ReactNode }) {
  return <span className="font-medium">{children}</span>
}

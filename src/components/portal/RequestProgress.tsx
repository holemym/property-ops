import { Check, Clock, MessageCircleQuestion, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TicketStatus } from '@/types/domain'
import { TENANT_STAGES, tenantProgress } from '@/lib/portal-status'

// A reassuring, tenant-facing progress stepper. Translates the internal ticket status
// into a 4-step journey (Received → Scheduled → In progress → Resolved) with completed,
// current, and upcoming states. Off-track states get their own treatment: a "waiting on
// you" callout while the manager needs more information, and a quiet cancelled state.
export function RequestProgress({ status }: { status: TicketStatus }) {
  const progress = tenantProgress(status)

  if (progress.kind === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">
        <XCircle className="size-4 shrink-0" />
        This request was cancelled.
      </div>
    )
  }

  const current = progress.stageIndex
  const allDone = progress.kind === 'done'
  const waiting = progress.kind === 'waiting'

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex items-start">
        {TENANT_STAGES.map((stage, i) => {
          const done = allDone || i < current
          const active = !allDone && i === current
          const isLast = i === TENANT_STAGES.length - 1
          return (
            <li key={stage} className="flex flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Left connector (hidden on the first step) */}
                <span
                  className={cn(
                    'h-0.5 flex-1',
                    i === 0 ? 'opacity-0' : done || active ? 'bg-foreground/70' : 'bg-border',
                  )}
                  aria-hidden
                />
                {/* Node */}
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 transition-colors',
                    done && 'bg-foreground text-background ring-foreground',
                    active && !waiting && 'bg-background text-foreground ring-foreground',
                    active && waiting && 'bg-amber-100 text-amber-800 ring-amber-400 dark:bg-amber-500/20 dark:text-amber-300',
                    !done && !active && 'bg-background text-muted-foreground ring-border',
                    active && 'motion-safe:animate-pulse',
                  )}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                {/* Right connector (hidden on the last step) */}
                <span
                  className={cn(
                    'h-0.5 flex-1',
                    isLast ? 'opacity-0' : done ? 'bg-foreground/70' : 'bg-border',
                  )}
                  aria-hidden
                />
              </div>
              <span
                className={cn(
                  'mt-1.5 text-center text-xs',
                  done || active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {stage}
              </span>
            </li>
          )
        })}
      </ol>

      {waiting && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">
          <MessageCircleQuestion className="mt-0.5 size-4 shrink-0" />
          <span>Your property manager needs a little more information. Add a message below to keep things moving.</span>
        </div>
      )}

      {allDone && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-sm text-green-900 ring-1 ring-green-200 dark:bg-green-500/10 dark:text-green-200 dark:ring-green-500/20">
          <Check className="size-4 shrink-0" />
          All done — this request has been resolved.
        </div>
      )}

      {!waiting && !allDone && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          Your property manager updates this as work progresses.
        </p>
      )}
    </div>
  )
}

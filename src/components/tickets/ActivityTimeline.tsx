export type TimelineEvent = {
  id: string
  label: string
  delta: string | null
  actor: string
  at: string
}

// The audit log rendered as a vertical timeline: a graphite rail down the left, a node
// per event, and the label/delta/actor/time beside it. Read-only. Events arrive
// newest-or-oldest in the order the data layer returns them; this component does not
// re-sort. The rail is drawn with a border on the list and per-item dots so it degrades
// gracefully with any number of rows.
export function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded.</p>
  }

  return (
    <ol className="relative flex flex-col gap-5 border-l border-border pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          {/* Node sitting on the rail. */}
          <span className="absolute top-1 -left-[1.4375rem] size-2 rounded-full bg-muted-foreground/50 ring-2 ring-background" />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="font-medium text-foreground">{e.label}</span>
            {e.delta && (
              <span className="font-mono text-xs text-muted-foreground">{e.delta}</span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {e.actor} · {e.at}
          </div>
        </li>
      ))}
    </ol>
  )
}

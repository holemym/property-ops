// A compact, human relative date for list rows: "Today", "Yesterday", "3d ago", "5w ago",
// then an absolute "12 Mac"/"12 Mar 2025" once it's old enough to stop counting days.
// Pure + deterministic (pass `now` in tests). Parses ISO timestamps; day math is done in
// local time to match how a person reads "today".

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function relativeDay(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const dayMs = 86400000
  const diffDays = Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / dayMs)

  if (diffDays <= 0) return diffDays === 0 ? 'Today' : formatAbsolute(then, now)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 28) return `${Math.floor(diffDays / 7)}w ago`
  return formatAbsolute(then, now)
}

// Absolute fallback: "12 Mar" for the current year, "12 Mar 2025" otherwise.
function formatAbsolute(then: Date, now: Date): string {
  const sameYear = then.getFullYear() === now.getFullYear()
  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

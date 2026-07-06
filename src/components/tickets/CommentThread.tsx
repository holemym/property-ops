import { Badge } from '@/components/ui/badge'

export type ThreadComment = {
  id: string
  author: string
  body: string
  at: string
  internal: boolean
}

// The comment thread, oldest-first. Internal comments are visually set apart from public
// ones: a subtle amber-tinted row + left accent + an "Internal" tone badge, so a manager
// can tell at a glance which notes the tenant/vendor can see. Public comments render on a
// plain card-toned row. Empty state is a quiet muted line.
export function CommentThread({ comments }: { comments: ThreadComment[] }) {
  if (comments.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments yet.</p>
  }

  return (
    <ul className="flex flex-col gap-3">
      {comments.map((c) => (
        <li
          key={c.id}
          className={
            c.internal
              ? 'rounded-lg border border-amber-200 border-l-2 border-l-amber-400 bg-amber-50/60 p-3 text-sm dark:border-amber-500/20 dark:border-l-amber-500/50 dark:bg-amber-500/5'
              : 'rounded-lg border p-3 text-sm'
          }
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.author}</span>
            {c.internal ? (
              <Badge variant="amber">Internal</Badge>
            ) : (
              <Badge variant="muted">Public</Badge>
            )}
            <span className="text-xs text-muted-foreground">{c.at}</span>
          </div>
          <p className="whitespace-pre-wrap text-foreground">{c.body}</p>
        </li>
      ))}
    </ul>
  )
}

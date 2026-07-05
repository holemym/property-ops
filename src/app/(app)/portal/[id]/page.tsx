import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getTicket } from '@/lib/data/tickets'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { listTicketComments } from '@/lib/data/ticket-comments'
import { TicketStatusBadge } from '@/components/tickets/TicketBadges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { addPublicCommentAction } from '../actions'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

export default async function PortalTicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()

  // RLS returns this ticket ONLY if the tenant owns it (created_by, or created_for after
  // 0013). A ticket belonging to another tenant returns null here even if the id is
  // guessed correctly -> notFound(). No service-role client is used for this read, so
  // there is no way to bypass the row-level scope.
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) notFound()

  const [property, unit, comments] = await Promise.all([
    getProperty(supabase, user.workspaceId, ticket.property_id),
    ticket.unit_id ? getUnit(supabase, user.workspaceId, ticket.unit_id) : Promise.resolve(null),
    // RLS (comments_select_own_public) returns ONLY PUBLIC comments on the tenant's own
    // ticket — INTERNAL comments are invisible to them, full stop.
    listTicketComments(supabase, user.workspaceId, id),
  ])

  const boundAddComment = addPublicCommentAction.bind(null, id)

  return (
    <div className="flex flex-col gap-8">
      {/* Header — title, status, category. NO priority (tenants don't set/see it as a
          concern), NO costs, NO assignment info, NO audit timeline. Clean status view. */}
      <div className="flex flex-col gap-3">
        <Link href="/portal" className="text-sm text-muted-foreground underline underline-offset-2">
          ← Back to my requests
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{ticket.title}</h1>
          <TicketStatusBadge status={ticket.status} />
          <Badge variant="outline">{ticket.category.replace(/_/g, ' ')}</Badge>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      {/* Info panel — location + description + created. */}
      <section className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Property</dt>
          <dd>{property?.name ?? ticket.property_id}</dd>
        </div>
        {unit && (
          <div>
            <dt className="text-muted-foreground">Unit</dt>
            <dd>{unit.label}</dd>
          </div>
        )}
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-wrap">{ticket.description}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{ticket.status.replace(/_/g, ' ')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Reported</dt>
          <dd>{formatDateTime(ticket.created_at)}</dd>
        </div>
      </section>

      {/* Public comment thread — the tenant-facing conversation. */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Messages</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                  <span>{formatDateTime(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {/* Add-message form — NO visibility select. The action hardcodes PUBLIC and RLS
            pins it too, so a tenant can only ever post a public message. */}
        <form action={boundAddComment} className="flex flex-col gap-2">
          <Label htmlFor="body">Add a message</Label>
          <Textarea id="body" name="body" required />
          <Button type="submit" size="sm" className="self-start">
            Send
          </Button>
        </form>
      </section>
    </div>
  )
}

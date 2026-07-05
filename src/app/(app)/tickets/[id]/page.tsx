import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  getTicket,
  getWorkspaceProfile,
  listWorkspaceOperators,
} from '@/lib/data/tickets'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor, listVendors } from '@/lib/data/vendors'
import { listTicketEvents, type TicketEvent } from '@/lib/data/ticket-events'
import { listTicketComments } from '@/lib/data/ticket-comments'
import { nextStatuses } from '@/lib/tickets/status-flow'
import { TicketStatusBadge, TicketPriorityBadge } from '@/components/tickets/TicketBadges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { TicketEventType } from '@/types/domain'
import {
  transitionTicketStatusAction,
  assignOperatorAction,
  assignVendorAction,
  addTicketCommentAction,
} from '../actions'

const EVENT_LABELS: Record<TicketEventType, string> = {
  TICKET_CREATED: 'Ticket created',
  STATUS_CHANGED: 'Status changed',
  PRIORITY_CHANGED: 'Priority changed',
  CATEGORY_CHANGED: 'Category changed',
  OPERATOR_ASSIGNED: 'Operator assigned',
  VENDOR_ASSIGNED: 'Vendor assigned',
  COMMENT_ADDED: 'Comment added',
  ATTACHMENT_UPLOADED: 'Attachment uploaded',
  AI_CLASSIFICATION_GENERATED: 'AI classification generated',
  EXPENSE_LINKED: 'Expense linked',
  INVOICE_UPLOADED: 'Invoice uploaded',
  TICKET_CLOSED: 'Ticket closed',
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(value)
}

// Compact old→new rendering for the audit timeline. STATUS_CHANGED carries {status},
// the *_ASSIGNED events carry an id — we render whatever `status` we find, else fall
// back to a terse JSON of the changed values. Kept intentionally simple (ids, not
// resolved names) to avoid N extra profile/vendor lookups per event row.
function eventDelta(event: TicketEvent): string | null {
  const oldV = event.old_value_json as Record<string, unknown> | null
  const newV = event.new_value_json as Record<string, unknown> | null
  if (oldV && newV && 'status' in oldV && 'status' in newV) {
    return `${String(oldV.status)} → ${String(newV.status)}`
  }
  if (event.metadata_json && typeof event.metadata_json === 'object') {
    const meta = event.metadata_json as Record<string, unknown>
    if ('visibility' in meta) return String(meta.visibility)
  }
  return null
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  // Managers + accountant reach this page (all hold tickets:read). Tenants lack
  // tickets:read and get their own portal in P3.7.
  const user = await requirePermission('tickets:read')
  const supabase = await createClient()

  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) notFound()

  const canWrite = can(user.role, 'tickets:write')
  const canAssign = can(user.role, 'tickets:assign')
  const canInternal = can(user.role, 'tickets:comment-internal')

  const [property, unit, events, comments, operators, vendors, assignedOperator, assignedVendor, reporter] =
    await Promise.all([
      getProperty(supabase, user.workspaceId, ticket.property_id),
      ticket.unit_id ? getUnit(supabase, user.workspaceId, ticket.unit_id) : Promise.resolve(null),
      listTicketEvents(supabase, user.workspaceId, id),
      listTicketComments(supabase, user.workspaceId, id),
      listWorkspaceOperators(supabase, user.workspaceId),
      listVendors(supabase, user.workspaceId, { isActive: true }),
      ticket.assigned_operator_id
        ? getWorkspaceProfile(supabase, user.workspaceId, ticket.assigned_operator_id)
        : Promise.resolve(null),
      ticket.assigned_vendor_id
        ? getVendor(supabase, user.workspaceId, ticket.assigned_vendor_id)
        : Promise.resolve(null),
      getWorkspaceProfile(supabase, user.workspaceId, ticket.created_by_user_id),
    ])

  // Resolve author ids → names for the comment thread and audit actors. operators +
  // reporter cover most; fall back to the raw id when a name is unavailable.
  const nameById = new Map<string, string>()
  for (const op of operators) if (op.full_name) nameById.set(op.id, op.full_name)
  if (reporter?.full_name) nameById.set(reporter.id, reporter.full_name)
  if (assignedOperator?.full_name) nameById.set(assignedOperator.id, assignedOperator.full_name)
  const displayName = (userId: string | null) =>
    userId ? nameById.get(userId) ?? userId : 'System'

  const transitions = nextStatuses(ticket.status)
  const boundTransition = transitionTicketStatusAction.bind(null, id)
  const boundAssignOperator = assignOperatorAction.bind(null, id)
  const boundAssignVendor = assignVendorAction.bind(null, id)
  const boundAddComment = addTicketCommentAction.bind(null, id)

  return (
    <div className="flex flex-col gap-8">
      {/* 1. Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{ticket.title}</h1>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
          <Badge variant="outline">{ticket.category.replace(/_/g, ' ')}</Badge>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      {/* 2. Info panel */}
      <section className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Property</dt>
          <dd>
            {property ? (
              <Link href={`/properties/${property.id}`} className="underline underline-offset-2">
                {property.name}
              </Link>
            ) : (
              ticket.property_id
            )}
          </dd>
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
          <dt className="text-muted-foreground">Reported by</dt>
          <dd>{displayName(ticket.created_by_user_id)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatDateTime(ticket.created_at)}</dd>
        </div>
        {ticket.scheduled_at && (
          <div>
            <dt className="text-muted-foreground">Scheduled</dt>
            <dd>{formatDateTime(ticket.scheduled_at)}</dd>
          </div>
        )}
        {ticket.estimated_cost != null && (
          <div>
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd>{formatMoney(ticket.estimated_cost)}</dd>
          </div>
        )}
        {ticket.actual_cost != null && (
          <div>
            <dt className="text-muted-foreground">Actual cost</dt>
            <dd>{formatMoney(ticket.actual_cost)}</dd>
          </div>
        )}
      </section>

      {/* 3. Status transitions (canWrite only) */}
      {canWrite && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Status</h2>
          {transitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This ticket is {ticket.status.replace(/_/g, ' ')}.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {transitions.map((next) => (
                <form key={next} action={boundTransition}>
                  <input type="hidden" name="nextStatus" value={next} />
                  <input type="hidden" name="expectedCurrentStatus" value={ticket.status} />
                  <Button type="submit" variant="outline" size="sm">
                    Mark {next.replace(/_/g, ' ')}
                  </Button>
                </form>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 4. Assignment (canAssign only) */}
      {canAssign && (
        <section className="grid gap-6 sm:grid-cols-2">
          <form action={boundAssignOperator} className="flex flex-col gap-2">
            <Label htmlFor="operatorId">Assigned operator</Label>
            <select
              id="operatorId"
              name="operatorId"
              defaultValue={ticket.assigned_operator_id ?? ''}
              className="h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="">Unassigned</option>
              {operators.map((op) => (
                <option key={op.id} value={op.id}>
                  {op.full_name ?? op.id}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm" className="self-start">
              Save operator
            </Button>
          </form>

          <form action={boundAssignVendor} className="flex flex-col gap-2">
            <Label htmlFor="vendorId">Assigned vendor</Label>
            <select
              id="vendorId"
              name="vendorId"
              defaultValue={ticket.assigned_vendor_id ?? ''}
              className="h-9 w-full rounded-md border px-2 text-sm"
            >
              <option value="">Unassigned</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.company_name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm" className="self-start">
              Save vendor
            </Button>
          </form>
        </section>
      )}

      {/* Read-only assignment display when the viewer cannot assign (e.g. accountant) */}
      {!canAssign && (
        <section className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Assigned operator</dt>
            <dd>{assignedOperator?.full_name ?? assignedOperator?.id ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assigned vendor</dt>
            <dd>{assignedVendor?.company_name ?? 'Unassigned'}</dd>
          </div>
        </section>
      )}

      {/* 5. Comments timeline */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Comments</h2>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{displayName(c.author_user_id)}</span>
                  <Badge variant={c.visibility === 'INTERNAL' ? 'secondary' : 'outline'}>
                    {c.visibility === 'INTERNAL' ? 'Internal' : 'Public'}
                  </Badge>
                  <span className="text-muted-foreground">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {/* Add-comment form is canWrite-gated: accountant (tickets:read only) is read-only. */}
        {canWrite && (
          <form action={boundAddComment} className="flex flex-col gap-2">
            <Label htmlFor="body">Add a comment</Label>
            <Textarea id="body" name="body" required />
            <div className="flex items-center gap-2">
              <select
                name="visibility"
                defaultValue="PUBLIC"
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="PUBLIC">Public</option>
                {/* INTERNAL only offered to comment-internal holders (RLS also enforces). */}
                {canInternal && <option value="INTERNAL">Internal</option>}
              </select>
              <Button type="submit" size="sm">
                Post comment
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* 6. Audit timeline (read-only) */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => {
              const delta = eventDelta(e)
              return (
                <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                  {delta && <span className="text-muted-foreground">{delta}</span>}
                  <span className="text-muted-foreground">
                    by {displayName(e.actor_user_id)} · {formatDateTime(e.created_at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

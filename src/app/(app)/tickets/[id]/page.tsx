import Link from 'next/link'
import { selectClassName } from '@/components/ui/native-select'
import { formatDateTime } from '@/lib/format-date'
import { formatMoneyExact as formatMoney } from '@/lib/format-money'
import { formatBytes } from '@/lib/format-bytes'

import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  getTicket,
  getWorkspaceProfile,
  listWorkspaceOperators,
  listProfilesByIds,
} from '@/lib/data/tickets'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor, listVendors } from '@/lib/data/vendors'
import { listTicketEvents, type TicketEvent } from '@/lib/data/ticket-events'
import { listTicketComments } from '@/lib/data/ticket-comments'
import { signStoragePaths } from '@/lib/storage/sign'
import { listAttachments, ATTACHMENTS_BUCKET } from '@/lib/data/attachments'
import { uploadAttachmentAction } from '../attachment-actions'
import { nextStatuses } from '@/lib/tickets/status-flow'
import { StatusBadge } from '@/components/ui/badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileInput } from '@/components/ui/file-input'
import { ErrorToast } from '@/components/common/ErrorToast'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { ActivityTimeline } from '@/components/tickets/ActivityTimeline'
import { CommentThread } from '@/components/tickets/CommentThread'
import type { TicketEventType } from '@/types/domain'
import {
  transitionTicketStatusAction,
  scheduleTicketAction,
  assignOperatorAction,
  assignVendorAction,
  addTicketCommentAction,
  generateVendorLinkAction,
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

const SELECT_CLASS = selectClassName

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

// A label/value row for the summary card's definition grid.
function SummaryField({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  )
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; joblink?: string }>
}) {
  const { id } = await params
  const { joblink } = await searchParams
  // Managers + accountant reach this page (all hold tickets:read). Tenants lack
  // tickets:read and get their own portal in P3.7.
  const user = await requirePermission('tickets:read')
  const supabase = await createClient()

  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) notFound()

  const canWrite = can(user.role, 'tickets:write')
  const canAssign = can(user.role, 'tickets:assign')
  const canInternal = can(user.role, 'tickets:comment-internal')

  const [property, unit, events, comments, operators, vendors, assignedOperator, assignedVendor, reporter, attachments] =
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
      // Depends only on (workspaceId, id) — batching it here saves a full serialized
      // round-trip on every ticket open; only the signing step below has to follow it.
      listAttachments(supabase, user.workspaceId, id),
    ])

  // Resolve author ids → names for the comment thread and audit actors. operators +
  // reporter + assignee cover most; any OTHER id appearing in comments/events (a
  // deactivated operator, a tenant reporter outside the operator set) is batch-resolved
  // in ONE extra query. Ids that still don't resolve render as '—', never a raw UUID.
  const nameById = new Map<string, string>()
  for (const op of operators) if (op.full_name) nameById.set(op.id, op.full_name)
  if (reporter?.full_name) nameById.set(reporter.id, reporter.full_name)
  if (assignedOperator?.full_name) nameById.set(assignedOperator.id, assignedOperator.full_name)
  const unresolvedIds = [
    ...new Set(
      [...comments.map((c) => c.author_user_id), ...events.map((e) => e.actor_user_id)].filter(
        (id): id is string => Boolean(id) && !nameById.has(id as string)
      )
    ),
  ]
  if (unresolvedIds.length > 0) {
    for (const p of await listProfilesByIds(supabase, user.workspaceId, unresolvedIds)) {
      if (p.full_name) nameById.set(p.id, p.full_name)
    }
  }
  const displayName = (userId: string | null) =>
    userId ? nameById.get(userId) ?? '—' : 'System'

  // Short-lived signed download URLs (private bucket). Signing per-render is
  // fine (60s TTL); if a single path fails to sign we skip its link rather than crash.
  const attachmentUrls = await signStoragePaths(
    supabase,
    ATTACHMENTS_BUCKET,
    attachments.map((a) => a.storage_path)
  )
  const signedAttachments = attachments.map((att) => ({
    att,
    url: attachmentUrls.get(att.storage_path) ?? null,
  }))
  const boundUploadAttachment = uploadAttachmentAction.bind(null, id, 'manager')

  const transitions = nextStatuses(ticket.status)
  const boundTransition = transitionTicketStatusAction.bind(null, id)
  const boundSchedule = scheduleTicketAction.bind(null, id)
  const boundAssignOperator = assignOperatorAction.bind(null, id)
  const boundAssignVendor = assignVendorAction.bind(null, id)
  const boundAddComment = addTicketCommentAction.bind(null, id)
  const boundGenerateVendorLink = generateVendorLinkAction.bind(null, id)

  // The one-time vendor job link, if the manager just generated one (present only in
  // their own URL for this render — see generateVendorLinkAction's docstring). Mirrors
  // notify.ts's ticketUrl null-guard: with no configured site URL there is no absolute
  // link to render, so the copy field is hidden ("undefined/job/…" would be worse).
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const jobLinkUrl = joblink && siteUrl ? `${siteUrl}/job/${joblink}` : null

  const timelineEvents = events.map((e) => ({
    id: e.id,
    label: EVENT_LABELS[e.event_type] ?? e.event_type,
    delta: eventDelta(e),
    actor: displayName(e.actor_user_id),
    at: formatDateTime(e.created_at),
  }))

  const threadComments = comments.map((c) => ({
    id: c.id,
    author: displayName(c.author_user_id),
    body: c.body,
    at: formatDateTime(c.created_at),
    internal: c.visibility === 'INTERNAL',
    kind: c.type === 'AI_NOTE' ? ('ai' as const) : c.type === 'SYSTEM_NOTE' ? ('system' as const) : undefined,
  }))

  return (
    <div className="flex flex-col gap-6">
      {/* Client-side error surfacing: server actions redirect back with ?error=. */}
      <ErrorToast />

      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link
          href="/tickets"
          className="w-fit text-sm text-muted-foreground hover:text-foreground"
        >
          ← Tickets
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.title}</h1>
          <StatusBadge kind="ticket_status" value={ticket.status} />
          <StatusBadge kind="ticket_priority" value={ticket.priority} />
          <Badge variant="outline" className="capitalize">
            {ticket.category.replace(/_/g, ' ').toLowerCase()}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: summary, comments, attachments, activity */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <SummaryField label="Property">
                  {property ? (
                    <Link
                      href={`/properties/${property.id}`}
                      className="underline underline-offset-2"
                    >
                      {property.name}
                    </Link>
                  ) : (
                    ticket.property_id
                  )}
                </SummaryField>
                {unit && (
                  <SummaryField label="Unit">
                    <Link href={`/units/${unit.id}`} className="text-foreground underline-offset-4 hover:underline">
                      {unit.label}
                    </Link>
                  </SummaryField>
                )}
                <SummaryField label="Description" wide>
                  <span className="whitespace-pre-wrap">{ticket.description}</span>
                </SummaryField>
                <SummaryField label="Reported by">
                  {displayName(ticket.created_by_user_id)}
                </SummaryField>
                <SummaryField label="Created">{formatDateTime(ticket.created_at)}</SummaryField>
                {ticket.scheduled_at && (
                  <SummaryField label="Scheduled">
                    {formatDateTime(ticket.scheduled_at)}
                  </SummaryField>
                )}
                {ticket.estimated_cost != null && (
                  <SummaryField label="Estimated cost">
                    {formatMoney(ticket.estimated_cost)}
                  </SummaryField>
                )}
                {ticket.actual_cost != null && (
                  <SummaryField label="Actual cost">
                    {formatMoney(ticket.actual_cost)}
                  </SummaryField>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CommentThread comments={threadComments} />

              {/* Add-comment form is canWrite-gated: accountant is read-only. */}
              {canWrite && (
                <form action={boundAddComment} className="flex flex-col gap-2 border-t pt-4">
                  <Label htmlFor="body">Add a comment</Label>
                  <Textarea id="body" name="body" required placeholder="Write a comment" />
                  <div className="flex flex-wrap items-center gap-2">
                    <select name="visibility" aria-label="Comment visibility" defaultValue="PUBLIC" className={SELECT_CLASS + ' w-auto'}>
                      <option value="PUBLIC">Public</option>
                      {/* INTERNAL only offered to comment-internal holders (RLS also enforces). */}
                      {canInternal && <option value="INTERNAL">Internal</option>}
                    </select>
                    <SubmitButton size="sm" pendingLabel="Posting">
                      Post comment
                    </SubmitButton>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Attachments */}
          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {signedAttachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No attachments yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {signedAttachments.map(({ att, url }) => (
                    <li
                      key={att.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2.5 text-sm"
                    >
                      <span className="font-medium">{att.file_name}</span>
                      <Badge variant="outline" className="capitalize">
                        {att.attachment_type.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                      <span className="text-muted-foreground">{formatBytes(att.file_size)}</span>
                      {url ? (
                        <a
                          href={url}
                          download={att.file_name}
                          className="ml-auto underline underline-offset-2"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="ml-auto text-muted-foreground">Link unavailable</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <form
                  action={boundUploadAttachment}
                  encType="multipart/form-data"
                  className="flex flex-wrap items-center gap-2 border-t pt-4"
                >
                  <FileInput
                    name="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    required
                  />
                  <SubmitButton size="sm" pendingLabel="Uploading">
                    Upload
                  </SubmitButton>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline events={timelineEvents} />
            </CardContent>
          </Card>
        </div>

        {/* Right column: status flow + assignment */}
        <div className="flex flex-col gap-6">
          {/* Status flow */}
          {canWrite && (
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {transitions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This ticket is {ticket.status.replace(/_/g, ' ').toLowerCase()}.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {transitions.map((next) => (
                      <form key={next} action={boundTransition}>
                        <input type="hidden" name="nextStatus" value={next} />
                        <input
                          type="hidden"
                          name="expectedCurrentStatus"
                          value={ticket.status}
                        />
                        <SubmitButton variant="outline" size="sm" pendingLabel="Saving">
                          Mark {next.replace(/_/g, ' ').toLowerCase()}
                        </SubmitButton>
                      </form>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Schedule — the only write path for scheduled_at (feeds the calendar).
              Hidden on terminal tickets (no transitions left = closed/cancelled),
              where scheduling a visit makes no sense. */}
          {canWrite && transitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {ticket.scheduled_at ? (
                  <p className="text-sm text-muted-foreground">
                    Currently scheduled for{' '}
                    <span className="text-foreground">{formatDateTime(ticket.scheduled_at)}</span>.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Pick a visit date and time to place this ticket on the calendar.
                  </p>
                )}
                <form action={boundSchedule} className="flex flex-col gap-2">
                  <Label htmlFor="scheduledAt">Visit date &amp; time</Label>
                  <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required />
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    className="self-start"
                    pendingLabel="Saving"
                  >
                    Save schedule
                  </SubmitButton>
                </form>
                {ticket.scheduled_at && (
                  <form action={boundSchedule}>
                    {/* intent=clear → the action writes scheduled_at = null. */}
                    <input type="hidden" name="intent" value="clear" />
                    <SubmitButton variant="ghost" size="sm" pendingLabel="Clearing">
                      Clear schedule
                    </SubmitButton>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {/* Assignment (canAssign) */}
          {canAssign && (
            <Card>
              <CardHeader>
                <CardTitle>Assignment</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <form action={boundAssignOperator} className="flex flex-col gap-2">
                  <Label htmlFor="operatorId">Operator</Label>
                  <select
                    id="operatorId"
                    name="operatorId"
                    defaultValue={ticket.assigned_operator_id ?? ''}
                    className={SELECT_CLASS}
                  >
                    <option value="">Unassigned</option>
                    {operators.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.full_name ?? op.id}
                      </option>
                    ))}
                  </select>
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    className="self-start"
                    pendingLabel="Saving"
                  >
                    Save operator
                  </SubmitButton>
                </form>

                <form action={boundAssignVendor} className="flex flex-col gap-2">
                  <Label htmlFor="vendorId">Vendor</Label>
                  <select
                    id="vendorId"
                    name="vendorId"
                    defaultValue={ticket.assigned_vendor_id ?? ''}
                    className={SELECT_CLASS}
                  >
                    <option value="">Unassigned</option>
                    {/* "(no email)" flags vendors the job-link/assignment emails can't
                        reach — otherwise they look identical in the select. */}
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.email ? v.company_name : `${v.company_name} (no email)`}
                      </option>
                    ))}
                  </select>
                  <SubmitButton
                    variant="outline"
                    size="sm"
                    className="self-start"
                    pendingLabel="Saving"
                  >
                    Save vendor
                  </SubmitButton>
                </form>

                {/* Vendor secure job link — only once a vendor is assigned. */}
                {ticket.assigned_vendor_id && (
                  <div className="flex flex-col gap-2 border-t pt-4">
                    <Label htmlFor="joblink">Vendor job link</Label>
                    {jobLinkUrl ? (
                      <>
                        <Input id="joblink" readOnly value={jobLinkUrl} />
                        <p className="text-xs text-muted-foreground">
                          The vendor can view and act on this job without logging in. It
                          expires in 7 days. Share it only with the assigned vendor.
                          {!assignedVendor?.email &&
                            ' This vendor has no email on file, so the link was NOT emailed — send it to them yourself.'}
                        </p>
                      </>
                    ) : joblink ? (
                      // A link was minted but NEXT_PUBLIC_SITE_URL is unset, so there is
                      // no absolute URL to show (or email). Same guard as notify.ts.
                      <p className="text-xs text-muted-foreground">
                        A job link was generated, but no site URL is configured
                        (NEXT_PUBLIC_SITE_URL), so it cannot be displayed or emailed. Set
                        it and generate a new link.
                      </p>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          Generate a no-login link the assigned vendor can use to accept,
                          decline, or complete this job.
                        </p>
                        <form action={boundGenerateVendorLink}>
                          <SubmitButton
                            variant="outline"
                            size="sm"
                            pendingLabel="Generating"
                          >
                            Generate job link
                          </SubmitButton>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Read-only assignment display for viewers who cannot assign (e.g. accountant) */}
          {!canAssign && (
            <Card>
              <CardHeader>
                <CardTitle>Assignment</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4">
                  <SummaryField label="Operator">
                    {assignedOperator?.full_name ?? assignedOperator?.id ?? 'Unassigned'}
                  </SummaryField>
                  <SummaryField label="Vendor">
                    {assignedVendor ? (
                      <Link
                        href={`/vendors/${assignedVendor.id}`}
                        className="text-foreground underline-offset-4 hover:underline"
                      >
                        {assignedVendor.company_name}
                      </Link>
                    ) : (
                      'Unassigned'
                    )}
                  </SummaryField>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

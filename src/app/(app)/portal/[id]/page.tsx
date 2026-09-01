import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getTicket, listWorkspaceOperators } from '@/lib/data/tickets'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { listTicketComments } from '@/lib/data/ticket-comments'
import { formatDateTime } from '@/lib/format-date'
import { formatBytes } from '@/lib/format-bytes'
import { signStoragePaths } from '@/lib/storage/sign'
import { listAttachments, ATTACHMENTS_BUCKET } from '@/lib/data/attachments'
import { Badge } from '@/components/ui/badge'
import { RequestProgress } from '@/components/portal/RequestProgress'
import { tenantStatusLabel } from '@/lib/portal-status'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FileInput } from '@/components/ui/file-input'
import { ErrorToast } from '@/components/common/ErrorToast'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { addPublicCommentAction } from '../actions'
import { uploadAttachmentAction } from '@/app/(app)/tickets/attachment-actions'

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

export default async function PortalTicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; created?: string }>
}) {
  const { id } = await params
  const { created } = await searchParams
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()

  // RLS returns this ticket ONLY if the tenant owns it (created_by, or created_for after
  // 0013). A ticket belonging to another tenant returns null here even if the id is
  // guessed correctly -> notFound(). No service-role client is used for this read, so
  // there is no way to bypass the row-level scope.
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) notFound()

  const [property, unit, comments, attachments, operators] = await Promise.all([
    getProperty(supabase, user.workspaceId, ticket.property_id),
    ticket.unit_id ? getUnit(supabase, user.workspaceId, ticket.unit_id) : Promise.resolve(null),
    // RLS (comments_select_own_public) returns ONLY PUBLIC comments on the tenant's own
    // ticket — INTERNAL comments are invisible to them, full stop.
    listTicketComments(supabase, user.workspaceId, id),
    // Attachments on the tenant's own ticket (RLS-scoped); depends only on
    // (workspaceId, id), so it batches — only the URL signing below has to follow.
    listAttachments(supabase, user.workspaceId, id),
    // Manager names for message attribution — a tenant may read workspace profiles
    // (profiles_select_self_or_workspace, migration 0002), and this is the same
    // roster the operator detail page resolves comment authors from.
    listWorkspaceOperators(supabase, user.workspaceId),
  ])

  // Author attribution for the message thread: the signed-in tenant's own messages say
  // "You"; anything else resolves to the manager's profile name, falling back to a
  // generic workspace label rather than a raw id.
  const nameById = new Map<string, string>()
  for (const op of operators) if (op.full_name) nameById.set(op.id, op.full_name)
  const authorLabel = (authorUserId: string) =>
    authorUserId === user.id ? 'You' : nameById.get(authorUserId) ?? 'Property management'
  // Batch-sign (one storage-API call for all attachments); a failed path omits its link.
  const attachmentUrls = await signStoragePaths(
    supabase,
    ATTACHMENTS_BUCKET,
    attachments.map((a) => a.storage_path)
  )
  const signedAttachments = attachments.map((att) => ({
    att,
    url: attachmentUrls.get(att.storage_path) ?? null,
  }))

  const boundAddComment = addPublicCommentAction.bind(null, id)
  // Tenants can always attach to their OWN ticket (they own it) — no canWrite gate.
  const boundUploadAttachment = uploadAttachmentAction.bind(null, id, 'tenant')

  return (
    <div className="flex flex-col gap-6">
      {/* Server actions redirect back with ?error= — surfaced as a toast. */}
      <ErrorToast />

      {/* One-time success line after reportIssueAction redirects here with ?created=1
          (house ?portal=invited pattern from people/[id]). Doubles as the photo hint:
          the report form has no file input, but this page's Attachments card does. */}
      {created === '1' && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm text-emerald-900 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-200"
        >
          Request received — we&apos;ll get back to you. If photos help show the problem,
          add them under Attachments below.
        </p>
      )}

      {/* Header — title, read-only status, category. NO priority, NO costs, NO
          assignment, NO audit timeline. A clean status view for the tenant. */}
      <div className="flex flex-col gap-3">
        <Link
          href="/portal"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          My requests
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {ticket.title}
          </h1>
          <Badge variant="outline">{tenantStatusLabel(ticket.status)}</Badge>
          <Badge variant="outline" className="capitalize">
            {ticket.category.replace(/_/g, ' ').toLowerCase()}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* Summary — location + description + reported date. */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <SummaryField label="Property">
                  {property?.name ?? ticket.property_id}
                </SummaryField>
                {unit && <SummaryField label="Unit">{unit.label}</SummaryField>}
                <SummaryField label="Description" wide>
                  <span className="whitespace-pre-wrap">{ticket.description}</span>
                </SummaryField>
                <SummaryField label="Reported">
                  {formatDateTime(ticket.created_at)}
                </SummaryField>
              </dl>
            </CardContent>
          </Card>

          {/* Messages — the tenant-facing conversation (PUBLIC comments only). */}
          <Card>
            <CardHeader>
              <CardTitle>Messages</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No messages yet. Add one below to reach your property manager.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {comments.map((c) => {
                    const mine = c.author_user_id === user.id
                    return (
                      <li
                        key={c.id}
                        className={
                          // The tenant's own messages get a subtle muted tint so the
                          // two sides of the conversation read apart at a glance;
                          // management replies stay on the plain card row.
                          mine
                            ? 'rounded-lg border bg-muted/40 p-3 text-sm'
                            : 'rounded-lg border p-3 text-sm'
                        }
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">
                            {authorLabel(c.author_user_id)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(c.created_at)}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap text-foreground">{c.body}</p>
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* Add-message form — NO visibility select. The action hardcodes PUBLIC and
                  RLS pins it too, so a tenant can only ever post a public message. */}
              <form action={boundAddComment} className="flex flex-col gap-2 border-t pt-4">
                <Label htmlFor="body">Add a message</Label>
                <Textarea id="body" name="body" required placeholder="Write a message" />
                <SubmitButton size="sm" className="self-start" pendingLabel="Sending">
                  Send message
                </SubmitButton>
              </form>
            </CardContent>
          </Card>

          {/* Attachments — the tenant's own ticket. Photos/PDFs of the issue, with signed
              download links + an always-available upload form (they own the ticket). */}
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
            </CardContent>
          </Card>
        </div>

        {/* Right column: read-only status panel for the tenant. */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <RequestProgress status={ticket.status} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

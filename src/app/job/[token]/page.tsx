import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/service'
import { getValidVendorJob } from '@/lib/data/vendor-tokens'
import { ATTACHMENTS_BUCKET } from '@/lib/data/attachments'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/common/FormError'
import {
  acceptJobAction,
  declineJobAction,
  completeJobAction,
  uploadVendorProofAction,
} from './actions'

// The vendor secure-link PUBLIC page (P3.8). OUTSIDE the (app) group — vendors have NO
// session, no app shell, no requireWorkspace. Reachable without auth (/job is in
// PUBLIC_PATHS), but the raw token in the URL is the ENTIRE auth boundary: the page
// validates it via the SERVICE-ROLE client (hash + expiry + not-revoked, single-ticket
// bound). An invalid/expired/revoked token shows a generic invalid page — no oracle.

// Explicitly non-cached: the token gate must run per request, and the ticket/comment
// state changes as the vendor acts.
export const dynamic = 'force-dynamic'

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// The whitelisted attachment shape the vendor may see for THIS ticket. Explicit columns
// only (never select('*')) and scoped to the token's workspace + ticket — the vendor can
// never see another ticket's files. Loaded via the SERVICE client (no vendor session) and
// signed for short-lived download; a failed sign just omits that row's link.
type VendorAttachment = {
  id: string
  file_name: string
  file_size: number
  attachment_type: string
  storage_path: string
}

async function loadVendorAttachments(
  service: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  ticketId: string
): Promise<{ att: VendorAttachment; url: string | null }[]> {
  const { data, error } = await service
    .from('attachments')
    .select('id, file_name, file_size, attachment_type, storage_path')
    .eq('workspace_id', workspaceId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error || !data) return []
  const rows = data as VendorAttachment[]
  return Promise.all(
    rows.map(async (att) => {
      let url: string | null = null
      try {
        const signed = await service.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(att.storage_path, 60)
        url = signed.data?.signedUrl ?? null
      } catch {
        url = null
      }
      return { att, url }
    })
  )
}

// The whitelisted PUBLIC-comment shape the vendor may see. Explicit columns only — NEVER
// select('*'); INTERNAL comments are excluded by the visibility filter below.
type PublicComment = { id: string; body: string; created_at: string }

async function loadPublicComments(
  service: ReturnType<typeof createServiceClient>,
  workspaceId: string,
  ticketId: string
): Promise<PublicComment[]> {
  const { data, error } = await service
    .from('ticket_comments')
    .select('id, body, created_at')
    .eq('workspace_id', workspaceId)
    .eq('ticket_id', ticketId)
    // CRITICAL: PUBLIC only. INTERNAL (staff-only) comments must NEVER reach a vendor.
    .eq('visibility', 'PUBLIC')
    .order('created_at', { ascending: true })
  if (error) return []
  return (data ?? []) as PublicComment[]
}

function InvalidLinkPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">This link is invalid or has expired.</h1>
      <p className="text-sm text-muted-foreground">
        Please ask your contact to send you a new job link.
      </p>
    </main>
  )
}

export default async function VendorJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { token } = await params
  const { error } = await searchParams

  // Throttle BEFORE the token lookup — this is the token-guessing surface (bearer
  // capability, no session), so limit by IP ahead of the DB hit. A throttled request
  // gets the SAME generic invalid page as a bad token — no oracle either way.
  const ip = clientIp(await headers())
  const allowed = await checkRateLimit(`job:${ip}`, 30, 5 * 60)
  if (!allowed) return <InvalidLinkPage />

  const service = createServiceClient()
  const job = await getValidVendorJob(service, token)

  // Invalid / expired / revoked → generic page, NO ticket detail, no distinguishing oracle.
  if (!job) return <InvalidLinkPage />

  const comments = await loadPublicComments(service, job.token.workspace_id, job.token.ticket_id)
  const attachments = await loadVendorAttachments(
    service,
    job.token.workspace_id,
    job.token.ticket_id
  )

  const accepted = Boolean(job.token.accepted_at)
  const declined = Boolean(job.token.declined_at)
  const completed = Boolean(job.token.completed_at)
  const pending = !accepted && !declined && !completed

  const boundAccept = acceptJobAction.bind(null, token)
  const boundDecline = declineJobAction.bind(null, token)
  const boundComplete = completeJobAction.bind(null, token)
  const boundUploadProof = uploadVendorProofAction.bind(null, token)

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-12">
      {/* Header */}
      <header className="flex flex-col gap-2">
        {job.vendorCompanyName && (
          <p className="text-sm text-muted-foreground">Job for {job.vendorCompanyName}</p>
        )}
        <h1 className="text-xl font-semibold">{job.ticket.title}</h1>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-md border px-2 py-0.5">{job.ticket.status.replace(/_/g, ' ')}</span>
          <span className="rounded-md border px-2 py-0.5">{job.ticket.priority}</span>
          <span className="rounded-md border px-2 py-0.5">{job.ticket.category.replace(/_/g, ' ')}</span>
        </div>
        <FormError message={error} />
      </header>

      {/* Sanitized detail */}
      <section className="grid gap-3 rounded-lg border p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Location</dt>
          <dd>
            {job.propertyName ?? 'Property'}
            {job.unitLabel ? ` — ${job.unitLabel}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-wrap">{job.ticket.description}</dd>
        </div>
      </section>

      {/* Public instructions from the operator, if any */}
      {comments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Notes</h2>
          <ul className="flex flex-col gap-3">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <p className="whitespace-pre-wrap">{c.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Attachments for THIS ticket only — signed download links (private bucket). */}
      {attachments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Attachments</h2>
          <ul className="flex flex-col gap-2">
            {attachments.map(({ att, url }) => (
              <li
                key={att.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
              >
                <span className="font-medium">{att.file_name}</span>
                <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                  {att.attachment_type}
                </span>
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
        </section>
      )}

      {/* Actions, gated by lifecycle state */}
      <section className="flex flex-col gap-3">
        {pending && (
          <div className="flex flex-wrap gap-2">
            <form action={boundAccept}>
              <Button type="submit">Accept job</Button>
            </form>
            <form action={boundDecline}>
              <Button type="submit" variant="outline">
                Decline job
              </Button>
            </form>
          </div>
        )}

        {accepted && !completed && !declined && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              You accepted this job. Upload proof of work (photos or an invoice), then mark it
              complete when the work is done.
            </p>
            <form action={boundUploadProof} encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
              <input
                type="file"
                name="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                required
                className="text-sm"
              />
              <Button type="submit" variant="outline">
                Upload proof
              </Button>
            </form>
            <form action={boundComplete}>
              <Button type="submit">Mark complete</Button>
            </form>
          </div>
        )}

        {declined && (
          <p className="text-sm text-muted-foreground">You declined this job.</p>
        )}

        {completed && (
          <p className="text-sm text-muted-foreground">
            This job is marked complete. Thank you.
          </p>
        )}
      </section>
    </main>
  )
}

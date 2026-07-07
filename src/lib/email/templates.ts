import type { TicketCategory, TicketPriority, TicketStatus } from '@/types/domain'

// ---------------------------------------------------------------------------
// Email templates (Phase 4) — typed builders that each return { subject, html, text }.
//
// Pure and side-effect-free: they render strings only, never send. The transport
// (send.ts) and the recipient resolution (notify.ts) live elsewhere. Design tone is
// graphite / near-monochrome with a single accent — system fonts, inline styles, no
// framework, so it renders identically across mail clients. Copy is warm, clear, and
// client-friendly.
// ---------------------------------------------------------------------------

export type EmailContent = { subject: string; html: string; text: string }

const ACCENT = '#3f3f46' // graphite accent
const INK = '#18181b'
const MUTED = '#71717a'
const HAIRLINE = '#e4e4e7'
const BG = '#f4f4f5'

// Human labels. Enum values are SCREAMING_SNAKE; render them as Title Case words.
function humanize(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// Minimal HTML-escape for interpolated user content (titles, names). Not a full
// sanitizer — these strings come from our own DB, but escaping keeps a title with an
// ampersand or angle bracket from breaking the markup.
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Shared HTML shell. A single centered card on a light-graphite background: small
 * uppercase eyebrow, a heading, the body blocks, then a quiet footer. All styles are
 * inline (mail clients strip <style> and classes). `bodyHtml` is trusted, pre-built
 * markup from the template functions below.
 */
function shell(opts: {
  preheader: string
  eyebrow: string
  heading: string
  bodyHtml: string
}): string {
  const { preheader, eyebrow, heading, bodyHtml } = opts
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
</head>
<body style="margin:0;padding:0;background:${BG};">
<span style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="height:4px;background:${ACCENT};"></td></tr>
<tr><td style="padding:28px 32px 8px 32px;">
<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};font-weight:600;">${esc(eyebrow)}</div>
<h1 style="margin:8px 0 0 0;font-size:20px;line-height:1.3;color:${INK};font-weight:600;">${esc(heading)}</h1>
</td></tr>
<tr><td style="padding:12px 32px 28px 32px;font-size:14px;line-height:1.6;color:${INK};">
${bodyHtml}
</td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid ${HAIRLINE};font-size:12px;line-height:1.5;color:${MUTED};">
Property Ops — property management notifications.<br />
You received this because you are involved in this maintenance request.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

// A quiet key/value row for the "details" block (property, priority, etc.).
function detailRow(label: string, value: string): string {
  return `<tr>
<td style="padding:4px 0;font-size:13px;color:${MUTED};width:120px;vertical-align:top;">${esc(label)}</td>
<td style="padding:4px 0;font-size:13px;color:${INK};font-weight:500;">${esc(value)}</td>
</tr>`
}

function detailsTable(rows: string[]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">${rows.join('')}</table>`
}

// A prominent button-style link (used for the vendor job link and ticket links).
function buttonLink(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
<td style="border-radius:8px;background:${ACCENT};">
<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
</td></tr></table>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;">${text}</p>`
}

// ---- Template inputs -------------------------------------------------------
// Each builder takes already-loaded, plain domain data (no DB access here).

export type TicketRef = {
  ticketId: string
  title: string
  category?: TicketCategory
  priority?: TicketPriority
  propertyName?: string | null
  ticketUrl?: string | null // optional deep link to the ticket detail page
}

// -- 1. Ticket status changed ------------------------------------------------
export function ticketStatusChangedEmail(input: TicketRef & {
  fromStatus: TicketStatus
  toStatus: TicketStatus
}): EmailContent {
  const { title, fromStatus, toStatus, propertyName, ticketUrl } = input
  const to = humanize(toStatus)
  const from = humanize(fromStatus)
  const subject = `Update on "${title}" — now ${to}`

  const rows = [detailRow('Status', `${from} → ${to}`)]
  if (propertyName) rows.push(detailRow('Property', propertyName))

  const bodyHtml = [
    paragraph(`There's an update on your maintenance request.`),
    detailsTable(rows),
    ticketUrl ? buttonLink(ticketUrl, 'View the request') : '',
    paragraph(`We'll let you know as things progress. No action is needed from you right now.`),
  ].join('')

  const text = [
    `Update on "${title}"`,
    ``,
    `Status: ${from} -> ${to}`,
    propertyName ? `Property: ${propertyName}` : '',
    ticketUrl ? `\nView the request: ${ticketUrl}` : '',
    ``,
    `We'll let you know as things progress.`,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: shell({ preheader: `Now ${to}`, eyebrow: 'Request update', heading: subject, bodyHtml }),
    text,
  }
}

// -- 2. Operator assigned ----------------------------------------------------
export function operatorAssignedEmail(input: TicketRef & {
  operatorName?: string | null
}): EmailContent {
  const { title, category, priority, propertyName, ticketUrl } = input
  const subject = `You've been assigned: "${title}"`

  const rows: string[] = []
  if (propertyName) rows.push(detailRow('Property', propertyName))
  if (category) rows.push(detailRow('Category', humanize(category)))
  if (priority) rows.push(detailRow('Priority', humanize(priority)))

  const bodyHtml = [
    paragraph(`A maintenance request has been assigned to you.`),
    rows.length ? detailsTable(rows) : '',
    ticketUrl ? buttonLink(ticketUrl, 'Open the request') : '',
    paragraph(`Please review the details and take it from here.`),
  ].join('')

  const text = [
    `You've been assigned: "${title}"`,
    ``,
    propertyName ? `Property: ${propertyName}` : '',
    category ? `Category: ${humanize(category)}` : '',
    priority ? `Priority: ${humanize(priority)}` : '',
    ticketUrl ? `\nOpen the request: ${ticketUrl}` : '',
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: shell({ preheader: 'A request needs your attention', eyebrow: 'Assigned to you', heading: subject, bodyHtml }),
    text,
  }
}

// -- 3. Vendor assigned (heads-up, no link yet) ------------------------------
export function vendorAssignedEmail(input: TicketRef & {
  vendorName?: string | null
}): EmailContent {
  const { title, category, priority, propertyName } = input
  const subject = `New work order: "${title}"`

  const rows: string[] = []
  if (propertyName) rows.push(detailRow('Property', propertyName))
  if (category) rows.push(detailRow('Category', humanize(category)))
  if (priority) rows.push(detailRow('Priority', humanize(priority)))

  const bodyHtml = [
    paragraph(`You've been lined up for a maintenance job. The manager will send a secure link with the full details and a way to accept and update the work.`),
    rows.length ? detailsTable(rows) : '',
    paragraph(`We'll follow up shortly with everything you need.`),
  ].join('')

  const text = [
    `New work order: "${title}"`,
    ``,
    propertyName ? `Property: ${propertyName}` : '',
    category ? `Category: ${humanize(category)}` : '',
    priority ? `Priority: ${humanize(priority)}` : '',
    ``,
    `The manager will send a secure link with the full details shortly.`,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: shell({ preheader: 'A new job is coming your way', eyebrow: 'New work order', heading: subject, bodyHtml }),
    text,
  }
}

// -- 4. Vendor job link (the high-value one) ---------------------------------
export function vendorJobLinkEmail(input: TicketRef & {
  jobUrl: string
  vendorName?: string | null
}): EmailContent {
  const { title, category, priority, propertyName, jobUrl } = input
  const subject = `Your job link: "${title}"`

  const rows: string[] = []
  if (propertyName) rows.push(detailRow('Property', propertyName))
  if (category) rows.push(detailRow('Category', humanize(category)))
  if (priority) rows.push(detailRow('Priority', humanize(priority)))

  const bodyHtml = [
    paragraph(`Here is your secure link for this job. It opens everything you need — the request details and a place to accept, schedule, and update the work. No account or password required.`),
    rows.length ? detailsTable(rows) : '',
    buttonLink(jobUrl, 'Open your job'),
    paragraph(`<span style="color:${MUTED};font-size:13px;">This link is private to you and expires in 7 days. If the button doesn't work, copy and paste this address into your browser:<br /><span style="word-break:break-all;color:${ACCENT};">${esc(jobUrl)}</span></span>`),
  ].join('')

  const text = [
    `Your job link: "${title}"`,
    ``,
    propertyName ? `Property: ${propertyName}` : '',
    category ? `Category: ${humanize(category)}` : '',
    priority ? `Priority: ${humanize(priority)}` : '',
    ``,
    `Open your job (private to you, expires in 7 days):`,
    jobUrl,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: shell({ preheader: 'Your secure job link is ready', eyebrow: 'Secure job link', heading: subject, bodyHtml }),
    text,
  }
}

// -- 5. Ticket created / confirmation ----------------------------------------
export function ticketCreatedEmail(input: TicketRef): EmailContent {
  const { title, category, priority, propertyName, ticketUrl } = input
  const subject = `We've logged your request: "${title}"`

  const rows: string[] = []
  if (propertyName) rows.push(detailRow('Property', propertyName))
  if (category) rows.push(detailRow('Category', humanize(category)))
  if (priority) rows.push(detailRow('Priority', humanize(priority)))

  const bodyHtml = [
    paragraph(`Thanks — we've received your maintenance request and our team is on it.`),
    rows.length ? detailsTable(rows) : '',
    ticketUrl ? buttonLink(ticketUrl, 'View your request') : '',
    paragraph(`We'll email you as the status changes. There's nothing you need to do right now.`),
  ].join('')

  const text = [
    `We've logged your request: "${title}"`,
    ``,
    propertyName ? `Property: ${propertyName}` : '',
    category ? `Category: ${humanize(category)}` : '',
    priority ? `Priority: ${humanize(priority)}` : '',
    ticketUrl ? `\nView your request: ${ticketUrl}` : '',
    ``,
    `We'll email you as the status changes.`,
  ].filter(Boolean).join('\n')

  return {
    subject,
    html: shell({ preheader: 'Your request has been logged', eyebrow: 'Request received', heading: subject, bodyHtml }),
    text,
  }
}

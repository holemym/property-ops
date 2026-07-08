import { sendEmail, type SendEmailResult } from './send'
import { invoiceTotals } from '@/lib/invoices/compute'
import type { Invoice, InvoiceLineItem } from '@/types/domain'

// Compose and send an invoice as an email. Uses the shared transport (disconnected-safe:
// with no RESEND_API_KEY it's a logging no-op returning { status: 'disconnected' }). The
// caller decides how to surface the result to the user.

function money(currency: string) {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: currency || 'EUR' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function invoiceHtml(invoice: Invoice, lines: InvoiceLineItem[]): string {
  const fmt = money(invoice.currency)
  const totals = invoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_amount: l.unit_amount })),
    invoice.tax_rate,
  )
  const rows = lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #eee;">${esc(l.description)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">${l.quantity}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">${fmt.format(l.unit_amount)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">${fmt.format(l.amount)}</td>
      </tr>`,
    )
    .join('')

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#18181b;">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #18181b;padding-bottom:12px;">
      <div><div style="font-size:20px;font-weight:600;">Invoice</div>
      <div style="font-size:13px;color:#71717a;">${esc(invoice.invoice_number)}</div></div>
      <div style="text-align:right;font-size:13px;"><strong>Property Ops</strong></div>
    </div>
    <div style="margin-top:16px;font-size:14px;">
      <div><span style="color:#71717a;">Billed to:</span> ${esc(invoice.party_name)}</div>
      <div><span style="color:#71717a;">Issued:</span> ${formatDate(invoice.issue_date)}${
        invoice.due_date ? ` &nbsp;·&nbsp; <span style="color:#71717a;">Due:</span> ${formatDate(invoice.due_date)}` : ''
      }</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;">
      <thead><tr style="text-align:left;border-bottom:1px solid #18181b;">
        <th style="padding:6px 0;">Description</th>
        <th style="padding:6px 0;text-align:right;">Qty</th>
        <th style="padding:6px 0;text-align:right;">Unit</th>
        <th style="padding:6px 0;text-align:right;">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;text-align:right;font-size:14px;">
      <div><span style="color:#71717a;">Subtotal:</span> ${fmt.format(totals.subtotal)}</div>
      <div><span style="color:#71717a;">Tax (${invoice.tax_rate}%):</span> ${fmt.format(totals.tax)}</div>
      <div style="font-weight:600;font-size:16px;margin-top:4px;">Total: ${fmt.format(totals.total)}</div>
    </div>
    ${invoice.notes ? `<div style="margin-top:20px;font-size:13px;color:#52525b;white-space:pre-wrap;">${esc(invoice.notes)}</div>` : ''}
  </div>`
}

export async function sendInvoiceEmail(
  invoice: Invoice,
  lines: InvoiceLineItem[],
  to: string,
): Promise<SendEmailResult> {
  const total = invoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_amount: l.unit_amount })),
    invoice.tax_rate,
  ).total
  const totalStr = money(invoice.currency).format(total)
  return sendEmail({
    to,
    subject: `Invoice ${invoice.invoice_number} — ${totalStr}`,
    html: invoiceHtml(invoice, lines),
    text: `Invoice ${invoice.invoice_number} for ${invoice.party_name}. Total ${totalStr}. Issued ${formatDate(invoice.issue_date)}${invoice.due_date ? `, due ${formatDate(invoice.due_date)}` : ''}.`,
  })
}

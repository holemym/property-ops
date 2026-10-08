import type { SupabaseClient } from '@supabase/supabase-js'
import type { InvoiceStatus, TicketStatus } from '@/types/domain'
import { countTicketsByStatus } from '@/lib/data/tickets'
import { getSetupProgress, type SetupProgress } from '@/lib/data/setup'

// The workspace's real state for the in-app guide (/guide): every chapter states what
// already exists and links straight to it, so the guide doubles as a checklist instead
// of describing an imaginary workspace. Head-only counts in one parallel batch (no rows
// shipped); RLS scopes each to the caller, so a role without finance access simply
// reads zeros there and the page hides those links by permission anyway.
export type GuideState = SetupProgress & {
  properties: number
  propertiesWithoutLocation: number
  firstPropertyId: string | null
  people: number
  vendors: number
  tickets: Partial<Record<TicketStatus, number>>
  invoices: Partial<Record<InvoiceStatus, number>>
  announcements: number
  documents: number
}

const INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'SENT', 'PAID']

export async function getGuideState(supabase: SupabaseClient, workspaceId: string): Promise<GuideState> {
  const head = (table: string) =>
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)

  const [setup, properties, unlocated, firstProperty, people, vendors, tickets, announcements, documents, ...invoiceCounts] =
    await Promise.all([
      getSetupProgress(supabase, workspaceId),
      head('properties').eq('status', 'ACTIVE'),
      head('properties').eq('status', 'ACTIVE').is('latitude', null),
      supabase
        .from('properties')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      head('tenants'),
      head('vendors'),
      countTicketsByStatus(supabase, workspaceId).catch(() => ({})),
      head('announcements'),
      head('documents'),
      ...INVOICE_STATUSES.map((s) => head('invoices').eq('status', s)),
    ])

  return {
    ...setup,
    properties: properties.count ?? 0,
    propertiesWithoutLocation: unlocated.count ?? 0,
    firstPropertyId: (firstProperty.data as { id: string } | null)?.id ?? null,
    people: people.count ?? 0,
    vendors: vendors.count ?? 0,
    tickets,
    invoices: Object.fromEntries(INVOICE_STATUSES.map((s, i) => [s, invoiceCounts[i].count ?? 0])),
    announcements: announcements.count ?? 0,
    documents: documents.count ?? 0,
  }
}

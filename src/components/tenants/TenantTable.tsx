import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Tenant } from '@/lib/data/tenants'

// The list page joins each tenant with its linked-tenancy count (computed from a
// single bulk listTenancies() call + a Map, mirroring /map's unitCountByProperty —
// no new data-layer code needed for a per-row count).
export type TenantWithTenancyCount = Tenant & { tenancyCount: number }

function ContactLines({ email, phone }: { email: string | null; phone: string | null }) {
  if (!email && !phone) return <>—</>
  return (
    <div className="flex flex-col">
      {email && <span className="truncate">{email}</span>}
      {phone && <span className="text-xs text-muted-foreground">{phone}</span>}
    </div>
  )
}

// Rows are clickable to the person detail page via a stretched Link on the name cell —
// same house pattern as VendorTable/PropertyTable (after:absolute inset-0 + a
// focus-visible ring on the link itself so keyboard users get a visible target).
export function TenantTable({ tenants }: { tenants: TenantWithTenancyCount[] }) {
  return (
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {tenants.map((t) => (
          <li key={t.id}>
            <Link
              href={`/people/${t.id}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium leading-snug">{t.full_name}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {t.tenancyCount} {t.tenancyCount === 1 ? 'tenancy' : 'tenancies'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{t.email ?? t.phone ?? '—'}</span>
                <span className="shrink-0">{t.language ?? '—'}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden overflow-hidden rounded-lg border sm:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Name</TableHead>
            <TableHead className="px-4">Contact</TableHead>
            <TableHead className="px-4">Language</TableHead>
            <TableHead className="px-4">Tenancies</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tenants.map((t) => (
            <TableRow key={t.id} className="group relative cursor-pointer">
              <TableCell className="px-4 py-3 font-medium">
                <Link
                  href={`/people/${t.id}`}
                  className="after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                >
                  {t.full_name}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                <ContactLines email={t.email} phone={t.phone} />
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {t.language ?? '—'}
              </TableCell>
              <TableCell className="px-4 py-3 tabular-nums text-muted-foreground">
                {t.tenancyCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}

import Link from 'next/link'

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/properties', label: 'Properties' },
  { href: '/units', label: 'Units' },
  { href: '/vendors', label: 'Vendors' },
]

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col gap-1 border-r px-3 py-4">
      {NAV.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

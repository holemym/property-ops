import { Building2 } from 'lucide-react'

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="flex items-center gap-2 text-foreground">
        <Building2 className="size-5" aria-hidden />
        <span className="font-heading text-base font-medium tracking-tight">Property Ops</span>
      </div>
      {children}
    </main>
  )
}

export function AuthPageShell({
  title,
  error,
  notice,
  children,
}: {
  title: string
  error?: string
  notice?: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {notice && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      )}
      {children}
    </div>
  )
}

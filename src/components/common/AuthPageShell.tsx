import { FormError } from '@/components/common/FormError'

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
      <FormError message={error} />
      {notice && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-400">
          {notice}
        </p>
      )}
      {children}
    </div>
  )
}

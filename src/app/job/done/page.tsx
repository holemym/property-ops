// Static vendor confirmation page for the two TERMINAL secure-link actions
// (decline / complete). Both revoke the token before redirecting, so the /job/<token>
// page can no longer render its thank-you state — it would show the generic "invalid
// link" page instead. This route needs NO token: it carries no ticket detail (nothing
// to authorize), just a generic confirmation styled like the job page shell. Public via
// the /job PUBLIC_PATHS prefix in src/proxy.ts; the static segment wins over
// /job/[token] so "done" is never treated as a token.

export default async function VendorJobDonePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>
}) {
  const { state } = await searchParams
  const declined = state === 'declined'
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">
        {declined ? 'You declined this job.' : 'This job is marked complete. Thank you.'}
      </h1>
      <p className="text-sm text-muted-foreground">
        {declined
          ? 'The property manager has been notified and will re-assign the work. You can close this page.'
          : 'The property manager has been notified. You can close this page.'}
      </p>
    </main>
  )
}

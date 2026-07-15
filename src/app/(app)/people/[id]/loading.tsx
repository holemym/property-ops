import { FormSkeleton } from '@/components/common/skeletons'

// The detail page is currently just the edit form (see page.tsx) — FormSkeleton is
// the honest match. Revisit if/when P1-3's linked-tenancies card lands here.
export default function Loading() {
  return <FormSkeleton />
}

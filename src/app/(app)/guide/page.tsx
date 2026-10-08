import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getGuideState } from '@/lib/data/guide'
import { PageHeader } from '@/components/layout/PageHeader'
import { GuideIndex } from '@/components/guide/GuideIndex'
import { GuideChapter } from '@/components/guide/GuideChapter'
import { operatorChapters, RESIDENT_CHAPTERS, visibleChapters } from '@/components/guide/chapters'

// /guide: the in-app walkthrough, one set of chapters per audience (operators,
// residents). Every step that happens on a screen links to that screen, and every
// operator chapter states the workspace's real numbers, so the guide doubles as the
// setup checklist. Chapters live in components/guide/chapters.tsx.
export default async function GuidePage() {
  const user = await requireWorkspace()
  const resident = isTenantRole(user.role)

  const chapters = resident
    ? RESIDENT_CHAPTERS
    : operatorChapters(await getGuideState(await createClient(), user.workspaceId))
  const visible = visibleChapters(chapters, user.role)

  return (
    <div>
      <PageHeader
        title="Guide"
        subtitle={
          resident
            ? 'How to use your resident portal. Each step opens its screen.'
            : 'How Property Ops works, with this workspace’s current numbers. Each step opens its screen.'
        }
      />
      {/* The chapter column is capped: on a wide screen an uncapped step row puts the
          instruction and its button a full monitor-width apart. */}
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,52rem)] lg:gap-10">
        <GuideIndex
          chapters={visible.map((c) => ({ id: c.id, number: c.number, title: c.title, done: c.state?.done }))}
        />
        <div className="flex min-w-0 flex-col gap-10">
          {visible.map((c) => (
            <GuideChapter
              key={c.id}
              id={c.id}
              number={c.number}
              title={c.title}
              purpose={c.purpose}
              state={c.state}
              specimen={c.specimen}
              steps={c.steps}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

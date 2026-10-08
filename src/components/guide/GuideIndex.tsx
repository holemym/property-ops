'use client'

import { useEffect, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export type GuideChapterRef = { id: string; number: string; title: string; done?: boolean }

// The guide's chapter index: plain #anchor links (keyboard reachable, work without JS),
// with the current chapter lit by scroll position. A sticky rail at lg+, a sticky
// horizontal strip above it on narrower screens. Chapters the workspace has already
// done carry a check, so the index doubles as a progress view.
export function GuideIndex({ chapters }: { chapters: GuideChapterRef[] }) {
  const [active, setActive] = useState(chapters[0]?.id)

  useEffect(() => {
    // root = viewport: the (app) shell scrolls inside <main>, whose clipping the
    // observer already accounts for. The band 20%–35% from the top is the reading line.
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-20% 0px -65% 0px' }
    )
    for (const c of chapters) {
      const el = document.getElementById(c.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [chapters])

  const link = (c: GuideChapterRef, compact: boolean) => (
    <a
      key={c.id}
      href={`#${c.id}`}
      aria-current={active === c.id ? 'location' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-md text-sm transition-colors duration-[--duration-fast]',
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2',
        active === c.id
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <span className="tabular-nums text-xs opacity-70">{c.number}</span>
      <span className={cn(compact ? 'whitespace-nowrap' : 'min-w-0 flex-1')}>{c.title}</span>
      {c.done && !compact && <CircleCheck className="size-3.5 shrink-0" aria-label="Done in this workspace" />}
    </a>
  )

  return (
    <>
      <nav
        aria-label="Guide chapters"
        className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden"
      >
        {chapters.map((c) => link(c, true))}
      </nav>
      <nav aria-label="Guide chapters" className="sticky top-0 hidden flex-col gap-0.5 self-start lg:flex">
        {chapters.map((c) => link(c, false))}
      </nav>
    </>
  )
}

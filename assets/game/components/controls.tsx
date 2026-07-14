// Editor-UI primitives for the game-engine editor: palette swatches, the sidebar
// Card wrapper, view/tool toggle buttons, and the animation frame stepper.
// Module-level, props-driven presentational components moved out of the page (stage 4).
import { useEffect, useRef, useState } from 'react'

/**
 * Editor sidebar card — a labelled, accent-bordered panel grouping one tool.
 * Pure presentational wrapper so every panel in the two sidebars looks the same
 * and stays readable for non-devs. Accent maps to a Tailwind border/title colour.
 */
export type CardAccent = 'yellow' | 'purple' | 'orange' | 'blue' | 'cyan'

export const CARD_TITLE_COLOR: Record<CardAccent, string> = {
  yellow: 'text-yellow-400',
  purple: 'text-purple-400',
  orange: 'text-orange-400',
  blue: 'text-blue-400',
  cyan: 'text-cyan-400',
}

export function Card({
  title,
  accent = 'yellow',
  action,
  children,
  defaultOpen = true,
  sectionId,
  focus,
}: {
  title: string
  accent?: CardAccent
  action?: React.ReactNode
  children: React.ReactNode
  /** start collapsed by passing false — collapsible to cut sidebar scrolling. */
  defaultOpen?: boolean
  /** stable id so the on-canvas quick-actions can target this section. */
  sectionId?: string
  /** bumped `{ id, n }` from a quick-action: when `id` matches `sectionId` the card
   *  opens itself + scrolls into view. The `n` nonce lets a repeat click re-focus. */
  focus?: { id: string; n: number } | null
}) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!focus || !sectionId || focus.id !== sectionId) return
    setOpen(true)
    // wait a frame so the just-expanded body has laid out before we scroll to it.
    const raf = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
    return () => cancelAnimationFrame(raf)
  }, [focus, sectionId])
  return (
    <section ref={ref} data-section={sectionId} className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg shadow-black/40">
      <header className={`flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`flex flex-1 items-center gap-1.5 text-left text-sm font-bold uppercase tracking-wide ${CARD_TITLE_COLOR[accent]}`}
        >
          <span aria-hidden className="text-[10px]">{open ? '▾' : '▸'}</span>
          <h3>{title}</h3>
        </button>
        {action}
      </header>
      {open && children}
    </section>
  )
}

/** A single view-mode button in the Views card. */
export function ViewButton({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

/** A tool toggle in the Entities card (Player / Enemy / NPC / Erase). */
export function EntityToolButton({
  label,
  glyph,
  active,
  activeClass,
  onClick,
}: {
  label: string
  glyph: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 rounded px-2 py-1.5 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      <span className="text-base leading-none" aria-hidden>{glyph}</span>
      <span>{label}</span>
    </button>
  )
}


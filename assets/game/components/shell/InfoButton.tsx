/**
 * THE (i) BUTTON — a click-to-open explanation next to a control.
 *
 * Alexander, 2026-09-08: *"we need to improve labeling and add (i) info and docs with example guides."*
 *
 * CLICK, not hover, and it stays open until dismissed. That is deliberate: a hover tooltip cannot be read
 * on a touch screen, cannot be selected or copied, and vanishes the moment you move toward the thing it
 * describes — which is exactly when you still need it. Godot's editor made the same correction.
 *
 * The copy lives in `editorHelp.data.ts`. An id with no copy renders NO button, so an (i) never opens an
 * empty box.
 */
import { useEffect, useId, useRef, useState } from 'react'

import { helpFor } from './editorHelp.data'

export interface InfoButtonProps {
  /** Which explanation to show. No copy for this id → no button at all. */
  helpId: string
  /** Optional in-page anchor for a longer guide, shown as a link at the foot of the popover. */
  docHref?: string
}

export function InfoButton({ helpId, docHref }: InfoButtonProps) {
  const entry = helpFor(helpId)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const anchor = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Dismiss on an outside click or Escape. Escape is listed first so it wins over a parent panel's own
  // Escape handler only for as long as this popover is the thing on top.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      anchor.current?.focus()
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popover.current?.contains(target) || anchor.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (!entry) return null

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    const rect = anchor.current?.getBoundingClientRect()
    // Clamp to the viewport so a control near the right edge does not open a popover off-screen.
    if (rect) {
      setPos({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 472)),
        top: rect.bottom + 8,
      })
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="i"
        aria-label="What is this?"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={(event) => {
          event.stopPropagation()
          toggle()
        }}
      >
        i
      </button>
      {open && pos && (
        <div ref={popover} id={panelId} className="pop atpoint" role="dialog" aria-label={entry.title} style={pos}>
          <div className="ph">
            <b>{entry.title}</b>
            <button type="button" className="px" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          {/* Authored copy from editorHelp.data.ts — never user input. See that file's header. */}
          <div className="pb" dangerouslySetInnerHTML={{ __html: entry.body }} />
          {docHref && (
            <div className="pb" style={{ paddingTop: 0 }}>
              <a href={docHref}>Open the full guide →</a>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/** A section heading with an optional (i) — the `sub()` helper from the design. */
export function SubHeading({
  children,
  helpId,
  docHref,
}: {
  children: React.ReactNode
  helpId?: string
  docHref?: string
}) {
  return (
    <div className="sub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span>{children}</span>
      {helpId && <InfoButton helpId={helpId} docHref={docHref} />}
    </div>
  )
}

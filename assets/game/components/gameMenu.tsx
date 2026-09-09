/**
 * `🎮 Boss ▾` — the game's identity and the actions that belong to the whole product (§4.4).
 *
 * §3.2 measured that inside `/games/[id]` "the only identity shown anywhere is the template name": you could
 * not tell WHICH game you were editing. The level stepper answered "which level"; this answers "which game",
 * and collects the actions whose subject is the game rather than the map — rename, manage levels, the level
 * graph, export, and the way out.
 *
 * §4.1's first principle is one question per region: the PROJECT bar answers *what am I working on*. These
 * items all answer that; none of them changes the map in front of you.
 *
 * The one guarantee with teeth: **← All games confirms before leaving with unsaved changes** (§4.4), because
 * §3.15 lists "navigates out of the game without warning — an unsaved map is lost with no prompt" as a live
 * defect. The guard is a required prop so a call site cannot quietly omit it.
 *
 * Presentational: every action is a prop.
 */
import { useEffect, useRef, useState } from 'react'

export function GameMenu({
  gameName, wouldLoseWork, confirmLeave,
  onRename, onManageLevels, onFlow, onExport, onAllGames,
}: {
  /** The game being edited, or null when the editor is open outside a game (`/templates`). */
  gameName: string | null
  /** Would leaving lose unsaved edits? (`describeSaveState(...).wouldLoseWork`) */
  wouldLoseWork: boolean
  /** Ask before abandoning unsaved work. Resolves true to proceed. */
  confirmLeave: () => Promise<boolean>
  onRename: () => void
  onManageLevels: () => void
  onFlow: () => void
  onExport: () => void
  onAllGames: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Click-away closes it, like the bar's other menus.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  // Outside a game there is no game to name — and no game actions to offer.
  if (gameName === null) return null

  const pick = (action: () => void) => () => { setOpen(false); action() }

  // Leaving is the one item that can destroy work, so it asks first — and only when there IS work at stake.
  const leave = async () => {
    setOpen(false)
    if (wouldLoseWork && !(await confirmLeave())) return
    onAllGames()
  }

  const item = 'block w-full rounded px-2 py-1 text-left text-xs text-gray-200 transition-colors hover:bg-gray-800'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Game menu — ${gameName}`}
        title={gameName}
        className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-bold text-gray-100 transition-colors hover:bg-white/10"
      >
        <span aria-hidden>🎮</span>
        <span className="max-w-[10rem] truncate">{gameName}</span>
        <span aria-hidden className="text-gray-400">▾</span>
      </button>

      {open && (
        <div role="menu" aria-label="Game" className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-white/10 bg-gray-950 p-1 shadow-2xl">
          <button role="menuitem" onClick={pick(onRename)} className={item}>Rename game…</button>
          <button role="menuitem" onClick={pick(onManageLevels)} className={item}>Manage levels…</button>
          <div className="my-1 h-px bg-white/10" />
          <button role="menuitem" onClick={pick(onFlow)} className={item}>Level graph (Flow)</button>
          <button role="menuitem" onClick={pick(onExport)} className={item}>Export this level as JSON</button>
          <div className="my-1 h-px bg-white/10" />
          <button role="menuitem" onClick={() => void leave()} className={item}>← All games</button>
        </div>
      )}
    </div>
  )
}

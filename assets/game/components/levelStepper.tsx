/**
 * `◀ Level 3 of 5 · village ▾ ▶` — the game's own levels, in the PROJECT bar (§4.4, fixes §3.2).
 *
 * §3.2 is a P0 and the measurement is blunt: inside `/games/[id]` there is no game name, no list of the
 * game's levels, no "level 2 of 5", and **Load (n) lists every saved template rather than this game's**. The
 * `templateIds` were already loaded and held in state — and used only to append to on save. They were never
 * rendered. This renders them.
 *
 * §5.3 rates the switcher medium risk because stepping away from unsaved edits would lose them, which is why
 * `wouldLoseWork` + `confirmLeave` are required props rather than an optional nicety: the guard is part of
 * the control, not something a call site can forget. It asks ONLY when there is something to lose — a prompt
 * with nothing at stake is what teaches people to click through prompts.
 *
 * Presentational: it knows nothing about templates, grids or saving. `onGo` does the loading.
 */
import { useState } from 'react'

export interface LevelRef {
  id: string
  name: string
}

export function LevelStepper({ levels, currentId, wouldLoseWork, onGo, confirmLeave, onAddLevel, onReorder }: {
  /** This game's levels, IN ORDER — index 0 is level 1. */
  levels: readonly LevelRef[]
  /** The template open right now. May be absent from `levels` (a template opened outside the game). */
  currentId: string | null
  /** Would leaving the open map lose unsaved edits? (`describeSaveState(...).wouldLoseWork`) */
  wouldLoseWork: boolean
  onGo: (templateId: string) => void | Promise<void>
  /** Ask the user whether to leave unsaved work. Resolves true to proceed. */
  confirmLeave: () => Promise<boolean>
  /** §4.4 draws these UNDER the level list, below a divider: `＋ Add a level…   ⇅ Reorder levels`. Adding
   *  a level is how you open a template that is not yet one of this game's — which is why `Load (n)` left
   *  the project bar. */
  onAddLevel?: () => void
  onReorder?: () => void
}) {
  const [listOpen, setListOpen] = useState(false)

  // A game with no levels has nothing to step through, and an empty stepper is just noise in the bar.
  if (levels.length === 0) return null

  const index = levels.findIndex(l => l.id === currentId)
  const current = index >= 0 ? levels[index] : null

  const go = async (templateId: string) => {
    setListOpen(false)
    if (wouldLoseWork && !(await confirmLeave())) return
    await onGo(templateId)
  }

  const step = (delta: number) => {
    const next = levels[index + delta]
    if (next) void go(next.id)
  }

  const arrow = 'shrink-0 rounded px-1.5 py-1 text-xs font-bold text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent'

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button onClick={() => step(-1)} disabled={index <= 0} aria-label="Previous level" title="Previous level" className={arrow}>◀</button>

      <button
        onClick={() => setListOpen(o => !o)}
        aria-expanded={listOpen}
        aria-label="Choose a level"
        title="Choose a level"
        className="shrink-0 rounded px-2 py-1 text-xs font-bold text-gray-100 transition-colors hover:bg-white/10"
      >
        {/* §4.11: the project bar NEVER scrolls, so when it cannot fit this label shortens to `3/5` rather
            than pushing Save and Play off the edge. Two spans, one visible per breakpoint — no JS, no
            measuring, and the long form is what you see on any normal laptop. */}
        {current
          ? (
            <>
              <span className="hidden xl:inline">
                Level {index + 1} of {levels.length} · <span className="text-cyan-300">{current.name}</span>
              </span>
              <span className="xl:hidden tabular-nums">
                <span className="text-cyan-300">{index + 1}/{levels.length}</span>
              </span>
              {' ▾'}
            </>
          )
          : <span className="text-amber-300">Not in this game ▾</span>}
      </button>

      <button onClick={() => step(1)} disabled={index < 0 || index >= levels.length - 1} aria-label="Next level" title="Next level" className={arrow}>▶</button>

      {listOpen && (
        <ul
          role="listbox"
          aria-label="Levels"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-1 shadow-2xl"
        >
          {levels.map((level, i) => (
            <li key={`${level.id}-${i}`}>
              <button
                role="option"
                aria-selected={level.id === currentId}
                onClick={() => void go(level.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                  level.id === currentId ? 'bg-cyan-900/50 text-cyan-200' : 'text-gray-200 hover:bg-gray-800'
                }`}
              >
                <span className="w-4 shrink-0 text-right text-[10px] text-gray-500">{i + 1}</span>
                <span className="truncate">{level.name}</span>
              </button>
            </li>
          ))}
          {(onAddLevel || onReorder) && (
            <>
              <li className="my-1 h-px bg-white/10" role="presentation" />
              <li className="flex gap-1">
                {onAddLevel && (
                  <button
                    onClick={() => { setListOpen(false); onAddLevel() }}
                    className="flex-1 rounded px-2 py-1 text-left text-xs text-gray-200 transition-colors hover:bg-gray-800"
                  >
                    ＋ Add a level…
                  </button>
                )}
                {onReorder && (
                  <button
                    onClick={() => { setListOpen(false); onReorder() }}
                    className="flex-1 rounded px-2 py-1 text-left text-xs text-gray-200 transition-colors hover:bg-gray-800"
                  >
                    ⇅ Reorder levels
                  </button>
                )}
              </li>
            </>
          )}
        </ul>
      )}
    </div>
  )
}

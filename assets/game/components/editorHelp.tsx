/**
 * THE EDITOR'S SELF-DOCUMENTATION — the mode chip and the `? Help` sheet (design §4.9).
 *
 * §3.4 is a P0: "Nothing tells the user how to use the editor." Two surfaces answer it, and neither
 * invents its content:
 *   - CanvasModeChip states what the next click does (`describeCanvasMode`), so a mode is VISIBLE
 *     on the canvas instead of implied by which panel happens to be open (§4.1.7).
 *   - HelpSheet prints the shortcut table — the same table the keydown dispatcher matches against,
 *     plus the LIVE ability/quick-slot bindings — so it cannot drift from the handlers.
 *
 * Presentational: no editor state, no fetching. Both take exactly what they render.
 */
import { Modal } from './modals'
import { describeCanvasMode, type CanvasModeState } from './canvasMode'
import { helpSheetGroups, type HelpSheetContext, type ShortcutGroup } from '@/game/shortcuts'

/**
 * The always-visible mode chip. `role="status"` + `aria-live="polite"` because it changes WHILE the
 * user works — a screen reader should mention the new mode without yanking focus off the canvas.
 */
export function CanvasModeChip(props: CanvasModeState) {
  const { glyph, what, how } = describeCanvasMode(props)
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-1 font-mono text-[11px] text-gray-200 shadow-lg shadow-black/40 backdrop-blur"
    >
      <span aria-hidden className="text-cyan-300">{glyph}</span>
      <span className="font-bold">{what}</span>
      <span className="text-gray-400">·</span>
      <span className="text-gray-400">{how}</span>
    </div>
  )
}

/** One group's rows as a two-column table — chord on the left, what it does on the right. */
function ShortcutTable({ group }: { group: ShortcutGroup }) {
  return (
    <section>
      <h4 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">{group.title.toUpperCase()}</h4>
      <table className="w-full border-collapse">
        <tbody>
          {group.rows.map((row, i) => (
            <tr key={`${row.chord}-${row.does}-${i}`} className="align-top">
              <th scope="row" className="whitespace-nowrap py-0.5 pr-3 text-left font-mono text-[11px] font-normal text-gray-100">
                {row.chord}
              </th>
              <td className="py-0.5 text-[11px] text-gray-400">{row.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/**
 * The shortcut sheet. Opened by the `? Help` button and by `?` / `F1`; closes on Esc or the backdrop
 * (both come free with `Modal`). Two columns at desktop width so the three groups read side by side
 * like §4.9's wireframe, one column when the panel is narrow.
 */
export function HelpSheet({ onClose, ...context }: { onClose: () => void } & HelpSheetContext) {
  return (
    <Modal title="Keyboard & mouse" accent="cyan" onClose={onClose} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        {helpSheetGroups(context).map(group => (
          <ShortcutTable key={group.id} group={group} />
        ))}
      </div>
    </Modal>
  )
}

/** The `? Help` button that opens the sheet. Lives in the view bar (§4.3). */
export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title="Keyboard & mouse shortcuts (? or F1)"
      aria-label="Keyboard and mouse shortcuts"
      className="rounded px-2 py-1 text-xs font-bold text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
    >
      ? Help
    </button>
  )
}

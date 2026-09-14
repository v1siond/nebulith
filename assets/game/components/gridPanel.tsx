import { useEffect, useRef, useState } from 'react'
import { type MapSize, CELL_SIZE_MIN, atLeast, cellCount, mapSizeProblem, mapSizeValid } from '@/lib/mapSize'

/**
 * THE GRID's controls — the map's own numbers, split by where they belong.
 *
 * They lived in the Generate panel, then moved to a rail section of their own, and are now split. Both
 * moves are
 *
 * 2026-09-10 (a):
 *
 * 2026-09-10 (b):
 *
 * So the split follows what each number DOES:
 *
 * - **The matrix** (columns / rows / cell pixels) rebuilds the map, so it sits with the thing that rebuilds
 *   the map. {@link MapMatrixSection}, inside the New world panel.
 * - **Ground thickness** changes nothing about the cells, only how the map is DRAWN. So it joins Rotate and
 *   Range in the view bar, which is where "how am I looking at it" lives. {@link GroundThicknessControl}.
 *
 * That also answers the:
 * the matrix is a draft the generate consumes, and thickness applies on the spot because it can.
 */

/**
 * A number input you can actually EMPTY.
 *
 * The old control ran `parseInt` on every
 * keystroke and DROPPED anything that did not parse, so backspacing to an empty field was rejected and the
 * old number snapped straight back.
 *
 * A text draft fixes it at the root: the field holds whatever you are typing, including nothing, and the
 * COMMIT is separate from the keystroke. A valid number commits as you type (so the map follows live); an
 * empty or half-typed one just sits there. Blur restores the committed value, so the field can never be
 * left showing a number the map does not have.
 */
export function NumberField({
  label,
  value,
  min = 0,
  onCommit,
  ariaLabel,
}: {
  label: string
  value: number
  min?: number
  onCommit: (next: number) => void
  /** Spoken label, when the visible one needs units the label does not carry. */
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)

  // Follow the value when something ELSE changes it — a generate, an undo, loading a map. Never while the
  // field has focus: that would overwrite the digits being typed, which is the bug this control exists for.
  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])

  const commit = (text: string): void => {
    setDraft(text)
    if (text.trim() === '') return // mid-edit, not a value yet
    const next = Number(text)
    if (!Number.isInteger(next) || next < min) return
    onCommit(next)
  }

  return (
    <div className="ctl">
      <span className="l">{label}</span>
      <input
        type="number"
        min={min}
        step={1}
        aria-label={ariaLabel ?? label}
        value={draft}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; setDraft(String(value)) }}
        onChange={e => commit(e.target.value)}
      />
    </div>
  )
}

/**
 * `How big` — the grid's MATRIX, inside the New world panel.
 *
 * The typed numbers are a DRAFT owned by the PARENT, because two actions read it: `Build this world`
 * generates into it, and the resize button applies it to the open map. A number two actions depend on
 * cannot be private to one of them.
 */
export function MapMatrixSection({
  draft,
  size,
  onDraft,
  onResize,
}: {
  /** The numbers as typed. */
  draft: MapSize
  /** The size the open map actually IS, so the resize button knows whether it has work to do. */
  size: MapSize
  onDraft: (next: MapSize) => void
  /** Apply the typed matrix to the open map. Destructive: it clears the cells. */
  onResize: (cols: number, rows: number, cellSize: number) => void
}) {
  const cells = cellCount(draft)
  const unchanged = draft.cols === size.cols && draft.rows === size.rows && draft.cellSize === size.cellSize
  const problem = mapSizeProblem(draft)

  return (
    <section>
      <NumberField label="Columns" value={draft.cols} min={1} ariaLabel="Map columns"
        onCommit={cols => onDraft({ ...draft, cols })} />
      <NumberField label="Rows" value={draft.rows} min={1} ariaLabel="Map rows"
        onCommit={rows => onDraft({ ...draft, rows })} />
      <NumberField label="Cell pixels" value={draft.cellSize} min={CELL_SIZE_MIN} ariaLabel="Cell size in pixels"
        onCommit={cellSize => onDraft({ ...draft, cellSize })} />
      <div className="hint">
        {cells === null
          ? 'Columns is how many cells fit in one row.'
          : `${draft.cols} × ${draft.rows} = ${cells.toLocaleString()} cells. Columns is how many cells fit in one row.`}
      </div>

      {/* Only when the numbers differ from the open map: a destructive button with nothing to do is noise.
          Building a world uses these numbers WITHOUT this, which is why it says so. */}
      {!unchanged && (
        <>
          <button
            type="button"
            onClick={() => onResize(draft.cols, draft.rows, draft.cellSize)}
            disabled={!mapSizeValid(draft)}
            title={`Rebuild the open map as ${draft.cols} × ${draft.rows} cells of ${draft.cellSize}px`}
            className="b dan"
            style={{ width: '100%', marginTop: 6, justifyContent: 'center' }}
          >
            {`Resize this map to ${draft.cols} × ${draft.rows}…`}
          </button>
          <div className="hint" style={{ color: 'var(--warn)' }}>
            {problem
              ? `⚠ ${problem}`
              : !atLeast(draft.cellSize, CELL_SIZE_MIN)
                ? '⚠ A cell needs to be at least one pixel.'
                : '⚠ Resizing clears the map. Ctrl+Z undoes it. Building a new world uses these numbers without clearing anything first.'}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * `▤ Ground` — the map's BODY depth, in the view bar beside Rotate and Range.
 *
 * That is right about the kind of thing it is: it rebuilds nothing and touches no cell, it only
 * changes how deep the map draws — the same class of property as which way the camera faces.
 *
 * It is only VISIBLE where the map stops, so an empty map shows no change at all. The title says so,
 * because that silence is what made it read as broken.
 */
export function GroundThicknessControl({
  blocks,
  onBlocks,
}: {
  blocks: number
  onBlocks: (blocks: number) => void
}) {
  const [draft, setDraft] = useState(String(blocks))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(String(blocks))
  }, [blocks])

  return (
    <div
      className="flex shrink-0 items-center gap-1.5 rounded bg-gray-700 px-2 py-1 text-xs font-bold text-white"
      title="How thick the map's own ground is, in blocks. You see it at the map's edges, so an empty map shows nothing. 0 lays it flat."
    >
      <label className="flex items-center gap-1" htmlFor="ground-thickness">▤ Ground</label>
      <input
        id="ground-thickness"
        type="number"
        min={0}
        step={1}
        value={draft}
        aria-label="Ground thickness in blocks"
        className="w-12 rounded bg-gray-800 px-1 text-right text-yellow-400"
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; setDraft(String(blocks)) }}
        onChange={e => {
          setDraft(e.target.value)
          if (e.target.value.trim() === '') return
          const next = Number(e.target.value)
          if (Number.isInteger(next) && next >= 0) onBlocks(next)
        }}
      />
    </div>
  )
}

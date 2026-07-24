/**
 * cameraControls — the top-nav camera controls for the ISO view.
 *
 * Alexander (#75): "I want the rotate button or action and just rotates the map horizontally, changing the
 * front perspective of the map and showing a different side of it" … "we can rotate the corners, 4 corners,
 * 4 rotation options, all faces of the map are visible."
 */
import { nextOrientation, type Orientation } from '@/engine/render/isoOrientation'

/** The label for each corner. An Orientation is quarter-turns CW, so the honest name for it is its angle —
 *  no invented compass direction, which the camera model doesn't define. */
const FACING_DEGREES: Record<Orientation, string> = { 0: '0°', 1: '90°', 2: '180°', 3: '270°' }

/**
 * ONE quarter-turn per click, wrapping 0→1→2→3→0, showing which corner you are currently on. Controlled: the
 * editor page owns the facing (its React state feeds `render({ cameraFacing })`), this only advances it.
 * ISO-only — 2D and Top have no rotation, so the page doesn't render this there.
 */
export function CameraRotateButton({
  facing,
  onFacing,
}: {
  facing: Orientation
  onFacing: (facing: Orientation) => void
}) {
  return (
    <button
      onClick={() => onFacing(nextOrientation(facing, 1))}
      aria-label="Rotate the map 90 degrees"
      title="Rotate the map horizontally — one quarter-turn per click, all 4 sides"
      className="shrink-0 rounded bg-gray-700 px-2 py-1 text-xs font-bold text-white transition-colors hover:bg-gray-600"
    >
      ↻ Rotate <span className="text-yellow-400">{FACING_DEGREES[facing]}</span>
    </button>
  )
}

/** The player-camera RANGE (radius in cells) the control offers. OFF is `undefined` (the full-window render);
 *  ON defaults to a mid radius and slides between MIN and MAX. */
export const PLAYER_RANGE_MIN = 1
export const PLAYER_RANGE_MAX = 24
export const PLAYER_RANGE_DEFAULT = 6

/** Normalise a would-be range to a valid ON value, or `undefined` for OFF. A null / non-finite / non-positive
 *  value is OFF (the full render — no regression); a positive value is rounded and clamped into range. This is
 *  the ONE place the control + the `window.__setPlayerViewRange` seam agree on what "off" and a valid range mean. */
export function normalizePlayerViewRange(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n) || n <= 0) return undefined
  return Math.min(PLAYER_RANGE_MAX, Math.max(PLAYER_RANGE_MIN, Math.round(n)))
}

/**
 * PLAYER-CAMERA RANGE control (Alexander: "I want to control that setting, so increasing, reducing, etc.").
 * CONTROLLED — the editor page owns the range and feeds it to `render({ playerViewRange })`; this only sets it.
 * DEFAULT OFF: a checkbox toggles the range on/off (undefined = the full-window render), and while ON a slider
 * increases / reduces the radius live. ISO-only — the page renders it only in the iso view.
 */
export function PlayerRangeControl({
  range,
  onRange,
}: {
  range: number | undefined
  onRange: (range: number | undefined) => void
}) {
  const on = range != null
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded bg-gray-700 px-2 py-1 text-xs font-bold text-white">
      <label className="flex cursor-pointer items-center gap-1" title="Only render tiles within this many cells of the player (draws a ring)">
        <input
          type="checkbox"
          checked={on}
          onChange={e => onRange(e.target.checked ? PLAYER_RANGE_DEFAULT : undefined)}
          aria-label="Toggle player camera range"
        />
        ◎ Range
      </label>
      {on && (
        <>
          <input
            type="range"
            min={PLAYER_RANGE_MIN}
            max={PLAYER_RANGE_MAX}
            value={range}
            onChange={e => onRange(normalizePlayerViewRange(Number(e.target.value)))}
            aria-label="Player camera range in cells"
            className="w-24"
          />
          <span className="w-6 text-right text-yellow-400">{range}</span>
        </>
      )}
    </div>
  )
}

/** Rotate a pan (camOffset) delta by `quarters` CW quarter-turns — the SAME quarter-turn the grid takes:
 *  (x,y) → (-y,x) each turn. Pure. */
export function rotatePan(pan: { x: number; y: number }, quarters: number): { x: number; y: number } {
  let { x, y } = pan
  const k = ((quarters % 4) + 4) % 4
  for (let i = 0; i < k; i++) { const nx = -y + 0, ny = x + 0; x = nx; y = ny } // +0 normalises -0 → 0
  return { x, y }
}

/** The pan (camOffset) that keeps the CURRENTLY-CENTERED world point centered when the camera facing changes
 *  `from → to`. The screen-centre world point is `player − R₋facing(pan)`, so rotating the pan by (to−from)
 *  quarter-turns holds that point fixed — the map rotates AROUND what you were looking at, no jump. Pure. */
export function panKeepingCenter(pan: { x: number; y: number }, from: Orientation, to: Orientation): { x: number; y: number } {
  return rotatePan(pan, to - from)
}

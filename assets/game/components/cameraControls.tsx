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

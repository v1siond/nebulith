import type { Facing } from './villageLayout'

/**
 * Map a planner facing to the iso billboard axis used by the render.
 *
 * Iso shows only the two camera-facing axes:
 *   0 = facade runs along +col  → buildings fronting a HORIZONTAL street (facing south/north)
 *   1 = facade runs along -row  → buildings fronting a VERTICAL road    (facing east/west)
 *
 * North and west face AWAY from the iso camera, so they reuse their street's axis: the building
 * stays aligned to its road (its true door is shown door-down in the 2D authoring view). This
 * replaces the old position-hash that rotated houses to random axes regardless of their road.
 */
export function isoFacingIndex(facing: Facing): number {
  return facing === 'east' || facing === 'west' ? 1 : 0
}

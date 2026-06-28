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

/**
 * Is the building's road (and thus its door/facade) on the side FACING AWAY from the iso camera?
 * The camera looks toward +row/+col, so south (road below, +row) and east (road right, +col) put
 * the door on the near/front face (visible); north (road above) and west (road left) put it on the
 * far/back face — drawn behind the box so no door ever points at the near-side grass. Proximity
 * transparency reveals these on approach.
 */
export function isoFacadeOnBack(facing: Facing): boolean {
  return facing === 'north' || facing === 'west'
}

/**
 * ROOF REVEAL, which roof blocks come off because the hero is inside the building (Diablo / Path of Exile).
 *
 * The trigger is POSITIONAL, not proximity: the hero is under a roof or they are not. The old
 * distance ease (`cutawayAlpha`) faded things as you merely walked past, which is why walls ghosted from
 * outside while the roof stayed solid (Image #1).
 *
 * A roof is authored as MANY blocks, one z-width column per footprint column (BuildingCompositions #32), so
 * lifting only the block directly overhead would punch a hole in the roof. We lift the CONNECTED roof: every
 * roof block whose footprint touches (orthogonally or diagonally) one already revealed. That groups a
 * building's roof without needing a building identity, and stops at the next building across the street.
 *
 * Pure + unit-tested; the renderer supplies each roof's covered cells and applies the result.
 */

// ── how transparent a reveal tile draws ───────────────────────────────────────────────────────────────────
// Three bands. FAR is solid, a building you are nowhere near is a building, not a ghost. APPROACH eases it
// translucent so you can read the facade and find its door. INSIDE is the deep reveal, the roof comes off
// (handled by revealedRoofs) and the shell drops back so the room reads.
//
// The four numbers the bands are made of used to be `export const` right here, and that is why the report
// was "I don't see any place to manage or edit it": a value invented in React has no row for a control to
// write to. They are columns on `game_settings` now, they travel with the map, and this module takes them
// as an argument so the maths above stays pure and the values stay the backend's.
import type { FadeBands } from '@/lib/fadeBands'
import { assetFadesNear, assetMinAlpha } from '@/engine/cellStack'
import type { GridAsset } from '@/engine/IsometricGrid'

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/**
 * The opacity a reveal tile draws at, given the game's bands.
 *
 * `minAlpha` is the tile's OWN floor, a per-tile backend SETTING, so the DOOR stays opaque and obvious
 * while the wall around it fades, and a TREE stays readable while a wall does not (no tile-name conditional
 * in the renderer). It only ever makes a tile MORE opaque, never less.
 *
 * NO BANDS MEANS NOTHING FADES. A map that has not landed yet has stated no rule, and drawing solid is the
 * honest reading of that. The alternative is a number picked here, which is the defect this signature
 * exists to remove.
 */
export function revealAlpha(
  bands: FadeBands | null,
  { dist, inside, minAlpha = 0 }: { dist: number; inside: boolean; minAlpha?: number },
): number {
  if (!bands) return 1

  // A PLATEAU then an ease-out, not one long ramp. A single smoothstep over the whole radius meant a hero
  // four cells from a wall got ~0.96 alpha, no visible change at all, which is why the reveal "didn't
  // trigger". Inside `fade_full_radius` it sits flat at its most transparent; from there it climbs back to
  // solid by `fade_radius`.
  const band = bandAlpha(bands, dist, inside)

  return Math.max(band, Math.min(1, minAlpha))
}

function bandAlpha(bands: FadeBands, dist: number, inside: boolean): number {
  if (inside) return bands.interior_alpha
  if (dist >= bands.fade_radius) return 1
  if (dist <= bands.fade_full_radius) return bands.fade_alpha

  const across = (dist - bands.fade_full_radius) / (bands.fade_radius - bands.fade_full_radius)

  return bands.fade_alpha + (1 - bands.fade_alpha) * smoothstep(across)
}

/**
 * The near-hero fade for ONE tile in a view with no building shell to reason about (2D and top): the same
 * `revealAlpha` distance rule the iso view uses, for any tile that opted into `fadeNear`. No hero, or a tile
 * that did not opt in, draws solid.
 */
export function nearFadeAlpha(
  bands: FadeBands | null,
  asset: GridAsset | undefined,
  hero: { col: number; row: number } | null,
): number {
  if (!hero || !asset || !assetFadesNear(asset)) return 1

  return revealAlpha(bands, {
    dist: Math.hypot(hero.col - asset.col, hero.row - asset.row),
    inside: false,
    minAlpha: assetMinAlpha(asset),
  })
}

/** The 8-neighbourhood of a `col,row` key, plus the cell itself, "touches" for roof grouping. */
function touching(key: string): string[] {
  const [col, row] = key.split(',').map(Number)
  const out: string[] = []
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) out.push(`${col + dc},${row + dr}`)
  return out
}

/**
 * The indices of the roof blocks to reveal, given the hero's cell and each roof block's covered footprint
 * (`col,row` keys). Empty when the hero stands under no roof, outside, every roof is fully drawn.
 */
export function revealedRoofs(heroCol: number, heroRow: number, roofs: readonly (readonly string[])[]): Set<number> {
  const revealed = new Set<number>()
  const heroKey = `${heroCol},${heroRow}`
  const seeds = roofs.flatMap((cells, i) => (cells.includes(heroKey) ? [i] : []))
  if (seeds.length === 0) return revealed

  // Grow the connected roof: a block joins when its footprint touches any cell already revealed.
  const covered = new Set<string>()
  const add = (i: number): void => {
    revealed.add(i)
    for (const cell of roofs[i]) for (const near of touching(cell)) covered.add(near)
  }
  seeds.forEach(add)
  for (let grew = true; grew; ) {
    grew = false
    roofs.forEach((cells, i) => {
      if (revealed.has(i) || !cells.some(cell => covered.has(cell))) return
      add(i)
      grew = true
    })
  }
  return revealed
}

/**
 * The SHELL of the revealed building: the cells its lifted roof covers plus the ring around them, i.e. the
 * walls, windows and doors standing under and around that roof. A `fadeNear` tile in this set eases translucent
 * so the interior is actually visible once the roof is off; every tile outside it keeps its full opacity.
 */
export function revealedShell(roofs: readonly (readonly string[])[], revealed: ReadonlySet<number>): Set<string> {
  const shell = new Set<string>()
  for (const i of revealed) for (const cell of roofs[i]) for (const near of touching(cell)) shell.add(near)
  return shell
}

/**
 * ROOF REVEAL — which roof blocks come off because the hero is inside the building (Diablo / Path of Exile).
 *
 * Alexander (2026-09-06): "roof gets transparent when user enters the building and we can see the inside of the
 * thing". The trigger is POSITIONAL, not proximity: the hero is under a roof or they are not. The old
 * distance ease (`cutawayAlpha`) faded things as you merely walked past, which is why walls ghosted from
 * outside while the roof stayed solid (Image #1).
 *
 * A roof is authored as MANY blocks — one z-width column per footprint column (BuildingCompositions #32) — so
 * lifting only the block directly overhead would punch a hole in the roof. We lift the CONNECTED roof: every
 * roof block whose footprint touches (orthogonally or diagonally) one already revealed. That groups a
 * building's roof without needing a building identity, and stops at the next building across the street.
 *
 * Pure + unit-tested; the renderer supplies each roof's covered cells and applies the result.
 */

// ── how transparent a reveal tile draws ───────────────────────────────────────────────────────────────────
// Three bands. FAR is solid — a building you are nowhere near is a building, not a ghost. APPROACH eases it
// translucent so you can read the facade and find its door (Alexander: "would I know that there's a door in a
// building if I can't see it?"). INSIDE is the deep reveal — the roof comes off (handled by revealedRoofs) and
// the shell drops back so the room reads.
// Widened 2026-09-08 (Alexander, Image #7): *"the roof should start getting transparent earlier, my
// character is super close to the door and still can't see it correctly due to the range of the
// transparency"*. At 6 / 2.5 the fade only BEGAN six cells out and did not reach its most transparent until
// 2.5 — so walking up to a door you were still climbing the ramp, and the roof was ~0.6 opaque right where
// you needed to see through it. The bands are the same shape; the range they act over is roughly doubled,
// so by the time the door is in reach the roof is already at its clearest.
export const APPROACH_RADIUS = 12       // beyond this the building is fully solid
export const APPROACH_NEAR = 5          // within this it holds FLAT at its most transparent — being near a
                                        // building has to be an unmistakable change, not a few percent
export const APPROACH_ALPHA = 0.35      // the close band: clearly see-through, so a door on the FAR face reads
export const INTERIOR_SHELL_ALPHA = 0.15 // standing INSIDE: the shell all but disappears so the interior reads

const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/**
 * The opacity a reveal tile draws at. `minAlpha` is the tile's OWN floor — a per-tile backend SETTING, so the
 * DOOR stays opaque and obvious while the wall around it fades (no tile-name conditional in the renderer).
 * It only ever makes a tile MORE opaque, never less.
 */
export function revealAlpha({ dist, inside, minAlpha = 0 }: { dist: number; inside: boolean; minAlpha?: number }): number {
  // A PLATEAU then an ease-out, not one long ramp. The old single smoothstep over the whole radius meant a hero
  // four cells from a wall got ~0.96 alpha — no visible change at all, which is why the reveal "didn't trigger"
  // (Alexander, Image #9). Inside APPROACH_NEAR it sits flat at its most transparent; from there it climbs back
  // to solid by APPROACH_RADIUS.
  const band = inside
    ? INTERIOR_SHELL_ALPHA
    : dist >= APPROACH_RADIUS
      ? 1
      : dist <= APPROACH_NEAR
        ? APPROACH_ALPHA
        : APPROACH_ALPHA + (1 - APPROACH_ALPHA) * smoothstep((dist - APPROACH_NEAR) / (APPROACH_RADIUS - APPROACH_NEAR))
  return Math.max(band, Math.min(1, minAlpha))
}

/** The 8-neighbourhood of a `col,row` key, plus the cell itself — "touches" for roof grouping. */
function touching(key: string): string[] {
  const [col, row] = key.split(',').map(Number)
  const out: string[] = []
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) out.push(`${col + dc},${row + dr}`)
  return out
}

/**
 * The indices of the roof blocks to reveal, given the hero's cell and each roof block's covered footprint
 * (`col,row` keys). Empty when the hero stands under no roof — outside, every roof is fully drawn.
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
 * The SHELL of the revealed building: the cells its lifted roof covers plus the ring around them — i.e. the
 * walls, windows and doors standing under and around that roof. A `fadeNear` tile in this set eases translucent
 * so the interior is actually visible once the roof is off; every tile outside it keeps its full opacity.
 */
export function revealedShell(roofs: readonly (readonly string[])[], revealed: ReadonlySet<number>): Set<string> {
  const shell = new Set<string>()
  for (const i of revealed) for (const cell of roofs[i]) for (const near of touching(cell)) shell.add(near)
  return shell
}

/**
 * Terrain autotile labels — the missing half of the "label EVERYTHING" tileset standard.
 *
 * Trees and building footprints already carry 9-piece autotile labels (cellLabels.ts). Terrain did
 * NOT: a grass/water/path cell had no positional label, so the ground was un-swappable — you could
 * not tell a GRASS TOP-LEFT corner tile from a GRASS INTERIOR fill tile. This module closes that gap
 * by running the SAME autotile scheme over the ground grid: each cell is part of its terrain-KIND
 * mass, and its POSITION (TOP-LEFT / TOP / … / INTERIOR) comes from which orthogonal neighbours are
 * a DIFFERENT kind (an open edge). Pure logic — no rendering, no grid mutation.
 *
 * The label is `<TERRAIN> <POSITION>` (e.g. `GRASS TOP-LEFT`, `WATER INTERIOR`, `PATH BOTTOM`), the
 * SAME `<TYPE> <POSITION>` shape buildings/trees use — one consistent vocabulary across every cell,
 * which is what the tile-replacement pass keys on.
 */
import { autotilePosition } from './cellLabels'
import { groundKind } from '@/game/artStyle'

type Ground = readonly (readonly string[])[]

/** The terrain KIND at (col,row) as an uppercase TYPE token, or null when out of bounds. */
function kindAt(ground: Ground, col: number, row: number): string | null {
  const tile = ground[row]?.[col]
  if (tile == null) return null
  return groundKind(tile)
}

/**
 * The full autotile label for one ground cell: `<TERRAIN> <POSITION>`. A cell is part of its own
 * terrain KIND's mass; a neighbour of a DIFFERENT kind (or off-grid) is an OPEN side, so a grass
 * cell bordering a path reads GRASS <edge>, a fully-surrounded grass cell reads GRASS INTERIOR.
 */
export function terrainLabelAt(ground: Ground, col: number, row: number): string {
  const kind = kindAt(ground, col, row)
  if (kind == null) return ''
  const sameKind = (c: number, r: number): boolean => kindAt(ground, c, r) === kind
  return `${kind.toUpperCase()} ${autotilePosition(sameKind, col, row)}`
}

/** One `<TERRAIN> <POSITION>` caption per ground cell — the terrain half of the debug overlay, so
 *  EVERY cell (not just asset cells) shows its tileset label. */
export function terrainCaptions(ground: Ground): { col: number; row: number; label: string }[] {
  const out: { col: number; row: number; label: string }[] = []
  for (let row = 0; row < ground.length; row++) {
    const line = ground[row] ?? []
    for (let col = 0; col < line.length; col++) {
      out.push({ col, row, label: terrainLabelAt(ground, col, row) })
    }
  }
  return out
}

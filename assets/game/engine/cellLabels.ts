/**
 * Cell-label vocabulary + per-label rules — the KEYSTONE for ASCII → tileset.
 *
 * Every cell an asset occupies carries a descriptive LABEL naming its part
 * (`tree_stem_bottom`, `tree_leaf_top`, `tree_top_left`, `roof_top`, `door`, …).
 * Two things hang off that label:
 *   1. PER-LABEL COLLISION (`isWalkable`) — the label, not the asset, decides if
 *      a cell blocks. A tree's canopy top is walkable (you walk *under* it), the
 *      trunk and leaves block; a building's top roof tile and doors are walkable,
 *      the rest blocks. (See project-nebulith-collision-model.)
 *   2. RENDER GLYPH + COLOR — owned by the TILESET (cellTileset.ts), not here. A
 *      label's appearance (and, downstream, the real tile chosen when ASCII is
 *      replaced by art) is presentation; this module is pure semantics.
 *
 * Tree/building MASSES are labeled by AUTOTILING: each filled cell gets a 9-piece
 * edge/corner/interior label from its 8-neighbour neighbourhood (grammar spec
 * `_tl _t _tr _l _c _r _bl _b _br`). Pure logic — no rendering, no grid mutation.
 */

// ── label vocabulary (single source of truth) ──────────────────────────
// Vertical single-column tree (trunk + canopy stack): bottom→top.
// `tree_crown` is the SOLID foliage cap of a standalone tree (it blocks — the
// whole tree is impassable). `tree_leaf_top` is reserved (still walkable) for a
// future overhead-canopy layer but is not emitted by the generator. `tree_snag`
// is a dead/bare trunk top (a burnt or frozen stem); it blocks like any trunk.
const TREE_COLUMN_LABELS = ['tree_stem_bottom', 'tree_stem', 'tree_leaf', 'tree_crown', 'tree_leaf_top', 'tree_snag'] as const

// 9-piece tree-mass labels (autotiled forest canopy).
const TREE_MASS_LABELS = [
  'tree_top_left',
  'tree_top',
  'tree_top_right',
  'tree_edge_left',
  'tree_interior',
  'tree_edge_right',
  'tree_bottom_left',
  'tree_bottom',
  'tree_bottom_right',
] as const

// Building parts.
const BUILDING_LABELS = ['roof_top', 'roof', 'wall', 'door', 'window'] as const

// Biome terrain FEATURES that anchor a hazard lake: a mountain massif (`mountain`
// slope + `peak` crown — a glowing crater in lava) and the `spill` that connects
// it to the water (a lava flow into a lava lake, a waterfall into a water/ice
// lake). All block movement.
const FEATURE_LABELS = ['mountain', 'peak', 'spill'] as const

export const CELL_LABELS = [...TREE_COLUMN_LABELS, ...TREE_MASS_LABELS, ...BUILDING_LABELS, ...FEATURE_LABELS] as const

export type CellLabel = (typeof CELL_LABELS)[number]

// ── per-label collision ────────────────────────────────────────────────
// The ONLY walkable cells: a tree's canopy top (walk under it) and a building's
// top roof tile + doors. Everything else — and anything unknown — blocks
// (fail-safe). Membership lookup, not an if/else chain.
const WALKABLE_LABELS: ReadonlySet<string> = new Set<CellLabel>(['tree_leaf_top', 'roof_top', 'door'])

export function isWalkable(label: string): boolean {
  return WALKABLE_LABELS.has(label)
}

// ── autotile labeler (9-piece corner/edge/interior) ────────────────────
// Each filled cell is labeled from its neighbourhood: a corner/edge piece is
// determined by which orthogonal sides are OPEN (not part of the mass); a fully
// surrounded cell is interior — the standard 9-piece blob scheme.
/**
 * A label FAMILY: the 9 edge/corner/interior labels for one mass material.
 * Re-usable so tree masses (and later building roofs, water, …) share one
 * autotile algorithm — Open/Closed: add a family, not a new branch.
 */
export interface MassFamily {
  topLeft: CellLabel
  top: CellLabel
  topRight: CellLabel
  edgeLeft: CellLabel
  interior: CellLabel
  edgeRight: CellLabel
  bottomLeft: CellLabel
  bottom: CellLabel
  bottomRight: CellLabel
}

export const TREE_MASS_FAMILY: MassFamily = {
  topLeft: 'tree_top_left',
  top: 'tree_top',
  topRight: 'tree_top_right',
  edgeLeft: 'tree_edge_left',
  interior: 'tree_interior',
  edgeRight: 'tree_edge_right',
  bottomLeft: 'tree_bottom_left',
  bottom: 'tree_bottom',
  bottomRight: 'tree_bottom_right',
}

/** Is the cell part of the mass? Out-of-bounds is treated as NOT filled (an edge). */
type Filled = (col: number, row: number) => boolean

// 4-bit open-side signature → 9-piece slot. Bits: top|right|bottom|left
// (1 = that side is OPEN / not part of the mass). The table is EXHAUSTIVE over
// all 16 signatures so labeling is a pure lookup — no fallback branching. Thin /
// lone masses (3-4 open sides) collapse onto the nearest outer corner so they
// still read as edge pieces, never (wrongly) interior.
const OPEN_TOP = 0b1000
const OPEN_RIGHT = 0b0100
const OPEN_BOTTOM = 0b0010
const OPEN_LEFT = 0b0001

const SLOT_BY_SIGNATURE: Readonly<Record<number, keyof MassFamily>> = {
  [0]: 'interior',
  [OPEN_TOP]: 'top',
  [OPEN_BOTTOM]: 'bottom',
  [OPEN_LEFT]: 'edgeLeft',
  [OPEN_RIGHT]: 'edgeRight',
  [OPEN_TOP | OPEN_LEFT]: 'topLeft',
  [OPEN_TOP | OPEN_RIGHT]: 'topRight',
  [OPEN_BOTTOM | OPEN_LEFT]: 'bottomLeft',
  [OPEN_BOTTOM | OPEN_RIGHT]: 'bottomRight',
  // 2 OPPOSITE open sides = a 1-wide strip (no dedicated 9-piece slot) → collapse
  // to a cap/edge piece so it still blocks and reads as part of the mass.
  [OPEN_LEFT | OPEN_RIGHT]: 'top', // vertical strip (tree above & below)
  [OPEN_TOP | OPEN_BOTTOM]: 'edgeLeft', // horizontal strip (tree left & right)
  // 3+ open sides (thin/lone) → nearest outer corner by the open vertical+horizontal side.
  [OPEN_TOP | OPEN_LEFT | OPEN_RIGHT]: 'topLeft',
  [OPEN_TOP | OPEN_BOTTOM | OPEN_LEFT]: 'topLeft',
  [OPEN_BOTTOM | OPEN_LEFT | OPEN_RIGHT]: 'bottomLeft',
  [OPEN_TOP | OPEN_BOTTOM | OPEN_RIGHT]: 'topRight',
  [OPEN_TOP | OPEN_BOTTOM | OPEN_LEFT | OPEN_RIGHT]: 'topLeft',
}

function openSignature(filled: Filled, col: number, row: number): number {
  let sig = 0
  if (!filled(col, row - 1)) sig |= OPEN_TOP
  if (!filled(col + 1, row)) sig |= OPEN_RIGHT
  if (!filled(col, row + 1)) sig |= OPEN_BOTTOM
  if (!filled(col - 1, row)) sig |= OPEN_LEFT
  return sig
}

/**
 * Label one filled mass cell by its 4-orthogonal-neighbour openness — a pure
 * 16-entry table lookup (no branching). Corners win over single edges; a fully
 * enclosed cell is interior.
 */
export function autotileLabel(family: MassFamily, filled: Filled, col: number, row: number): CellLabel {
  // All 16 orthogonal signatures are mapped; '?? interior' is defensive so an
  // unmapped signature can never yield an undefined (label-less) cell.
  const slot = SLOT_BY_SIGNATURE[openSignature(filled, col, row)] ?? 'interior'
  return family[slot]
}

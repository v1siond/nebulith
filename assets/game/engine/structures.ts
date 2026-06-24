/**
 * Layered ASCII STRUCTURES (houses, cabins, towers) — each is a SINGLE-anchor sprite drawn
 * bottom-to-top like the loved tree, NOT a flat per-cell stamp. One asset, one blocking cell,
 * many rows of art. Pure data + lookups so placement/selection logic is unit-testable; the
 * renderer stacks `rows` from the ground up and shades the roof row (top) darker, the same way
 * the tree shades its canopy layers.
 */
export interface StructureDef {
  id: string
  name: string
  /** ASCII rows TOP→BOTTOM (roof first). The renderer draws them stacked, ground = last row. */
  rows: string[]
  /** wall/body color (the roof row is auto-darkened from this, like tree canopy shading). */
  color: string
  /** how many grid cells tall the sprite reads as, for the height offset (trees use ≈3). */
  heightTiles: number
}

export const STRUCTURES: readonly StructureDef[] = [
  { id: 'cabin', name: 'Cabin', rows: ['/===\\', '|[+]|', '|___|'], color: '#b07a4a', heightTiles: 3 },
  { id: 'house', name: 'House', rows: ['/^^^\\', '|o.o|', '|.+.|', '|___|'], color: '#c8a06a', heightTiles: 4 },
  { id: 'tower', name: 'Tower', rows: ['_^_', '|o|', '|=|', '|=|', '|+|'], color: '#9a9aa6', heightTiles: 5 },
]

/** Look up a structure by id (undefined when unknown). Pure. */
export const structureById = (id: string): StructureDef | undefined =>
  STRUCTURES.find(s => s.id === id)

/** The ground (bottom) row of a structure — where the door sits + collision anchors. Pure. */
export const structureGroundRow = (def: StructureDef): string =>
  def.rows[def.rows.length - 1] ?? ''

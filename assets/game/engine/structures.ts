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
  /** wall/body color. */
  color: string
  /** roof color (the top row); falls back to an auto-darkened wall if omitted. */
  roofColor?: string
  /** how many grid cells tall the sprite reads as, for the height offset (trees use ≈3). */
  heightTiles: number
}

export const STRUCTURES: readonly StructureDef[] = [
  { id: 'cabin', name: 'Cabin', rows: ['/===\\', '|o.o|', '|.+.|', '|___|'], color: '#c08a55', roofColor: '#9c3b2e', heightTiles: 4 },
  { id: 'house', name: 'House', rows: ['/^^^\\', '|o.o|', '|._.|', '|.+.|', '|___|'], color: '#cda569', roofColor: '#7a4630', heightTiles: 5 },
  { id: 'tower', name: 'Tower', rows: ['/^\\', '|#|', '|o|', '|#|', '|+|'], color: '#9aa0ac', roofColor: '#5b6470', heightTiles: 5 },
]

/** Look up a structure by id (undefined when unknown). Pure. */
export const structureById = (id: string): StructureDef | undefined =>
  STRUCTURES.find(s => s.id === id)

/** The ground (bottom) row of a structure — where the door sits + collision anchors. Pure. */
export const structureGroundRow = (def: StructureDef): string =>
  def.rows[def.rows.length - 1] ?? ''

/** Rows ordered GROUND→ROOF (bottom first) — the order the layered renderer stacks them. Pure. */
export const groundUpRows = (rows: readonly string[]): string[] => [...rows].reverse()

/** placeAsset options for dropping a structure as a single BLOCKING anchor cell. Pure —
 *  art carries the sprite rows; the 'structure' type routes it to the layered render path. */
export const structurePlacement = (
  def: StructureDef,
): { art: string[]; type: 'structure'; blocking: true; color: string; bgColor?: string } => ({
  art: [...def.rows],
  type: 'structure',
  blocking: true,
  color: def.color,
  bgColor: def.roofColor, // carried to the asset → distinct roof color in the renderer
})

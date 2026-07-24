import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * REPLACE-IN-PLACE — the "Replace tile" Inspector action (Image #15). The button reads "Replace tile" once a
 * cell holds a stacked tile, and the user's expectation is that picking a Library tile SWAPS the selected
 * tile IN PLACE — NOT paints a new one on top (the reported bug: Replace was stacking like the paint brush).
 *
 * replaceTileInPlace swaps the tile at the SELECTED stack slot for the picked tile — same slot, tiles above
 * and below untouched, stack height unchanged. A ground/terrain pick on the FLOOR slot swaps the ground; a
 * non-ground pick on the floor is refused (the caller stacks it instead — that's an "add", not a replace).
 */
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { tilesForStyle, type TileDef } from '@/game/artStyle'
import { stackAssetTile, replaceTileInPlace } from '@/game/editor/tileBrush'

const EMOJI = tilesForStyle('emoji')
const byId = (id: string): TileDef => {
  const t = Object.values(EMOJI).flat().find(x => x.id === id)
  if (!t) throw new Error(`tile ${id} not in the emoji catalog`)
  return t
}
const makeGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 32, isoScale: 1.4 })
const nonFloor = (g: IsometricGrid, col: number, row: number): GridAsset[] =>
  g.getAssetsAtCell(col, row).filter(a => a.type !== 'floor')

describe('replaceTileInPlace — swap the SELECTED stack tile in place (Replace, not stack)', () => {
  test('replacing the MIDDLE tile swaps ONLY it — stack height unchanged, tiles above and below survive', () => {
    const g = makeGrid()
    stackAssetTile(g, 1, 1, byId('emoji:pine-tree')) // getAssetsAtCell order → [floor(0), pine(1), oak(2), boulder(3)]
    stackAssetTile(g, 1, 1, byId('emoji:oak-tree'))
    stackAssetTile(g, 1, 1, byId('emoji:boulder'))
    const before = g.getAssetsAtCell(1, 1).length

    const ok = replaceTileInPlace(g, 1, 1, 2, byId('emoji:rock')) // slot 2 = the oak (the selected tile)
    expect(ok).toBe(true)
    expect(g.getAssetsAtCell(1, 1).length).toBe(before) // STACK HEIGHT UNCHANGED — nothing stacked

    const stack = g.getAssetsAtCell(1, 1)
    expect(stack[1].tileOverride).toBe('emoji:pine-tree') // below survives
    expect(stack[2].tileOverride).toBe('emoji:rock')     // the selected slot is now the picked tile
    expect(stack[2].type).toBe('rock')                    // identity swapped, not just the visual
    expect(stack[3].tileOverride).toBe('emoji:boulder')   // above survives
  })

  test('the swapped tile adopts the NEW tile’s own block height (DATA) while keeping its slot / heightLevel', () => {
    const g = makeGrid()
    stackAssetTile(g, 2, 2, byId('emoji:pine-tree')) // slot 1
    stackAssetTile(g, 2, 2, byId('emoji:rose'))      // slot 2 (the selected tile)
    const oldLevel = g.getAssetsAtCell(2, 2)[2].heightLevel

    replaceTileInPlace(g, 2, 2, 2, { ...byId('emoji:rose'), height: 3 }) // synthetic height proves the read
    const a = g.getAssetsAtCell(2, 2)[2]
    expect(a.height).toBe(3)               // adopts the picked tile's OWN height DATA
    expect(a.heightLevel).toBe(oldLevel)   // same slot — nothing restacked
  })

  test('does NOT stack — the reported bug: Replace used the paint path and added a tile on top', () => {
    const g = makeGrid()
    stackAssetTile(g, 3, 3, byId('emoji:pine-tree')) // one non-floor tile at slot 1
    replaceTileInPlace(g, 3, 3, 1, byId('emoji:rock'))
    const placed = nonFloor(g, 3, 3)
    expect(placed).toHaveLength(1)                    // still ONE tile — swapped, not stacked
    expect(placed[0].tileOverride).toBe('emoji:rock')
  })

  test('replacing the FLOOR slot with a terrain tile swaps the GROUND (setGround), never stacks', () => {
    const g = makeGrid() // the ctor fills a grass floor at slot 0
    const ok = replaceTileInPlace(g, 4, 4, 0, byId('emoji:deep-water'))
    expect(ok).toBe(true)
    expect(g.groundAt(4, 4)).toBe('deep-water')
    expect(nonFloor(g, 4, 4)).toHaveLength(0) // no stacked tile added — the ground was swapped in place
  })

  test('replacing the FLOOR slot with a NON-terrain tile is REFUSED (false) — the caller stacks it instead', () => {
    const g = makeGrid()
    expect(replaceTileInPlace(g, 5, 5, 0, byId('emoji:rock'))).toBe(false)
    expect(nonFloor(g, 5, 5)).toHaveLength(0) // untouched — replaceTileInPlace made no change
  })

  test('returns false when no tile sits at the selected slot (nothing to replace)', () => {
    const g = makeGrid()
    expect(replaceTileInPlace(g, 0, 0, 5, byId('emoji:rock'))).toBe(false)
  })
})

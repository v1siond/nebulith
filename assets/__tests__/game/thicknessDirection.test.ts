/**
 * THE THICKNESS AXIS IS THE HOUSE'S, NOT THE VIEWER'S.
 *
 * Alexander: "I want to ensure the doors are less tick while facing the direction of their logical front,
 * IE: the ISO direction — but here it's only applied viewing to MY front, not the front of the house."
 *
 * For that to hold, `thicknessDir` has to survive the two rotations that stand between an authored tile and
 * the pixels, exactly as `depthDir` already does:
 *
 *   1. the BUILDING's rotation, applied when a composition is stamped (a house facing east has its doors
 *      thin toward east), and
 *   2. the CAMERA's facing, applied at render time (turning the camera must not re-thin the door).
 *
 * …and it has to round-trip through save/load, or a reloaded map loses the axis and every door goes back to
 * being a cube.
 */
import { compositionCellRender } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { serializeGrid, deserializeToGrid } from '@/lib/api'
import { replaceTileInPlace, stackAssetTile } from '@/game/editor/tileBrush'
import { rotateDepthDir } from '@/engine/render/isoBlock'
import type { TileDef } from '@/game/artStyle'

const tileWith = (settings?: Record<string, unknown>): TileDef => ({
  id: 'door',
  label: 'door',
  category: 'doors',
  styleId: 'emoji',
  visual: { kind: 'image', image: '/tiles/emoji/door.png', color: '#5a3a22' },
  height: 1,
  settings,
} as unknown as TileDef)

// The backend's authoring SHORTHAND: "0.3 thick, hugging the +col face" → reach 0.3 the other way.
const DOOR = tileWith({ scaleZ: 0.3, thicknessDir: 'right-down' })
const HUGGED = 'left-up' as const // the reach the shorthand actually sets
const PLAIN = tileWith({ color: '#9e4b3b' })

const grid = () => new IsometricGrid({ cols: 4, rows: 4, cellSize: 16, isoScale: 2.5 })
const topAsset = (g: IsometricGrid, col = 1, row = 1) => {
  const stack = g.getAssetsAtCell(col, row)
  return stack[stack.length - 1]
}

describe('a painted tile carries its authored thickness axis', () => {
  it('paints the door with both the amount and the direction', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, DOOR)
    expect(topAsset(g).scaleZ).toBe(0.3)
    expect(topAsset(g).thickness).toEqual({ [HUGGED]: 0.3 })
  })

  it('a tile with thickness but NO direction keeps the legacy behaviour — amount only', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, tileWith({ scaleZ: 0.3 }))
    expect(topAsset(g).scaleZ).toBe(0.3)
    expect(topAsset(g).thickness).toBeUndefined() // amount alone → the legacy screen squash, no world axis
  })

  it('rejects a direction that is not one of the four iso diagonals', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, tileWith({ scaleZ: 0.3, thicknessDir: 'sideways' }))
    expect(topAsset(g).thickness).toBeUndefined()
  })

  it('replacing a tile swaps the axis, and CLEARS it when the new tile has none', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, PLAIN)
    const i = g.getAssetsAtCell(1, 1).length - 1
    replaceTileInPlace(g, 1, 1, i, DOOR)
    expect(topAsset(g).thickness).toEqual({ [HUGGED]: 0.3 })
    replaceTileInPlace(g, 1, 1, i, PLAIN)
    expect(topAsset(g).thickness).toBeUndefined()
  })
})

describe('a stamped composition rotates the axis with the BUILDING', () => {
  const comp = { key: 'house_4', cells: [], footprintW: 1, footprintH: 1 } as never
  const cell = (over: Record<string, unknown> = {}) => ({ dx: 0, dy: 0, level: 0, label: 'door', ...over }) as never
  const tile = (settings?: Record<string, unknown>) => ({ settings } as never)

  it('an unrotated house keeps the authored axis', () => {
    const render = compositionCellRender(comp, cell(), tile({ scaleZ: 0.3, thicknessDir: 'right-down' }), 1, 0)
    expect(render.thickness).toEqual({ [HUGGED]: 0.3 })
  })

  it.each([1, 2, 3])('a house rotated %i quarter-turn(s) turns its doors with it', rotation => {
    const render = compositionCellRender(comp, cell(), tile({ scaleZ: 0.3, thicknessDir: 'right-down' }), 1, rotation)
    expect(render.thickness).toEqual({ [rotateDepthDir(HUGGED, rotation as 0 | 1 | 2 | 3)]: 0.3 })
  })

  it('an explicit per-cell axis wins over the tile default, and rotates too', () => {
    // A per-cell override rides `cell.settings`, the same place `scaleZ`/`scaleY` overrides live.
    const render = compositionCellRender(
      comp,
      cell({ settings: { thickness: { 'right-up': 0.4 } } }),
      tile({ scaleZ: 0.3, thicknessDir: 'right-down' }),
      1,
      1,
    )
    expect(render.thickness).toEqual({ [rotateDepthDir('right-up', 1)]: 0.4 })
  })

  it('a tile with no axis stamps without one', () => {
    expect(compositionCellRender(comp, cell(), tile({ scaleZ: 0.3 }), 1, 2).thickness).toBeUndefined()
  })
})

describe('the axis survives save and load — a reloaded map keeps its thin doors', () => {
  /** serialize → the Postgres JSON column → deserialize, exactly as a template save/load does. */
  const hydrate = (g: IsometricGrid) => {
    const wire = JSON.parse(JSON.stringify(serializeGrid(g)))
    return deserializeToGrid({
      cols: 4, rows: 4, cellSize: 16, isoScale: 2.5,
      groundData: g.groundSlugs(), heightData: g.height, assetsData: wire.assetsData,
    } as unknown as Parameters<typeof deserializeToGrid>[0])
  }

  it('round-trips the amount AND the axis', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, DOOR)
    const back = topAsset(hydrate(g))
    expect(back.scaleZ).toBe(0.3)
    expect(back.thickness).toEqual({ [HUGGED]: 0.3 })
  })

  it('a tile with no axis round-trips without inventing one', () => {
    const g = grid()
    stackAssetTile(g, 1, 1, PLAIN)
    expect(topAsset(hydrate(g)).thickness).toBeUndefined()
  })
})

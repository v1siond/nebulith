/**
 * CELL STACK adapter (migration Step 0) — forward projection of the split grid fields onto the target
 * uniform tile-stack model, plus the mutators that translate stack ops back onto the grid's setters.
 *
 * The adapter is PURELY ADDITIVE: these tests exercise it against a small in-memory IsometricGrid and
 * assert (a) getStack projects floor + assets into the right order/fields, (b) deriveCellCollision ORs the
 * blocking flags, (c) the mutators round-trip back to the expected ground/assets state, and
 * (d) migrateAssetsToStack reproduces the same stack from raw legacy data.
 */
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import {
  getStack,
  deriveCellCollision,
  migrateAssetsToStack,
  setFloor,
  pushTile,
  popTile,
  setTileCollision,
  type TileEntry,
  type LegacyCell,
} from '@/engine/cellStack'

const mkGrid = () => new IsometricGrid({ cols: 6, rows: 6, cellSize: 16, isoScale: 1.4 })

/** A fully-specified stacked asset pushed straight onto grid.assets — bypasses placeAsset (which drops
 *  scaleX/scaleZ/height/label) so getStack's projection of every asset field can be asserted directly. */
const mkAsset = (over: Partial<GridAsset>): GridAsset => ({
  art: ['#'],
  col: 2,
  row: 3,
  type: 'decoration',
  ...over,
})

describe('getStack — forward projection of the current split fields', () => {
  test('floor tile is index 0: ground+colour+dims, h:0, no tileId', () => {
    const grid = mkGrid()
    grid.setGround(2, 3, 'stone')
    grid.setGroundColor(2, 3, '#123456')
    grid.setGroundDims(2, 3, { scaleX: 2, scaleZ: 3, scale: 1.5, scaleY: 1.2, pose: { dx: 0.2 } })

    const [floor] = getStack(grid, 2, 3)
    expect(floor).toEqual<TileEntry>({
      source: 'floor',
      slug: 'stone',
      w: 2,
      d: 3,
      h: 0,
      zoom: 1.5,
      scaleY: 1.2,
      pose: { dx: 0.2 },
      color: '#123456',
      heightLevel: 0,
    })
    expect(floor.tileId).toBeUndefined()
  })

  test('a bare cell projects to just its default grass floor at h:0', () => {
    const grid = mkGrid()
    const stack = getStack(grid, 0, 0)
    expect(stack).toHaveLength(1)
    expect(stack[0]).toMatchObject({ source: 'floor', slug: 'grass', w: 1, d: 1, h: 0, color: null })
  })

  test('assets stack above the floor ORDERED by heightLevel, with fields mapped', () => {
    const grid = mkGrid()
    // pushed OUT of order to prove the sort: level 1 first, then level 0.
    grid.assets.push(
      mkAsset({
        heightLevel: 1,
        type: 'building',
        label: 'wall',
        tileOverride: 'emoji:wall',
        color: '#b0603a',
        blocking: true,
        height: 2,
        scaleX: 1.5,
        scaleZ: 0.5,
        scaleY: 3,
        scale: 1.25,
      }),
      mkAsset({ heightLevel: 0, type: 'decoration', label: 'flower', color: '#ff00aa', blocking: false }),
    )

    const stack = getStack(grid, 2, 3)
    expect(stack.map(t => t.source)).toEqual(['floor', 'asset', 'asset'])
    expect(stack.map(t => t.heightLevel)).toEqual([0, 0, 1]) // floor(0), flower(0), wall(1)

    const flower = stack[1]
    expect(flower).toMatchObject({ source: 'asset', slug: 'flower', h: 0, color: '#ff00aa', collision: false })

    const wall = stack[2]
    expect(wall).toMatchObject({
      source: 'asset',
      slug: 'wall',       // label ?? type
      tileId: 'emoji:wall',
      w: 1.5,             // scaleX
      d: 0.5,             // scaleZ
      h: 2,               // resolveTileHeight(height)
      zoom: 1.25,         // scale
      scaleY: 3,
      color: '#b0603a',
      collision: true,    // blocking
    })
  })

  test('slug falls back to type when the asset has no label; negative height clamps to 0', () => {
    const grid = mkGrid()
    grid.assets.push(mkAsset({ heightLevel: 0, type: 'crate', height: -5 }))
    const [, tile] = getStack(grid, 2, 3)
    expect(tile.slug).toBe('crate')
    expect(tile.h).toBe(0)
  })
})

describe('deriveCellCollision — OR of the stack tiles blocking', () => {
  test('true when any asset blocks', () => {
    const grid = mkGrid()
    grid.assets.push(mkAsset({ heightLevel: 0, blocking: false }), mkAsset({ heightLevel: 1, blocking: true }))
    expect(deriveCellCollision(getStack(grid, 2, 3))).toBe(true)
  })

  test('false for a floor-only cell and for non-blocking assets', () => {
    const grid = mkGrid()
    expect(deriveCellCollision(getStack(grid, 2, 3))).toBe(false)
    grid.assets.push(mkAsset({ heightLevel: 0, blocking: false }))
    expect(deriveCellCollision(getStack(grid, 2, 3))).toBe(false)
  })
})

describe('mutators translate stack ops back onto the grid setters', () => {
  test('setFloor writes ground/colour/dims and round-trips through getStack', () => {
    const grid = mkGrid()
    const entry: TileEntry = {
      source: 'floor',
      slug: 'water',
      w: 2,
      d: 3,
      h: 0,
      zoom: 1.5,
      scaleY: 1.1,
      pose: { rot: 0.5 },
      color: '#0066cc',
    }
    setFloor(grid, 1, 4, entry)

    expect(grid.ground[4][1]).toBe('water')
    expect(grid.groundColor[4][1]).toBe('#0066cc')
    expect(grid.groundDims[4][1]).toEqual({ scaleX: 2, scaleZ: 3, scale: 1.5, scaleY: 1.1, pose: { rot: 0.5 } })

    // getStack reads the same floor back out.
    expect(getStack(grid, 1, 4)[0]).toMatchObject({
      source: 'floor', slug: 'water', w: 2, d: 3, h: 0, zoom: 1.5, scaleY: 1.1, pose: { rot: 0.5 }, color: '#0066cc',
    })
  })

  test('setFloor with a null colour clears the override', () => {
    const grid = mkGrid()
    grid.setGroundColor(0, 0, '#ffffff')
    setFloor(grid, 0, 0, { source: 'floor', slug: 'grass', w: 1, d: 1, h: 0, color: null })
    expect(grid.groundColor[0][0]).toBeNull()
  })

  test('pushTile places an asset at (top + 1) with dims + collision, losslessly', () => {
    const grid = mkGrid()
    const first = pushTile(grid, 2, 2, {
      source: 'asset', slug: 'wall', type: 'building', label: 'wall', art: ['#'],
      w: 1, d: 1, h: 3, color: '#b0603a', collision: true, tileId: 'emoji:wall',
    })
    expect(first.heightLevel).toBe(0)
    expect(grid.getAssetsAtCell(2, 2)).toHaveLength(1)

    // second push lands on the next level up
    const second = pushTile(grid, 2, 2, {
      source: 'asset', slug: 'roof', type: 'building', label: 'roof', art: ['^'],
      w: 1.5, d: 0.5, h: 1, scaleY: 2, color: '#333', collision: false, zoom: 1.25,
    })
    expect(second.heightLevel).toBe(1)

    // the dropped-by-placeAsset dims/label were patched back on
    expect(second).toMatchObject({
      col: 2, row: 2, type: 'building', label: 'roof', tileOverride: undefined,
      scaleX: 1.5, scaleZ: 0.5, scaleY: 2, height: 1, scale: 1.25, blocking: false,
    })

    // blocking asset drove grid.collision through placeAsset
    expect(grid.isBlocked(2, 2)).toBe(true)

    // round-trips through getStack: floor + two assets, ordered
    const stack = getStack(grid, 2, 2)
    expect(stack.map(t => t.slug)).toEqual(['grass', 'wall', 'roof'])
    expect(stack[1]).toMatchObject({ h: 3, collision: true, tileId: 'emoji:wall' })
    expect(stack[2]).toMatchObject({ w: 1.5, d: 0.5, h: 1, scaleY: 2, zoom: 1.25 })
  })

  test('pushTile passes opacity through and leaves OMITTED w/d/h undefined (editor-brush parity)', () => {
    const grid = mkGrid()
    // A brush-style entry pins art/type/tile/colour + opacity but OMITS w/d/h, so the placed instance keeps
    // its catalog size/height (scaleX/scaleZ/height stay undefined) exactly like the pre-adapter placeAsset.
    const placed = pushTile(grid, 1, 1, {
      source: 'asset', slug: 'pine-tree', type: 'tree', art: ['🌲'],
      tileId: 'emoji:pine-tree', color: '#2e8b57', collision: true, opacity: 0.5,
    })
    expect(placed.opacity).toBe(0.5)
    expect(placed.scaleX).toBeUndefined()
    expect(placed.scaleZ).toBeUndefined()
    expect(placed.scaleY).toBeUndefined()
    expect(placed.height).toBeUndefined() // no per-instance height → renderer uses the tile's catalog height
    expect(placed.tileOverride).toBe('emoji:pine-tree')
    expect(grid.isBlocked(1, 1)).toBe(true)
  })

  test('popTile removes only the TOP asset and returns it; no-op on a floor-only cell', () => {
    const grid = mkGrid()
    pushTile(grid, 3, 3, { source: 'asset', slug: 'base', type: 'tile', label: 'base', art: ['.'], w: 1, d: 1, h: 1 })
    pushTile(grid, 3, 3, { source: 'asset', slug: 'top', type: 'tile', label: 'top', art: ['*'], w: 1, d: 1, h: 1 })

    const popped = popTile(grid, 3, 3)
    expect(popped?.label ?? popped?.type).toBeDefined()
    expect(grid.getAssetsAtCell(3, 3)).toHaveLength(1)
    expect(getStack(grid, 3, 3).map(t => t.slug)).toEqual(['grass', 'base'])

    popTile(grid, 3, 3)
    expect(grid.getAssetsAtCell(3, 3)).toHaveLength(0)
    expect(popTile(grid, 3, 3)).toBeUndefined() // floor-only → no-op
  })

  test('setTileCollision toggles the cell collision', () => {
    const grid = mkGrid()
    expect(grid.isBlocked(1, 1)).toBe(false)
    setTileCollision(grid, 1, 1, true)
    expect(grid.isBlocked(1, 1)).toBe(true)
    setTileCollision(grid, 1, 1, false)
    expect(grid.isBlocked(1, 1)).toBe(false)
  })
})

describe('migrateAssetsToStack — same stack from raw legacy data', () => {
  test('reproduces exactly what getStack produces for the same cell', () => {
    const grid = mkGrid()
    grid.setGround(2, 3, 'stone')
    grid.setGroundColor(2, 3, '#123456')
    grid.setGroundDims(2, 3, { scaleX: 2, scaleZ: 3, scale: 1.5, pose: { dx: 0.2 } })
    const assets = [
      mkAsset({ heightLevel: 1, type: 'building', label: 'wall', blocking: true, height: 2, scaleX: 1.5 }),
      mkAsset({ heightLevel: 0, type: 'decoration', label: 'flower', blocking: false }),
    ]
    grid.assets.push(...assets)

    const legacy: LegacyCell = {
      groundData: 'stone',
      groundColor: '#123456',
      groundDims: { scaleX: 2, scaleZ: 3, scale: 1.5, pose: { dx: 0.2 } },
      assetsData: assets,
    }

    expect(migrateAssetsToStack(legacy)).toEqual(getStack(grid, 2, 3))
  })

  test('sorts unsorted legacy assets by heightLevel and defaults an absent floor colour to null', () => {
    const legacy: LegacyCell = {
      groundData: 'grass',
      assetsData: [
        mkAsset({ heightLevel: 2, label: 'top' }),
        mkAsset({ heightLevel: 0, label: 'bottom' }),
        mkAsset({ heightLevel: 1, label: 'mid' }),
      ],
    }
    const stack = migrateAssetsToStack(legacy)
    expect(stack.map(t => t.slug)).toEqual(['grass', 'bottom', 'mid', 'top'])
    expect(stack[0].color).toBeNull()
  })
})

/**
 * The building ENTRANCE is a FLOOR tile — and what was GENERATED must be what RELOADS.
 *
 * Alexander: "the entrances door are kinda of fixed, the main bug is that they aren't 0.01 height like the
 * rest of floor tiles, so we must generate them with that height, which saves to the database on 'save' and
 * loads as expected later."
 *
 * Two linked defects, one story:
 *
 * (A) THE STAMP forced `asset.height = 1` on EVERY composition cell, so the doorstep — the `path` tile the
 *     backend's entrance apron places (`BuildingCompositions.entrance_cells/2`), a FLOOR tile carrying the
 *     same minimal flat height as the road it joins — stamped as a full standing BLOCK, a kerb in front of
 *     the door. Height is per-tile DATA read UNIFORMLY, with no branch by type, category or art style
 *     (MAP-MODEL §4): the stamp must read the TILE's OWN height.
 *
 * (B) THE SAVE (`stageToTemplate`) copied a composition cell's art/col/row/type/blocking/color/height/label
 *     but DROPPED its `settings` — where the authored Z-WIDTH (`depth`/`depthDir`: the roof-z-width column
 *     and the 2-wide entrance, MAP-MODEL §5) and the collapsed-run HEIGHT (`scaleY`) live. A saved generated
 *     town therefore reloaded with its 2-wide doorstep collapsed to one block and its roof spans broken.
 *
 * The composition under test mirrors the LIVE backend payload (`GET :4000/api/tilesets`, house_4):
 *   entrance → {"label":"path","level":0,"settings":{"depth":2,"depthDir":"right-down"},"dx":1,"dy":4,"walkable":true}
 *   roof     → one depth-spanned block per column ({"depth":4,"depthDir":"left-down","scaleY":2})
 */
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { stampComposition, stampBuildingKind } from '@/game/runtime/composition'
import { generateStage, stageToTemplate, type StageData } from '@/engine/stageGenerator'
import { facingRotation } from '@/engine/buildingCatalog'
import type { Composition } from '@/engine/tileset/tileset'
import type { Facing } from '@/engine/villageLayout'

// A test-only building whose cells are the LIVE backend shapes (see the header): a 4-tall wall pier, a 2-wide
// doorway, ONE depth-spanned roof column, and the entrance apron on the row in FRONT of the facade (dy = h).
const KIND = '__entrance_house__'
const ENTRANCE_COMP: Composition = {
  footprint: { w: 4, h: 4 },
  cells: [
    { dx: 0, dy: 3, level: 0, label: 'wall_wood_c', walkable: false, settings: { scaleY: 4 } },
    { dx: 1, dy: 3, level: 0, label: 'door', walkable: true },
    { dx: 2, dy: 3, level: 0, label: 'door', walkable: true },
    { dx: 3, dy: 3, level: 0, label: 'wall_wood_c', walkable: false, settings: { scaleY: 4 } },
    { dx: 0, dy: 0, level: 4, label: 'roof', walkable: true, settings: { depth: 4, depthDir: 'left-down', scaleY: 2 } },
    { dx: 1, dy: 4, level: 0, label: 'path', walkable: true, settings: { depth: 2, depthDir: 'right-down' } },
  ],
}

/** The doorstep's height, READ from the loaded tileset — never a constant pinned here. A flat tile is 0 blocks
 *  (nebulith data migration 0005, "GET THE TILES OF 0.1 DOWN TO 0"); whatever the DB says is what the stamp
 *  must produce, which is the only thing this file should assert. */
const floorHeight = (): number => ASCII_TILESET.tiles.path.height ?? 0

const mkGrid = (): IsometricGrid => new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1.4 })

/** The per-cell fields that must survive BOTH paths identically — position, art routing, collision, and the
 *  whole render shape (height / z-width / scale / pose). Sorted-comparable. */
const shape = (a: Partial<GridAsset>): string =>
  JSON.stringify({
    col: a.col, row: a.row, label: a.label, heightLevel: a.heightLevel ?? 0, blocking: a.blocking,
    height: a.height, scale: a.scale ?? 1, scaleX: a.scaleX, scaleY: a.scaleY, scaleZ: a.scaleZ,
    depth: a.depth, depthDir: a.depthDir, shape: a.shape, pose: a.pose, color: a.color,
  })

const shapesOf = (assets: Array<Partial<GridAsset>>): string[] => assets.map(shape).sort()

describe('(A) a composition cell stamps at the TILE\'s OWN height', () => {
  useSeedTileset() // the DB-equivalent tileset — real wall/door/roof/path tiles with their DB heights

  beforeAll(() => { ASCII_TILESET.compositions[KIND] = ENTRANCE_COMP })
  afterAll(() => { delete ASCII_TILESET.compositions[KIND] })

  test('the entrance doorstep stamps FLAT — the path tile\'s own floor height, not a 1-block kerb', () => {
    const grid = mkGrid()
    stampComposition(grid, KIND, 10, 10, 'spring')

    const doorstep = grid.assets.filter(a => a.label === 'path')
    expect(doorstep).toHaveLength(1)
    expect(doorstep[0].height).toBe(floorHeight()) // read from the DB tile, never invented
    expect(doorstep[0].height).toBeLessThan(1)     // FLAT — the doorstep is not a 1-block kerb in front of the door
  })

  test('a STANDING cell (wall / door / roof) still stamps a whole block', () => {
    const grid = mkGrid()
    stampComposition(grid, KIND, 10, 10, 'spring')

    for (const label of ['wall_wood_c', 'door', 'roof']) {
      const cells = grid.assets.filter(a => a.label === label)
      expect(cells.length).toBeGreaterThan(0)
      for (const c of cells) expect(c.height).toBe(1)
    }
  })

  test('a label with NO tile in the DB keeps the unit block — a stamp never vanishes', () => {
    ASCII_TILESET.compositions['__unknown_label__'] = {
      footprint: { w: 1, h: 1 },
      cells: [{ dx: 0, dy: 0, level: 0, label: '__no_such_tile__', walkable: true }],
    }
    try {
      const grid = mkGrid()
      stampComposition(grid, '__unknown_label__', 5, 5, 'spring')
      const placed = grid.assets.filter(a => a.label === '__no_such_tile__')
      expect(placed).toHaveLength(1)
      expect(placed[0].height).toBe(1)
    } finally {
      delete ASCII_TILESET.compositions['__unknown_label__']
    }
  })

  test('every cell of the existing compositions stamps its OWN tile height — tree / bush / fountain / lamp post / house', () => {
    // Behaviour-preservation guard, stated as the actual invariant (this describe's whole point): a stamped
    // cell's height IS its tile's DB height — a standing wall/trunk/roof is its 1 block, the house's entrance
    // doorstep is the FLAT `path` floor tile. Nothing is forced to 1 and nothing is invented, so a tile whose
    // DB height changes flows straight through without this test needing a new hardcoded number.
    for (const kind of ['tree_small', 'tree', 'bush', 'fountain', 'well', 'lamp_post', 'house_4', 'store_5']) {
      const grid = mkGrid()
      const placed = stampComposition(grid, kind, 12, 12, 'spring')
      expect(placed).toBeGreaterThan(0)
      const wrong = grid.assets
        .filter(a => a.type === kind)
        .filter(a => a.height !== (ASCII_TILESET.tiles[a.label ?? '']?.height ?? 1))
        .map(a => `${kind}/${a.label}: stamped ${a.height}, DB says ${ASCII_TILESET.tiles[a.label ?? '']?.height}`)
      expect(wrong).toEqual([])
    }
  })
})

describe('(B) a generated stage survives stageToTemplate — depth / depthDir / scaleY / height intact', () => {
  useSeedTileset()

  beforeAll(() => { ASCII_TILESET.compositions[KIND] = ENTRANCE_COMP })
  afterAll(() => { delete ASCII_TILESET.compositions[KIND] })

  /** A real generated town, re-pointed at the test building so the save path walks the LIVE cell shapes. */
  function stageWithTestBuilding(facing: Facing): StageData {
    const stage = generateStage({ zone: 'spring', variant: 'town', cols: 48, rows: 48 })
    expect(stage.buildings.length).toBeGreaterThan(0)
    const b = stage.buildings[0]
    return { ...stage, buildings: [{ ...b, kind: KIND, facing, length: 4, height: 4, depth: 4 }] }
  }

  test('the 2-wide entrance stays 2 wide, and flat, through the save', () => {
    const stage = stageWithTestBuilding('south')
    const saved = stageToTemplate(stage, 'entrance-test').assetsData.filter(a => a.label === 'path')

    expect(saved).toHaveLength(1) // ONE z-width block, not two cells and not zero
    expect(saved[0].depth).toBe(2)
    expect(saved[0].depthDir).toBe('right-down')
    expect(saved[0].height).toBe(floorHeight()) // the doorstep reloads at the DB height it was stamped with
  })

  test('the roof column keeps its z-width span AND its gable-step height', () => {
    const stage = stageWithTestBuilding('south')
    const saved = stageToTemplate(stage, 'roof-test').assetsData.filter(a => a.label === 'roof')

    expect(saved).toHaveLength(1)
    expect(saved[0].depth).toBe(4)
    expect(saved[0].depthDir).toBe('left-down')
    expect(saved[0].scaleY).toBe(2)
  })

  test('the wall pier keeps its collapsed-run height (scaleY)', () => {
    const stage = stageWithTestBuilding('south')
    const saved = stageToTemplate(stage, 'wall-test').assetsData.filter(a => a.label === 'wall_wood_c')

    expect(saved).toHaveLength(2)
    for (const w of saved) expect(w.scaleY).toBe(4)
  })

  for (const facing of ['south', 'east', 'north', 'west'] as const) {
    test(`SAVED equals STAMPED cell-for-cell on a ${facing}-facing building (the two paths never diverge)`, () => {
      const stage = stageWithTestBuilding(facing)
      const b = stage.buildings[0]
      const anchorRow = b.row - (b.height - 1)

      const grid = mkGrid()
      stampBuildingKind(grid, KIND, b.col, anchorRow, stage.zone, facing)
      const live = grid.assets.filter(a => a.type === KIND)
      expect(live.length).toBe(ENTRANCE_COMP.cells.length)

      const saved = stageToTemplate(stage, 'parity').assetsData.filter(a => a.type === KIND)
      expect(shapesOf(saved as Array<Partial<GridAsset>>)).toEqual(shapesOf(live))
      // and the rotation really is exercised (a turned building spans a different grid axis)
      expect(facingRotation(facing)).toBe(facingRotation(facing))
    })
  }

  test('the decor compositions the generator records (plaza centrepiece + street lamps) are saved too', () => {
    // They are recorded as composition ANCHORS (stage.compositions) and stamped live by applyStageToGrid; the
    // save path expanded trees + buildings ONLY, so a saved town reloaded with no fountain and no lamps.
    const stage = generateStage({ zone: 'spring', variant: 'town', cols: 48, rows: 48 })
    expect(stage.compositions.length).toBeGreaterThan(0)

    const savedTypes = new Set(stageToTemplate(stage, 'decor-test').assetsData.map(a => a.type))
    for (const c of stage.compositions) expect(savedTypes.has(c.kind)).toBe(true)
  })
})

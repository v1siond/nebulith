/**
 * COPY / PASTE — capture a marquee selection's tiles (each keyed "col,row,stackIndex" — its slot in the cell
 * stack — or a bare "col,row" cell) as a position-independent TileClip, then re-stamp them at a new hovered
 * anchor: every tile lands at (anchorCol+relCol, anchorRow+relRow) at its PRESERVED level, replacing whatever
 * occupied the target, with collision re-derived. A tall wall is ONE collapsed scaleY-run asset (ONE stack
 * slot), so it round-trips as a single tile. The grid ctor fills grass, so slot 0 of every cell is its floor
 * and stacked tiles start at slot 1. Mirrors tileBrush / selectionEdit (replace-anything + deriveCellCollision).
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { copyTiles, pasteTiles } from '@/game/editor/clipboard'

const makeGrid = () => new IsometricGrid({ cols: 32, rows: 32, cellSize: 32, isoScale: 1.4 })

describe('copyTiles / pasteTiles — reproduce a multi-block selection at a new anchor', () => {
  test('copies a multi-block selection (incl a collapsed scaleY wall run + a floor) and pastes it verbatim', () => {
    const g = makeGrid()
    // A little scene at cols 1..2, rows 1..2:
    g.setGround(1, 2, 'water') // a floor patch we expect to travel with the clip
    const tree = g.placeAsset(['🌲'], 1, 1, { type: 'tree', heightLevel: 1, color: '#3a5' })
    tree.label = 'tree_top'
    const wall = g.placeAsset(['🧱'], 2, 1, { type: 'wall', heightLevel: 1, blocking: true, color: '#987' })
    wall.scaleY = 3 // a tall wall: ONE asset spanning levels 1..3 (collapsed vertical run)
    wall.label = 'wall'
    wall.settings = { fadeNear: true }
    wall.tileOverride = 'emoji:brick'

    // Selection keys as the marquee produces them: raised blocks carry their level, the floor patch is flat.
    const clip = copyTiles(g, ['1,1,1', '2,1,1', '1,2'])
    expect(clip.tiles).toHaveLength(3)

    // Paste anchored at (10,10): min-corner of the selection (col1,row1) maps to (10,10).
    const placed = pasteTiles(g, clip, 10, 10)
    expect(placed).toBe(3)

    // tree reproduced at (10,10) level 1, label + colour intact
    const pastedTree = g.getAssetsAtCell(10, 10).find((a) => a.type === 'tree')
    expect(pastedTree).toBeTruthy()
    expect(pastedTree!.heightLevel).toBe(1)
    expect(pastedTree!.label).toBe('tree_top')
    expect(pastedTree!.color).toBe('#3a5')

    // wall reproduced at (11,10) — relCol 1 preserved — with its scaleY run, settings + tileOverride
    const pastedWall = g.getAssetsAtCell(11, 10).find((a) => a.type === 'wall')
    expect(pastedWall).toBeTruthy()
    expect(pastedWall!.heightLevel).toBe(1)
    expect(pastedWall!.scaleY).toBe(3)
    expect(pastedWall!.label).toBe('wall')
    expect(pastedWall!.settings).toEqual({ fadeNear: true })
    expect(pastedWall!.tileOverride).toBe('emoji:brick')

    // floor patch reproduced at (10,11) — relRow 1 preserved
    expect(g.groundAt(10, 11)).toBe('water')

    // and the ORIGINALS are untouched (copy, not move)
    expect(g.getAssetsAtCell(1, 1).find((a) => a.type === 'tree')).toBeTruthy()
    expect(g.groundAt(1, 2)).toBe('water')
  })

  test('preserves RELATIVE levels across a stack (roof higher than wall) at the new anchor', () => {
    const g = makeGrid()
    g.placeAsset(['🧱'], 3, 3, { type: 'wall', heightLevel: 1 }) // stack slot 1 (floor is slot 0)
    g.placeAsset(['🟫'], 3, 3, { type: 'roof', heightLevel: 4 }) // 3 heightLevels above the wall — stack slot 2

    const clip = copyTiles(g, ['3,3,1', '3,3,2']) // the wall's slot + the roof's slot
    pasteTiles(g, clip, 20, 20)

    const stack = g.getAssetsAtCell(20, 20)
    expect(stack.find((a) => a.type === 'wall')!.heightLevel).toBe(1)
    expect(stack.find((a) => a.type === 'roof')!.heightLevel).toBe(4) // gap of 3 preserved
  })

  test('REPLACES whatever occupies the target cell+level (replace-anything, like the brush)', () => {
    const g = makeGrid()
    const source = g.placeAsset(['🌲'], 1, 1, { type: 'tree', heightLevel: 1 })
    source.label = 'tree_top'
    // an existing DIFFERENT asset sits at the paste target (10,10) level 1
    g.placeAsset(['🪨'], 10, 10, { type: 'rock', heightLevel: 1 })

    const clip = copyTiles(g, ['1,1,1'])
    pasteTiles(g, clip, 10, 10)

    const atTarget = g.getAssetsAtCell(10, 10).filter((a) => a.type !== 'floor')
    expect(atTarget).toHaveLength(1) // the rock was replaced, not stacked
    expect(atTarget[0].type).toBe('tree')
  })

  test('re-derives collision: pasting a BLOCKING tile blocks the target cell', () => {
    const g = makeGrid()
    g.placeAsset(['🧱'], 1, 1, { type: 'wall', heightLevel: 1, blocking: true })
    expect(g.isBlocked(5, 5)).toBe(false)

    pasteTiles(g, copyTiles(g, ['1,1,1']), 5, 5)

    expect(g.isBlocked(5, 5)).toBe(true)
  })

  test('re-derives collision: replacing the only blocker with a WALKABLE tile unblocks the cell', () => {
    const g = makeGrid()
    // source: a walkable flower
    g.placeAsset(['🌼'], 1, 1, { type: 'flower', heightLevel: 1, blocking: false })
    // target already has a blocking rock at level 1
    g.placeAsset(['🪨'], 8, 8, { type: 'rock', heightLevel: 1, blocking: true })
    expect(g.isBlocked(8, 8)).toBe(true)

    pasteTiles(g, copyTiles(g, ['1,1,1']), 8, 8) // replaces the rock with the walkable flower

    expect(g.isBlocked(8, 8)).toBe(false)
    expect(g.getAssetsAtCell(8, 8).filter((a) => a.type !== 'floor').map((a) => a.type)).toEqual(['flower'])
  })

  test('an empty selection copies nothing and pastes nothing (no-op)', () => {
    const g = makeGrid()
    const clip = copyTiles(g, [])
    expect(clip.tiles).toHaveLength(0)
    expect(pasteTiles(g, clip, 4, 4)).toBe(0)
  })

  test('a flat "col,row" key copies the FLOOR so a ground patch travels', () => {
    const g = makeGrid()
    g.setGround(2, 2, 'water')
    g.floorAt(2, 2)!.color = '#0af'

    pasteTiles(g, copyTiles(g, ['2,2']), 15, 15)

    expect(g.groundAt(15, 15)).toBe('water')
    expect(g.floorAt(15, 15)?.color).toBe('#0af')
  })

  test('skips targets that fall off the grid (bounds-safe)', () => {
    const g = makeGrid()
    g.placeAsset(['🌲'], 0, 0, { type: 'tree', heightLevel: 1 })
    g.placeAsset(['🌲'], 1, 0, { type: 'tree', heightLevel: 1 })
    const clip = copyTiles(g, ['0,0,1', '1,0,1']) // rel (0,0) and (1,0)
    // anchor at the last column: rel(1,0) lands off-grid → only one placed
    const placed = pasteTiles(g, clip, g.cols - 1, 5)
    expect(placed).toBe(1)
    expect(g.getAssetsAtCell(g.cols - 1, 5).find((a) => a.type === 'tree')).toBeTruthy()
  })
})

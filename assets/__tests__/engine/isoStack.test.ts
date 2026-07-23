/**
 * ISO STACK RENDERING — the "then implement isometric to deal with BLOCKS" half of the brush's
 * Minecraft-style placement. A cell can hold a STACK of brush-placed assets, each carrying a
 * `heightLevel` (0,1,2,…). The iso render must lift each stack entry `heightLevel` cubes up so the pile
 * CLIMBS (mirroring the 2D raised stack in topdown.ts), with a per-kind split:
 * EVERY placed tile extrudes through the block path (MAP-MODEL §4, EDITOR-INTERACTION §11: "the old flat
 * billboard path ... is gone") — only the block HEIGHT differs, and only as DATA:
 *   · SOLID/block-like kinds (wall/rock/crate — the tileset gives them height ≥ 1) extrude into a real
 *     iso CUBE via drawIsoTileBlock, so a stack reads as stacked cubes;
 *   · height-0 decorative kinds (tree/flower/bush/… — no tileset height) extrude into a THIN slab (the same
 *     drawIsoTileBlock face fills, minimal height), NEVER a flat billboard. They still LIFT/climb per level.
 * heightLevel 0 (every generated/existing asset) → 0 lift → byte-identical to before.
 *
 * Verified through a recording ctx (the isoTileBlock.test.ts technique) that also tracks translation, so
 * the effective screen y of the cube vertices / billboard glyph is observable per stack level.
 */
import { isoStackLift, isoDepthCompare, ISO_BLOCK_H_FRAC, drawIsoAssetAscii } from '@/engine/render/iso'
import { EMOJI_STYLE, rebuildEmojiStyle } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'

// This is a MECHANISM test for the stack lift + the tall-cube-vs-thin-slab height split, so it seeds exactly
// the two tiles it needs (the frontend ships no bundled default): a SOLID rock (tileset height ≥ 1 → extrudes
// into a full cube) and a height-0 DECORATIVE tree (no tileset height → a lifted THIN SLAB, still a block).
// Kept out of the fixture so the two kinds are unambiguous regardless of the DB's per-tile height choices.
beforeAll(() => {
  EMOJI_TILESET.rock = { char: '🪨', color: '#8a8a8a', height: 1 }
  EMOJI_TILESET.tree = { char: '🌲', color: '#2f8f3f' } // no height → a height-0 thin-slab block (never a billboard)
  rebuildEmojiStyle()
})
afterAll(() => {
  delete EMOJI_TILESET.rock
  delete EMOJI_TILESET.tree
  rebuildEmojiStyle()
})

// Records solid face fills (cube detection), the effective y of every path vertex (cube geometry) and of
// every glyph (billboard geometry) — tracking translate()/save()/restore() so a translated glyph draw
// (the billboard branch translates then draws at local 0,0) reports its true on-screen y.
function recordingCtx() {
  const fills: string[] = []
  const quadYs: number[] = []
  const textYs: number[] = []
  let oy = 0
  const stack: number[] = []
  const ctx = {
    fillStyle: '#000', font: '', textAlign: '' as CanvasTextAlign, textBaseline: '' as CanvasTextBaseline, globalAlpha: 1,
    save() { stack.push(oy) },
    restore() { const s = stack.pop(); if (s !== undefined) oy = s },
    translate(_x: number, dy: number) { oy += dy },
    scale() {}, rotate() {}, transform() {}, // fillIsoFaceWithTile's shear CTM — irrelevant to our screen-space checks
    beginPath() {}, moveTo(_x: number, y: number) { quadYs.push(oy + y) }, lineTo(_x: number, y: number) { quadYs.push(oy + y) },
    closePath() {}, rect() {}, clip() {},
    fill() { fills.push(String((ctx as { fillStyle: string }).fillStyle)) },
    fillRect() {}, fillText(_t: string, _x: number, y: number) { textYs.push(oy + y) }, drawImage() {},
    measureText() { return { width: 8 } },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, quadYs, textYs }
}

const tileW = 40
const tileH = 20
const baseY = 500 // ground-level draw y; a lift SUBTRACTS from this (up the screen = smaller y)

const rockAt = (heightLevel: number): GridAsset => ({ art: ['🪨'], col: 3, row: 3, type: 'rock', blocking: true, color: '#8a8a8a', tileOverride: 'emoji:rock', heightLevel })
const treeAt = (heightLevel: number): GridAsset => ({ art: ['🌲'], col: 3, row: 3, type: 'tree', color: '#2f8f3f', heightLevel })

describe('isoStackLift — screen-space rise per stack level', () => {
  test('heightLevel absent or 0 → NO lift (byte-identical for generated/existing maps)', () => {
    expect(isoStackLift(tileW, undefined)).toBe(0)
    expect(isoStackLift(tileW, 0)).toBe(0)
  })

  test('each level lifts one cube height (tileW * ISO_BLOCK_H_FRAC), climbing linearly', () => {
    const oneCube = tileW * ISO_BLOCK_H_FRAC
    expect(isoStackLift(tileW, 1)).toBeCloseTo(oneCube)
    expect(isoStackLift(tileW, 2)).toBeCloseTo(2 * oneCube)
    expect(isoStackLift(tileW, 3)).toBeCloseTo(3 * oneCube)
    // consecutive levels are always one cube apart → a uniform staircase
    expect(isoStackLift(tileW, 2) - isoStackLift(tileW, 1)).toBeCloseTo(oneCube)
    expect(isoStackLift(tileW, 3) - isoStackLift(tileW, 2)).toBeCloseTo(oneCube)
  })
})

describe('isoDepthCompare — stacked cells draw bottom-up, everything else unchanged', () => {
  test('same cell → the higher heightLevel sorts AFTER (drawn over) the lower', () => {
    const lo = { col: 2, row: 2, asset: { heightLevel: 0 } }
    const hi = { col: 2, row: 2, asset: { heightLevel: 2 } }
    expect(isoDepthCompare(lo, hi)).toBeLessThan(0)
    expect(isoDepthCompare(hi, lo)).toBeGreaterThan(0)
  })

  test('different cells → back-to-front by (col + row), same as the old sort', () => {
    const near = { col: 1, row: 1, asset: { heightLevel: 5 } } // even a tall stack stays behind…
    const far = { col: 4, row: 4, asset: { heightLevel: 0 } }  // …a cell further front
    expect(isoDepthCompare(near, far)).toBeLessThan(0)
  })

  test('a non-asset tie (entity/player/building) returns 0 → stable insertion order preserved', () => {
    expect(isoDepthCompare({ col: 2, row: 2 }, { col: 2, row: 2 })).toBe(0)
    // an asset vs a non-asset at the same cell also stays put (no reordering of units into stacks)
    expect(isoDepthCompare({ col: 2, row: 2, asset: { heightLevel: 3 } }, { col: 2, row: 2 })).toBe(0)
  })

  test('sorting a 3-stack yields ascending heightLevel (bottom-first, top-last)', () => {
    const items = [
      { col: 2, row: 2, asset: { heightLevel: 2 } },
      { col: 2, row: 2, asset: { heightLevel: 0 } },
      { col: 2, row: 2, asset: { heightLevel: 1 } },
    ]
    const order = [...items].sort(isoDepthCompare).map(i => i.asset.heightLevel)
    expect(order).toEqual([0, 1, 2])
  })
})

describe('drawIsoAssetAscii — a brush stack CLIMBS in iso (Task A)', () => {
  test('a 3-tall SOLID stack (rock) draws 3 CUBES at strictly rising y (block-kind → drawIsoTileBlock)', () => {
    const tops: number[] = []
    for (const level of [0, 1, 2]) {
      const { ctx, fills, quadYs } = recordingCtx()
      // The render loop lifts a stacked asset by isoStackLift before drawing — simulate that here.
      const y = baseY - isoStackLift(tileW, level)
      drawIsoAssetAscii(ctx, 300, y, rockAt(level), tileW, tileH, 0, false, 'day', EMOJI_STYLE)
      // A single cube = 2 side faces + 1 top cap = 3 solid quad fills → it went through drawIsoTileBlock,
      // NOT a flat billboard (which draws 0 quad fills).
      expect(fills).toHaveLength(3)
      tops.push(Math.min(...quadYs)) // top-most vertex of the cube
    }
    // Each higher stack entry is drawn further UP the screen (smaller y) than the one below it.
    expect(tops[1]).toBeLessThan(tops[0])
    expect(tops[2]).toBeLessThan(tops[1])
    // …and by one cube height per level (the cubes sit seamlessly on each other, matching the lift).
    expect(tops[0] - tops[1]).toBeCloseTo(tileW * ISO_BLOCK_H_FRAC)
    expect(tops[1] - tops[2]).toBeCloseTo(tileW * ISO_BLOCK_H_FRAC)
  })

  test('a 3-tall height-0 DECORATIVE stack (tree) draws 3 LIFTED thin-slab BLOCKS at rising y (never a billboard)', () => {
    // The retired model billboarded a height-0 decorative tile; the current uniform model (MAP-MODEL §4,
    // EDITOR-INTERACTION §11: "the old flat billboard path ... is gone") routes EVERY placed tile through the
    // block path — a height-0 tile as a THIN slab (drawIsoTileBlock face fills), NEVER a lifted billboard. The
    // load-bearing behaviour is unchanged: the stack still CLIMBS one cube-height per level.
    const tops: number[] = []
    for (const level of [0, 1, 2]) {
      const { ctx, fills, quadYs } = recordingCtx()
      const y = baseY - isoStackLift(tileW, level)
      drawIsoAssetAscii(ctx, 300, y, treeAt(level), tileW, tileH, 0, false, 'day', EMOJI_STYLE)
      expect(fills.length).toBeGreaterThan(0) // a thin slab is a REAL block (face fills) — not a 0-fill billboard
      tops.push(Math.min(...quadYs)) // top-most vertex of the slab
    }
    expect(tops[1]).toBeLessThan(tops[0]) // each tile in the pile is lifted higher than the last
    expect(tops[2]).toBeLessThan(tops[1])
    expect(tops[0] - tops[1]).toBeCloseTo(tileW * ISO_BLOCK_H_FRAC)
  })

  test('a single tile at heightLevel 0 renders IDENTICALLY to no stack (no regression)', () => {
    const draw = (asset: GridAsset) => { const r = recordingCtx(); drawIsoAssetAscii(r.ctx, 300, baseY, asset, tileW, tileH, 0, false, 'day', EMOJI_STYLE); return r }
    const level0 = draw(rockAt(0))
    const noStack = draw({ art: ['🪨'], col: 3, row: 3, type: 'rock', blocking: true, color: '#8a8a8a', tileOverride: 'emoji:rock' }) // heightLevel undefined
    expect(level0.quadYs).toEqual(noStack.quadYs) // same geometry, same screen y — a lone tile is unchanged
    expect(level0.fills).toEqual(noStack.fills)
  })
})

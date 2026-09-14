/**
 * THE MAP NEVER SHOWS THE CANVAS THROUGH ITS OWN FLOOR.
 *
 * The dark navy patches reported over and over on river crossings were not a colour, a tile size or a camera
 * angle. They were `#1a1a2e`, the colour `render()` clears the frame with, showing through cells that painted
 * NOTHING.
 *
 * Why nothing painted: a floor has no label, so its picture is resolved through `assetKind` → `groundKind`,
 * which folds ground names onto kinds on purpose (every `water_*` shares the one `water` tile so a river is one
 * picture). A name it does not recognise folds onto `'ground'`, and `'ground'` IS NOT A TILE. `cobblestone` is a
 * real baked tile in both styles and `groundKind` has no case for it, so it resolved no image; with no image and
 * no glyph the draw guard `blockCount >= 1 && (adv.image || adv.char)` skipped the slab entirely.
 *
 * Two guarantees, both measured in real pixels through the production `render()`:
 *   1. the fold is LOSSLESS — a ground name the kinds do not recognise still resolves its OWN baked tile;
 *   2. a floor draws its slab even with no picture at all, because it is the map's SURFACE. Every other tile
 *      keeps "no art, no block": a missing prop leaves the ground under it, a missing floor leaves the canvas.
 */
import { styleTiles } from '@/engine/tileset/styleTiles'
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { render } from '@/engine/render/iso'
import { assetTileImage, styleTileImage } from '@/engine/render/shared'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { assetKind, groundKind, EMOJI_STYLE, ASCII_STYLE, type Style } from '@/game/artStyle'
import type { PlayerState } from '@/game/runtime/player'

installSeedTileset()

let H: RealCanvasHarness

// Clamp-free camera so the player's cell sits dead centre and the sampled box is deep inside the map.
const CELL = 100, W = 800, HGT = 600, ISO = 1, COLS = 30, ROWS = 30
const PCOL = 15, PROW = 15
const CLEAR = { r: 0x1a, g: 0x1a, b: 0x2e } // what render() fills the frame with before drawing

const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)

/** A map whose every cell carries the same ground, compressed into z-width runs exactly as generation does. */
function mapOf(ground: string): IsometricGrid {
  const grid = new IsometricGrid({ cols: COLS, rows: ROWS, cellSize: CELL, isoScale: ISO })
  grid.fillGround(0, 0, COLS, ROWS, ground)
  grid.compressGround()
  return grid
}

/** Clear-colour pixels in a box at the middle of the frame — a region the map body covers on every side. */
function clearPixelsAtCentre(grid: IsometricGrid, style: Style): number {
  const canvas = H.makeCanvas(W, HGT)
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
  render({
    ctx, w: W, h: HGT, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [],
    enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [],
    projectiles: [], dayNight: 'day', attackReach: 1, style, clampCamera: false, chrome: false, showPlayer: false,
  })
  const box = { x: W / 2 - 120, y: HGT / 2 - 50, w: 240, h: 100 }
  const { data } = canvas.getContext('2d').getImageData(box.x, box.y, box.w, box.h)
  let clear = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === CLEAR.r && data[i + 1] === CLEAR.g && data[i + 2] === CLEAR.b) clear++
  }
  return clear
}

beforeAll(async () => {
  H = installRealCanvas().harness
  const srcs = new Set<string>()
  for (const t of Object.values(styleTiles('emoji'))) if (t.image) srcs.add(t.image)
  for (const s of srcs) H.registerSolid(s, '#00c800')
  await H.warm([...srcs])
})

describe('the ground-name → kind fold is lossless', () => {
  // States the mechanism, so this file fails loudly if someone "fixes" cobblestone by giving it a kind and
  // then deletes the resolver that covers every OTHER unmapped ground name.
  test('cobblestone folds onto the generic ground kind, and there is no tile called ground', () => {
    expect(groundKind('cobblestone')).toBe('ground')
    expect(assetKind({ type: 'floor', tileKey: 'cobblestone' })).toBe('ground')
    expect(styleTileImage('ground', EMOJI_STYLE)).toBeUndefined()
    expect(styleTileImage('ground', ASCII_STYLE)).toBeUndefined()
  })

  test.each([EMOJI_STYLE, ASCII_STYLE])('a floor whose kind has no tile resolves its OWN tile ($id)', style => {
    expect(styleTileImage('cobblestone', style)).toBeDefined() // precondition: the catalog does carry it
    expect(assetTileImage({ type: 'floor', tileKey: 'cobblestone' }, style)).toBeDefined()
  })

  test.each([EMOJI_STYLE, ASCII_STYLE])('the KIND still wins where it resolves, so a river stays one picture ($id)', style => {
    const water = styleTileImage('water', style)
    expect(water).toBeDefined()
    // water_deep / water_shallow are their own catalog entries; the fold onto `water` is deliberate and the
    // own-name lookup must not undo it.
    expect(assetTileImage({ type: 'floor', tileKey: 'water_deep' }, style)?.src).toBe(water?.src)
    expect(assetTileImage({ type: 'floor', tileKey: 'water_shallow' }, style)?.src).toBe(water?.src)
  })
})

describe('a floor always paints its cell', () => {
  test('a cobblestone map leaves no clear pixel at its centre', () => {
    expect(clearPixelsAtCentre(mapOf('cobblestone'), EMOJI_STYLE)).toBe(0)
  })

  test('a meadow map leaves no clear pixel at its centre (the case that already worked)', () => {
    expect(clearPixelsAtCentre(mapOf('meadow'), EMOJI_STYLE)).toBe(0)
  })

  // The guarantee, not the instance: a ground name with NO tile anywhere in the catalog still draws, in the
  // colour the floor already carries. Without it, the next unmapped label reopens the same hole.
  test('a ground name with no tile at all still paints, in its own colour', () => {
    const grid = mapOf('no_such_ground_anywhere')
    const floor = grid.floorAt(PCOL, PROW)
    expect(styleTileImage('no_such_ground_anywhere', EMOJI_STYLE)).toBeUndefined()
    expect(assetTileImage({ type: 'floor', tileKey: 'no_such_ground_anywhere' }, EMOJI_STYLE)).toBeUndefined()
    expect(floor?.color).toBeTruthy()
    expect(clearPixelsAtCentre(grid, EMOJI_STYLE)).toBe(0)
  })
})

/**
 * PERMANENT GUARD: a tile renders at its OWN DB block-height — read, never invented, never floored.
 *
 * WHY (Alexander): a flat tile's minimal height (0.1 blocks) is DATA in the DB (nebulith), not a frontend
 * constant. The frontend only READS `height` and draws it: a 0.1-block tile is a thin slab, a 1-block tile a
 * full cube, a 3-block tile three tall. The old bugs were the frontend INVENTING the flat height
 * (FLOOR_SLAB_SCALE_Y / resolveHeightScale) and the render FLOORING a sub-1 height to a full cube.
 *
 * Proved against the production iso path (drawIsoAssetAscii): the extrude height scales with the tile's DB
 * `height`, sub-1 heights draw as proportional thin slabs (not full cubes, not invisible), and the floor
 * asset (which carries NO hardcoded height) resolves its ground tile's DB height and draws that slab.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { drawIsoAssetAscii } from '@/engine/render/iso'
import { EMOJI_STYLE } from '@/game/artStyle'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { TileGeom } from '@/engine/render/tileHit'

installSeedTileset()

let H: RealCanvasHarness
const TW = 30, TH = 15, CX = 200, CY = 250

/** Any emoji tile that carries a baked image — a concrete tile to render at various heights. */
function anImageTileKey(): string {
  const hit = Object.entries(EMOJI_TILESET).find(([, t]) => t.image && t.category !== 'units')
  if (!hit) throw new Error('fixture has no image-backed non-unit emoji tile')
  return hit[0]
}

function render(key: string, extra: Partial<GridAsset>): TileGeom | null {
  const cv = H.makeCanvas(480, 420)
  const asset = { art: [''], col: 4, row: 4, type: key, tileOverride: `emoji:${key}`, heightLevel: 0, color: '#c9c9c9', ...extra } as unknown as GridAsset
  return drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, CX, CY, asset, TW, TH, 0, false, 'day', EMOJI_STYLE)
}

/** A cube's extruded on-screen height in px (base back corner y − top back corner y) — proportional to height. */
const extrudePx = (g: TileGeom | null): number => (g && g.kind === 'cube' ? g.base[1].y - g.top[1].y : 0)

beforeAll(async () => {
  H = installRealCanvas().harness
  const srcs = new Set<string>()
  for (const t of Object.values(EMOJI_TILESET)) if (t.image) srcs.add(t.image)
  for (const s of srcs) H.registerSolid(s, '#00c800')
  await H.warm([...srcs])
})

describe('a tile renders at its OWN DB height — read, not invented; sub-1 not floored', () => {
  test('a 0.1-block tile draws a THIN slab ~0.1 of a full block (not a full cube, not invisible)', () => {
    const key = anImageTileKey()
    const flat = extrudePx(render(key, { height: 0.1 }))
    const full = extrudePx(render(key, { height: 1 }))
    expect(flat).toBeGreaterThan(0)             // a REAL slab, not floored to nothing
    expect(flat).toBeCloseTo(full * 0.1, 0)     // proportional to the DB height — 0.1 of a full block
    expect(flat).toBeLessThan(full * 0.25)      // clearly a thin slab, NOT a full cube (the old floor-to-1 bug)
  })

  test('extrude scales with the DB height: 0.1 < 1 < 3 (the render reads the number it is given)', () => {
    const key = anImageTileKey()
    const h01 = extrudePx(render(key, { height: 0.1 }))
    const h1 = extrudePx(render(key, { height: 1 }))
    const h3 = extrudePx(render(key, { height: 3 }))
    expect(h01).toBeLessThan(h1)
    expect(h1).toBeLessThan(h3)
    expect(h3).toBeCloseTo(h1 * 3, 0)           // 3 blocks tall = 3× a one-block tile
  })

  test('the per-instance Height multiplier (scaleY) scales the DB height, not replaces it', () => {
    const key = anImageTileKey()
    const flat = extrudePx(render(key, { height: 0.1 }))
    const flatX2 = extrudePx(render(key, { height: 0.1, scaleY: 2 }))
    expect(flatX2).toBeCloseTo(flat * 2, 0)     // 0.1 × 2 = 0.2 — grows proportionally
  })

  test('the floor asset carries NO hardcoded height — it resolves its ground tile\'s DB height as a thin slab', () => {
    const floor = { art: [''], col: 4, row: 4, type: 'floor', tileKey: 'grass', heightLevel: 0, blocking: false } as unknown as GridAsset
    const cv = H.makeCanvas(480, 420)
    const g = drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, CX, CY, floor, TW, TH, 0, false, 'day', EMOJI_STYLE)
    const full = extrudePx(render(anImageTileKey(), { height: 1 }))
    expect(g?.kind).toBe('cube')                 // a block/slab, not a billboard
    expect(extrudePx(g)).toBeGreaterThan(0)      // resolves the DB height (0.1) — NOT invisible
    expect(extrudePx(g)).toBeLessThan(full * 0.25) // …and thin, like a floor
  })
})

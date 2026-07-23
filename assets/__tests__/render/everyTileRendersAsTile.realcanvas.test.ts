/**
 * PERMANENT REGRESSION GUARD — EVERY tile, in EVERY category, in BOTH styles, renders through the ONE
 * uniform tile path as a BLOCK/SLAB — NEVER a flat 2D billboard. A UNIT is the single documented exception
 * (a depth-0 tile drawn by drawIsoEntity, MAP-MODEL §4: "a character/unit is a depth-0 tile — the one map
 * exception").
 *
 * WHY THIS EXISTS (Alexander's demand): "EVERY tile in EVERY category must render through the ONE uniform
 * tile path, never a flat 2D billboard, forever." A prior fix routed height-0 tiles through the block path
 * as a thin slab (FLOOR_SLAB_SCALE_Y) instead of a billboard, but was only ever validated on 39 emoji
 * nature/decor tiles. This test proves it for ALL 262 emoji + 211 ascii tiles and FAILS the moment anyone
 * reintroduces a billboard path for a placed tile.
 *
 * THE CONTRACT (MAP-MODEL §4, EDITOR-INTERACTION-SPEC §11, ENGINE-ARCHITECTURE §3/§8):
 *   • non-unit tile  → drawIsoAssetAscii returns a CUBE geom (block/slab). A height-0 tile is a THIN slab
 *                      (a real, minimal-height block), a height≥1 tile a taller cube. NEVER billboardGeom.
 *   • Z-Width (depth) → the block EXTRUDES further (a directional depth-box hull), settings honoured.
 *   • unit tile      → routed to the ENTITY path (placementFor === 'entity'), NEVER forced into a block.
 *
 * DETERMINISTIC + OFFLINE: the tile list is the baked `fixtures/tilesets.json` (a captured /api/tilesets
 * response — every category present), installed via the SAME loader production uses. Each tile's baked PNG
 * is stubbed by a solid raster + warmed BEFORE any render (the images-decoded condition the real app gates
 * on). No network at test time.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { drawIsoAssetAscii, drawIsoEntity } from '@/engine/render/iso'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { placementFor } from '@/game/editor/tilePlacement'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { TileGeom } from '@/engine/render/tileHit'
import type { Entity } from '@/game/types'

// Install the DB-equivalent tileset at MODULE LOAD (before describe.each enumerates the rows) — the tile
// holders must be populated when the per-tile cases are generated, not only inside beforeAll.
installSeedTileset()

let H: RealCanvasHarness
const TW = 30, TH = 15, CX = 200, CY = 250

type Style = typeof EMOJI_STYLE

interface Row { key: string; category: string; height: number; src?: string }

// Read the LIVE loaded tilesets (installed from the baked fixture) — the exact set /api/tilesets serves.
function emojiRows(): Row[] {
  return Object.entries(EMOJI_TILESET).map(([key, t]) => ({ key, category: t.category ?? '(none)', height: t.height ?? 0, src: t.image }))
}
function asciiRows(): Row[] {
  return Object.entries(ASCII_TILESET.tiles).map(([key, t]) => ({ key, category: t.category ?? '(none)', height: (t as { height?: number }).height ?? 0, src: t.image?.src }))
}
const nonUnit = (rows: Row[]) => rows.filter(r => r.category !== 'units')

/** A PAINTED tile exactly as the brush produces it (stackAssetTile → pushTile): a stacked asset pinned to
 *  the exact catalog tile via `tileOverride`, carrying the tile's OWN DB height. No `label` — the palette
 *  paint path resolves the tile through its override, not a composition label. */
function paintedAsset(styleId: string, r: Row, extra: Partial<GridAsset> = {}): GridAsset {
  return { art: [''], col: 4, row: 4, type: r.key, tileOverride: `${styleId}:${r.key}`, height: r.height, heightLevel: 0, color: '#c9c9c9', ...extra } as unknown as GridAsset
}
function renderIso(style: Style, r: Row, extra: Partial<GridAsset> = {}): TileGeom | null {
  const cv = H.makeCanvas(480, 420)
  return drawIsoAssetAscii(cv.getContext('2d') as unknown as CanvasRenderingContext2D, CX, CY, paintedAsset(style.id, r, extra), TW, TH, 0, false, 'day', style)
}
/** The on-screen bounding box of ANY geom (cube uses base+top rings; poly uses its points). */
function bbox(g: TileGeom | null): { w: number; h: number; area: number } {
  if (!g) return { w: 0, h: 0, area: 0 }
  const pts = g.kind === 'cube' ? [...g.base, ...g.top] : g.pts
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys)
  return { w, h, area: w * h }
}
/** A cube's extruded on-screen height (px): base back corner y − top back corner y. */
const cubeExtrudePx = (g: TileGeom | null): number => (g && g.kind === 'cube' ? g.base[1].y - g.top[1].y : 0)

beforeAll(async () => {
  H = installRealCanvas().harness
  const srcs = new Set<string>()
  for (const r of [...emojiRows(), ...asciiRows()]) if (r.src) srcs.add(r.src)
  for (const s of srcs) H.registerSolid(s, '#00c800')
  await H.warm([...srcs])
})

// ── the core guard: EVERY non-unit tile, per style, is a block/slab (cube) — never a billboard poly ──
describe.each([
  ['EMOJI', EMOJI_STYLE, () => nonUnit(emojiRows())],
  ['ASCII', ASCII_STYLE, () => nonUnit(asciiRows())],
] as const)('%s — every non-unit tile renders as a block/slab, never a billboard', (name, style, getRows) => {
  const rows = getRows()

  it(`covers every non-unit ${name} tile (sanity: the fixture is non-empty)`, () => {
    expect(rows.length).toBeGreaterThan(100)
  })

  // ONE named case PER TILE — a regression names the exact offending tile ("test EACH one").
  it.each(rows.map(r => [`${r.category}/${r.key}`, r] as const))('%s is a cube/slab (not a billboard)', (_label, r) => {
    const g = renderIso(style, r)
    // kind 'cube' == the block/slab path (cubeGeom). A billboard/diamond would be kind 'poly'.
    expect(g?.kind).toBe('cube')
  })

  // Exhaustive backstop: assert the WHOLE set at once so a failure lists EVERY billboarding tile key.
  it(`ZERO of the ${rows.length} non-unit ${name} tiles billboard`, () => {
    const billboards = rows.filter(r => renderIso(style, r)?.kind !== 'cube').map(r => `${r.category}/${r.key}`)
    expect(billboards).toEqual([])
  })
})

// ── a sub-block (flat, 0<h<1) tile is a THIN slab; a height≥1 tile is a taller cube (both real blocks) ──
// Flat tiles now carry their real DB height (0.1) — the renderer reads it and draws a proportional slab, never
// flooring it to a full cube. (Only UNITS are height 0 now; they render via the entity path, tested below.)
describe('the height model — sub-block (flat) = thin slab, standing = taller cube (both blocks)', () => {
  it('a sub-block emoji tile is a THIN slab and a height≥1 emoji tile is a much taller cube', () => {
    const flat = nonUnit(emojiRows()).find(r => r.height > 0 && r.height < 1)!
    const tall = nonUnit(emojiRows()).find(r => r.height >= 1)!
    const flatPx = cubeExtrudePx(renderIso(EMOJI_STYLE, flat))
    const tallPx = cubeExtrudePx(renderIso(EMOJI_STYLE, tall))
    expect(flatPx).toBeGreaterThan(0)          // a REAL (thin) slab — its DB height (0.1) drawn, not floored to 0
    expect(tallPx).toBeGreaterThan(flatPx * 3) // …but far shorter than a standing block (the floor-slab look)
  })

  it('an image-LESS ASCII glyph tile is still a THIN slab (glyph on the block), never a billboard', () => {
    // ASCII resolves a placed tile to its GLYPH (not its baked image); the flat case used to billboard.
    const flatAscii = nonUnit(asciiRows()).find(r => r.height > 0 && r.height < 1)!
    const g = renderIso(ASCII_STYLE, flatAscii)
    expect(g?.kind).toBe('cube')
    expect(cubeExtrudePx(g)).toBeGreaterThan(0)
  })
})

// ── Z-Width (directional depth) EXTRUDES the block further — settings honoured, per category ──
describe('Z-Width extrudes the block (settings honoured), per category', () => {
  const oneEmojiPerCategory = (): Array<[string, Row]> => {
    const seen = new Set<string>()
    const out: Array<[string, Row]> = []
    for (const r of nonUnit(emojiRows())) if (!seen.has(r.category)) { seen.add(r.category); out.push([`${r.category}/${r.key}`, r]) }
    return out
  }
  it.each(oneEmojiPerCategory())('%s extrudes when Z-Width is set', (_label, r) => {
    const base = bbox(renderIso(EMOJI_STYLE, r))
    const wide = bbox(renderIso(EMOJI_STYLE, r, { depth: 5, depthDir: 'right-up' }))
    expect(wide.area).toBeGreaterThan(base.area * 1.3) // the depth-box covers substantially more than the base cube
  })
})

// ── UNIT tiles are the exception: routed to the ENTITY path, never forced into a block ──
describe('UNIT tiles render as billboards via the entity path — never forced into the block path', () => {
  const FX_PROJECTILES = new Set(['arrow', 'bullet', 'dart', 'fire-slash', 'ice-slash', 'cleave', 'bolt', 'piercing-shot', 'nova', 'lightning', 'heal-glow', 'guard-flash'])
  const unitRows = () => [...emojiRows(), ...asciiRows()].filter(r => r.category === 'units')

  it('every figure-unit tile routes to the ENTITY path (not asset/terrain — never a block)', () => {
    const misrouted = unitRows()
      .filter(r => !FX_PROJECTILES.has(r.key))
      .filter(r => placementFor({ category: 'units', id: `x:${r.key}` }) !== 'entity')
      .map(r => r.key)
    expect(misrouted).toEqual([])
  })

  it('a unit renders as an upright sprite through drawIsoEntity (opaque pixels), not a cube', () => {
    const cv = H.makeCanvas(240, 260)
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D
    const npc = { id: 'u1', kind: 'npc', col: 3, row: 3, name: 'Bob', baseStats: { hp: 10, maxHp: 10, attack: 1, defense: 1, speed: 1 } } as unknown as Entity
    drawIsoEntity(ctx, 120, 170, npc, TH, undefined, 0, false, false, false, EMOJI_STYLE)
    const { data } = (cv.getContext('2d') as unknown as CanvasRenderingContext2D).getImageData(0, 0, cv.width, cv.height)
    let opaque = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) opaque++
    expect(opaque).toBeGreaterThan(0) // the entity sprite path drew something (a billboard figure, not a block)
  })
})

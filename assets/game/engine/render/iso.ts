import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { assetAnimFrame, assetCycleFrame } from '@/engine/assetAnimations'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { type BuildingType } from '@/engine/buildingComposer'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { buildingFadeAlpha } from '@/engine/isoBuilding'
import { buildingCellColor } from '@/engine/stageGenerator'
import { type Projectile, projectileCellAt } from '@/game/projectiles'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction, playerDisplayName } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { GROUND_COLORS } from '@/levels/village'
import { Connector } from '@/lib/api'
import { ASCII_FONT, BUILDING_BADGES, COMBAT_RANGE, type DayNight, type DrawVisual, ENEMY_MOVE_MS, LAMP_GLOW, LIGHT, applyCellTransform, isoCameraFocus, collectLampGlows, debugCellCaptions, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawNightLighting, drawPlayerArm, drawQuestMarker, drawRangeRing, drawStyledImage, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, getPlayerArt, grassShade, cellFill, fillTintedGlyph, drawBuildingLandmark, idleNow, isDeadEnemy, isDebugMode, resolveDraw, tileImage, treeCanopyLayers } from './shared'
import { ASCII_STYLE, assetKind, buildingLandmarkEmoji, entityKind, enemyTileId, genderize, groundKind, type ElementKind, type ImageVisual, type Style } from '@/game/artStyle'
import { DEFAULT_CHARACTER_ANIMATIONS, activeFrame } from '@/game/runtime/entityAnimation'


/** Per-face brightness from the global light: a face whose outward screen normal points toward the
 *  sun is brighter, one facing away dimmer. Returns a darken factor in [0.6, 1.0]. */
export function faceLight(nx: number, ny: number): number {
  const len = Math.hypot(nx, ny) || 1
  const d = (nx / len) * LIGHT.dir.x + (ny / len) * LIGHT.dir.y // -1 (away) .. 1 (toward)
  return 0.6 + 0.4 * (d * 0.5 + 0.5)
}


// ════════════════════════════════════════════════════════════════════════════
// ISO STATIC-GROUND OFFSCREEN CACHE
// The ground layer (cube sides + diamond tops + per-cell glyphs) is by far the
// heaviest part of an iso frame — thousands of fills/glyphs redrawn every rAF even
// when nothing moves, which pins the GPU and stutters other tabs' video. It only
// changes with the camera, zoom, viewport size, or the visible map cells — the
// only per-frame ground motion is the grass micro-flicker and the water shimmer.
// So we render it ONCE into an offscreen canvas keyed on exactly those inputs and
// BLIT it each frame; the dynamic layer (live water, entities, buildings, effects,
// night, UI) is drawn fresh on top. The blit is at offset (0,0) with the SAME
// projection/camera the cache was built with, so it is pixel-identical to a direct
// draw — no resampling. Grass's ≤1.5% flicker (mostly clamped to 1.0) is baked at
// full alpha so the cache is time-independent and reusable (measured pixel impact
// ~2e-5 MAE); the animated water surface is excluded and redrawn live. While the
// camera is moving (key changing every frame) we draw directly — no regression.
// Module state only — no game state is touched.
export type IsoGroundCache = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; camKey: string; contentSig: number; width: number; height: number; waterCells: { col: number; row: number }[] }

export let isoGroundCache: IsoGroundCache | null = null

export let isoCacheCanvas: HTMLCanvasElement | null = null

export let isoLastFrameKey = ''

export let isoRenderMsEMA = 0

export const ISO_CACHE_MAX_DIM = 8192


export function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}


/** Lazily create / resize the shared offscreen cache canvas. Null when there's no
 *  DOM (SSR / tests) — callers then fall back to a direct draw. */
export function ensureIsoCacheCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null
  if (!isoCacheCanvas) isoCacheCanvas = document.createElement('canvas')
  if (isoCacheCanvas.width !== w) isoCacheCanvas.width = w
  if (isoCacheCanvas.height !== h) isoCacheCanvas.height = h
  const ctx = isoCacheCanvas.getContext('2d')
  if (!ctx) return null
  return { canvas: isoCacheCanvas, ctx }
}


/** Fast FNV-1a over the visible cells' ground type + height — the only static-cache
 *  inputs an in-place map edit can change. Cheap (a few hundred cells, pure CPU) and
 *  complete: it catches any visible paint/height edit regardless of mutation path. */
export function isoGroundSignature(grid: IsometricGrid, startCol: number, endCol: number, startRow: number, endRow: number): number {
  let hsh = 0x811c9dc5
  for (let row = startRow; row <= endRow; row++) {
    const groundRow = grid.ground[row]
    const heightRow = grid.height[row]
    for (let col = startCol; col <= endCol; col++) {
      const g = groundRow ? groundRow[col] : undefined
      if (g) for (let i = 0; i < g.length; i++) { hsh ^= g.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) }
      hsh ^= (heightRow ? heightRow[col] : 0) | 0
      hsh = Math.imul(hsh, 0x01000193)
    }
  }
  return hsh >>> 0
}


export interface IsoGroundParams {
  grid: IsometricGrid
  w: number; h: number; time: number
  camX: number; camZ: number; isoScale: number; cellSize: number
  tileW: number; tileH: number; heightStep: number; cubeDepth: number
  startCol: number; endCol: number; startRow: number; endRow: number
  groundFontSize: number
  style: Style
}


/** Draw a ground cell's CONTENT on top of its already-filled diamond:
 *   - reskin (a style tile / image is active) → the tile SHEARED flat onto the iso diamond via
 *     fillIsoFaceWithTile (angled, with the cube's z below it) — one path for emoji + image;
 *   - passthrough (no tint) → the caller's ASCII glyph exactly as before (grass keeps its live
 *     flicker when `live`), byte-identical to the pre-style inline loop. */
function drawIsoGroundContent(
  ctx: CanvasRenderingContext2D,
  gdv: DrawVisual,
  px: number,
  drawY: number,
  tileW: number,
  tileH: number,
  isGrass: boolean,
  live: boolean,
  time: number,
  col: number,
  row: number,
): void {
  // Reskin (a style tile is active): SHEAR the tile onto the iso DIAMOND so it lies FLAT on the
  // ground plane — angled, with the cube's z below it — never an upright square stamped on top.
  // The diamond is the parallelogram from its LEFT corner: eA→top, eB→bottom. One primitive covers
  // an emoji glyph and an image sprite. ASCII passthrough (no tint/image) falls through to the
  // byte-identical glyph draw below.
  if (gdv.tint || gdv.image) {
    fillIsoFaceWithTile(
      ctx,
      { x: px - tileW, y: drawY },
      { x: tileW, y: -tileH },
      { x: tileW, y: tileH },
      { char: gdv.char, color: gdv.color, image: gdv.image },
      1,
      1,
    )
    return
  }
  ctx.fillStyle = gdv.color
  if (live && isGrass) {
    ctx.globalAlpha = 0.85 + 0.15 * (Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1)
    ctx.fillText(gdv.char, px, drawY)
    ctx.globalAlpha = 1
  } else {
    ctx.fillText(gdv.char, px, drawY)
  }
}


/** Draw the ground layer (cube sides + diamond tops + glyphs). `bakeStatic = true`
 *  renders only the time-independent parts (grass glyph at full alpha; the animated
 *  water surface is skipped and its cells pushed into `waterOut`) into the offscreen
 *  cache. `false` renders the full layer byte-identically to the original inline loop
 *  (live grass flicker + live water shimmer) for the direct / fallback path. The
 *  projection is inlined so the hot double-loop never allocates a point per cell. */
export function drawIsoGroundLayer(ctx: CanvasRenderingContext2D, p: IsoGroundParams, bakeStatic: boolean, waterOut: { col: number; row: number }[] | null): void {
  const { grid, w, h, time, camX, camZ, isoScale, cellSize, tileW, tileH, heightStep, cubeDepth, startCol, endCol, startRow, endRow, groundFontSize, style } = p
  ctx.font = `bold ${groundFontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const wx = col * cellSize - camX
      const wz = row * cellSize - camZ
      const px = w / 2 + (wx - wz) * isoScale * 0.71
      const py = h / 2 + (wx + wz) * isoScale * 0.36
      if (px < -tileW * 2 || px > w + tileW * 2 || py < -tileH * 2 || py > h + tileH * 2) continue

      const tileType = grid.ground[row]?.[col] || 'grass'
      const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass

      // Noise-based color variation (same as 2D view)
      const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
      const colorIdx = noiseVal > 0 ? 0 : 1

      const char = colors.char[colorIdx % colors.char.length]
      const fg = colors.fg[colorIdx % colors.fg.length]
      const isGrass = tileType.includes('grass')
      // Grass varies per-cell into natural green tones (deterministic hash); every other
      // ground keeps its uniform floor base — no per-cell checkerboard (calmer floor).
      const bg = isGrass ? grassShade(colors.bg[0], col, row) : colors.bg[0]

      // Active art style (ASCII passthrough → char+fg above, byte-identical). Ground cells carry no
      // per-element override, so this depends only on the active style — folded into the cache key so
      // a style switch rebuilds the offscreen ground. `tint` present → this is a REskinned tile: fill
      // the SAME cube+diamond geometry with the tile hue (so it stays iso-angled with z) and drop a
      // small hint — the geometry is reused, only the fill/asset changes. No tint → bg (identical).
      const gk = groundKind(tileType)
      const gdv = resolveDraw(gk, style, undefined, char, fg)
      // reskin → the tile's OWN colour (catalog data), but grass AND the rocky cave floor KEEP their
      // per-cell shade so the field/cavern isn't one flat sheet ("grass is just color"); ASCII → bg.
      const fillBg = cellFill(gdv.tint, bg, isGrass || gk === 'cavefloor', col, row)

      const cellHeight = grid.getHeight(col, row)
      const heightOffset = cellHeight * heightStep
      const drawY = py - heightOffset

      // CUBE sides — only the terrain's exposed front edges actually show a wall, so draw
      // the left face only when the down-left neighbour is lower/absent and the right face
      // only when the down-right neighbour is. Same look, a fraction of the fills.
      const sideBottom = py + cubeDepth
      const leftOpen = row + 1 >= grid.rows || grid.getHeight(col, row + 1) < cellHeight
      const rightOpen = col + 1 >= grid.cols || grid.getHeight(col + 1, row) < cellHeight
      if (leftOpen) {
        ctx.fillStyle = darkenColor(fillBg, 0.5)
        ctx.beginPath()
        ctx.moveTo(px - tileW, drawY)
        ctx.lineTo(px, drawY + tileH)
        ctx.lineTo(px, sideBottom + tileH)
        ctx.lineTo(px - tileW, sideBottom)
        ctx.closePath()
        ctx.fill()
      }
      if (rightOpen) {
        ctx.fillStyle = darkenColor(fillBg, 0.7)
        ctx.beginPath()
        ctx.moveTo(px + tileW, drawY)
        ctx.lineTo(px, drawY + tileH)
        ctx.lineTo(px, sideBottom + tileH)
        ctx.lineTo(px + tileW, sideBottom)
        ctx.closePath()
        ctx.fill()
      }

      // Top face (diamond) - always draw, filled with the tile hue (bg for ASCII → identical)
      ctx.fillStyle = fillBg
      ctx.beginPath()
      ctx.moveTo(px, drawY - tileH)
      ctx.lineTo(px + tileW, drawY)
      ctx.lineTo(px, drawY + tileH)
      ctx.lineTo(px - tileW, drawY)
      ctx.closePath()
      ctx.fill()

      const isWater = WATER_DEPTH_TILES.has(tileType)

      if (bakeStatic) {
        // Static cache: skip the animated water surface (collected for the live pass);
        // bake the grass glyph at full alpha (the ≤1.5% flicker is render-only motion).
        if (isWater) { if (waterOut) waterOut.push({ col, row }); continue }
        drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, false, time, col, row)
        continue
      }

      // Direct / fallback path — byte-identical to the original inline loop for ASCII.
      if (isWater) drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
      drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, true, time, col, row)
    }
  }
}


/** Redraw the animated water cells (recessed shimmer surface + glyph) on top of the
 *  blitted static cache — the one ground element that must stay live each frame.
 *  Matches the original per-water-cell draw order: water depth, then the glyph. */
export function drawIsoWaterCells(ctx: CanvasRenderingContext2D, p: IsoGroundParams, cells: { col: number; row: number }[]): void {
  const { grid, w, h, time, camX, camZ, isoScale, cellSize, tileW, tileH, heightStep, groundFontSize, style } = p
  ctx.font = `bold ${groundFontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const cell of cells) {
    const { col, row } = cell
    const wx = col * cellSize - camX
    const wz = row * cellSize - camZ
    const px = w / 2 + (wx - wz) * isoScale * 0.71
    const py = h / 2 + (wx + wz) * isoScale * 0.36
    const tileType = grid.ground[row]?.[col] || 'grass'
    const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass
    const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
    const colorIdx = noiseVal > 0 ? 0 : 1
    const char = colors.char[colorIdx % colors.char.length]
    const fg = colors.fg[colorIdx % colors.fg.length]
    const bg = colors.bg[0]
    const drawY = py - grid.getHeight(col, row) * heightStep
    const wdv = resolveDraw(groundKind(tileType), style, undefined, char, fg)
    const fillBg = wdv.tint ?? bg // reskin water → the tile's own colour (catalog data); ASCII → bg
    drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
    drawIsoGroundContent(ctx, wdv, px, drawY, tileW, tileH, false, true, time, col, row)
  }
}


export function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  hitMarkers: readonly HitMarker[] = [],
  now: number = time,
  zoom: number = 1,
  attackAnims: readonly AttackAnim[] = [],
  connectors: Connector[] = [],
  quests: readonly Quest[] = [],
  projectiles: readonly Projectile[] = [],
  dayNight: DayNight = 'day',
  attackReach: number = 1,
  style: Style = ASCII_STYLE,
) {
  const __isoT0 = perfNow() // perf probe — rolling avg of render() ms, exposed on window.__isoRenderMs
  // Clear
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const isoScale = grid.isoScale * zoom // mouse-wheel zoom scales the iso projection

  // Camera follows player + pan offset, then CLAMP so the viewport stays on the map. Iso maps
  // screen x/y to the diagonal coords p = col-row (horizontal) and q = col+row (vertical); the
  // viewport spans ±pPad in p and ±qPad in q.
  const Kx = cellSize * isoScale * 0.71  // screen px per unit of (col - row)
  const Ky = cellSize * isoScale * 0.36  // screen px per unit of (col + row)
  const pPad = w / (2 * Kx)              // half viewport width, in (col-row) units
  const qPad = h / (2 * Ky)              // half viewport height, in (col+row) units
  // Clamp in (p, q) space: q to the diamond's full vertical extent so the camera can pan all the
  // way to the top/bottom corners — the old combined (pPad+qPad)/2 col/row clamp kept the whole
  // rect inside the diamond but stopped the camera pPad short of the bottom/top rows (#38). p is
  // then clamped to the diamond's width AT THAT HEIGHT so the sides stay inside it.
  const { fc, fr } = isoCameraFocus(
    (player.x - camOffset.x) / cellSize,
    (player.z - camOffset.y) / cellSize,
    pPad,
    qPad,
    grid.cols,
    grid.rows,
  )
  const camX = fc * cellSize
  const camZ = fr * cellSize

  // Tile dimensions - slightly overlapping to eliminate gaps
  const tileW = cellSize * isoScale * 0.71  // Half-width of diamond
  const tileH = cellSize * isoScale * 0.36  // Half-height of diamond
  const heightStep = cellSize * isoScale * 0.4  // Height per elevation level
  const cubeDepth = tileH * 1.6  // base extrusion so every tile reads as a CUBE

  // Convert world to screen (center of diamond tile)
  const toScreen = (col: number, row: number) => {
    const wx = col * cellSize - camX
    const wz = row * cellSize - camZ
    return {
      x: w / 2 + (wx - wz) * isoScale * 0.71,
      y: h / 2 + (wx + wz) * isoScale * 0.36
    }
  }

  // ─── GROUND TILES (cube sides + diamond tops + glyphs) ─────────────
  // The heaviest part of the frame. Cache it to an offscreen canvas keyed on the
  // camera / zoom / viewport / visible-cells and BLIT it each frame; only draw it
  // directly while the camera is moving (key changing every frame) or when the
  // cache can't be built. The animated water surface is always drawn live on top.

  // Zoom-aware visible range: derive the half-span from the ACTUAL (zoomed) tile
  // size, so we iterate exactly the cells the camera can see — fewer when zoomed in,
  // more when zoomed out — then CLAMP to the grid so off-grid cells aren't scanned.
  const halfSpan = Math.ceil((w / tileW + h / tileH) / 2) + 4
  const camCol = Math.floor(camX / cellSize)
  const camRow = Math.floor(camZ / cellSize)
  const startCol = Math.max(0, camCol - halfSpan)
  const endCol = Math.min(grid.cols - 1, camCol + halfSpan)
  const startRow = Math.max(0, camRow - halfSpan)
  const endRow = Math.min(grid.rows - 1, camRow + halfSpan)
  const groundFontSize = Math.max(12, tileH * 1.1)

  const groundParams: IsoGroundParams = {
    grid, w, h, time, camX, camZ, isoScale, cellSize,
    tileW, tileH, heightStep, cubeDepth,
    startCol, endCol, startRow, endRow, groundFontSize, style,
  }

  ctx.globalAlpha = 1
  const forceDirect = typeof window !== 'undefined' && !!(window as unknown as { __ISO_NOCACHE?: boolean }).__ISO_NOCACHE
  const cacheFits = w <= ISO_CACHE_MAX_DIM && h <= ISO_CACHE_MAX_DIM
  // Camera key = viewport + exact camera + zoom/cell scale. The exact camera means the
  // blit is at offset (0,0) → no resampling → pixel-identical to a direct draw. The
  // content hash (visible cells) is computed ONLY when the camera is stable (a cache-hit
  // candidate) — never while panning, so movement stays a cheap direct draw.
  const camKey = `${w}x${h}|${camX.toFixed(3)},${camZ.toFixed(3)}|${isoScale.toFixed(4)}|${cellSize}|${style.id}`
  let liveWater: { col: number; row: number }[] | null = null
  let didCache = false

  if (!forceDirect && cacheFits) {
    const stableCam = !!isoGroundCache && isoGroundCache.camKey === camKey && isoGroundCache.width === w && isoGroundCache.height === h
    if (stableCam || camKey === isoLastFrameKey) {
      const sig = isoGroundSignature(grid, startCol, endCol, startRow, endRow)
      if (stableCam && isoGroundCache!.contentSig === sig) {
        ctx.drawImage(isoGroundCache!.canvas, 0, 0) // hit → one blit instead of thousands of fills/glyphs
        liveWater = isoGroundCache!.waterCells
        didCache = true
      } else {
        const cc = ensureIsoCacheCanvas(w, h) // camera settled or map edited → (re)build, then blit
        if (cc) {
          cc.ctx.clearRect(0, 0, w, h)
          cc.ctx.globalAlpha = 1
          const water: { col: number; row: number }[] = []
          drawIsoGroundLayer(cc.ctx, groundParams, true, water)
          isoGroundCache = { canvas: cc.canvas, ctx: cc.ctx, camKey, contentSig: sig, width: w, height: h, waterCells: water }
          ctx.drawImage(cc.canvas, 0, 0)
          liveWater = water
          didCache = true
        }
      }
    }
  }
  // Moving / first frame / viewport too big / no DOM → draw directly (no regression, identical).
  if (!didCache) drawIsoGroundLayer(ctx, groundParams, false, null)
  isoLastFrameKey = camKey

  // The animated water surface is excluded from the static cache so its shimmer stays
  // live — redraw just those (sparse) cells on top of the blit each frame.
  if (liveWater && liveWater.length) drawIsoWaterCells(ctx, groundParams, liveWater)

  // ─── CONNECTOR MARKERS (purple diamond + ◊ on each owned cell's top face) ──
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col, pcell.row)
      const drawY = p.y - grid.getHeight(pcell.col, pcell.row) * heightStep
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${tileH * 1.1}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('◊', p.x, drawY)
    }
  }

  // ─── ASSETS + PLAYER (ASCII art stacked in isometric space) ────────

  // Zoom-aware cull: use the SAME span the camera can see (matches the ground tiles above),
  // so zooming OUT reveals more of the map's elements instead of a fixed 30×20 window — at
  // full zoom-out the span covers the whole map, so every element shows.
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camX / cellSize),
    Math.floor(camZ / cellSize),
    halfSpan * 2, halfSpan * 2
  )
  // Ground shadow goes ONLY on a tree's bottom (ground-contact) cell — see isGroundContact.
  const treeCells = new Set(grid.assets.filter(a => a.type === 'tree').map(a => `${a.col},${a.row}`))
  const isTreeCell = (c: number, r: number): boolean => treeCells.has(`${c},${r}`)

  // Sort all objects by depth (back to front). Placed entities depth-sort with
  // assets/player and draw as glyphs on top of their cell.
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  // Buildings render as ONE upright unit (grid.buildings) — collect their footprint cells so we
  // SKIP the per-cell building assets in iso (2D still draws them). Legacy █ buildings aren't
  // grouped, so they fall through and render per-cell as before.
  const buildingFootprint = new Set<string>()
  for (const b of grid.buildings ?? []) {
    const top = b.row - (b.height - 1)
    for (let r = 0; r < b.height; r++) for (let c = 0; c < b.length; c++) buildingFootprint.add(`${b.col + c},${top + r}`)
  }
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset; entity?: Entity; moving?: boolean; inRange?: boolean; building?: GridBuilding }[] = [
    ...visibleAssets
      .filter(a => !(a.type === 'building' && buildingFootprint.has(`${a.col},${a.row}`)))
      .map(a => ({ col: a.col, row: a.row, asset: a })),
    ...(grid.buildings ?? []).map(b => ({ col: b.col + (b.length - 1) / 2, row: b.row, building: b })),
    // The player ENTITY is drawn as the live sprite below (isPlayer), so skip it here
    // to avoid a ghost double at the spawn cell. (Top view keeps it — see renderTopView.)
    ...entities.filter(e => e.kind !== 'player').map(e => {
      const pos = entityRenderCell(e, now) // smooth, deterministic interpolation (motionPos)
      const mot = entityMotion.get(e.id)
      const moving = !!mot && now < mot.startMs + ENEMY_MOVE_MS // mid-interpolation → walk anim
      const inRange = e.kind === 'enemy' && Math.hypot(e.col - pCol, e.row - pRow) <= COMBAT_RANGE
      return { col: pos.col, row: pos.row, entity: e, moving, inRange }
    }),
    {
      col: player.x / cellSize,
      row: player.z / cellSize,
      isPlayer: true
    }
  ].sort((a, b) => (a.col + a.row) - (b.col + b.row))

  // Render each object with ASCII art style
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer) {
      // The player's melee swing progress (0..1) drives the in-hand weapon animation below.
      const inHandSlash = attackAnims.find(a => a.inHand && now - a.start < a.durationMs)
      const swingP = inHandSlash ? Math.min(1, (now - inHandSlash.start) / inHandSlash.durationMs) : null
      drawIsoPlayer(ctx, p.x, p.y - heightOffset - (player.jumpHeight ?? 0), tileW, tileH, player, time, swingP, inHandSlash?.tint, style)
    } else if (obj.entity) {
      const combat = obj.entity.kind === 'enemy' ? enemyCombat.get(obj.entity.id) : undefined
      if (isDeadEnemy(obj.entity, combat)) continue // hidden until it respawns
      const attackable = enemyInAttackReach(obj.entity, Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), attackReach)
      const anchor = drawIsoEntity(ctx, p.x, p.y - heightOffset, obj.entity, tileH, combat, now, obj.moving ?? false, obj.inRange ?? false, attackable, style)
      drawQuestMarker(ctx, entityQuestMarker(obj.entity, quests), anchor.x, anchor.y, Math.max(14, tileH * 1.6))
    } else if (obj.building) {
      // ONE upright unit, oriented by its real road-derived facing. The planner already reserved
      // the oriented footprint rect (road-free), so the billboard can't spill — no gate needed.
      const b = obj.building
      const f = ISO_FACINGS[(b.facing ?? 0) % ISO_FACINGS.length]
      const oC = b.col - 0.5 + f.baseColFrac * b.length // base start = footprint's LEFT EDGE (cell left corner), not the cell centre
      const oR = b.row + 0.5 // base sits on the frontage front edge
      const origin = toScreen(oC, oR)
      const lp = toScreen(oC + f.len[0], oR + f.len[1])
      const colVec = { x: lp.x - origin.x, y: lp.y - origin.y } // per-column step along the length axis
      const dp = toScreen(oC + f.dep[0] * b.depth, oR + f.dep[1] * b.depth)
      const depthVec = { x: dp.x - origin.x, y: dp.y - origin.y } // z-depth = the building's own GROUND depth
      const flicker = Math.sin(time * 0.003 + b.col * 0.5 + b.row * 0.7) * 0.15 + 1
      // Fade the building when the player is near, so a back-facing door behind it is findable.
      const fade = buildingFadeAlpha(pCol, pRow, b, BUILDING_FADE_RADIUS, BUILDING_MIN_ALPHA)
      if (fade < 1) ctx.globalAlpha = fade
      drawIsoBuilding(ctx, b, origin, colVec, depthVec, tileW * 0.9, flicker, style)
      if (fade < 1) ctx.globalAlpha = 1
    } else if (obj.asset) {
      const op = obj.asset.opacity ?? 1 // per-asset opacity for contrast/depth
      if (op < 1) ctx.globalAlpha = op
      // Authored frame animation: offset/rotate/scale the asset around its cell (sway/wind).
      const ax = p.x, ay = p.y - heightOffset
      const ct = assetCellTransform(obj.asset.cellAnim, time)
      if (ct) applyCellTransform(ctx, ax, ay, ct, tileW, tileH)
      drawIsoAssetAscii(ctx, ax, ay, obj.asset, tileW, tileH, time, obj.asset.type === 'tree' && (!!obj.asset.baseShadow || isGroundContact(isTreeCell, obj.asset.col, obj.asset.row)), dayNight, style)
      if (ct) ctx.restore()
      if (op < 1) ctx.globalAlpha = 1
    }
  }

  // Attack animations (slash / shot / lightning / block) in iso space. Read-only:
  // the loop prunes finished ones (animFrame returns null past the duration).
  if (attackAnims.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(14, tileH * 1.7)}px ${ASCII_FONT}`
    for (const a of attackAnims) {
      if (a.inHand) continue // the player's melee is the ONE in-hand weapon swinging (drawn by drawIsoPlayer)
      const f = animFrame(a, now)
      if (!f) continue
      const sp = toScreen(f.x / cellSize, f.z / cellSize)
      ctx.fillStyle = f.color
      if (f.angle != null) {
        // SLASH: swing the blade through its arc AT the attacker's hand (not a stick floating off the cell)
        ctx.save()
        ctx.translate(sp.x, sp.y - tileH * 1.25)
        ctx.rotate(f.angle)
        ctx.fillText(f.char, 0, 0)
        ctx.restore()
      } else {
        ctx.fillText(f.char, sp.x, sp.y - tileH)
      }
    }
  }

  // Travelling projectiles (arrow/bullet/bolt) — lerp along their path in iso space. The
  // loop ticks/resolves/drops them; this is read-only draw at the interpolated cell.
  if (projectiles.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(14, tileH * 1.6)}px ${ASCII_FONT}`
    ctx.fillStyle = '#ffe9a8'
    for (const pr of projectiles) {
      const pc = projectileCellAt(pr, now)
      const sp = toScreen(pc.col + 0.5, pc.row + 0.5)
      ctx.fillText(pr.glyph, sp.x, sp.y - tileH)
    }
  }

  // Floating "+dmg" hit markers, drawn over everything in iso space.
  for (const marker of hitMarkers) {
    const p = toScreen(marker.col + 0.5, marker.row + 0.5)
    drawHitMarker(ctx, p.x, p.y, marker, now)
  }

  // ─── NIGHT LIGHTING ─────────────────────────────────────────────────
  // After the scene draws: a navy veil over everything, then steady warm pools at each lamp head.
  if (dayNight === 'night') {
    const lamps = collectLampGlows(grid, (c, r) => toScreen(c, r), tileW * LAMP_GLOW.radiusTiles, tileH * 1.5, w, h)
    drawNightLighting(ctx, w, h, lamps)
  }

  // ─── DEBUG MODE ────────────────────────────────────────────────────

  if (isDebugMode()) {
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize)
  }

  // ─── UI ───────────────────────────────────────────────────────────

  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillText(`Grid: ${Math.floor(player.x / cellSize)}, ${Math.floor(player.z / cellSize)}`, 10, 50)

  if (isDebugMode()) {
    ctx.fillStyle = '#ff4444'
    ctx.fillText('DEBUG MODE', 10, 70)
  }

  const __isoMs = perfNow() - __isoT0
  isoRenderMsEMA = isoRenderMsEMA === 0 ? __isoMs : isoRenderMsEMA * 0.9 + __isoMs * 0.1
  if (typeof window !== 'undefined') (window as unknown as { __isoRenderMs?: number }).__isoRenderMs = isoRenderMsEMA
}


/** Draw multi-row ASCII art in the TREE block language: each row gets a solid `bg` block
 *  (sized to that row's glyph extent) + a bright `fg` glyph + a 1px shadow. Rows stack
 *  bottom-to-top from `baseY`, left-aligned at `leftX` (monospace advance = `charW`). Shared
 *  by entities + the player so the whole cast reads as ROBUST sprites, not thin line-art.
 *  Caller sets ctx.font + textAlign 'left' + textBaseline 'middle'. */
export function drawBlockFigure(
  ctx: CanvasRenderingContext2D,
  art: readonly string[],
  leftX: number,
  baseY: number,
  lineHeight: number,
  charW: number,
  fg: string,
  bg: string,
): void {
  for (let i = 0; i < art.length; i++) {
    const line = art[art.length - 1 - i]
    const ly = baseY - i * lineHeight
    const start = line.length - line.trimStart().length // skip leading spaces — block hugs the glyphs
    const end = line.trimEnd().length
    if (end > start) {
      const blockH = lineHeight * 0.78 // skinnier than the full line — the backing hugs the glyph row
      ctx.fillStyle = bg
      ctx.fillRect(leftX + start * charW - 1, ly - blockH / 2, (end - start) * charW + 2, blockH)
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)' // 1px drop shadow for crisp edges
    ctx.fillText(line, leftX + 1, ly + 1)
    ctx.fillStyle = fg
    ctx.fillText(line, leftX, ly)
  }
}


export function drawIsoPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  player: PlayerState,
  time: number,
  swingP: number | null = null,
  swingTint?: string,
  style: Style = ASCII_STYLE,
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // Breathing animation
  const breathe = Math.sin(time * 0.004) * 2

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // Armor tint: steel-blue when wearing gear, warm yellow otherwise — the figure visibly
  // changes the moment you equip armor. Paired with a dark block bg (the trees' language).
  const bodyColor = player.armored ? '#bcd4ff' : (player.bodyColor ?? '#ffdd00')
  const bodyBg = player.armored ? '#243a5e' : (player.bodyBg ?? '#5a4412')

  const charW = fontSize * 0.6
  const maxW = playerArt.reduce((m, r) => Math.max(m, r.length), 0)
  const pHalf = (maxW * charW) / 2
  // Ground shadow sized to the player figure (always reads; fixed — doesn't bob).
  drawGroundShadow(ctx, x, y - tileH * 0.5, pHalf)

  // Robust block figure — same recipe as entities + trees; `breathe` bobs the whole figure. When
  // attacking, HIDE the static arm on the swinging side (the animated swing-arm below replaces it) so
  // we never draw two arms (#47/#39).
  const swingArmDir = player.facing === 'left' ? -1 : 1
  // During a swing, base the figure on the IDLE pose (predictable arm) and HIDE the facing-side arm
  // bracket — the swing-arm below (the SAME bracket glyph, just rotated) replaces it. (#47/#67)
  const figArt = swingP == null
    ? playerArt
    : playerSprite.idle.map(row => (swingArmDir > 0 ? row.replace('>', ' ') : row.replace('<', ' ')))
  const pdv = resolveDraw('player', style, undefined, '', bodyColor)
  if (pdv.image) {
    drawStyledImage(ctx, pdv.image, x, y - lineHeight - breathe, tileH * 2.6)
  } else if (pdv.char) {
    ctx.font = `bold ${fontSize * 1.8}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = pdv.color
    // Play the hero's AUTHORED animation (data-driven, direction-aware) — no hardcoded walk/run/flip.
    const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
    drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), x, y - lineHeight - breathe, pf.flipX)
    ctx.textAlign = 'left'
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  } else {
    drawBlockFigure(ctx, figArt, x - pHalf, y - lineHeight * 0.5 - breathe, lineHeight, charW, bodyColor, bodyBg)
  }

  // The held weapon + the shield, both at the ARM row. The weapon sits on the FACING hand; the
  // shield on the OFF-hand (the side OPPOSITE the weapon) at the SAME arm height — so they never
  // land on the same hand in any facing (#49).
  const onLeft = player.facing === 'left'
  const dir = onLeft ? -1 : 1 // +1 → facing right, weapon on the RIGHT hand
  const weaponSize = fontSize * 1.7
  const handY = y - lineHeight * 1.5 - breathe // the HAND, at the arm/body row (shared by weapon + shield)
  const shoulderX = x + dir * pHalf * 0.25 // at the body, on the weapon side
  const shoulderY = y - lineHeight * 1.95 - breathe // shoulder = TOP of the # row (the pivot)
  drawPlayerArm(ctx, {
    swinging: swingP != null, // an attack is mid-flight → the ARM drives the swing (#47)
    swingP: swingP ?? 0,
    facingDir: dir,
    fontSize,
    bodyColor,
    weaponGlyph: player.weaponGlyph,
    weaponTint: '#e6e6e6',
    swingTint,
    shoulderX,
    shoulderY,
    restHandX: x + dir * (pHalf + weaponSize * 0.18),
    restHandY: handY,
    shieldGlyph: player.shieldGlyph,
    shieldX: x - dir * (pHalf + fontSize * 0.3), // off-hand: opposite the weapon
    shieldY: handY, // same arm row as the weapon hand
    shieldR: fontSize * 0.5,
  })

  // Life bar + name above the head — the SAME treatment enemies get (drawFigureVitals), so the
  // player reads identically. Drawn only once HP is mirrored onto the struct (see the game loop).
  if (player.maxHp != null) {
    const figureTop = y - lineHeight * 0.5 - breathe - playerArt.length * lineHeight
    const barWidth = Math.max(28, tileH * 2.2)
    const nameSize = Math.max(9, tileH * 0.95)
    drawFigureVitals(ctx, x, figureTop, barWidth, 7, nameSize, barFraction(player.hp ?? player.maxHp, player.maxHp), playerDisplayName(player.name))
  }
}


// Apex roof glyph by type: a house PEAKS (▲ = triangle roof); every other type keeps the flat
// (squared) apex. Replaces the default roof_top glyph for that one cell.
export const ROOF_APEX_GLYPH: Record<string, string> = { house: '▲' }


export function drawIsoLabeledCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileH: number,
): void {
  const char = asset.art[0] ?? '?'
  const fontSize = tileH * 1.25
  // Sit the glyph ON its own cell (same anchor as the ground glyph: p.y -
  // heightOffset). The old half-tile lift floated the canopy ~half a cell north
  // of the cell it actually blocks, so leaves *looked* passable. Aligned now:
  // the leaf you see is the cell that blocks; only the canopy TOP stays walkable.
  const cy = y
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Monospace single glyph → advance ≈ 0.6em. Avoids a per-cell measureText(), the
  // canvas-2D layout call that tanked iso FPS on dense (forest) stages.
  const w = fontSize * 0.6
  // Building cells FILL with their own part color so a dark door + a glass/lit window read as
  // solid coloured blocks (a dark glyph on a black backing was invisible). Trees keep the plain
  // dark backing behind their canopy glyph.
  const base = asset.color ?? '#cccccc'
  ctx.fillStyle = asset.type === 'building' ? darkenColor(base, 0.28) : 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x - w / 2 - 2, cy - fontSize * 0.55, w + 4, fontSize * 1.1)
  // Roof shape by building type: houses peak (▲), squared "buildings" stay flat.
  const glyph = asset.label === 'roof_top' ? (ROOF_APEX_GLYPH[asset.buildingType ?? ''] ?? char) : char
  ctx.fillStyle = base
  ctx.fillText(glyph, x, cy)

  // Type signage on the apex: a "STORE" marquee, a red hospital cross. Only the ONE
  // roof_top cell per building hits this → the measureText here is rare, not per-cell.
  if (asset.label === 'roof_top' && asset.buildingType) {
    const badge = BUILDING_BADGES[asset.buildingType]
    if (badge) {
      const bf = fontSize * (badge.text.length > 1 ? 0.5 : 0.9)
      ctx.font = `bold ${bf}px ${ASCII_FONT}`
      const by = cy - fontSize * 0.95
      const bw = ctx.measureText(badge.text).width
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
      ctx.fillRect(x - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
      ctx.fillStyle = badge.color
      ctx.fillText(badge.text, x, by)
    }
  }
}


export function drawIsoEntity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  entity: Entity,
  tileH: number,
  combat?: CombatState,
  now: number = idleNow(),
  moving = false,
  inRange = false,
  attackable = false,
  style: Style = ASCII_STYLE,
): { x: number; y: number } {
  // Multi-row ASCII creature, drawn bottom-to-top. The frame comes from the animation
  // engine (frameAt): idle bob when still, a faster step cycle while moving, an attack
  // cadence when the player is in range — built on top of the existing base/alt art.
  const art = entityAnimFrame(entity, now, moving, inRange)
  // Same scale as drawIsoPlayer, so NPCs/monsters stand as tall as the player
  // (a 3-row figure ≈ 2 cells tall), not a squished 1×1.
  const fontSize = tileH * 1.2
  const lineHeight = tileH * 1.4
  const baseY = y - lineHeight * 0.5
  // LEFT-align all rows on a shared origin (monospace advance ≈ 0.6em) so the figure's
  // shape holds together — centering each row independently mangles real ASCII art.
  const charW = fontSize * 0.6
  const maxW = art.reduce((m, r) => Math.max(m, r.length), 0)
  const leftX = x - (maxW * charW) / 2
  // Ground shadow sized to the figure so it always reads (not hidden behind it).
  drawGroundShadow(ctx, x, baseY + tileH * 0.1, (maxW * charW) / 2)
  // In-strike-range indicator: a ring at the feet, under the figure (#35).
  if (attackable) drawRangeRing(ctx, x, baseY + tileH * 0.1, (maxW * charW) / 2 + tileH * 0.2, now)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const pal = entityPalette(entity)
  const kind = entityKind(entity.kind)
  const isEnemy = kind === 'enemy'
  // An enemy draws its per-type tile (goblin→👺, wolf→🐺, …) unless a manual tileOverride wins.
  const override = entity.tileOverride ?? (isEnemy ? enemyTileId(entity.enemyType, style) : undefined)
  const edv = resolveDraw(kind, style, override, '', pal.fg)
  // Ground the billboard by its BOTTOM at the shadow line, so ANY tile size stays grounded (a
  // smaller enemy no longer floats above its shadow). `groundY` is the feet contact point.
  const groundY = baseY + tileH * 0.1
  if (edv.image) {
    const imgPx = tileH * (isEnemy ? 1.9 : 2.4)
    drawStyledImage(ctx, edv.image, x, groundY - imgPx * 0.42, imgPx)
  } else if (edv.char) {
    // Enemies read a touch smaller than people so a mob doesn't tower over the hero. Play the
    // entity's AUTHORED animation (data-driven); enemies default to their static glyph.
    const emojiPx = fontSize * (isEnemy ? 1.35 : 1.7)
    ctx.font = `bold ${emojiPx}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = edv.color
    const anims = entity.animations ?? (isEnemy ? undefined : DEFAULT_CHARACTER_ANIMATIONS)
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), x, groundY - emojiPx * 0.42, ef.flipX)
    ctx.textAlign = 'left'
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  } else {
    drawBlockFigure(ctx, art, leftX, baseY, lineHeight, charW, pal.fg, pal.bg)
  }

  // Top of the figure — where above-entity overlays (quest marker) anchor.
  const figureTop = baseY - art.length * lineHeight
  if (entity.kind !== 'enemy') return { x, y: figureTop - lineHeight * 0.5 }

  // Enemy vitals (HP bar + name) drew for EVERY enemy, so a mob-heavy cave/temple became a wall of
  // "skeleton/bat/spider" text. Show them only when the enemy is ENGAGED (in combat proximity) or
  // DAMAGED; an idle distant enemy is just its self-identifying glyph (💀/🦇/🕷️) — click it for the
  // Inspector. Standard action-RPG behaviour: bars appear on engagement/damage, not always-on.
  const frac = hpFraction(entity, combat)
  if (frac >= 0.999 && !inRange && !attackable) return { x, y: figureTop - lineHeight * 0.5 }
  const barWidth = Math.max(28, tileH * 2.2)
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, tileH * 0.95)
  return drawFigureVitals(ctx, x, figureTop, barWidth, 7, nameSize, frac, label)
}


// Diablo/PoE-style proximity fade: a building goes semi-transparent when the player is within
// BUILDING_FADE_RADIUS cells, easing to BUILDING_MIN_ALPHA when standing on it, so an occluded
// (back-facing) door is findable on approach.
export const BUILDING_FADE_RADIUS = 3.5

export const BUILDING_MIN_ALPHA = 0.35


// ISO facing. Each building stands inside its plot RECT — cols [col, col+L] × the clear headroom
// rows ABOVE the frontage (that whole rect is road-free, verified on the grid). A facing keeps
// the footprint inside that rect by extruding UP into the headroom, never DOWN onto the street
// it fronts. `baseColFrac` is which end of the frontage the base starts at; `len`/`dep` are the
// grid axes the length + depth run along. Applied only when the rotated footprint fits (L < H);
// wide-short types (store/temple/castle) stay front-facing so they can't spill past the rect.
export const ISO_FACINGS: { len: [number, number]; dep: [number, number]; baseColFrac: number }[] = [
  { len: [1, 0], dep: [0, -1], baseColFrac: 0 },  // faces down-left:  base +col,        depth up-right
  { len: [0, -1], dep: [-1, 0], baseColFrac: 1 }, // faces down-right: base up the right, depth up-left
]


export type Pt = { x: number; y: number }

export const ptAdd = (p: Pt, v: Pt): Pt => ({ x: p.x + v.x, y: p.y + v.y })

export const ptScale = (v: Pt, k: number): Pt => ({ x: v.x * k, y: v.y * k })

export const fillQuad = (ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: Pt, d: Pt): void => {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.fill()
}


/**
 * Fill an iso FACE by tiling a TILE across it, SHEARED to the face — the ONE place a tile
 * (an emoji glyph now, an image sprite later) becomes an iso-angled texture. The face is the
 * parallelogram `origin + [0,1]·eA + [0,1]·eB` (eA = the bottom edge vector, eB = the up/side
 * edge vector). We push a CTM built from (eA, eB, origin) scaled into a 64×64 work box — so a
 * unit tile maps onto the parallelogram and every glyph/image inherits the shear — clip to the
 * box, then stamp `na`×`nb` tiles across it. That single transform is why a colored-square emoji
 * becomes the ground DIAMOND fill and a brick emoji tiles UP a wall at the iso angle, instead of
 * standing upright. Font size is kept in a normal px range (the 64-box) so glyphs never clamp to
 * a sub-pixel size. Callers invoke this only on a reskin (a style tile is active); the ASCII
 * passthrough path never reaches here, so ASCII stays byte-identical.
 */
export function fillIsoFaceWithTile(
  ctx: CanvasRenderingContext2D,
  origin: Pt,
  eA: Pt,
  eB: Pt,
  tv: { char?: string; color: string; image?: ImageVisual },
  na: number,
  nb: number,
): void {
  const S = 64 // work-box side; keeps font px normal under the shear CTM (no sub-pixel fonts)
  const cols = Math.max(1, Math.round(na))
  const rows = Math.max(1, Math.round(nb))
  const cw = S / cols
  const ch = S / rows
  ctx.save()
  ctx.transform(eA.x / S, eA.y / S, eB.x / S, eB.y / S, origin.x, origin.y)
  ctx.beginPath()
  ctx.rect(0, 0, S, S)
  ctx.clip()
  if (tv.image) {
    const img = tileImage(tv.image.src)
    if (img) {
      const sx = tv.image.sx ?? 0
      const sy = tv.image.sy ?? 0
      const sw = tv.image.sw ?? img.naturalWidth
      const sh = tv.image.sh ?? img.naturalHeight
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(img, sx, sy, sw, sh, i * cw, j * ch, cw, ch)
    }
  } else if (tv.char) {
    ctx.fillStyle = tv.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.min(cw, ch) * 1.16}px ${ASCII_FONT}` // slight overfill; the clip trims the excess
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.fillText(tv.char, (i + 0.5) * cw, (j + 0.5) * ch)
  }
  ctx.restore()
}


/** One facade cell as an ISO PARALLELOGRAM: the bottom edge runs along `colVec` (the iso
 *  angle), the sides rise straight up by `cellH`. Same tile vocabulary as 2D (red /\ roof,
 *  gold |[]| body, |==| door) — just sheared onto the iso axis instead of a 90° rect. */
export interface FacadeColors { wall: string; door: string; window: string; roof: string }


export function drawIsoFacadeTile(ctx: CanvasRenderingContext2D, bl: Pt, colVec: Pt, cellH: number, kind: string, flicker: number, colors: FacadeColors, style: Style = ASCII_STYLE): void {
  const up: Pt = { x: 0, y: -cellH }
  const br = ptAdd(bl, colVec)
  const tl = ptAdd(bl, up)
  const tr = ptAdd(br, up)
  const isRoof = kind === 'roof'
  const isDoor = kind === 'door'
  const isWindow = kind === 'window'
  // distinct per-cell bg from the SAME per-building palette as 2D (door = dark doorway, window = glass)
  const bg = isRoof ? colors.roof : isDoor ? colors.door : isWindow ? colors.window : colors.wall
  const fg = isRoof
    ? darkenColor(colors.roof, 0.58) // /\ as a darker shade of this roof
    : isDoor
    ? 'rgba(232, 212, 170, 0.9)' // warm handle on the dark door
    : isWindow
    ? 'rgba(40, 62, 84, 0.85)' // dark frame on the glass
    : darkenColor(colors.wall, 0.72)
  const glyph = isRoof ? '/\\' : isDoor ? '▯' : isWindow ? '⊞' : ''
  ctx.fillStyle = bg // the sheared iso QUAD, filled at the tile hue (facadeColors are style-tinted when reskinned)
  fillQuad(ctx, bl, br, tr, tl)
  const mid = { x: (bl.x + tr.x) / 2, y: (bl.y + tr.y) / 2 }
  const fdv = resolveDraw(kind as ElementKind, style, undefined, glyph, fg)
  // Reskin (a style tile / image is active): tile it SHEARED onto this facade face — the face IS
  // the parallelogram (bl, colVec, up), so wall→brick, roof→tile, door/window carry their own
  // glyph, all angled WITH the face (never an upright square). One primitive for emoji + image.
  // ASCII passthrough (no tint/image) draws its glyph centered exactly as before.
  if (fdv.tint || fdv.image) {
    fillIsoFaceWithTile(ctx, bl, colVec, up, { char: fdv.char, color: fdv.color, image: fdv.image }, 1, 1)
    return
  }
  if (!fdv.char) return
  ctx.font = `bold ${cellH * 0.62}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fdv.color
  ctx.fillText(fdv.char, mid.x, mid.y)
}


export const ROOF_ROWS = 2 // facade roof is always the top 2 rows (mirrors composeBuilding)

export const ROOF_OVERHANG = 0.3 // peaked-roof eaves stick out past the walls

export const ROOF_RIDGE_FRAC = 0.46 // peaked-roof flat-top width as a fraction of length


/** ISO building = the 2D facade standing at its plot, sheared onto the iso angle, drawn as a
 *  SOLID box — all four walls + every roof face filled, so it never shows through from any
 *  facing — with the z-depth extruded along depthVec. Houses get a peaked (trapezoid-prism)
 *  roof, flat types a box slab; EVERY roof face is red. `origin` = front-bottom-left corner;
 *  `colVec` = per-column length step; `depthVec` = full z-depth back. */
export function drawIsoBuilding(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  origin: Pt,
  colVec: Pt,
  depthVec: Pt,
  cellH: number,
  flicker: number,
  style: Style = ASCII_STYLE,
): void {
  // Billboard size comes from the FACADE grid (b.cells), not the footprint span — for east/west
  // buildings the footprint rect is rotated (length/height swapped), so reading b.length/b.height
  // there would draw the facade with the wrong proportions.
  const L = b.cells[0]?.length ?? b.length
  const H = b.cells.length
  // A landmark type (temple/manor/castle/cathedral) draws as its own big emoji, sitting on its
  // footprint, so it reads as what it IS instead of another brick box. Others fall through to the box.
  const landmark = buildingLandmarkEmoji(b.type, style)
  if (landmark) {
    const depth = Math.max(1, b.depth)
    const cx = origin.x + colVec.x * (L / 2) + depthVec.x * (depth / 2)
    const gy = origin.y + colVec.y * (L / 2) + depthVec.y * (depth / 2)
    drawBuildingLandmark(ctx, landmark, cx, gy + cellH * 0.4, Math.max(L, depth) * cellH * 1.25)
    return
  }
  const bodyH = H - ROOF_ROWS // wall/window/door rows
  const up = (n: number): Pt => ({ x: 0, y: -n * cellH })
  // Houses peak (composeBuilding leaves empty corners in row 0); flat types keep a box roof.
  const peaked = (b.cells[0] ?? []).some(k => k === 'empty')

  // Per-building colors from the SAME source as 2D/top, so all three views agree. Wall + roof faces
  // are shaded by orientation (front brightest → back darkest); the facade tiles (door/windows) use
  // the full palette.
  const tcol = b.type as BuildingType
  // A reskin (Emoji/image style) tints the SAME cube (roof colour on the roof faces, wall on the
  // walls, door/window at their own hue) AND — via tileFace below — overlays the real tile SHEARED
  // onto each face, so the box reads as brick/tiled at the iso angle (the emoji test for real
  // sprites). ASCII → tint undefined → the byte-identical building palette, no overlay.
  const wallDV = resolveDraw('wall', style, undefined, '', buildingCellColor(tcol, 'wall', b.col))
  const roofDV = resolveDraw('roof', style, undefined, '', buildingCellColor(tcol, 'roof', b.col))
  const wallC = wallDV.tint ?? buildingCellColor(tcol, 'wall', b.col)
  // Roof colour ALWAYS from the game DATA (buildingCellColor varies the roof PER BUILDING → roofs
  // aren't monotone red, even on a reskin). The reskin roof faces show this varied colour directly;
  // a fixed-colour roof emoji would hide it, so the roof tiles NO glyph (walls still tile their brick).
  const roofC = buildingCellColor(tcol, 'roof', b.col)
  const doorC = resolveDraw('door', style, undefined, '', buildingCellColor(tcol, 'door', b.col)).tint ?? buildingCellColor(tcol, 'door', b.col)
  const windowC = resolveDraw('window', style, undefined, '', buildingCellColor(tcol, 'window', b.col)).tint ?? buildingCellColor(tcol, 'window', b.col)
  const reskinned = !!(wallDV.tint || wallDV.image || roofDV.tint || roofDV.image)
  const roofFaceDV: DrawVisual = { char: '', color: roofC } // reskin roof: coloured face, no emoji glyph
  const facadeColors: FacadeColors = {
    wall: withAlpha(wallC, 0.98),
    door: withAlpha(doorC, 0.98),
    window: withAlpha(windowC, 0.98),
    roof: withAlpha(roofC, 0.98),
  }
  // Side faces are shaded by the global LIGHT: the wall facing the sun is brighter than the one
  // facing away (outward normals ≈ ∓colVec). Front facade stays full/bright, the far wall dim.
  const sideLF = faceLight(-colVec.x, -colVec.y) // left wall (faces -col)
  const sideRF = faceLight(colVec.x, colVec.y) // right wall (faces +col)
  const wallLeft = withAlpha(darkenColor(wallC, sideLF), 0.98)
  const wallRight = withAlpha(darkenColor(wallC, sideRF), 0.98)
  const wallBack = withAlpha(darkenColor(wallC, 0.82), 0.98)
  const roofFront = withAlpha(roofC, 0.98) // sunny front roof face = full roof color
  const roofSlopeL = withAlpha(darkenColor(roofC, Math.min(1, sideLF + 0.06)), 0.98)
  const roofSlopeR = withAlpha(darkenColor(roofC, Math.min(1, sideRF + 0.06)), 0.98)
  const roofTop = withAlpha(darkenColor(roofC, 0.9), 0.98)
  const roofBack = withAlpha(darkenColor(roofC, 0.66), 0.98)

  // ground corners + helper to lift a corner to the eaves (top of the walls)
  const fbl = origin
  const fbr = ptAdd(fbl, ptScale(colVec, L))
  const bbl = ptAdd(fbl, depthVec)
  const bbr = ptAdd(fbr, depthVec)
  const eave = (p: Pt): Pt => ptAdd(p, up(bodyH))
  const mid = (a: Pt, c: Pt): Pt => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 })

  // On a reskin, overlay the wall/roof TILE sheared onto a SOLID face: a = bottom-left corner,
  // b = bottom-right (so b−a is the bottom edge), d = top-left (d−a is the up/side edge). Tile
  // counts are capped so a big wall stays a few tiles (emoji fillText runs every frame). The two
  // peaked-roof trapezoid caps aren't parallelograms, so they keep their flat roof tint. No-op on
  // ASCII (reskinned = false) → the box stays byte-identical.
  const FACE_CAP = 3
  const tileFace = (a: Pt, b: Pt, d: Pt, dv: DrawVisual, na: number, nb: number): void => {
    if (!reskinned) return
    fillIsoFaceWithTile(
      ctx,
      a,
      { x: b.x - a.x, y: b.y - a.y },
      { x: d.x - a.x, y: d.y - a.y },
      { char: dv.char, color: dv.color, image: dv.image },
      Math.min(FACE_CAP, na),
      Math.min(FACE_CAP, nb),
    )
  }

  // A row of small windows on a wall face: `base` = the face's bottom-left ground corner, `axis` =
  // its bottom edge vector (full span), `count` evenly-spaced lights at mid-wall height. Glass fill
  // + dark frame mirrors the front facade so the side/back walls read as windowed, not blank.
  const wallWindows = (base: Pt, axis: Pt, count: number): void => {
    if (bodyH < 1) return
    const slot = 1 / count
    const halfW = slot * 0.26 // window half-width as a fraction of the wall span
    const sill = up(bodyH * 0.46) // window bottom, ~mid wall
    const winH = up(bodyH * 0.42) // window height
    ctx.lineWidth = Math.max(1, cellH * 0.06)
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) * slot
      const bl = ptAdd(ptAdd(base, ptScale(axis, t - halfW)), sill)
      const br = ptAdd(ptAdd(base, ptScale(axis, t + halfW)), sill)
      const tl = ptAdd(bl, winH)
      const tr = ptAdd(br, winH)
      ctx.beginPath()
      ctx.moveTo(bl.x, bl.y)
      ctx.lineTo(br.x, br.y)
      ctx.lineTo(tr.x, tr.y)
      ctx.lineTo(tl.x, tl.y)
      ctx.closePath()
      ctx.fillStyle = facadeColors.window
      ctx.fill()
      ctx.strokeStyle = darkenColor(wallC, 0.45)
      ctx.stroke()
    }
  }

  // `/\` chevrons marching along a roof SIDE face's centre line (front→back), in a darker roof
  // tone — so the roof reads as shingled from the side too, like draw2DBuilding's roof glyph.
  const roofChevrons = (frontMid: Pt, backMid: Pt, count: number): void => {
    if (reskinned) return // the emoji/image roof tiles already read as shingled — no ASCII /\ on top
    ctx.font = `bold ${cellH * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = darkenColor(roofC, 0.58)
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      ctx.fillText('/\\', frontMid.x + (backMid.x - frontMid.x) * t, frontMid.y + (backMid.y - frontMid.y) * t)
    }
  }
  const roofSideCount = Math.max(2, Math.min(4, Math.round(b.depth)))

  // Simple ground shadow: a soft ellipse offset opposite the sun (down-right along -LIGHT.dir), so
  // the building reads as grounded. Drawn first → the box sits on top; only the cast part shows.
  const gC = mid(mid(fbl, fbr), mid(bbl, bbr))
  const footSpan = Math.hypot(colVec.x, colVec.y) * L + Math.hypot(depthVec.x, depthVec.y) * b.depth
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
  ctx.beginPath()
  ctx.ellipse(gC.x - LIGHT.dir.x * cellH * 0.6, gC.y - LIGHT.dir.y * cellH * 0.6 + cellH * 0.15, footSpan * 0.34, footSpan * 0.18, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Paint the facade tiles (door/windows) onto one face. `base` is that face's bottom-left corner.
  const drawFacade = (base: Pt): void => {
    for (let r = 0; r < H; r++) {
      if (peaked && r < ROOF_ROWS) continue
      for (let c = 0; c < L; c++) {
        const kind = b.cells[r]?.[c]
        if (!kind || kind === 'empty') continue
        const bl = ptAdd(ptAdd(base, ptScale(colVec, c)), up(H - 1 - r))
        drawIsoFacadeTile(ctx, bl, colVec, cellH, kind, flicker, facadeColors, style)
      }
    }
  }

  // North/west houses front a road on the camera-FAR side: draw their facade on the BACK face
  // FIRST so the solid box occludes it (door toward the road, never toward the near grass).
  if (b.facadeOnBack) drawFacade(bbl)

  // ── WALL BODY (solid box, ground → eaves): both sides + the non-facade face ──
  ctx.fillStyle = wallBack
  if (b.facadeOnBack) { fillQuad(ctx, fbl, fbr, eave(fbr), eave(fbl)); tileFace(fbl, fbr, eave(fbl), wallDV, L, bodyH) } // plain FRONT wall (camera side)
  else { fillQuad(ctx, bbl, bbr, eave(bbr), eave(bbl)); tileFace(bbl, bbr, eave(bbl), wallDV, L, bodyH) } // plain BACK wall
  ctx.fillStyle = wallLeft
  fillQuad(ctx, fbl, bbl, eave(bbl), eave(fbl)); tileFace(fbl, bbl, eave(fbl), wallDV, b.depth, bodyH) // left
  ctx.fillStyle = wallRight
  fillQuad(ctx, fbr, bbr, eave(bbr), eave(fbr)); tileFace(fbr, bbr, eave(fbr), wallDV, b.depth, bodyH) // right

  // Windows on the faces the front facade doesn't cover: both sides + the plain (non-facade) wall.
  const depthWindows = Math.max(2, Math.min(3, Math.round(b.depth)))
  const lenWindows = Math.max(2, Math.min(3, Math.round(L / 2)))
  wallWindows(fbl, depthVec, depthWindows) // left wall
  wallWindows(fbr, depthVec, depthWindows) // right wall
  if (b.facadeOnBack) wallWindows(fbl, ptScale(colVec, L), lenWindows) // plain FRONT wall (camera side)
  else wallWindows(bbl, ptScale(colVec, L), lenWindows) // plain BACK wall

  // ── ROOF (all faces red) ──
  if (peaked) {
    const rh = (L * ROOF_RIDGE_FRAC) / 2
    const FEL = ptAdd(eave(fbl), ptScale(colVec, -ROOF_OVERHANG))
    const FER = ptAdd(eave(fbr), ptScale(colVec, ROOF_OVERHANG))
    const BEL = ptAdd(FEL, depthVec)
    const BER = ptAdd(FER, depthVec)
    const FRL = ptAdd(ptAdd(fbl, ptScale(colVec, L / 2 - rh)), up(H))
    const FRR = ptAdd(ptAdd(fbl, ptScale(colVec, L / 2 + rh)), up(H))
    const BRL = ptAdd(FRL, depthVec)
    const BRR = ptAdd(FRR, depthVec)
    ctx.fillStyle = roofBack
    fillQuad(ctx, BEL, BER, BRR, BRL) // back trapezoid (kept flat-tinted — not a parallelogram)
    ctx.fillStyle = roofSlopeL
    fillQuad(ctx, FEL, BEL, BRL, FRL); tileFace(FEL, BEL, FRL, roofFaceDV, b.depth, ROOF_ROWS) // left slope
    ctx.fillStyle = roofSlopeR
    fillQuad(ctx, FER, BER, BRR, FRR); tileFace(FER, BER, FRR, roofFaceDV, b.depth, ROOF_ROWS) // right slope
    ctx.fillStyle = roofTop
    fillQuad(ctx, FRL, FRR, BRR, BRL); tileFace(FRL, FRR, BRL, roofFaceDV, 2, b.depth) // flat ridge top
    ctx.fillStyle = roofFront
    fillQuad(ctx, FEL, FER, FRR, FRL) // front trapezoid (the `‾\_/‾`, kept flat-tinted)
    // shingle the two side slopes with /\ so the roof reads from the side too
    roofChevrons(mid(FEL, FRL), mid(BEL, BRL), roofSideCount) // left slope
    roofChevrons(mid(FER, FRR), mid(BER, BRR), roofSideCount) // right slope
  } else {
    const top = (p: Pt): Pt => ptAdd(p, up(H))
    ctx.fillStyle = roofBack
    fillQuad(ctx, eave(bbl), eave(bbr), top(bbr), top(bbl)); tileFace(eave(bbl), eave(bbr), top(bbl), roofFaceDV, L, ROOF_ROWS)
    ctx.fillStyle = roofSlopeL
    fillQuad(ctx, eave(fbl), eave(bbl), top(bbl), top(fbl)); tileFace(eave(fbl), eave(bbl), top(fbl), roofFaceDV, b.depth, ROOF_ROWS) // left
    ctx.fillStyle = roofSlopeR
    fillQuad(ctx, eave(fbr), eave(bbr), top(bbr), top(fbr)); tileFace(eave(fbr), eave(bbr), top(fbr), roofFaceDV, b.depth, ROOF_ROWS) // right
    ctx.fillStyle = roofTop
    fillQuad(ctx, top(fbl), top(fbr), top(bbr), top(bbl)); tileFace(top(fbl), top(fbr), top(bbl), roofFaceDV, L, b.depth)
    ctx.fillStyle = roofFront
    fillQuad(ctx, eave(fbl), eave(fbr), top(fbr), top(fbl)); tileFace(eave(fbl), eave(fbr), top(fbl), roofFaceDV, L, ROOF_ROWS)
    // shingle the two side faces with /\ so the slab roof reads from the side too
    roofChevrons(mid(eave(fbl), top(fbl)), mid(eave(bbl), top(bbl)), roofSideCount) // left
    roofChevrons(mid(eave(fbr), top(fbr)), mid(eave(bbr), top(bbr)), roofSideCount) // right
  }

  // ── FRONT FACADE TILES (on top of the box, nearest the camera) for south/east houses ──
  if (!b.facadeOnBack) drawFacade(fbl)

  // ── TYPE SIGNAGE (STORE / HOSPITAL) floating above the roof apex — mirrors the 2D/top badge
  //    (black pill + colored text) so a shop / clinic reads at a glance in iso too. Only
  //    store + hospital carry a badge. Projected at the footprint-centre lifted to the roof top.
  const badge = BUILDING_BADGES[b.type]
  if (badge) {
    const apex = ptAdd(ptAdd(ptAdd(fbl, ptScale(colVec, L / 2)), ptScale(depthVec, 0.5)), up(H))
    const bf = cellH * (badge.text.length > 1 ? 0.7 : 1.1)
    ctx.font = `bold ${bf}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const bw = ctx.measureText(badge.text).width
    const by = apex.y - bf * 0.9 // sit just above the apex
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(apex.x - bw / 2 - 3, by - bf * 0.65, bw + 6, bf * 1.3)
    ctx.fillStyle = badge.color
    ctx.fillText(badge.text, apex.x, by)
  }
}


// ── shared iso solids (raised structures + water depth) ──────────────────
// Ground tiles that get an iso DEPTH treatment (a sunken basin) instead of a flat diamond.
export const WATER_DEPTH_TILES: ReadonlySet<string> = new Set(['water', 'ice_water', 'oasis', 'koi'])


/** Fill one iso diamond centred at (cx,cy) with half-extents (hw,hh). */
export function fillDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, fill: string): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(cx, cy - hh)
  ctx.lineTo(cx + hw, cy)
  ctx.lineTo(cx, cy + hh)
  ctx.lineTo(cx - hw, cy)
  ctx.closePath()
  ctx.fill()
}


/** A raised iso PRISM: a `height`-tall box whose BASE diamond is centred at (cx, baseY).
 *  Draws the two camera-facing side faces (left/right shaded) + the top diamond. */
export function drawIsoPrism(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  hw: number,
  hh: number,
  height: number,
  top: string,
  left: string,
  right: string,
): void {
  const topY = baseY - height
  ctx.fillStyle = left
  ctx.beginPath()
  ctx.moveTo(cx - hw, topY)
  ctx.lineTo(cx, topY + hh)
  ctx.lineTo(cx, baseY + hh)
  ctx.lineTo(cx - hw, baseY)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = right
  ctx.beginPath()
  ctx.moveTo(cx + hw, topY)
  ctx.lineTo(cx, topY + hh)
  ctx.lineTo(cx, baseY + hh)
  ctx.lineTo(cx + hw, baseY)
  ctx.closePath()
  ctx.fill()
  fillDiamond(ctx, cx, topY, hw, hh, top)
}


/** Give a water ground cell ISO DEPTH (#50): a darker sunken bank rim + a recessed,
 *  gently-shimmering surface dropped below the lip — so a pond reads as a basin with
 *  depth, not a flat blue diamond. Render-only; (cx,cy) is the tile's top-face centre. */
export function drawIsoWaterDepth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  base: string,
  time: number,
  col: number,
  row: number,
): void {
  fillDiamond(ctx, cx, cy, hw * 0.84, hh * 0.84, darkenColor(base, 0.5)) // shaded inner bank
  const sink = hh * 0.42
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.0018 + col * 0.7 + row * 0.5)
  fillDiamond(ctx, cx, cy + sink, hw * 0.64, hh * 0.64, lightenColor(base, 0.1 + 0.14 * shimmer)) // recessed surface
}


/** The TOWN-SQUARE fountain: ONE big animated park fountain spanning its reserved plaza — a round
 *  stone base PLATFORM, a blue water BASIN with a stone RIM, a central TIERED column of stacked bowls,
 *  and water JETS shooting up, arcing out, and cascading down into the basin, plus ripples — all
 *  animated. Drawn as a SINGLE structure from the centre cell (asset.footprint = the basin side in
 *  cells), never N clustered mini-wells. Matches the reference isometric park fountains. */
export function drawIsoTownFountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number,
): void {
  const f = Math.max(2, asset.footprint ?? 3)
  const hw = tileW * f * 0.62 // basin platform half-width (screen px)
  const hh = tileH * f * 0.62 // basin platform half-height
  const baseY = y + tileH * 0.55 // platform base sits a touch toward the cell's front edge
  const stone = '#bcb3a2'
  const stoneLit = lightenColor(stone, 0.12)
  const water = '#3fb2e6'
  const waterDeep = darkenColor(water, 0.5)
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.003)

  // A round iso DRUM: a flat side-wall silhouette (a cylinder is full-width at every height) capped
  // by a rounded top ellipse. Drawn UPWARD from `baseCy`; returns the new (raised) top centre y.
  const drum = (baseCy: number, rx: number, ry: number, height: number, topFill: string, sideFill: string): number => {
    const topCy = baseCy - height
    ctx.fillStyle = sideFill
    ctx.fillRect(x - rx, topCy, rx * 2, baseCy - topCy) // side wall (vertical cylinder silhouette)
    ctx.fillStyle = withAlpha(lightenColor(sideFill, 0.12), 0.5)
    ctx.fillRect(x - rx, topCy, rx * 0.5, baseCy - topCy) // soft left sheen → reads as round
    ctx.fillStyle = topFill
    ctx.beginPath()
    ctx.ellipse(x, topCy, rx, ry, 0, 0, Math.PI * 2) // rounded top cap (hides the wall's flat top)
    ctx.fill()
    return topCy
  }
  const disc = (cy: number, rx: number, ry: number, fill: string): void => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // 1. stone base PLATFORM — a low wide drum (the steps around the basin).
  const platTop = drum(baseY, hw, hh, tileH * 0.5, stoneLit, darkenColor(stone, 0.5))
  // 2. the BASIN wall — a taller, slightly narrower drum that holds the water.
  const rimRx = hw * 0.82
  const rimRy = hh * 0.82
  const rimTop = drum(platTop + tileH * 0.04, rimRx, rimRy, tileH * 0.85, stone, darkenColor(stone, 0.42))
  // 3. the WATER pool inside the rim — stone lip, deep ring, shimmering surface, expanding ripples.
  const waterRx = rimRx * 0.78
  const waterRy = rimRy * 0.78
  const waterCy = rimTop + tileH * 0.05
  disc(waterCy, rimRx * 0.9, rimRy * 0.9, darkenColor(stone, 0.28)) // inner rim lip
  disc(waterCy, waterRx, waterRy, waterDeep) // pool depth
  disc(waterCy, waterRx * 0.95, waterRy * 0.95, withAlpha(lightenColor(water, 0.04 + 0.14 * shimmer), 0.96)) // surface
  ctx.lineWidth = Math.max(1, tileW * 0.018)
  for (let k = 0; k < 3; k++) {
    const phase = (time * 0.0011 + k / 3) % 1
    ctx.strokeStyle = withAlpha('#e2f5ff', (1 - phase) * 0.45)
    ctx.beginPath()
    ctx.ellipse(x, waterCy, waterRx * (0.2 + phase * 0.8), waterRy * (0.2 + phase * 0.8), 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 4. the central TIERED column — a pedestal + a wide lower bowl, a thin pedestal + a small bowl.
  const pedTop = drum(waterCy - waterRy * 0.1, hw * 0.13, hh * 0.13, tileH * 1.05, stoneLit, darkenColor(stone, 0.5))
  const bowl1Rx = hw * 0.46
  const bowl1Ry = hh * 0.46
  disc(pedTop, bowl1Rx, bowl1Ry, stone) // lower bowl rim
  disc(pedTop - tileH * 0.04, bowl1Rx * 0.84, bowl1Ry * 0.84, waterDeep)
  disc(pedTop - tileH * 0.06, bowl1Rx * 0.76, bowl1Ry * 0.76, withAlpha(lightenColor(water, 0.1 + 0.12 * shimmer), 0.96))
  const ped2Top = drum(pedTop - tileH * 0.06, hw * 0.075, hh * 0.075, tileH * 0.8, stoneLit, darkenColor(stone, 0.5))
  const bowl2Rx = hw * 0.22
  const bowl2Ry = hh * 0.22
  disc(ped2Top, bowl2Rx, bowl2Ry, stone) // upper bowl rim
  disc(ped2Top - tileH * 0.03, bowl2Rx * 0.74, bowl2Ry * 0.74, withAlpha(lightenColor(water, 0.12 + 0.12 * shimmer), 0.96))

  // 5. WATER JETS (all animated) — a central vertical jet, arcs from the spout into the lower bowl,
  //    cascades from the lower bowl down into the basin, and falling droplets that splash in.
  const spoutY = ped2Top - tileH * 0.08
  const jetH = tileH * 2.0 * (0.82 + 0.18 * Math.sin(time * 0.006))
  ctx.fillStyle = withAlpha('#eaf8ff', 0.9)
  ctx.beginPath()
  ctx.moveTo(x, spoutY - jetH)
  ctx.lineTo(x + tileW * 0.05, spoutY)
  ctx.lineTo(x - tileW * 0.05, spoutY)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = withAlpha('#d4f0ff', 0.8)
  ctx.lineWidth = Math.max(1.5, tileW * 0.024)
  ctx.lineCap = 'round'
  for (const dir of [-1, 1]) {
    ctx.beginPath() // arc from spout out into the lower bowl
    ctx.moveTo(x, spoutY - jetH * 0.5)
    ctx.quadraticCurveTo(x + dir * bowl1Rx * 1.05, spoutY - jetH * 0.15, x + dir * bowl1Rx * 0.68, pedTop - tileH * 0.05)
    ctx.stroke()
    ctx.beginPath() // cascade from the lower bowl rim into the basin
    ctx.moveTo(x + dir * bowl1Rx * 0.8, pedTop)
    ctx.quadraticCurveTo(x + dir * rimRx * 0.82, (pedTop + waterCy) / 2, x + dir * rimRx * 0.72, waterCy - waterRy * 0.2)
    ctx.stroke()
  }
  ctx.fillStyle = withAlpha('#eaf8ff', 0.85)
  for (const dir of [-1, 1]) {
    const dphase = (time * 0.004 + (dir > 0 ? 0.5 : 0)) % 1
    const dy = pedTop + dphase * (waterCy - waterRy * 0.2 - pedTop)
    ctx.beginPath()
    ctx.arc(x + dir * rimRx * 0.72, dy, tileW * 0.03, 0, Math.PI * 2)
    ctx.fill()
  }
}


/** A well / fountain as a RAISED iso structure (#50): a stone basin prism with a recessed
 *  water pool on top, then a distinguishing topper — a fountain's animated water jet or a
 *  well's posted, peaked roof. Mirrors the building iso standard (a 3D volume, not a flat glyph). */
export function drawIsoWellFountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number,
): void {
  const isFountain = asset.type === 'fountain'
  const hw = tileW * 0.62
  const hh = tileH * 0.62
  const bodyH = tileH * 1.8 // raised ~1-tile stone basin
  const baseY = y + tileH * 0.45 // base sits toward the cell's front edge
  const stone = '#a39b8c'
  // stone basin body
  drawIsoPrism(ctx, x, baseY, hw, hh, bodyH, lightenColor(stone, 0.18), darkenColor(stone, 0.5), darkenColor(stone, 0.72))
  const topY = baseY - bodyH
  // water pool recessed into the basin top, gently shimmering
  const water = isFountain ? '#5fbce0' : '#3f78c0'
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.004 + x * 0.05)
  fillDiamond(ctx, x, topY + hh * 0.16, hw * 0.66, hh * 0.66, darkenColor(water, 0.55)) // pool depth
  fillDiamond(ctx, x, topY + hh * 0.3, hw * 0.5, hh * 0.5, lightenColor(water, 0.08 + 0.16 * shimmer)) // surface

  if (isFountain) {
    // A TIERED park fountain: stacked stone pedestals each carrying a blue water BOWL, narrowing
    // upward, with water arcing from the top spout down into the bowls + the pool (per the refs).
    const tierStone = lightenColor(stone, 0.16)
    const waterSurf = lightenColor(water, 0.12 + 0.16 * shimmer)
    // tier 1 — a short pedestal rising from the pool carrying a wide bowl
    const p1Y = topY + hh * 0.2
    drawIsoPrism(ctx, x, p1Y, hw * 0.12, hh * 0.12, bodyH * 0.5, tierStone, darkenColor(stone, 0.5), darkenColor(stone, 0.72))
    const b1Y = p1Y - bodyH * 0.5
    fillDiamond(ctx, x, b1Y, hw * 0.44, hh * 0.44, lightenColor(stone, 0.08)) // bowl rim (stone)
    fillDiamond(ctx, x, b1Y, hw * 0.34, hh * 0.34, darkenColor(water, 0.5)) // bowl depth
    fillDiamond(ctx, x, b1Y - hh * 0.05, hw * 0.28, hh * 0.28, waterSurf) // bowl water
    // tier 2 — a thinner pedestal + a small upper bowl
    drawIsoPrism(ctx, x, b1Y - hh * 0.05, hw * 0.07, hh * 0.07, bodyH * 0.42, tierStone, darkenColor(stone, 0.5), darkenColor(stone, 0.72))
    const b2Y = b1Y - hh * 0.05 - bodyH * 0.42
    fillDiamond(ctx, x, b2Y, hw * 0.22, hh * 0.22, lightenColor(stone, 0.08))
    fillDiamond(ctx, x, b2Y - hh * 0.03, hw * 0.15, hh * 0.15, waterSurf)
    // water — a central jet + two arcs spraying out from the top spout down into the lower bowl
    const sprayTop = b2Y - bodyH * 0.45
    ctx.strokeStyle = withAlpha('#d4f0ff', 0.85)
    ctx.lineWidth = Math.max(1.5, tileW * 0.03)
    ctx.lineCap = 'round'
    for (const dx of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(x, sprayTop)
      ctx.quadraticCurveTo(x + dx * hw * 0.55, sprayTop + hh * 0.1, x + dx * hw * 0.5, b1Y + hh * 0.05)
      ctx.stroke()
    }
    ctx.fillStyle = withAlpha('#e6f6ff', 0.9) // central vertical jet
    ctx.beginPath()
    ctx.moveTo(x, sprayTop - hh * 0.3)
    ctx.lineTo(x + tileW * 0.045, b2Y - hh * 0.05)
    ctx.lineTo(x - tileW * 0.045, b2Y - hh * 0.05)
    ctx.closePath()
    ctx.fill()
    const drop = Math.sin(time * 0.005) * 0.5 + 0.5 // animated falling droplets
    for (const dx of [-0.45, 0.45]) {
      ctx.beginPath()
      ctx.arc(x + dx * hw, b1Y - drop * tileH * 0.4, tileW * 0.045, 0, Math.PI * 2)
      ctx.fill()
    }
    return
  }

  // a well: two stone posts carrying a small peaked roof over the shaft
  const postH = bodyH * 0.95
  const roofY = topY - postH
  drawIsoPrism(ctx, x - hw * 0.72, topY, hw * 0.1, hh * 0.1, postH, '#8a6a3a', '#5e4724', '#7a5c30')
  drawIsoPrism(ctx, x + hw * 0.72, topY, hw * 0.1, hh * 0.1, postH, '#8a6a3a', '#5e4724', '#7a5c30')
  fillDiamond(ctx, x, roofY + hh * 0.4, hw * 1.05, hh * 0.5, '#7a2f2a') // roof eave
  ctx.fillStyle = '#a14038' // peaked roof
  ctx.beginPath()
  ctx.moveTo(x, roofY - hh * 0.9)
  ctx.lineTo(x + hw * 1.05, roofY + hh * 0.4)
  ctx.lineTo(x - hw * 1.05, roofY + hh * 0.4)
  ctx.closePath()
  ctx.fill()
}


export function drawIsoAssetAscii(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number,
  groundContact = false,
  dayNight: DayNight = 'day',
  style: Style = ASCII_STYLE,
) {
  const lineHeight = tileH * 1.3
  const fontSize = tileH * 1.1
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Active art style: a mapped kind (or a per-element override) replaces ALL of the per-type
  // art below (labeled cells, trees, legacy buildings, props) with ONE tile. ASCII + no
  // override → adv.char '' → falls through to the byte-identical per-type rendering.
  const adv = resolveDraw(assetKind(asset), style, asset.tileOverride, '', asset.color ?? '#ffffff')
  if (adv.image) { drawStyledImage(ctx, adv.image, x, y - lineHeight * 0.6, tileH * 2.2); return }
  if (adv.char) {
    // Trees tower (~3 cells, like the ASCII tree) instead of a tiny one-cell 🌲, anchored at the base.
    const isTree = asset.type === 'tree'
    const glyphPx = fontSize * (isTree ? 2.7 : 1.7)
    ctx.font = `bold ${glyphPx}px ${ASCII_FONT}`
    ctx.fillStyle = adv.color || '#ffffff'
    const gy = y - lineHeight * (isTree ? 1.15 : 0.6)
    // A tree keeps its shape but is recoloured to its SEASON's canopy shade (asset.color).
    if (isTree) fillTintedGlyph(ctx, adv.char, x, gy, glyphPx, asset.color, 0.55)
    else ctx.fillText(adv.char, x, gy)
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    return
  }

  // Generated multi-cell assets carry a cell-part label → draw each cell as ONE
  // glyph (the cell IS the tile). The layered art below is for legacy single-cell,
  // manually-placed assets only.
  if (asset.label) {
    drawIsoLabeledCell(ctx, x, y, asset, tileH)
    return
  }

  // Authored animation cycles (author panel) OVERRIDE static type rendering with the live
  // frame — applies to ANY asset the user animated. No cycles → normal rendering below.
  const cycleArt = assetCycleFrame(asset.cycles, time)
  if (cycleArt) {
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(cycleArt[0] ?? '?', x, layerY)
    return
  }

  if (asset.type === 'tree') {
    // Tree: bark trunk + layered canopy. The canopy tints to the asset's
    // zone/theme color (never hardcoded green); the trunk stays bark.
    const canopy = treeCanopyLayers(asset.color || '#2e8b2e', flicker)
    // Canopy is an UPRIGHT pyramid: widest just above the trunk, narrowing to the apex
    // at the top. (Layer i rises up the screen as i grows, so wide base = drawn first.)
    const layers = [
      { text: '0', color: '#ad8621', bg: '#5a4510' },  // Trunk bottom
      { text: 'W', color: '#c9a030', bg: '#6a5520' },  // Trunk top
      { text: '(@&@&@)', color: canopy[0].fg, bg: canopy[0].bg }, // wide base
      { text: '(@&@)', color: canopy[1].fg, bg: canopy[1].bg },   // mid
      { text: '(&)', color: canopy[2].fg, bg: canopy[2].bg },     // narrow apex
    ]
    // Ground shadow ONLY on the tree's bottom (ground-contact) cell — never every cell.
    if (groundContact) {
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.beginPath()
      ctx.ellipse(x, y, tileW * 0.55, tileH * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      // Bigger font at the wide base, smaller toward the apex → a crisp upright pyramid.
      const layerFontSize = i < 2 ? fontSize * 0.9 : fontSize * (0.85 - (i - 2) * 0.05)
      ctx.font = `bold ${layerFontSize}px ${ASCII_FONT}`

      // Background shape
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      // Text
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'building') {
    // Building: connected structure with walls, windows, and peaked roof
    // Use consistent width and visual connection between layers
    const buildingWidth = tileW * 2.2
    const wallColor = '#b48441'
    const wallDarkColor = '#8a6230'
    const roofColor = '#cc4040'
    const roofDarkColor = '#992020'

    const layers = [
      { text: '|==|', color: '#664422', bg: wallColor, width: 1.0 },          // Base/door
      { text: '|[]|', color: `rgba(255, 220, 80, ${0.5 + 0.3 * flicker})`, bg: wallColor, width: 1.0 },   // Window floor 1
      { text: '|[]|', color: `rgba(255, 200, 60, ${0.4 + 0.3 * flicker})`, bg: wallDarkColor, width: 1.0 }, // Window floor 2
      { text: '/==\\', color: roofColor, bg: roofDarkColor, width: 1.1 },     // Roof eave
      { text: '/\\', color: `rgba(255, 100, 80, ${0.8 + 0.2 * flicker})`, bg: roofColor, width: 0.7 },    // Roof peak
    ]

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerWidth = buildingWidth * layer.width

      // Background - maintains visual connection
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - layerWidth / 2, layerY - lineHeight / 2, layerWidth, lineHeight)

      // Draw connecting side walls for wall sections
      if (i < 3) {
        ctx.fillStyle = wallDarkColor
        ctx.fillRect(x - layerWidth / 2 - 2, layerY - lineHeight / 2, 3, lineHeight)
        ctx.fillRect(x + layerWidth / 2 - 1, layerY - lineHeight / 2, 3, lineHeight)
      }

      // Character
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'lamp' || asset.type === 'lantern') {
    // Lamp post. STEADY light — ON (constant warm bulb) at night, OFF (dim, unlit bulb) by day.
    // The old lampPulse faded the bulb in/out every cycle, which read as a broken flicker; the
    // night ambience now comes from the warm light pool in drawNightLighting, not a pulsing glyph.
    const glow = dayNight === 'night' ? 1 : 0.18
    const layers = [
      { text: '|', color: '#666666', bg: '#333333' },
      { text: '|', color: '#777777', bg: '#444444' },
      { text: 'o', color: `rgba(255, 220, 50, ${glow})`, bg: `rgba(100, 80, 0, ${glow})` },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'bush') {
    // Small bush
    const layers = [
      { text: '*', color: `rgba(80, 200, 80, ${0.8 + 0.2 * flicker})`, bg: 'rgba(0, 100, 0, 0.85)' },
      { text: '**', color: `rgba(60, 180, 60, ${0.85 + 0.15 * flicker})`, bg: 'rgba(0, 90, 0, 0.8)' },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize * 0.9}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'npc') {
    // NPC character - cleaner humanoid figure
    // Stack: legs, body/arms, head with face
    const layers = [
      { text: '/\\', color: '#3355aa', bg: '#1a2a55' },     // Legs (pants)
      { text: '[=]', color: '#4466cc', bg: '#223366' },    // Body/torso
      { text: '(o)', color: '#ffccaa', bg: '#996644' },    // Head with simple face
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerFontSize = i === 2 ? fontSize * 0.95 : fontSize  // Slightly smaller head

      ctx.font = `bold ${layerFontSize}px ${ASCII_FONT}`

      // Background for visibility
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      // Shadow
      ctx.fillStyle = '#000000'
      ctx.fillText(layer.text, x + 1, layerY + 1)
      // Character
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'flower') {
    // Small flower — ambient sway driven by the animation engine (assetAnimFrame).
    ctx.font = `bold ${fontSize * 0.8}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.3
    ctx.fillStyle = asset.color || '#ff88cc'
    ctx.fillText(assetAnimFrame('flower', time)?.[0] ?? '+', x, layerY)

  } else if (asset.type === 'rock' || asset.type === 'decoration') {
    // Rock/decoration
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = '#555555'
    ctx.fillRect(x - tileW / 2, layerY - lineHeight / 2, tileW, lineHeight)
    ctx.fillStyle = '#999999'
    ctx.fillText('O', x, layerY)

  } else if (asset.type === 'fountain' && asset.footprint) {
    // The town SQUARE centrepiece: ONE big animated park fountain spanning its plaza (basin + tiered
    // column + jets), drawn from the centre cell — never N clustered mini-wells.
    drawIsoTownFountain(ctx, x, y, asset, tileW, tileH, time)

  } else if (asset.type === 'well' || asset.type === 'fountain') {
    // Legacy single-cell well/fountain (manual editor placement): a raised 3D iso basin (#50).
    drawIsoWellFountain(ctx, x, y, asset, tileW, tileH, time)

  } else {
    // Default: show the asset's art character
    const char = asset.art[0] || '?'
    const layerY = y - lineHeight * 0.5
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    ctx.fillStyle = darkenColor(asset.color || '#888888', 0.4)
    const textWidth = ctx.measureText(char).width
    ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(char, x, layerY)
  }
}


// Debug overlay rendering
export function renderDebugOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  toScreen: (wx: number, wz: number) => { x: number; y: number },
  cellSize: number
) {
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Pass 1: Draw collision overlay (red tint on blocked cells)
  for (let rz = 0; rz < tilesZ; rz++) {
    for (let rx = 0; rx < tilesX; rx++) {
      const col = Math.floor(startCol + rx)
      const row = Math.floor(startRow + rz)

      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const worldX = col * cellSize
      const worldZ = row * cellSize
      const p = toScreen(worldX, worldZ)

      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) continue

      const isBlocked = grid.isBlocked(col, row)
      const tileW = cellSize * grid.isoScale * 0.7
      const tileH = cellSize * grid.isoScale * 0.35

      if (isBlocked) {
        // Red overlay for collision
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - tileH)
        ctx.lineTo(p.x + tileW, p.y)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x - tileW, p.y)
        ctx.closePath()
        ctx.fill()
      }

      // Grid coordinates
      ctx.fillStyle = isBlocked ? '#ffaaaa' : '#aaffaa'
      ctx.fillText(`${col},${row}`, p.x, p.y)
    }
  }

  // Pass 2: per-cell TYPE + POSITION captions — same flattened captions every view draws.
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(player.x / cellSize),
    Math.floor(player.z / cellSize),
    30, 20
  )

  ctx.font = `bold 11px ${ASCII_FONT}`

  for (const cap of debugCellCaptions(visibleAssets)) {
    const worldX = cap.col * cellSize
    const worldZ = cap.row * cellSize
    const p = toScreen(worldX, worldZ)

    // Color by type
    const { fg: labelColor, bg: labelBg } = debugLabelColors(cap.type)

    // Draw label background (TYPE + corner/edge/sub-part — identical to top + 2D)
    const metrics = ctx.measureText(cap.text)
    const labelY = p.y - 30

    ctx.fillStyle = labelBg
    ctx.fillRect(p.x - metrics.width / 2 - 3, labelY - 8, metrics.width + 6, 16)

    ctx.fillStyle = labelColor
    ctx.fillText(cap.text, p.x, labelY)

    // Connection line
    ctx.strokeStyle = labelColor
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(p.x, labelY + 8)
    ctx.lineTo(p.x, p.y - 5)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

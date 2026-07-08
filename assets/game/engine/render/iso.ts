import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { assetAnimFrame, assetCycleFrame } from '@/engine/assetAnimations'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { type BuildingType } from '@/engine/buildingComposer'
import { facadeToFootprint, buildingRect, doorCellFor, gridBuildingFacing } from '@/engine/buildingEditor'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { buildingFadeAlpha } from '@/engine/isoBuilding'
import { buildingCellColor, wallMaterialTile, wallMaterialImage } from '@/engine/stageGenerator'
import { type Projectile, projectileCellAt } from '@/game/projectiles'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction, playerDisplayName } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { Connector } from '@/lib/api'
import { ASCII_FONT, BUILDING_BADGES, COMBAT_RANGE, type DayNight, type DrawVisual, ENEMY_MOVE_MS, LAMP_GLOW, LIGHT, applyCellTransform, isoCameraFocus, assetCaptionByCell, terrainLabelAt, collectLampGlows, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, grassShade, cellFill, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, assetOverride, tileImage, tintedImage, tintedGlyphSprite, treeCanopyLayers } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { type GroundCellDims, groundSizeFactors, groundDimsActive } from '@/engine/groundDims'
import { isoBlockFaces, type BlockFace } from './isoBlock'
import { resolveTileHeight } from '@/engine/tileset/tileHeight'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { applyPose } from '@/engine/tileset/pose'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, type ElementKind, type ImageVisual, type Style } from '@/game/artStyle'
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
    const colorRow = grid.groundColor?.[row]
    const dimsRow = grid.groundDims?.[row]
    for (let col = startCol; col <= endCol; col++) {
      const g = groundRow ? groundRow[col] : undefined
      if (g) for (let i = 0; i < g.length; i++) { hsh ^= g.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) }
      hsh ^= (heightRow ? heightRow[col] : 0) | 0
      hsh = Math.imul(hsh, 0x01000193)
      // fold the per-cell FLOOR COLOUR override into the hash so a colour edit rebuilds the cached ground
      const oc = colorRow ? colorRow[col] : null
      if (oc) for (let i = 0; i < oc.length; i++) { hsh ^= oc.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) }
      // …and the per-cell FLOOR DIMS override (Width/Height/Depth/Zoom/pose) so a dims edit rebuilds it
      // too. Sparse → only edited cells pay the stringify; unedited cells add nothing (stay identical).
      const od = dimsRow ? dimsRow[col] : undefined
      if (od) { const s = JSON.stringify(od); for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 0x01000193) } }
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
  tint?: string, // per-cell floor-colour override → recolour the ground tile image (#80)
  dims?: GroundCellDims, // per-cell floor-dims override (Width/Depth/Zoom + pose) — undefined → default look
): void {
  // Reskin (a style tile is active): SHEAR the tile onto the iso DIAMOND so it lies FLAT on the
  // ground plane — angled, with the cube's z below it — never an upright square stamped on top.
  // The diamond is the parallelogram from its LEFT corner: eA→top, eB→bottom. One primitive covers
  // an emoji glyph and an image sprite. ASCII passthrough (no tint/image) falls through to the
  // byte-identical glyph draw below.
  if (gdv.tint || gdv.image) {
    // Per-cell DIMS override: size the diamond (Width→x, Depth→y, Zoom→both) and apply the per-cell pose,
    // so THIS one floor cell stretches/shifts without touching its neighbours. Sized cells bake their own
    // sprite (keyed on the factors); a pose blits under a per-cell transform. Only overridden cells reach
    // here — an unset cell falls through to the shared unsized sprite below (byte-identical).
    if (dims && groundDimsActive(dims)) {
      const { fx, fy } = groundSizeFactors(dims)
      const tw = tileW * fx
      const th = tileH * fy
      const pose = dims.pose
      const poseUnit = Math.max(tileW, tileH) * 2 // ≈ one cell → pose dx/dy read as fractions of a tile
      const sprite = groundSprite(gdv, tileW, tileH, tint, fx, fy)
      if (sprite) {
        if (pose) {
          ctx.save()
          ctx.translate(px, drawY)
          applyPose(ctx, pose, 1, poseUnit)
          ctx.drawImage(sprite, -tw, -th)
          ctx.restore()
        } else {
          ctx.drawImage(sprite, px - tw, drawY - th)
        }
        return
      }
      // No baked sprite yet (SSR / image still decoding) → direct sheared draw, scaled + posed.
      ctx.save()
      ctx.translate(px, drawY)
      if (pose) applyPose(ctx, pose, 1, poseUnit)
      fillIsoFaceWithTile(ctx, { x: -tw, y: 0 }, { x: tw, y: -th }, { x: tw, y: th }, { char: gdv.char, color: gdv.color, image: gdv.image }, 1, 1, tint)
      ctx.restore()
      return
    }
    // Blit the pre-baked diamond sprite (constant shear → one bake reused for every cell) instead of a
    // per-cell transform+clip — the ground-perf fix. Falls back to the direct draw when there's no sprite
    // (SSR / an image tile still decoding).
    const sprite = groundSprite(gdv, tileW, tileH, tint)
    if (sprite) {
      ctx.drawImage(sprite, px - tileW, drawY - tileH)
      return
    }
    fillIsoFaceWithTile(ctx, { x: px - tileW, y: drawY }, { x: tileW, y: -tileH }, { x: tileW, y: tileH }, { char: gdv.char, color: gdv.color, image: gdv.image }, 1, 1, tint)
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
      // Ground appearance now LOADS from the tileset (resolveGroundTile) instead of the hardcoded
      // GROUND_COLORS table — byte-identical selection (same noise variant). Grass keeps its per-cell shade.
      const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row)
      const char = gt.char
      const fg = gt.fg
      const isGrass = tileType.includes('grass')
      const bg = isGrass ? grassShade(gt.bg, col, row) : gt.bg

      // Active art style (ASCII passthrough → char+fg above, byte-identical). Ground cells carry no
      // per-element override, so this depends only on the active style — folded into the cache key so
      // a style switch rebuilds the offscreen ground. `tint` present → this is a REskinned tile: fill
      // the SAME cube+diamond geometry with the tile hue (so it stays iso-angled with z) and drop a
      // small hint — the geometry is reused, only the fill/asset changes. No tint → bg (identical).
      const gk = groundKind(tileType)
      const gdv = resolveDraw(gk, style, undefined, char, fg)
      // reskin → the tile's OWN colour (catalog data), but grass AND the rocky cave floor KEEP their
      // per-cell shade so the field/cavern isn't one flat sheet ("grass is just color"); ASCII → bg.
      // A per-cell FLOOR COLOUR override (Property panel) wins over the catalog colour (drives the diamond
      // top AND the darkened cube sides below, so a recoloured cell reads solid in iso).
      const fillBg = grid.groundColor?.[row]?.[col] ?? cellFill(gdv.tint, bg, isGrass || gk === 'cavefloor', col, row)

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
        drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, false, time, col, row, grid.groundColor?.[row]?.[col] ?? undefined, grid.groundDims?.[row]?.[col])
        continue
      }

      // Direct / fallback path — byte-identical to the original inline loop for ASCII.
      if (isWater) drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
      drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, true, time, col, row, grid.groundColor?.[row]?.[col] ?? undefined, grid.groundDims?.[row]?.[col])
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
    const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row) // LOADS from the tileset (byte-identical)
    const char = gt.char
    const fg = gt.fg
    const bg = gt.bg
    const drawY = py - grid.getHeight(col, row) * heightStep
    const wdv = resolveDraw(groundKind(tileType), style, undefined, char, fg)
    const fillBg = wdv.tint ?? bg // reskin water → the tile's own colour (catalog data); ASCII → bg
    drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
    drawIsoGroundContent(ctx, wdv, px, drawY, tileW, tileH, false, true, time, col, row, grid.groundColor?.[row]?.[col] ?? undefined, grid.groundDims?.[row]?.[col])
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
  clampCamera: boolean = true,
  targetId: string | null = null,
  hoverId: string | null = null,
  selectedCells: ReadonlySet<string> = new Set(),
  hoveredCell: { col: number; row: number } | null = null,
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
  // Clamp the camera to the map ONLY in game mode (predefined zooms, no drag). In dev mode the clamp
  // fought drag-to-pan — the system couldn't decide when to limit — so there the camera pans freely.
  const rawFc = (player.x - camOffset.x) / cellSize
  const rawFr = (player.z - camOffset.y) / cellSize
  const { fc, fr } = clampCamera ? isoCameraFocus(rawFc, rawFr, pPad, qPad, grid.cols, grid.rows) : { fc: rawFc, fr: rawFr }
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
  const playerIsTarget = !!targetId && entities.some(e => e.kind === 'player' && e.id === targetId)
  const playerIsHover = !!hoverId && entities.some(e => e.kind === 'player' && e.id === hoverId)
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer) {
      // The player's melee swing progress (0..1) drives the in-hand weapon animation below.
      const inHandSlash = attackAnims.find(a => a.inHand && now - a.start < a.durationMs)
      const swingP = inHandSlash ? Math.min(1, (now - inHandSlash.start) / inHandSlash.durationMs) : null
      drawIsoPlayer(ctx, p.x, p.y - heightOffset - (player.jumpHeight ?? 0), tileW, tileH, player, time, swingP, inHandSlash?.tint, style, playerIsTarget, playerIsHover)
    } else if (obj.entity) {
      const combat = obj.entity.kind === 'enemy' ? enemyCombat.get(obj.entity.id) : undefined
      if (isDeadEnemy(obj.entity, combat)) continue // hidden until it respawns
      const attackable = enemyInAttackReach(obj.entity, Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), attackReach)
      const anchor = drawIsoEntity(ctx, p.x, p.y - heightOffset, obj.entity, tileH, combat, now, obj.moving ?? false, obj.inRange ?? false, attackable, style, obj.entity.id === targetId, obj.entity.id === hoverId)
      drawQuestMarker(ctx, entityQuestMarker(obj.entity, quests), anchor.x, anchor.y, Math.max(14, tileH * 1.6))
    } else if (obj.building) {
      // A building is drawn PURELY FROM TILES now — per-cell wall/roof/door blocks via drawIsoBuildingTiles,
      // not the hardcoded facade box. Keep the wall-fade so the interior/door stay findable when the hero is near.
      const b = obj.building
      const forceFade = typeof window !== 'undefined' && !!(window as unknown as { __ISO_FADE_ALL?: boolean }).__ISO_FADE_ALL
      const fade = forceFade ? BUILDING_MIN_ALPHA : buildingFadeAlpha(pCol, pRow, b, BUILDING_FADE_RADIUS, BUILDING_MIN_ALPHA)
      // drawIsoBuildingTiles applies the fade PER CELL (walls more transparent, door more opaque).
      drawIsoBuildingTiles(ctx, b, toScreen, (c, r) => grid.getHeight(c, r), heightStep, tileW, tileH, style, fade)
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
      const from = toScreen(pr.fromCol + 0.5, pr.fromRow + 0.5)
      const to = toScreen(pr.toCol + 0.5, pr.toRow + 0.5)
      drawProjectileGlyph(ctx, pr.glyph, sp.x, sp.y - tileH, from.x, from.y, to.x, to.y)
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
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, true, tileW, tileH)
  } else if (isShowCollisions()) {
    // Collision-only overlay: same red diamonds as debug, no coords/labels. Pass the render's ZOOMED
    // tileW/tileH so the diamonds fill each cell edge-to-edge (not the unzoomed grid.isoScale default).
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, false, tileW, tileH)
  }

  // ─── Cell-hover outline — a DIM/translucent iso cube around the cell under the cursor, mirroring the
  //     selection cube below but drawn UNDER it (so it never hides the solid-yellow selection). Shows on
  //     EVERY cell, even one a unit stands on, in addition to the unit hover reticle. ──────────────────
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    const selH = tileW * 0.9 // same cube height as the selection so hover + select read as the same block
    const p = toScreen(hoveredCell.col, hoveredCell.row)
    const gt = { x: p.x, y: p.y - tileH }, gr = { x: p.x + tileW, y: p.y }, gb = { x: p.x, y: p.y + tileH }, gl = { x: p.x - tileW, y: p.y }
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y - selH); ctx.lineTo(gr.x, gr.y - selH); ctx.lineTo(gb.x, gb.y - selH); ctx.lineTo(gl.x, gl.y - selH); ctx.closePath(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gr.x, gr.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(gl.x, gl.y); ctx.closePath(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(gl.x, gl.y); ctx.lineTo(gl.x, gl.y - selH)
    ctx.moveTo(gr.x, gr.y); ctx.lineTo(gr.x, gr.y - selH)
    ctx.moveTo(gb.x, gb.y); ctx.lineTo(gb.x, gb.y - selH)
    ctx.moveTo(gt.x, gt.y); ctx.lineTo(gt.x, gt.y - selH)
    ctx.stroke()
  }

  // ─── Selection outline (property-editor multi-select) — a yellow diamond around each
  //     selected cell's ground footprint, drawn over the world like the 2D/top views. ──
  if (selectedCells.size > 0) {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    const selH = tileW * 0.9 // cube height ≈ one tile block → the selector reads as a CUBE, not a flat diamond
    for (const key of selectedCells) {
      const [col, row] = key.split(',').map(Number)
      const p = toScreen(col, row)
      const gt = { x: p.x, y: p.y - tileH }, gr = { x: p.x + tileW, y: p.y }, gb = { x: p.x, y: p.y + tileH }, gl = { x: p.x - tileW, y: p.y }
      // TOP diamond (raised) + GROUND diamond + the 4 vertical edges = an iso cube outline
      ctx.beginPath(); ctx.moveTo(gt.x, gt.y - selH); ctx.lineTo(gr.x, gr.y - selH); ctx.lineTo(gb.x, gb.y - selH); ctx.lineTo(gl.x, gl.y - selH); ctx.closePath(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gr.x, gr.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(gl.x, gl.y); ctx.closePath(); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(gl.x, gl.y); ctx.lineTo(gl.x, gl.y - selH)
      ctx.moveTo(gr.x, gr.y); ctx.lineTo(gr.x, gr.y - selH)
      ctx.moveTo(gb.x, gb.y); ctx.lineTo(gb.x, gb.y - selH)
      ctx.moveTo(gt.x, gt.y); ctx.lineTo(gt.x, gt.y - selH)
      ctx.stroke()
    }
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
  isTarget: boolean = false,
  isHover: boolean = false,
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // The hero does NOT bob: the old sin() breathe made the figure loop up-and-down and read as FLOATING
  // (NPCs never bobbed, so it also made the hero inconsistent with them). Kept as a named 0 so the body,
  // weapon and vitals still share one anchor origin — re-enabling is a one-line change.
  const breathe = 0

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
  // Bottom-anchor the figure EXACTLY like drawIsoEntity (the enemies/NPCs), so the hero stands the same
  // way instead of floating: `groundY` is the feet contact point; the emoji is lifted by 0.42 of its own
  // size so its feet land there, and the shadow + reticles sit AT groundY. (Replaces the old `emojiFootLift`
  // band-aid that only nudged the emoji figure and left the player anchored differently from every NPC.)
  const baseY = y - lineHeight * 0.5
  const groundY = baseY + tileH * 0.24
  // Ground shadow sized to the player figure (always reads; fixed — doesn't bob).
  drawGroundShadow(ctx, x, groundY, pHalf)
  if (isTarget) drawSelectionRing(ctx, x, groundY, pHalf * 0.8) // red target reticle at the feet
  else if (isHover) drawHoverRing(ctx, x, groundY, pHalf * 0.8) // dim white hover reticle

  // Robust block figure — same recipe as entities + trees; `breathe` bobs the whole figure. When
  // attacking, HIDE the static arm on the swinging side (the animated swing-arm below replaces it) so
  // we never draw two arms (#47/#39).
  const swingArmDir = player.facing === 'left' ? -1 : 1
  // During a swing, base the figure on the IDLE pose (predictable arm) and HIDE the facing-side arm
  // bracket — the swing-arm below (the SAME bracket glyph, just rotated) replaces it. (#47/#67)
  const figArt = swingP == null
    ? playerArt
    : playerSprite.idle.map(row => (swingArmDir > 0 ? row.replace('>', ' ') : row.replace('<', ' ')))
  const pdv = resolveDraw('player', style, personVariantTileId(player.variant, style), '', bodyColor)
  // Under an emoji/image style the ACTIVE animation frame drives what's drawn (idle/walk/run) — data, not
  // hardcoded. The frame resolves to a baked image (the base tile or an override tile) OR a glyph, honouring
  // its flipX, so the authored walk/idle actually PLAYS instead of freezing on the static base image. ASCII
  // (no image, empty char) keeps its block-figure sprite below (which animates via getPlayerArt).
  if (pdv.image || pdv.char) {
    const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
    const pfImg = frameImage(pf, pdv.char, pdv.image)
    if (pfImg) {
      drawStyledImage(ctx, pfImg, x, groundY - (tileH * 2.6) * 0.42 - breathe, tileH * 2.6, pf.flipX)
    } else {
      ctx.font = `bold ${fontSize * 1.8}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = pdv.color
      drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), x, groundY - (fontSize * 1.8) * 0.42 - breathe, pf.flipX)
      ctx.textAlign = 'left'
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    }
  } else {
    drawBlockFigure(ctx, figArt, x - pHalf, baseY - breathe, lineHeight, charW, bodyColor, bodyBg)
  }

  // The held weapon + the shield, both at the ARM row. The weapon sits on the FACING hand; the
  // shield on the OFF-hand (the side OPPOSITE the weapon) at the SAME arm height — so they never
  // land on the same hand in any facing (#49).
  const onLeft = player.facing === 'left'
  const dir = onLeft ? -1 : 1 // +1 → facing right, weapon on the RIGHT hand
  const weaponSize = fontSize * 1.7
  const handY = baseY - lineHeight - breathe // the HAND, at the arm/body row (shared by weapon + shield), off groundY
  const shoulderX = x + dir * pHalf * 0.25 // at the body, on the weapon side
  const shoulderY = baseY - lineHeight * 1.45 - breathe // shoulder = TOP of the # row (the pivot)
  drawPlayerArm(ctx, {
    swinging: swingP != null, // an attack is mid-flight → the ARM drives the swing (#47)
    swingP: swingP ?? 0,
    facingDir: dir,
    isEmoji: style.id !== ASCII_STYLE.id, // reskin → no ASCII `>`/`<` bracket beside the emoji figure
    fontSize,
    bodyColor,
    weaponGlyph: player.weaponGlyph,
    weaponPose: player.weaponPose,
    punchGlyph: player.punchGlyph,
    punchPose: player.punchPose,
    weaponTint: '#e6e6e6',
    swingTint,
    shoulderX,
    shoulderY,
    restHandX: x + dir * (pHalf + weaponSize * 0.18),
    restHandY: handY,
    shieldGlyph: player.shieldGlyph,
    shieldPose: player.shieldPose,
    shieldX: x - dir * (pHalf + fontSize * 0.3), // off-hand: opposite the weapon
    shieldY: handY, // same arm row as the weapon hand
    shieldR: fontSize * 0.5,
  })

  // Life bar + name above the head — the SAME treatment enemies get (drawFigureVitals), so the
  // player reads identically. Drawn only once HP is mirrored onto the struct (see the game loop).
  if (player.maxHp != null) {
    const figureTop = baseY - breathe - playerArt.length * lineHeight // above the head, off the same anchor
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
  isTarget = false,
  isHover = false,
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
  drawGroundShadow(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2)
  if (isTarget) drawSelectionRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.8) // red target reticle at the feet
  else if (isHover) drawHoverRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.8) // dim white hover reticle
  // In-strike-range indicator: a ring at the feet, under the figure (#35).
  if (attackable) drawRangeRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.85, now)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const pal = entityPalette(entity)
  const kind = entityKind(entity.kind)
  const isEnemy = kind === 'enemy'
  // An enemy draws its per-type tile (goblin→👺, wolf→🐺, …); a person draws its per-variant figure
  // (male→🧍‍♂️, old→🧓, …) — both baked images. A manual tileOverride still wins.
  const override = entity.tileOverride ?? entityStyleOverride(entity, style)
  const edv = resolveDraw(kind, style, override, '', pal.fg)
  // Ground the billboard by its BOTTOM at the shadow line, so ANY tile size stays grounded (a
  // smaller enemy no longer floats above its shadow). `groundY` is the feet contact point.
  const groundY = baseY + tileH * 0.24
  // Per-entity SIZE scales the drawn figure (a size-2 boss draws twice as big). It grows UP from the
  // feet line (the `- (drawPx-basePx)*0.5` keeps the BOTTOM fixed), so a bigger figure stays grounded
  // on its shadow instead of sinking through the floor. size 1 is byte-identical to before.
  const size = Math.max(1, entity.size ?? 1)
  // The entity's AUTHORED animation frame drives what's drawn (data-driven); people default to the walk/
  // idle set, enemies to their static glyph. The frame resolves to a baked image (base or override tile)
  // OR a glyph — honouring flipX — so a moving person actually animates instead of freezing on the base
  // image. ASCII (no image, empty char) keeps its block-figure sprite below.
  const anims = entity.animations ?? (isEnemy ? undefined : DEFAULT_CHARACTER_ANIMATIONS)
  if (edv.image || edv.char) {
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    const efImg = frameImage(ef, edv.char, edv.image)
    if (efImg) {
      const baseImgPx = tileH * (isEnemy ? 1.9 : 2.4)
      const imgPx = baseImgPx * size
      drawStyledImage(ctx, efImg, x, groundY - baseImgPx * 0.42 - (imgPx - baseImgPx) * 0.5, imgPx, ef.flipX)
    } else {
      // Enemies read a touch smaller than people so a mob doesn't tower over the hero.
      const baseEmojiPx = fontSize * (isEnemy ? 1.35 : 1.7)
      const emojiPx = baseEmojiPx * size
      ctx.font = `bold ${emojiPx}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = edv.color
      drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), x, groundY - baseEmojiPx * 0.42 - (emojiPx - baseEmojiPx) * 0.5, ef.flipX)
      ctx.textAlign = 'left'
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    }
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
  tv: { char?: string; color: string; image?: ImageVisual; tintTo?: string }, // tintTo → recolour a colour-emoji GLYPH (the roof 🟥 → roof colour)
  na: number,
  nb: number,
  tint?: string, // an editor floor-colour override → recolour the tile image (#80)
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
  // Image tile if its raster is ready; otherwise fall back to the glyph so the face is NEVER blank —
  // covers the split second before a Noto PNG decodes AND a failed/missing image (graceful degradation).
  const img = tv.image ? tileImage(tv.image.src) : null
  if (img) {
    const drawSrc = tint ? tintedImage(img, tv.image!.src, tint) : img
    const sx = tv.image!.sx ?? 0
    const sy = tv.image!.sy ?? 0
    const sw = tv.image!.sw ?? img.naturalWidth
    const sh = tv.image!.sh ?? img.naturalHeight
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(drawSrc, sx, sy, sw, sh, i * cw, j * ch, cw, ch)
  } else if (tv.char) {
    // A colour-emoji ignores fillStyle, so a per-building roof colour can't be applied with fillText — when
    // `tintTo` is set (the roof), shear a RECOLOURED sprite instead so the roof 🟥 reads the roof's own hue.
    const sprite = tv.tintTo ? tintedGlyphSprite(tv.char, Math.max(cw, ch), tv.tintTo) : null
    if (sprite) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, i * cw, j * ch, cw, ch)
    } else {
      ctx.fillStyle = tv.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.min(cw, ch) * 1.16}px ${ASCII_FONT}` // slight overfill; the clip trims the excess
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.fillText(tv.char, (i + 0.5) * cw, (j + 0.5) * ch)
    }
  }
  ctx.restore()
}


/** Ground-tile SPRITE CACHE — the iso shear is CONSTANT per frame (only the cell position translates),
 *  so a reskinned ground tile is pixel-identical for every cell of a given appearance. Bake it ONCE to
 *  an offscreen diamond sprite and blit it translated per cell (drawImage) instead of paying a per-cell
 *  save/transform/clip/restore — the ctx.clip() over ~1000 ground cells/frame was the emoji-vs-ascii perf
 *  sink. Keyed on (tile,colour,size); ground resolves to only a handful of appearances per zoom level. */
const _groundSpriteCache = new Map<string, HTMLCanvasElement | null>()
// `sizeW`/`sizeD` (default 1) SCALE the baked diamond for a per-cell floor-dims override (Width×Zoom on x,
// Depth×Zoom on the ground axis). At 1×1 the key + bake are byte-identical to before — the common (unsized)
// ground cell reuses the ONE shared sprite. A sized cell bakes its own (few of them, so the cache stays small).
function groundSprite(gdv: DrawVisual, tileW: number, tileH: number, tint?: string, sizeW = 1, sizeD = 1): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  // Don't bake until an image tile's raster is decoded — else the sprite would freeze the ASCII fallback.
  if (gdv.image && !tileImage(gdv.image.src)) return null
  const tw = tileW * sizeW
  const th = tileH * sizeD
  const sizeKey = sizeW !== 1 || sizeD !== 1 ? `|${sizeW}|${sizeD}` : '' // unsized → EXACTLY the old key
  const key = `${gdv.image?.src ?? gdv.char}|${gdv.color}|${tint ?? ''}|${Math.round(tileW)}|${Math.round(tileH)}${sizeKey}`
  const hit = _groundSpriteCache.get(key)
  if (hit !== undefined) return hit
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(2 * tw)
  cv.height = Math.ceil(2 * th)
  const c = cv.getContext('2d')
  if (!c) {
    _groundSpriteCache.set(key, null)
    return null
  }
  // Bake with the diamond's LEFT corner at local (0, th) → the sprite's bbox top-left is (0,0), so a
  // blit at (px - tw, drawY - th) lands the (scaled) diamond centred exactly where the unsized draw did.
  fillIsoFaceWithTile(c, { x: 0, y: th }, { x: tw, y: -th }, { x: tw, y: th }, { char: gdv.char, color: gdv.color, image: gdv.image }, 1, 1, tint)
  _groundSpriteCache.set(key, cv)
  return cv
}


/** Render a height≥1 tile/asset as an iso CUBE — the 3D half of the 2D+3D tileset model. The cell's
 *  flat diamond extrudes into `height` stacked blocks (isoBlockFaces); each block fills its two
 *  camera-visible side faces + the top face gets the final cap, and the tile is SHEARED onto every
 *  face via fillIsoFaceWithTile (auto-extrude — one image on all faces; per-face art is a later phase).
 *  Side faces are shaded by the global LIGHT (top brightest, the two front walls dimmer) so the block
 *  reads 3D even when the tile has no per-face detail. `tint` = a per-instance colour override that
 *  recolours the whole cube (the colour-as-data rule). Impure canvas glue; the corner math is the pure,
 *  unit-tested isoBlockFaces. `dv.char`/`dv.image` come from resolveDraw — ASCII passthrough never
 *  reaches here (its assets stay flat), only a styled/emoji tile block does. */
export function drawIsoTileBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  topDv?: DrawVisual, // optional DIFFERENT tile for the TOP face (e.g. a ROOF cap on a WALL block)
): void {
  const n = Math.max(1, Math.floor(height))
  const faceColor = tint ?? dv.tint ?? dv.color
  // Per-face brightness from the sun (outward screen normals of the two FRONT walls). Constant per
  // block → hoisted out of the stacking loop. Same faceLight shading the peaked roof uses.
  const leftShade = darkenColor(faceColor, faceLight(-tileH, tileW)) // front-left wall (L→B edge)
  const rightShade = darkenColor(faceColor, faceLight(tileH, tileW)) // front-right wall (B→R edge)
  // Fill a face as a shaded solid quad, then overlay ITS tile sheared onto it (the auto-extrude).
  const fillFace = (f: BlockFace, colour: string, fdv: DrawVisual, ftint?: string): void => {
    ctx.fillStyle = colour
    fillQuad(ctx, f.a, f.b, f.c, f.d)
    if (fdv.image || fdv.char) {
      fillIsoFaceWithTile(ctx, f.a, { x: f.b.x - f.a.x, y: f.b.y - f.a.y }, { x: f.d.x - f.a.x, y: f.d.y - f.a.y }, { char: fdv.char, color: fdv.color, image: fdv.image }, 1, 1, ftint)
    }
  }
  // Stack bottom→top so higher blocks composite over lower ones; the TOP face is capped last (full-bright).
  for (let k = 0; k < n; k++) {
    const faces = isoBlockFaces(center, tileW, tileH, blockH, k)
    fillFace(faces.left, leftShade, dv, tint)
    fillFace(faces.right, rightShade, dv, tint)
  }
  const top = isoBlockFaces(center, tileW, tileH, blockH, n - 1).top
  if (topDv) fillFace(top, topDv.tint ?? topDv.color ?? faceColor, topDv) // a ROOF tile capping a wall block
  else fillFace(top, faceColor, dv, tint)
}

// Building-interior setting (default OFF = HOLLOW): buildings render as an empty shell so the DOOR and the
// wall-fade read — you can see IN when the hero is near (a filled interior blocks that). ON = filled;
// interior decorations come later. The editor toggles this via setShowBuildingInterior.
export let SHOW_BUILDING_INTERIOR = false
export function setShowBuildingInterior(v: boolean): void { SHOW_BUILDING_INTERIOR = v }

/** Windows per wall FACE — ~one per two cells, clamped [2,4] — matching the 2D elevation's spacing so a
 *  street reads uniform. Shared by the iso render + its test (single source of truth). */
export function faceWindowCount(span: number): number {
  return Math.max(2, Math.min(4, Math.round(span / 2)))
}


/** Overlay the roof TILE onto ONE peaked-roof face (an arbitrary quad), CLIPPED to that quad so it can
 *  never spill past the face, and RECOLOURED to the face's own `shade`. The caller already fillQuad'd the
 *  shade underneath, so this is purely the tile LAYER that makes the face genuinely tile-based (like 2D)
 *  without changing the look. ASCII (no tile char/image) → no-op. Headless (no offscreen) → the glyph is
 *  stamped at the centroid so the render still resolves a tile. */
function drawRoofTileOnQuad(ctx: CanvasRenderingContext2D, pts: Pt[], dv: DrawVisual, shade: string): void {
  if (!dv.char && !dv.image) return
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, span = Math.max(maxX - minX, maxY - minY)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.closePath()
  ctx.clip()
  if (dv.image) {
    drawStyledImage(ctx, dv.image, cx, cy, span, false, shade) // image roof → luminance-tint to the face shade
  } else {
    const sprite = tintedGlyphSprite(dv.char, span, shade)
    if (sprite) ctx.drawImage(sprite, cx - span / 2, cy - span / 2, span, span)
    else { ctx.fillStyle = shade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${span}px ${ASCII_FONT}`; ctx.fillText(dv.char, cx, cy) }
  }
  ctx.restore()
}


/** A peaked (gable) roof over the footprint BOX: the eaves overhang the walls, a ridge runs front→back at
 *  the length midpoint lifted `roofRise` above the eaves — the SAME trapezoid-prism the 2D house peaks
 *  into, extruded along the footprint's depth. Every face is fillQuad'd in the building's roof DATA colour
 *  (shaded by orientation), then the roof TILE is sheared onto it recoloured to that shade (drawRoofTileOnQuad)
 *  — so the roof is genuinely tile-based like the 2D elevation while the varied per-building colour still
 *  reads and the look is unchanged. Filled back-to-front so nearer faces occlude farther ones. `fbl/fbr/bbl/bbr`
 *  are the box's four GROUND corners (front-left, front-right, back-left, back-right); `L` = the length span. */
function drawIsoPeakedRoof(ctx: CanvasRenderingContext2D, fbl: Pt, fbr: Pt, bbl: Pt, bbr: Pt, L: number, liftEave: number, roofRise: number, roofC: string, roofTileDV: DrawVisual): void {
  const colVec: Pt = { x: (fbr.x - fbl.x) / L, y: (fbr.y - fbl.y) / L } // per-cell length step (down-right)
  const depthVec: Pt = { x: bbl.x - fbl.x, y: bbl.y - fbl.y }           // full depth back
  const eaveOf = (p: Pt): Pt => ({ x: p.x, y: p.y - liftEave })
  const rh = (L * ROOF_RIDGE_FRAC) / 2 // ridge half-width, in cells
  const upRoof = liftEave + roofRise
  const FEL = ptAdd(eaveOf(fbl), ptScale(colVec, -ROOF_OVERHANG)) // eaves stick out past the walls
  const FER = ptAdd(eaveOf(fbr), ptScale(colVec, ROOF_OVERHANG))
  const BEL = ptAdd(FEL, depthVec)
  const BER = ptAdd(FER, depthVec)
  const ridge = (t: number): Pt => ({ x: fbl.x + colVec.x * t, y: fbl.y + colVec.y * t - upRoof })
  const FRL = ridge(L / 2 - rh)
  const FRR = ridge(L / 2 + rh)
  const BRL = ptAdd(FRL, depthVec)
  const BRR = ptAdd(FRR, depthVec)
  const sideLF = faceLight(-colVec.x, -colVec.y) // left slope faces -col; right slope +col
  const sideRF = faceLight(colVec.x, colVec.y)
  // Each face: fill the shaded roof colour (the look), then shear the roof TILE onto it recoloured to that
  // same shade (clipped, so it can't spill) — genuinely tile-based, visually identical to the solid fill.
  const face = (shade: string, a: Pt, b: Pt, c: Pt, d: Pt): void => {
    ctx.fillStyle = shade
    fillQuad(ctx, a, b, c, d)
    drawRoofTileOnQuad(ctx, [a, b, c, d], roofTileDV, shade)
  }
  face(darkenColor(roofC, 0.66), BEL, BER, BRR, BRL)                         // back trapezoid
  face(darkenColor(roofC, Math.min(1, sideLF + 0.06)), FEL, BEL, BRL, FRL)   // left slope
  face(darkenColor(roofC, Math.min(1, sideRF + 0.06)), FER, BER, BRR, FRR)   // right slope
  face(darkenColor(roofC, 0.9), FRL, FRR, BRR, BRL)                          // ridge top
  face(roofC, FEL, FER, FRR, FRL)                                            // front gable (full roof colour)
}


/**
 * ISO building rendered PURELY FROM TILES = the 2D facade + DEPTH. Every footprint cell extrudes as a
 * tile block through the SAME primitive (drawIsoTileBlock) as every rock/prop: perimeter WALL cells rise
 * `floors` blocks carrying THIS building's MATERIAL tile (🪵/🧱/🪨/plaster, like 2D — not one global
 * brick); the DOOR cell is a LOW doorway (min 2 blocks, not a full cube). Over that, the two camera-near
 * walls get WINDOW tiles — one band per floor, exactly the rows the 2D elevation punches — and the top is
 * capped with a real ROOF: a peaked gable for houses/temple/cathedral, a flat plane otherwise, in the
 * building's roof DATA colour (no red 🟥 band, mirroring 2D). A STORE/HOSPITAL badge floats over the apex.
 * No whole-building landmark glyph, no solid-only content faces. Cells draw back-to-front so nearer walls
 * occlude farther ones; the interior stays HOLLOW unless SHOW_BUILDING_INTERIOR. */
export function drawIsoBuildingTiles(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  toScreen: (col: number, row: number) => Pt,
  cellElevation: (col: number, row: number) => number,
  heightStep: number,
  tileW: number,
  tileH: number,
  style: Style,
  fade = 1,
): void {
  const tcol = b.type as BuildingType
  const wallC = buildingCellColor(tcol, 'wall', b.col)
  const roofC = buildingCellColor(tcol, 'roof', b.col)
  const doorC = buildingCellColor(tcol, 'door', b.col)
  const windowC = buildingCellColor(tcol, 'window', b.col)
  const doorDV = resolveDraw('door', style, undefined, '', doorC)
  // Windows: the real 🪟 tile (its ⊞ fallback under ASCII / before the PNG decodes), sheared onto the wall.
  const windowDV = resolveDraw('window', style, undefined, '⊞', windowC)
  // Walls ride THIS building's MATERIAL tile (🪵 wood / 🧱 brick / 🪨 stone; '' plaster → colour only) — the
  // SAME per-building material 2D reads, never one global brick. ASCII (passthrough) → no overlay, so the
  // wall face stays its solid colour, byte-identical to before.
  const reskinned = style.id !== ASCII_STYLE.id
  const wallTile = reskinned ? wallMaterialTile(tcol, b.col) : ''
  const wallImage = reskinned ? wallMaterialImage(tcol, b.col) : undefined
  const wallTileDV: DrawVisual = { char: wallImage ? '' : wallTile, color: wallC, image: wallImage ? { kind: 'image', src: wallImage } : undefined }
  // Wall-block top CAPS stay a plain roof-colour fill (they're overdrawn by the real roof below).
  const roofFaceDV: DrawVisual = { char: '', color: roofC }
  // The roof TILE itself (🟥 under emoji; '' under ASCII → no tile). Sheared onto the visible roof faces
  // and RECOLOURED per-face to the roof's data shade, so the roof is a genuine tile like the 2D elevation
  // — no solid-colour-only roof face — while the varied per-building colour still reads. ASCII → unchanged.
  const roofTileDV = resolveDraw('roof', style, undefined, '', roofC)

  const blockH = tileW * 0.9 // one floor ≈ the cell's iso width
  const rect = buildingRect(b)
  const cells = facadeToFootprint(b).sort((a, z) => (a.col + a.row) - (z.col + z.row))
  const floors = cells.reduce((m, c) => Math.max(m, c.height), 1)
  // Facade WINDOW rows → iso block LEVELS: facade row r sits at block k = H-1-r from the ground, so an
  // N-floor building shows N floors of windows — the SAME rows draw2DBuilding punches (b.cells).
  const H = b.cells.length
  const windowLevels: number[] = []
  for (let r = 0; r < H; r++) if ((b.cells[r] ?? []).some(k => k === 'window')) windowLevels.push(H - 1 - r)
  const peaked = (b.cells[0] ?? []).some(k => k === 'empty') // houses/temple/cathedral leave empty roof corners
  const roofRise = ROOF_ROWS * blockH // the roof's 2 rows, translated 1 row = 1 block like the walls
  // When the building fades (hero near), the WALLS go MORE transparent so you can see IN, but the DOOR
  // stays MORE opaque so it's findable. Not faded (fade=1) → everything opaque.
  const wallAlpha = fade < 1 ? fade * 0.55 : 1
  const doorAlpha = fade < 1 ? Math.min(1, fade + 0.45) : 1

  // ── WALL / DOOR blocks (+ optional interior) — back-to-front so nearer cells occlude farther ones ──
  for (const c of cells) {
    const p = toScreen(c.col, c.row)
    const center: Pt = { x: p.x, y: p.y - cellElevation(c.col, c.row) * heightStep }
    // The DOOR cell is a CONTINUOUS wall for the block geometry (full height, same material as its
    // neighbours — no short standalone cube); the 🚪 door tile shears onto its road-facing FACE below.
    if (c.kind === 'wall' || c.kind === 'door') { ctx.globalAlpha = wallAlpha; drawIsoTileBlock(ctx, center, tileW, tileH, blockH, floors, wallTileDV, wallC, roofFaceDV) }
    else if (SHOW_BUILDING_INTERIOR) { ctx.globalAlpha = wallAlpha; drawIsoTileBlock(ctx, center, tileW, tileH, blockH, floors, roofFaceDV, roofC) } // interior filled only when the setting is ON (default: HOLLOW)
  }

  // ── Outer footprint BOX (its four GROUND corners) — the window bands + a peaked roof hang on it. Each
  //    corner is a perimeter cell's outermost diamond vertex, so the box edges sit flush on the wall faces. ──
  const corner = (col: number, row: number, offX: number, offY: number): Pt => {
    const s = toScreen(col, row)
    return { x: s.x + offX, y: s.y - cellElevation(col, row) * heightStep + offY }
  }
  const c0 = rect.col, c1 = rect.col + rect.w - 1, r0 = rect.row, r1 = rect.row + rect.h - 1
  const fbl = corner(c0, r1, -tileW, 0) // left (SW) vertex
  const fbr = corner(c1, r1, 0, tileH)  // front (S) vertex
  const bbl = corner(c0, r0, 0, -tileH) // back (N) vertex
  const bbr = corner(c1, r0, tileW, 0)  // right (NE) vertex
  const liftEave = floors * blockH

  // ── WINDOWS: the 🪟 window TILE sheared onto the TWO camera-near walls (front + near side), one band per
  //    floor — matching the 2D facade's window rows. The two hidden far walls get NONE (cameraNearWalls),
  //    so a faded building never bleeds phantom glass onto the roof. Faded with the wall it sits in. ──
  ctx.globalAlpha = wallAlpha
  const winH = blockH * 0.5 // a window ≈ half a floor tall
  for (const wall of cameraNearWalls(fbl, fbr, bbl, bbr, rect.w, rect.h)) {
    const count = faceWindowCount(wall.span)
    const slot = 1 / count
    const halfW = slot * 0.26 // window half-width as a fraction of the wall span
    for (const k of windowLevels) {
      const sill = k * blockH + blockH * 0.28 // window bottom, centred in this floor's block
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) * slot
        const bl: Pt = { x: wall.base.x + wall.axis.x * (t - halfW), y: wall.base.y + wall.axis.y * (t - halfW) - sill }
        const br: Pt = { x: wall.base.x + wall.axis.x * (t + halfW), y: wall.base.y + wall.axis.y * (t + halfW) - sill }
        // the window's own iso face: bottom edge (bl→br) runs along the wall axis, side edge rises straight up
        fillIsoFaceWithTile(ctx, bl, { x: br.x - bl.x, y: br.y - bl.y }, { x: 0, y: -winH }, { char: windowDV.char, color: windowDV.color, image: windowDV.image }, 1, 1)
      }
    }
  }

  // ── DOORS: FULL-CELL door TILES sheared onto the ground floor of the entrance wall — ONE per facade door
  //    cell, so the iso door COUNT equals the 2D facade's (house 1, cathedral 3, castle 4), as a CONTIGUOUS
  //    run CENTRED on the walkable entrance. Each door fills a WHOLE wall cell (full face width × one block
  //    tall — the same footprint a wall/window tile cell has), not a narrow doorway. The run rides a
  //    CAMERA-NEAR wall so it is ALWAYS visible: the south (front) row and east (right) col are the two edges
  //    the camera sees (their L→B / B→R faces — the pair cameraNearWalls returns for this projection, the SAME
  //    set the windows use). A south/east entrance is already near, so the doors sit on the real entrance; a
  //    north/west entrance faces a HIDDEN far wall, so the run is MIRRORED onto the near edge of its axis
  //    (north→south front row, west→east right col) — the user's "always findable" choice: a hidden-side house
  //    still shows its doors on the wall facing the camera. Drawn AFTER walls + windows so they read over them,
  //    at doorAlpha (kept more opaque than the faded walls so they stay findable when the hero fades the
  //    building). VISUAL only — the single walkable door cell + collision are unchanged. ──
  const bottomRow = b.cells[b.cells.length - 1] ?? []
  const doorCount = bottomRow.filter(k => k === 'door').length // = the 2D facade door width (1 / 3 / 4)
  if (doorCount > 0) {
    const facing = gridBuildingFacing(b)
    const rowAxis = facing === 'south' || facing === 'north' // entrance runs along COLS (a front/back row) vs ROWS
    const door = doorCellFor(facing, rect) // the lone walkable entrance cell — the door run centres on it
    const edgeLen = rowAxis ? rect.w : rect.h // cells along the entrance edge (== facade length)
    const centreIdx = rowAxis ? door.col - rect.col : door.row - rect.row // walkable cell's index along the edge
    const start = Math.max(0, Math.min(edgeLen - doorCount, centreIdx - Math.floor(doorCount / 2)))
    // The near edge the run draws on: south front row (L→B 'left' face) for a col-running entrance, east right
    // col (B→R 'right' face) for a row-running one — always camera-visible, mirroring a hidden north/west edge.
    const side: 'left' | 'right' = rowAxis ? 'left' : 'right'
    const frontRow = rect.row + rect.h - 1
    const rightCol = rect.col + rect.w - 1
    ctx.globalAlpha = doorAlpha
    for (let k = 0; k < doorCount; k++) {
      const col = rowAxis ? rect.col + start + k : rightCol
      const row = rowAxis ? frontRow : rect.row + start + k
      const dp = toScreen(col, row)
      const dCenter: Pt = { x: dp.x, y: dp.y - cellElevation(col, row) * heightStep }
      const face = isoBlockFaces(dCenter, tileW, tileH, blockH, 0)[side] // ground block's camera-near face
      // FULL CELL: the whole bottom edge (face.a→face.b) wide, ONE block (blockH) tall — a wall-cell footprint.
      fillIsoFaceWithTile(ctx, face.a, { x: face.b.x - face.a.x, y: face.b.y - face.a.y }, { x: 0, y: -blockH }, { char: doorDV.char, color: doorDV.color, image: doorDV.image }, 1, 1)
    }
  }

  // ── ROOF (drawn LAST so it occludes the wall/window tops it overlaps) — peaked gable for houses etc.,
  //    a flat plane otherwise, both in the building's roof DATA colour like 2D. Faded with the building. ──
  ctx.globalAlpha = fade
  if (peaked) {
    drawIsoPeakedRoof(ctx, fbl, fbr, bbl, bbr, rect.w, liftEave, roofRise, roofC, roofTileDV)
  } else {
    for (const c of cells) {
      const p = toScreen(c.col, c.row)
      const top = isoBlockFaces({ x: p.x, y: p.y - cellElevation(c.col, c.row) * heightStep }, tileW, tileH, blockH, floors - 1).top
      ctx.fillStyle = roofC
      fillQuad(ctx, top.a, top.b, top.c, top.d)
      // shear the roof TILE flat onto the diamond top, recoloured to roofC — a real tile face (like 2D), not colour-only
      fillIsoFaceWithTile(ctx, top.a, { x: top.b.x - top.a.x, y: top.b.y - top.a.y }, { x: top.d.x - top.a.x, y: top.d.y - top.a.y }, { char: roofTileDV.char, color: roofC, image: roofTileDV.image, tintTo: roofC }, 1, 1, roofC)
    }
  }

  // ── TYPE BADGE (STORE / HOSPITAL) floating over the roof apex — mirrors the 2D/top badge so a shop /
  //    clinic reads at a glance. Only store + hospital carry one. Always full-opacity so it stays legible. ──
  const badge = BUILDING_BADGES[b.type]
  if (badge) {
    ctx.globalAlpha = 1
    const cx = (fbl.x + fbr.x + bbl.x + bbr.x) / 4
    const cy = (fbl.y + fbr.y + bbl.y + bbr.y) / 4
    const apexY = cy - liftEave - (peaked ? roofRise : blockH * 0.4)
    const bf = blockH * (badge.text.length > 1 ? 0.6 : 0.95)
    ctx.font = `bold ${bf}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const bw = ctx.measureText(badge.text).width
    const by = apexY - bf * 0.9
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(cx - bw / 2 - 3, by - bf * 0.65, bw + 6, bf * 1.3)
    ctx.fillStyle = badge.color
    ctx.fillText(badge.text, cx, by)
  }

  ctx.globalAlpha = 1
}


export const ROOF_ROWS = 2 // facade roof is always the top 2 rows (mirrors composeBuilding)

export const ROOF_OVERHANG = 0.3 // peaked-roof eaves stick out past the walls

export const ROOF_RIDGE_FRAC = 0.46 // peaked-roof flat-top width as a fraction of length


/** One wall of an iso building footprint: its bottom-left ground corner `base`, the `axis` vector
 *  along the wall's whole bottom edge, and the `span` in cells (drives the window count). */
export interface IsoWall { base: Pt; axis: Pt; span: number }

/** The TWO camera-NEAR walls of an iso box, from its four ground corners + footprint size. A wall is
 *  "near" (its outward face points toward the viewer) when its bottom-edge midpoint sits BELOW — larger
 *  screen-y — the footprint centre. Exactly two of the four qualify, and WHICH two flips with the
 *  building's orientation (colVec/depthVec signs). Windows draw ONLY on these, never the two far/hidden
 *  walls — so a faded (translucent) building never bleeds hidden-wall windows through onto the roof
 *  (#32: they used to, because the "roof drawn last occludes them" trick only holds while opaque).
 *  Pure geometry → unit-tested. */
export function cameraNearWalls(fbl: Pt, fbr: Pt, bbl: Pt, bbr: Pt, length: number, depth: number): IsoWall[] {
  const cy = (fbl.y + fbr.y + bbl.y + bbr.y) / 4 // footprint centre screen-y
  const midY = (base: Pt, axis: Pt): number => base.y + axis.y / 2 // bottom-edge midpoint y
  const walls: IsoWall[] = [
    { base: fbl, axis: { x: fbr.x - fbl.x, y: fbr.y - fbl.y }, span: length }, // front (south edge)
    { base: bbl, axis: { x: bbr.x - bbl.x, y: bbr.y - bbl.y }, span: length }, // back  (north edge)
    { base: fbl, axis: { x: bbl.x - fbl.x, y: bbl.y - fbl.y }, span: depth }, // left  (west edge)
    { base: fbr, axis: { x: bbr.x - fbr.x, y: bbr.y - fbr.y }, span: depth }, // right (east edge)
  ]
  return walls.filter(w => midY(w.base, w.axis) > cy)
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
  const adv = resolveDraw(assetKind(asset), style, assetOverride(asset, style), '', asset.color ?? '#ffffff')
  // The tile's emoji-tileset entry: per-view size/pose + the iso block-height default. Undefined under ASCII.
  const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
  // 3D half of the 2D+3D tileset: a tile (or the placed instance via GridAsset.height) with height≥1 extrudes
  // into an iso BLOCK instead of a flat billboard. Height 0 / ASCII passthrough (adv.char '') → the flat draw below.
  const blocks = resolveTileHeight(vt, asset)
  if (blocks >= 1 && (adv.image || adv.char)) {
    const bh = resolveAssetDrawSize(tileW * 0.9, asset, 'billboard').h // one block ≈ the cell's iso width; Height/Zoom stretch it
    drawIsoTileBlock(ctx, { x, y }, tileW, tileH, bh, blocks, adv, asset.color)
    return
  }
  // A per-asset colour override tints the baked sprite (an emoji ships its own colours, so an override
  // has to recolour the image, not a fill) — #80. Undefined colour → drawn untinted.
  if (adv.image) {
    // Per-view tile size (byte-identical when unset: falls back to the old 2.2 constant), then per-element dims (#77/#78).
    const d = resolveAssetDrawSize(tileH * (resolveTileSize(vt, 'iso') ?? 2.2), asset, 'billboard')
    const cx = x, cy = y - lineHeight * 0.6 - d.baseLift
    const pose = resolveTilePose(vt, 'iso') // #1: props finally read a per-view pose (was unwired)
    if (pose) {
      ctx.save(); ctx.translate(cx, cy); applyPose(ctx, pose, 1, tileH)
      drawStyledImage(ctx, adv.image, 0, 0, d.w, false, asset.color, d.h)
      ctx.restore()
    } else {
      drawStyledImage(ctx, adv.image, cx, cy, d.w, false, asset.color, d.h)
    }
    return
  }
  if (adv.char) {
    // Trees tower (~3 cells, like the ASCII tree) instead of a tiny one-cell 🌲, anchored at the base.
    const isTree = asset.type === 'tree'
    const base = fontSize * (isTree ? 2.7 : 1.7) * (resolveTileSize(vt, 'iso') ?? 1)
    const d = resolveAssetDrawSize(base, asset, 'billboard') // #universal: Width/Height/Zoom apply to glyphs too
    const gy = y - lineHeight * (isTree ? 1.15 : 0.6) - d.baseLift
    const pose = resolveTilePose(vt, 'iso')
    const strength = asset.color ? (isTree ? 0.55 : 0.85) : 0 // colour-emoji ignore fillStyle → wash the tint on
    ctx.font = `bold ${d.h}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = asset.color ?? adv.color ?? '#ffffff' // ASCII glyphs / the no-override fillText path
    ctx.save()
    ctx.translate(x, gy)
    if (pose) applyPose(ctx, pose, 1, tileH)
    if (d.w !== d.h) ctx.scale(d.w / d.h, 1) // non-uniform Width vs Height, like the image branch
    fillTintedGlyph(ctx, adv.char, 0, 0, d.h, asset.color, strength)
    ctx.restore()
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
  cellSize: number,
  labels = true, // false → COLLISION-ONLY overlay (red tint on blocked cells, no coords/labels/player tag)
  // Diamond half-extents. render() passes its ALREADY-ZOOMED tileW/tileH (cellSize·isoScale·zoom·…) so the
  // red diamonds fill each cell edge-to-edge at any zoom. The defaults reproduce the old UNZOOMED formula
  // (off grid.isoScale) for callers/tests that don't pass a zoom — back-compat, but they under-fill zoomed.
  tileW = cellSize * grid.isoScale * 0.71,
  tileH = cellSize * grid.isoScale * 0.36,
) {
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Per-cell TILESET LABEL: the asset caption where a cell carries a placed element, else the terrain
  // autotile label computed PER VISIBLE CELL (not a whole-grid rebuild — that was the debug perf sink).
  const assetCaps = labels ? assetCaptionByCell(grid.getVisibleAssets(Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), 30, 20)) : new Map()

  // Pass 1: collision tint + per-cell coords + the cell's <TYPE> <POSITION> label (fit to the diamond)
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
      // tileW/tileH are the render's own (zoomed) diamond half-extents, so the tint matches the ground-tile
      // diamond + the building-footprint cube EXACTLY at any zoom — blocked cells GLUE edge-to-edge, no gaps.

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

      if (!labels) continue // collision-only overlay: tint blocked cells, skip the coords + label

      // Tiny coords in the cell (top-left of the diamond), so the centred label stays readable.
      ctx.font = `${Math.max(6, tileH * 0.42)}px ${ASCII_FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = isBlocked ? 'rgba(255,150,150,0.75)' : 'rgba(150,255,150,0.55)'
      ctx.fillText(`${col},${row}`, p.x - tileW * 0.42, p.y - tileH * 0.5)

      // The cell's tileset label, centred in the diamond + shrunk to fit (never overflows).
      const ac = assetCaps.get(`${col},${row}`)
      const text = ac?.text ?? terrainLabelAt(grid.ground, col, row)
      const lc = debugLabelColors(ac?.type ?? 'terrain')
      drawCellLabel(ctx, text, p.x, p.y, tileW * 1.7, lc.fg, lc.bg)
    }
  }

  if (!labels) return // collision-only overlay ends here — no PLAYER tag

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

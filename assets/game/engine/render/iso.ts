import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { assetAnimFrame, assetCycleFrame } from '@/engine/assetAnimations'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { type Facing } from '@/engine/villageLayout'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type Projectile, projectileCellAt } from '@/game/projectiles'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction, playerDisplayName } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { Connector } from '@/lib/api'
import { ASCII_FONT, COMBAT_RANGE, type DayNight, type DrawVisual, ENEMY_MOVE_MS, LAMP_GLOW, LIGHT, applyCellTransform, isoCameraFocus, assetCaptionByCell, terrainLabelAt, collectLampGlows, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawConnectorMarker, drawAttackAnimFrame, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, grassShade, cellFill, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, labelTileImage, labelTileRecolor, tileImage, tintedImage, tintedGlyphSprite, treeCanopyLayers, treeCellSet } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { type GroundCellDims, groundSizeFactors, groundDimsActive } from '@/engine/groundDims'
import { getStack, type TileSource } from '@/engine/cellStack'
import { isoBlockFaces, isoDepthBox, depthFrontExtent, type BlockFace, type DepthDir } from './isoBlock'
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

      // Step 4b — the FLOOR is read as tile index 0 of the cell's unified stack (mirrors 2D's Step 4a).
      // getStack projects the SAME ground slug/colour/dims the direct grid.ground/groundColor/groundDims
      // reads gave, so resolveGroundTile/cellFill + the dims path below stay byte-identical — only the
      // SOURCE moved onto the one tile-in-cell adapter. (Props keep their flat getVisibleAssets path in
      // render(): the TileEntry projection is lossy for a prop and per-cell iteration would reorder the
      // depth-sorted stack, either of which would break the pixel-identical contract.)
      const floor = getStack(grid, col, row)[0]
      const tileType = floor.slug || 'grass'
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
      const fillBg = floor.color ?? cellFill(gdv.tint, bg, isGrass || gk === 'cavefloor', col, row)

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

      // FLOOR COLOUR + DIMS also ride the floor tile (getStack maps groundColor → color and
      // scaleX/scaleZ/scale/scaleY/pose → w/d/zoom/scaleY/pose). Reconstruct the SAME GroundCellDims the old
      // grid.groundDims read gave — groundDimsActive/groundSizeFactors resolve identically (an all-unset
      // floor → w:1,d:1 → inactive, {fx:1,fy:1}); floor.color ?? undefined == the old groundColor ?? undefined.
      const floorTint = floor.color ?? undefined
      const floorDims: GroundCellDims = { scaleX: floor.w, scaleY: floor.scaleY, scaleZ: floor.d, scale: floor.zoom, pose: floor.pose }

      if (bakeStatic) {
        // Static cache: skip the animated water surface (collected for the live pass);
        // bake the grass glyph at full alpha (the ≤1.5% flicker is render-only motion).
        if (isWater) { if (waterOut) waterOut.push({ col, row }); continue }
        drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, false, time, col, row, floorTint, floorDims)
        continue
      }

      // Direct / fallback path — byte-identical to the original inline loop for ASCII.
      if (isWater) drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
      drawIsoGroundContent(ctx, gdv, px, drawY, tileW, tileH, isGrass, true, time, col, row, floorTint, floorDims)
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
    const floor = getStack(grid, col, row)[0] // Step 4b — floor from the unified stack (byte-identical)
    const tileType = floor.slug || 'grass'
    const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row) // LOADS from the tileset (byte-identical)
    const char = gt.char
    const fg = gt.fg
    const bg = gt.bg
    const drawY = py - grid.getHeight(col, row) * heightStep
    const wdv = resolveDraw(groundKind(tileType), style, undefined, char, fg)
    const fillBg = wdv.tint ?? bg // reskin water → the tile's own colour (catalog data); ASCII → bg
    drawIsoWaterDepth(ctx, px, drawY, tileW, tileH, fillBg, time, col, row)
    const floorDims: GroundCellDims = { scaleX: floor.w, scaleY: floor.scaleY, scaleZ: floor.d, scale: floor.zoom, pose: floor.pose }
    drawIsoGroundContent(ctx, wdv, px, drawY, tileW, tileH, false, true, time, col, row, floor.color ?? undefined, floorDims)
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
  hoveredCell: { col: number; row: number; level?: number } | null = null,
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
  // CONTENT signature is grid.groundVersion — an O(1) counter the grid bumps on every
  // ground/height/colour/dims edit (setGround/setGroundColor/setGroundDims/setHeight), the
  // SAME signal the 2D static-ground layer keys on. This replaces the per-frame FNV hash
  // over the visible cells (which stringified every groundDims cell) with a single int
  // compare on the hot cache-hit path; any map edit still forces a rebuild (never stale).
  const camKey = `${w}x${h}|${camX.toFixed(3)},${camZ.toFixed(3)}|${isoScale.toFixed(4)}|${cellSize}|${style.id}`
  let liveWater: { col: number; row: number }[] | null = null
  let didCache = false

  if (!forceDirect && cacheFits) {
    const stableCam = !!isoGroundCache && isoGroundCache.camKey === camKey && isoGroundCache.width === w && isoGroundCache.height === h
    if (stableCam || camKey === isoLastFrameKey) {
      const sig = grid.groundVersion
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
      ctx.font = `bold ${tileH * 1.1}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Portal marker is a TILE now: 🌀 under a reskin, ◊ under ASCII — over the purple diamond backing.
      drawConnectorMarker(ctx, style, p.x, drawY, tileH * 2)
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
  // Ground shadow goes ONLY on a tree's bottom (ground-contact) cell — see isGroundContact. The
  // tree-cell Set is memoized (treeCellSet) so we don't rescan every asset + realloc each frame.
  const treeCells = treeCellSet(grid)
  const isTreeCell = (c: number, r: number): boolean => treeCells.has(`${c},${r}`)

  // Sort all objects by depth (back to front). Placed entities depth-sort with
  // assets/player and draw as glyphs on top of their cell.
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  // A BUILDING is just TILES: a pre-built building is stamped as its composition's per-cell assets (like a
  // tree cell), so its walls/windows/door/roof flow into the draw list through the SAME `asset` path as any
  // stacked tile — no building-specific collect/filter/drawer, and no grouped-building array to read.
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset; entity?: Entity; moving?: boolean; inRange?: boolean }[] = [
    ...visibleAssets.map(a => ({ col: a.col, row: a.row, asset: a })),
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
  ].sort(isoDepthCompare) // back-to-front, then bottom-up within a stacked cell (higher blocks over lower)

  // Render each object with ASCII art style
  const playerIsTarget = !!targetId && entities.some(e => e.kind === 'player' && e.id === targetId)
  const playerIsHover = !!hoverId && entities.some(e => e.kind === 'player' && e.id === hoverId)
  // Proximity reveal is a GENERIC per-tile behavior now — NO building special case, no grouped-building read.
  // Any asset whose tile opted into settings.fadeNear eases translucent as the hero closes in, and
  // settings.cutawayRoof lifts the tile off entirely — each computed from the asset's OWN cell distance in the
  // draw loop below (fadeNearAlpha / cutawayAlpha). So a tree-leaf tile carrying fadeNear fades exactly like a wall.
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
    } else if (obj.asset) {
      // A BUILDING is JUST tiles: walls, windows, doors AND the roof all render per-cell through this one
      // generic path. The roof is a STACK of roof blocks forming a peaked gable (buildingCellTiles →
      // gableRoofLevels), so it needs no special cap drawer — the SAME stacked tiles project to a triangle
      // (2D front), a 3D gable (iso), and the footprint rectangle (top), like any other stacked tile.
      let op = obj.asset.opacity ?? 1 // per-asset opacity for contrast/depth
      // GENERIC proximity behavior: ANY asset whose tile opted into fadeNear/cutawayRoof eases by its OWN
      // distance to the hero — walls/leaves ease translucent (fadeNearAlpha), a roof lifts off (cutawayAlpha).
      const fx = obj.asset.settings
      if (fx && (fx.fadeNear || fx.cutawayRoof)) {
        const dist = Math.hypot(pCol - obj.asset.col, pRow - obj.asset.row)
        const alpha = fx.cutawayRoof ? cutawayAlpha(dist) : fadeNearAlpha(dist)
        if (alpha <= 0.03) continue // a cutaway tile lifted off → skip drawing entirely
        op = Math.min(op, alpha)
      }
      if (op < 1) ctx.globalAlpha = op
      // Brush STACK: lift this entry `heightLevel` cubes up so the pile climbs in iso (block-kinds extrude
      // into stacked cubes, decorative sprites become a lifted billboard). No-op at heightLevel 0 — every
      // generated/existing asset — so non-stacked maps are byte-identical. Mirrors the 2D raised stack.
      const stackLift = isoStackLift(tileW, obj.asset.heightLevel)
      // Authored frame animation: offset/rotate/scale the asset around its cell (sway/wind).
      const ax = p.x, ay = p.y - heightOffset - stackLift
      const ct = assetCellTransform(obj.asset.cellAnim, time)
      if (ct) applyCellTransform(ctx, ax, ay, ct, tileW, tileH)
      drawIsoAssetAscii(ctx, ax, ay, obj.asset, tileW, tileH, time, obj.asset.type === 'tree' && (!!obj.asset.baseShadow || isGroundContact(isTreeCell, obj.asset.col, obj.asset.row)), dayNight, style)
      if (ct) ctx.restore()
      if (op < 1) ctx.globalAlpha = 1
    }
  }

  ctx.globalAlpha = 1
  // (No post-loop roof CAP — the roof is per-cell stacked tiles drawn in the loop above, one system, all views.)

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
      // Under a reskin this draws the ability's FX TILE (🔥/⚡/…) recoloured to f.color, keeping the slash-arc
      // rotation; ASCII keeps the \ | / ─ frame glyph. Slash lifts a touch higher to swing at the hand.
      const ay = f.angle != null ? sp.y - tileH * 1.25 : sp.y - tileH
      drawAttackAnimFrame(ctx, a, f, style, sp.x, ay, Math.max(14, tileH * 1.7))
    }
  }

  // Travelling projectiles (arrow/bullet/bolt) — lerp along their path in iso space. The
  // loop ticks/resolves/drops them; this is read-only draw at the interpolated cell.
  if (projectiles.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const projPx = Math.max(14, tileH * 1.6)
    ctx.font = `bold ${projPx}px ${ASCII_FONT}`
    ctx.fillStyle = '#ffe9a8'
    for (const pr of projectiles) {
      const pc = projectileCellAt(pr, now)
      const sp = toScreen(pc.col + 0.5, pc.row + 0.5)
      const from = toScreen(pr.fromCol + 0.5, pr.fromRow + 0.5)
      const to = toScreen(pr.toCol + 0.5, pr.toRow + 0.5)
      // Under a reskin the glyph resolves to its arrow/bullet/dart tile IMAGE (warm-tinted like the glyph);
      // ASCII keeps the rotated glyph.
      drawProjectileGlyph(ctx, pr.glyph, sp.x, sp.y - tileH, from.x, from.y, to.x, to.y, style, projPx, '#ffe9a8')
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
    const selH = tileW * ISO_BLOCK_H_FRAC // same cube height as the selection so hover + select read as the same block
    const { col, row } = hoveredCell
    const lvl = hoveredCell.level ?? 0
    const p = toScreen(col, row)
    // Lift the hover cube onto the SAME block the click will select — the EXACT raise the selection cube uses
    // below — so the dim hover and the yellow selection align on a stack, instead of the hover floating on the
    // flat ground cell BEHIND the block (the hover-vs-selection offset). A flat cell (level 0) stays on ground.
    const raise = lvl >= 1 ? grid.getHeight(col, row) * heightStep + lvl * selH : 0
    const py = p.y - raise
    const gt = { x: p.x, y: py - tileH }, gr = { x: p.x + tileW, y: py }, gb = { x: p.x, y: py + tileH }, gl = { x: p.x - tileW, y: py }
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
    const selH = tileW * ISO_BLOCK_H_FRAC // cube height = ONE stack level (matches isoStackLift) → the selector hugs a real block
    for (const key of selectedCells) {
      // A 3-part key "col,row,level" is a RAISED block (3D selection); a 2-part "col,row" is a flat cell.
      const [col, row, lvl] = key.split(',').map(Number)
      const p = toScreen(col, row)
      // Lift the selector onto the block: the cell's elevation + the block's OWN stack lift (isoStackLift =
      // heightLevel · selH), the EXACT y render() draws the block's base at (isoBlockFaces: center = the base
      // diamond). So the outline's ground diamond sits on the block's base and its top cap on the block's top —
      // it hugs THAT block, not the one below. A flat cell (no level / level 0) stays on the ground.
      const raise = lvl >= 1 ? grid.getHeight(col, row) * heightStep + lvl * selH : 0
      const py = p.y - raise
      const gt = { x: p.x, y: py - tileH }, gr = { x: p.x + tileW, y: py }, gb = { x: p.x, y: py + tileH }, gl = { x: p.x - tileW, y: py }
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


/** Apex signage (a "STORE" marquee, a "HOSPITAL" word) drawn above a cell's apex at (x, apexY). GENERIC:
 *  driven by the tile's own `settings.badge` ({text,color}), NOT a buildingType lookup — so any tile that
 *  carries a badge shows one, through whichever draw path (cube or labeled cell) rendered the block. */
export function drawApexBadge(ctx: CanvasRenderingContext2D, x: number, apexY: number, fontSize: number, badge: { text: string; color: string }): void {
  const bf = fontSize * (badge.text.length > 1 ? 0.5 : 0.9)
  ctx.font = `bold ${bf}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const by = apexY - fontSize * 0.95
  const bw = ctx.measureText(badge.text).width
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(x - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
  ctx.fillStyle = badge.color
  ctx.fillText(badge.text, x, by)
}


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
  // Monospace advance ≈ 0.6em per char → width from the glyph's CHAR COUNT, so a multi-char composition
  // tile (a leaf '(@&@)') gets a backing that fits it, while a single glyph is unchanged. No per-cell
  // measureText() — the canvas-2D layout call that tanked iso FPS on dense (forest) stages.
  const w = char.length * fontSize * 0.6
  // A cell carrying apex signage FILLS solid (its darkened tint) so the word reads over it; every other
  // labeled cell keeps the plain dark backing behind its glyph. No `type:'building'` special case.
  const base = asset.color ?? '#cccccc'
  ctx.fillStyle = asset.settings?.badge ? darkenColor(base, 0.28) : 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x - w / 2 - 2, cy - fontSize * 0.55, w + 4, fontSize * 1.1)
  ctx.fillStyle = base
  ctx.fillText(char, x, cy)

  // Apex signage — driven GENERICALLY by settings.badge (not buildingType). Only the one apex tile per
  // building carries it → the measureText here is rare, not per-cell.
  if (asset.settings?.badge) drawApexBadge(ctx, x, cy, fontSize, asset.settings.badge)
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
  // (male→🧍‍♂️, old→🧓, …) — both baked images. A brush-placed unit's manual `tileOverride` RE-HOMES onto
  // the active style (resolveEntityDraw) so it RESKINS like a placed asset instead of freezing to the
  // style it was placed in; no pin → the style-derived default, byte-identical to before.
  const edv = resolveEntityDraw(kind, style, entity.tileOverride, entityStyleOverride(entity, style), '', pal.fg)
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


// Proximity reveal (Zelda/PoE style), now a GENERIC per-tile behavior driven by settings.fadeNear /
// settings.cutawayRoof — not building-only. A `fadeNear` tile eases to translucent as the hero closes in; a
// `cutawayRoof` tile eases to fully invisible — SMOOTHLY (smoothstep), not a hard pop. Constants kept.
export const BUILDING_FADE_RADIUS = 4.5 // fade begins easing this far out — a wide, gentle onset
export const BUILDING_MIN_ALPHA = 0.22  // a fadeNear tile eases to this (translucent but readable) on top
export const ROOF_GONE_DIST = 1.8       // a cutaway tile is fully invisible within this distance — lifted clean off

const smoothstep = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
/** fadeNear opacity by the hero's distance: 1 far, easing to BUILDING_MIN_ALPHA on top (walls, leaves, …). */
export function fadeNearAlpha(dist: number): number {
  if (dist >= BUILDING_FADE_RADIUS) return 1
  return BUILDING_MIN_ALPHA + (1 - BUILDING_MIN_ALPHA) * smoothstep(dist / BUILDING_FADE_RADIUS)
}
/** cutawayRoof opacity by distance: 1 far, easing to 0 by ROOF_GONE_DIST — the tile lifts off smoothly, no pop. */
export function cutawayAlpha(dist: number): number {
  if (dist >= BUILDING_FADE_RADIUS) return 1
  if (dist <= ROOF_GONE_DIST) return 0
  return smoothstep((dist - ROOF_GONE_DIST) / (BUILDING_FADE_RADIUS - ROOF_GONE_DIST))
}


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
  // Image tile if its raster is ready; otherwise fall back to the glyph so the face is NEVER blank —
  // covers the split second before a Noto PNG decodes AND a failed/missing image (graceful degradation).
  const img = tv.image ? tileImage(tv.image.src) : null
  if (img) {
    // PERF: an image scaled to (0,0,S,S) fills the sheared box EXACTLY — i.e. this face — so it can never
    // spill past it. The per-face ctx.clip() (a real hotspot at ~thousands of building-cube faces/frame) is
    // therefore redundant for the image path and is skipped; only the overfilling GLYPH path still clips.
    const drawSrc = tint ? tintedImage(img, tv.image!.src, tint) : img
    const sx = tv.image!.sx ?? 0
    const sy = tv.image!.sy ?? 0
    const sw = tv.image!.sw ?? img.naturalWidth
    const sh = tv.image!.sh ?? img.naturalHeight
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(drawSrc, sx, sy, sw, sh, i * cw, j * ch, cw, ch)
  } else if (tv.char) {
    ctx.beginPath()
    ctx.rect(0, 0, S, S)
    ctx.clip()
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


// The default iso BLOCK height (screen px) of ONE stack level — one cube tall. drawIsoTileBlock draws
// a default-dim cube exactly this tall (its `bh` base is tileW * 0.9), so lifting a stacked asset by
// this per level makes the pile climb in lockstep with the cubes (and with the 2D raised stack).
export const ISO_BLOCK_H_FRAC = 0.9

/** Iso screen-space RISE for a stacked asset: `heightLevel` cubes up (one ISO_BLOCK_H per level). The
 *  new brush stacks assets on a cell with heightLevel 0,1,2,… so the render lifts each entry by this —
 *  a 3-tall stack reads as 3 items climbing. heightLevel absent/0 (every generated/existing asset) → 0,
 *  so this is a pure no-op for non-stacked maps. Matches topdown.ts's 2D `heightLevel * tileH * 0.9`. */
export function isoStackLift(tileW: number, heightLevel: number | undefined): number {
  return (heightLevel ?? 0) * tileW * ISO_BLOCK_H_FRAC
}

/** Depth order for the merged iso draw list: back-to-front by the iso key (col + row), then — for two
 *  ASSETS on the SAME cell — bottom-up by heightLevel so a brush STACK composites higher blocks OVER
 *  lower ones (matching the isoStackLift rise). A non-asset tie (entity/player/building) returns 0 to
 *  keep the array's stable insertion order, so nothing but same-cell asset stacks is reordered — the
 *  no-stack case is byte-identical to the old `(a.col+a.row)-(b.col+b.row)` sort. */
export function isoDepthCompare(
  a: { col: number; row: number; asset?: { heightLevel?: number; depth?: number; depthDir?: DepthDir } },
  b: { col: number; row: number; asset?: { heightLevel?: number; depth?: number; depthDir?: DepthDir } },
): number {
  // A directional-depth box reaches `depthFrontExtent` cells toward the camera past its anchor, so it sorts by
  // its FRONTMOST covered cell — a box extending toward the camera draws in front of what it overlaps. A
  // depth-less asset (every existing tile) adds 0, so the no-depth case is byte-identical to (col+row).
  const key = (o: { col: number; row: number; asset?: { depth?: number; depthDir?: DepthDir } }): number => {
    const dep = o.asset?.depth
    const dir = o.asset?.depthDir
    return o.col + o.row + (dir && dep && Math.floor(dep) > 1 ? depthFrontExtent(dep, dir) : 0)
  }
  const d = key(a) - key(b)
  if (d !== 0) return d
  if (a.asset && b.asset) return (a.asset.heightLevel ?? 0) - (b.asset.heightLevel ?? 0)
  return 0
}




/** The camera/zoom/viewport the iso projection needs — the SAME numbers render() computes:
 *  `isoScale` is already the zoom-scaled value (grid.isoScale * zoom); camX/camZ are the clamped
 *  focus in world units (fc*cellSize, fr*cellSize). */
export interface IsoPickCamera {
  w: number
  h: number
  cellSize: number
  isoScale: number
  camX: number
  camZ: number
}

/** One raised block to hit-test: its cell, its stack level, and the ELEVATION of its cell (grid.getHeight)
 *  so the block's on-screen position matches the render, which lifts a stacked asset by BOTH the terrain
 *  height and isoStackLift. */
export interface IsoPickBlock {
  col: number
  row: number
  heightLevel: number
  terrainHeight: number
  /** which store this block came from (floor/asset/building/entity) — carried straight through to the
   *  result so the caller routes the hit to the right selection WITHOUT the picker ever branching on it.
   *  Absent for the legacy asset-only callers, where the result is `{col,row,level}` exactly as before. */
  source?: TileSource
}

export interface IsoPickResult {
  col: number
  row: number
  level: number
  /** the hit block's store (from IsoPickBlock.source). Undefined for asset-only callers. */
  source?: TileSource
}

/** Screen → the RAISED block the pointer is on, or null. Fixes the iso selection ignoring stacked blocks:
 *  `screenToCell` inverts the FLAT diamond projection, so a click on a block that the render LIFTED up
 *  (isoStackLift) resolves to the ground cell under that pixel — the bottom — never the block. This mirrors
 *  render()'s projection + lift to hit-test each block's on-screen footprint (its iso diamond at its lifted
 *  height) and returns the FIRST one the point falls inside, NEAREST the camera first — the draw order
 *  reversed (higher col+row, then higher level = drawn last / on top), so the block you SEE on top wins an
 *  overlap. Only heightLevel ≥ 1 blocks are tested; a flat cell / lone level-0 asset returns null so the
 *  caller's existing flat pick stays byte-identical (normal, unstacked selection is unchanged). Pure. */
export function pickIsoBlocksAll(
  screenX: number,
  screenY: number,
  blocks: readonly IsoPickBlock[],
  cam: IsoPickCamera,
): IsoPickResult[] {
  const { w, h, cellSize, isoScale, camX, camZ } = cam
  const tileW = cellSize * isoScale * 0.71
  const tileH = cellSize * isoScale * 0.36
  const heightStep = cellSize * isoScale * 0.4
  if (tileW <= 0 || tileH <= 0) return []
  // Nearest-camera-first = the reverse of render's back-to-front sort (isoDepthCompare): a higher (col+row)
  // is drawn later / on top, then a higher level within the same cell. Collect hits IN that order, so the
  // topmost VISIBLE block is first and the ones it occludes follow (front→back) — the order click-to-cycle
  // walks to reach a hidden block. Hit-test EVERY provided block, including level 0 — a ground-floor wall is
  // a 0-based CUBE seated on the floor and must be selectable. The CALLER decides what counts as a block (the
  // flat floor is excluded upstream); this pure fn just projects + hit-tests whatever it's given.
  const ordered = blocks
    .slice()
    .sort((a, b) => {
      const d = (b.col + b.row) - (a.col + a.row)
      if (d !== 0) return d
      return (b.heightLevel ?? 0) - (a.heightLevel ?? 0)
    })
  const hits: IsoPickResult[] = []
  for (const b of ordered) {
    const wx = b.col * cellSize - camX
    const wz = b.row * cellSize - camZ
    const px = w / 2 + (wx - wz) * isoScale * 0.71
    const py = h / 2 + (wx + wz) * isoScale * 0.36
    // isoBlockFaces: `center` is the block's BASE diamond and the cube extrudes UP. So hit-test the whole
    // visible cube UPWARD from the base: the TOP CAP diamond (at yTop), OR the two FRONT wall faces running
    // from the base (yBase, bottom) up to the top (yTop).
    const yBase = py - b.terrainHeight * heightStep - isoStackLift(tileW, b.heightLevel)
    const blockH = tileW * ISO_BLOCK_H_FRAC // one block's on-screen height
    const yTop = yBase - blockH
    const dxAbs = Math.abs(screenX - px)
    const hit = dxAbs / tileW + Math.abs(screenY - yTop) / tileH <= 1        // TOP cap diamond
      || (screenY >= yTop && screenY <= yBase && dxAbs <= tileW)             // FRONT wall faces (base → top)
    if (hit) hits.push({ col: b.col, row: b.row, level: b.heightLevel, source: b.source })
  }
  return hits
}

/** Screen → the frontmost RAISED block under the pointer (nearest-camera), or null — the block the render
 *  draws ON TOP at that pixel. The first of pickIsoBlocksAll; the rest are occluded behind it (reach them
 *  via click-to-cycle / nextPickIndex). Unchanged for every existing caller. */
export function pickIsoBlock(
  screenX: number,
  screenY: number,
  blocks: readonly IsoPickBlock[],
  cam: IsoPickCamera,
): IsoPickResult | null {
  return pickIsoBlocksAll(screenX, screenY, blocks, cam)[0] ?? null
}

/** Click-to-cycle index for reaching an OCCLUDED block: repeated clicks on (nearly) the same pixel walk
 *  front→back through the `count` overlapping candidates (wrapping); a click on a NEW pixel (beyond `tol`
 *  px) resets to the frontmost (0). Pure — the caller holds the {x,y,index} of the previous pick. */
export function nextPickIndex(
  prev: { x: number; y: number; index: number } | null,
  x: number,
  y: number,
  count: number,
  tol: number,
): number {
  if (count <= 0) return 0
  if (prev && Math.abs(x - prev.x) <= tol && Math.abs(y - prev.y) <= tol) return (prev.index + 1) % count
  return 0
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
function drawIsoTileBlockLive(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  topDv?: DrawVisual, // optional DIFFERENT tile for the TOP face (e.g. a ROOF cap on a WALL block)
  depth = 1, // directional-depth: >1 (with depthDir) extrudes into a long iso box spanning `depth` cells
  depthDir?: DepthDir,
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

  // DIRECTIONAL-DEPTH path (depth>1 + a direction): draw the extruded long-box HULL instead of a unit cube.
  // Guarded so a depth-less block (every existing tree/wall/terrain) never reaches here → byte-identical render.
  if (depthDir && Math.floor(depth) > 1) {
    const shade = (role: 'left' | 'right') => (role === 'left' ? leftShade : rightShade)
    // Stack bottom→top exactly like the cube path; each level is one long box, higher levels composite over lower.
    for (let k = 0; k < n; k++) {
      const box = isoDepthBox(center, tileW, tileH, blockH, depth, depthDir, k)
      fillFace(box.long, shade(box.longShade), dv, tint)
      fillFace(box.cap, shade(box.capShade), dv, tint)
    }
    const boxTop = isoDepthBox(center, tileW, tileH, blockH, depth, depthDir, n - 1).top
    if (topDv) fillFace(boxTop, topDv.tint ?? topDv.color ?? faceColor, topDv)
    else fillFace(boxTop, faceColor, dv, tint)
    return
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

// ── Single-block cube SPRITE CACHE (the building-cell hotspot) ────────────────────────────────────────
// A building cell is a height-1 image cube (drawIsoTileBlock(..., 1, ...)). It is pixel-identical for every
// cell of the same (tile image, face colour, tint, top-cap, dims) — a city has THOUSANDS (every wall / roof /
// window cell). Bake that cube ONCE to an offscreen canvas and blit it per cell, exactly like the ground
// sprite cache — instead of re-drawing 3 faces (each a fillQuad + a save/transform/drawImage) per cell/frame.
const _cubeSpriteCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number } | null>()

function cubeBlockSprite(dv: DrawVisual, tileW: number, tileH: number, blockH: number, tint?: string, topDv?: DrawVisual) {
  if (typeof document === 'undefined') return null
  // Don't bake until the image raster(s) decoded — else the sprite would freeze the glyph fallback.
  if (dv.image && !tileImage(dv.image.src)) return null
  if (topDv?.image && !tileImage(topDv.image.src)) return null
  const faceColor = tint ?? dv.tint ?? dv.color
  const key = `${dv.image?.src ?? dv.char}|${faceColor}|${tint ?? ''}|${topDv?.image?.src ?? ''}|${topDv?.tint ?? topDv?.color ?? ''}|${Math.round(tileW)}|${Math.round(tileH)}|${Math.round(blockH)}`
  const hit = _cubeSpriteCache.get(key)
  if (hit !== undefined) return hit
  const m = 1 // 1px margin so edge anti-aliasing never clips
  const ox = tileW + m // local centre-x
  const oy = blockH + tileH + m // local centre-y: room above for the block top diamond, below for the base
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(2 * tileW + 2 * m)
  cv.height = Math.ceil(blockH + 2 * tileH + 2 * m)
  const c = cv.getContext('2d')
  // A real browser ctx supports the full path API; jsdom's stub canvas (jest) does not — fall through to the
  // LIVE draw there instead of throwing in fillQuad.
  if (!c || typeof c.beginPath !== 'function') {
    _cubeSpriteCache.set(key, null)
    return null
  }
  drawIsoTileBlockLive(c, { x: ox, y: oy }, tileW, tileH, blockH, 1, dv, tint, topDv)
  const sprite = { canvas: cv, ox, oy }
  _cubeSpriteCache.set(key, sprite)
  return sprite
}

/** Draw a stacked iso cube. A single-block, full-opacity IMAGE cube blits a CACHED sprite (the building-cell
 *  fast path — the big city hotspot); taller stacks, fading/cutaway cubes (globalAlpha < 1) and glyph-only
 *  ASCII draw live. Skipping the cache at globalAlpha < 1 keeps proximity fade compositing exactly as before. */
export function drawIsoTileBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  topDv?: DrawVisual,
  depth = 1, // directional-depth (with depthDir) → a long iso box; default 1 = the unmodified cube
  depthDir?: DepthDir,
): void {
  const isDepthBox = !!depthDir && Math.floor(depth) > 1
  // The cube-sprite cache bakes a UNIT cube — never a directional box; skip it so a depth box always draws live.
  if (!isDepthBox && Math.floor(height) === 1 && ctx.globalAlpha === 1 && dv.image) {
    const spr = cubeBlockSprite(dv, tileW, tileH, blockH, tint, topDv)
    if (spr) {
      ctx.drawImage(spr.canvas, center.x - spr.ox, center.y - spr.oy)
      return
    }
  }
  drawIsoTileBlockLive(ctx, center, tileW, tileH, blockH, height, dv, tint, topDv, depth, depthDir)
}

// Buildings always render as an empty shell (HOLLOW) so the DOOR and the wall-fade read — you can see IN
// when the hero is near. Interior decorations come later as real tiles, not a fill toggle.

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


export const ROOF_ROWS = 2 // facade roof is always the top 2 rows (matches the baked building roof)

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
  // art below (labeled cells, trees, legacy buildings, props) with ONE tile. A PLACED tile's
  // override re-homes onto the active style so it RESKINS (resolveAssetDraw), never freezing to
  // the style it was picked in. ASCII + no override → adv.char '' → the byte-identical per-type draw.
  const adv = resolveAssetDraw(assetKind(asset), style, assetOverride(asset, style), '', asset.color ?? '#ffffff')
  // The tile's emoji-tileset entry: per-view size/pose + the iso block-height default. Undefined under ASCII.
  const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
  // 3D half of the 2D+3D tileset: a tile (or the placed instance via GridAsset.height) with height≥1 extrudes
  // into an iso BLOCK instead of a flat billboard. Height 0 / ASCII passthrough (adv.char '') → the flat draw below.
  const blocks = resolveTileHeight(vt, asset)
  // A well / fountain under a RESKIN (emoji) extrudes its RESOLVED TILE (⛲/🪣) into a raised iso basin block
  // instead of a flat billboard — keeps the 3D depth from the DB tile; town fountains scale to their footprint.
  // ASCII (passthrough) + a tile with its own height (blocks≥1) use the generic tile path below — the bespoke
  // fountain/well drawers are gone.
  const reskinned = style.id !== ASCII_STYLE.id
  if (reskinned && blocks < 1 && (asset.type === 'well' || asset.type === 'fountain') && (adv.image || adv.char)) {
    const span = asset.footprint && asset.footprint > 1 ? asset.footprint : 1
    const bw = span > 1 ? tileW * span * 0.6 : tileW
    const bhScreen = span > 1 ? tileH * span * 0.6 : tileH
    const basinH = tileH * (span > 1 ? span * 0.5 : 1.4) // raised basin height in px (≈ the ASCII bodyH)
    drawIsoTileBlock(ctx, { x, y }, bw, bhScreen, basinH, 1, adv, asset.color)
    return
  }
  if (blocks >= 1 && (adv.image || adv.char)) {
    // A block scales on ALL THREE axes (was height-only): Width (scaleX) widens the diamond, Depth (scaleZ)
    // deepens it, Height (scaleY) stretches it up, and Zoom (scale) multiplies every axis. This is what makes a
    // tile able to SPAN MANY BLOCKS (a 1×2 wall, a wide roof) instead of only growing taller.
    const zoom = asset.scale ?? 1
    const bw = tileW * (asset.scaleX ?? 1) * zoom       // Width  — diamond half-width
    const bd = tileH * (asset.scaleZ ?? 1) * zoom       // Depth  — diamond half-height (into-screen axis)
    const bh = tileW * 0.9 * (asset.scaleY ?? 1) * zoom // Height — one block ≈ the cell's iso width, stretched up
    drawIsoTileBlock(ctx, { x, y }, bw, bd, bh, blocks, adv, asset.color, undefined, asset.depth, asset.depthDir)
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

  // ── ASCII composition tile → a true iso CUBE (minecraft-style block), rendered by the SAME drawIsoTileBlock
  // the EMOJI path uses — so ascii + emoji tiles are drawn IDENTICALLY (no special ascii drawer, no flat
  // billboard). A labeled tile with a real block height (a tree / fountain / lamp / prop CELL) extrudes into a
  // cube with its glyph painted (sheared) onto the faces; consecutive stack levels lift by isoStackLift, which
  // uses the SAME tileW·ISO_BLOCK_H_FRAC as the cube height so a column stacks flush. BUILDINGS ride this path
  // too now (no `type:'building'` gate) — a wall/window/door/roof block is just a labeled cube like a tree cell.
  if (asset.label && (asset.height ?? 0) >= 1) {
    const zoom = asset.scale ?? 1
    const bw = tileW * (asset.scaleX ?? 1) * zoom       // Width  — diamond half-width
    const bd = tileH * (asset.scaleZ ?? 1) * zoom       // Depth  — diamond half-height (into-screen axis)
    const bh = tileW * ISO_BLOCK_H_FRAC * (asset.scaleY ?? 1) * zoom // Height — one block, flush with isoStackLift
    const tint = asset.color ?? '#cccccc'
    // The composition is style-agnostic STRUCTURE; the block is PAINTED with the ACTIVE style's tile for this
    // cell's label — the emoji in emoji mode, the ascii glyph otherwise. Both come from the loaded DB tileset
    // under the same label (ascii + emoji, one path, no hardcoded frontend tile).
    const et = style.id === 'emoji' ? EMOJI_TILESET[asset.label] : undefined
    const glyph = et ? et.char : (asset.art[0] ?? '?') // emoji part tile in emoji mode, else the ascii glyph
    // The label's backend IMAGE (ascii: a white tint-target, RECOLOURED to the block's tint; emoji: an
    // already-coloured Noto/baked PNG, NEVER recoloured) paints the block faces; a label with no image
    // (most today) falls back to the glyph above via drawIsoTileBlock's own image-or-char face fill, so a
    // cell is never blank.
    const image = labelTileImage(asset.label, style)
    const recolor = labelTileRecolor(style, tint)
    drawIsoTileBlock(ctx, { x, y }, bw, bd, bh, 1, { char: glyph, color: tint, tint: recolor, image }, recolor, undefined, asset.depth, asset.depthDir)
    // Apex signage rides ON TOP of the cube (the apex roof block carries settings.badge) — generic, no buildingType.
    if (asset.settings?.badge) drawApexBadge(ctx, x, y - bh, fontSize, asset.settings.badge)
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

  } else {
    // Default: show the asset's art character (fountain/well fall through here — they render as their TILE:
    // the emoji reskin path above extrudes ⛲/🪣 into an iso basin, ASCII draws the asset glyph — no bespoke drawer)
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

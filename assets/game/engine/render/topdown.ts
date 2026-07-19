import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type Projectile, projectileCellAt } from '@/game/projectiles'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction, playerDisplayName } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { resolveGroundTile } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { applyPose } from '@/engine/tileset/pose'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { Connector } from '@/lib/api'
import { ASCII_FONT, COMBAT_RANGE, type DayNight, ENEMY_MOVE_MS, applyCellTransform, clampCameraAxis, assetCaptionByCell, terrainLabelAt, collectLampGlows, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawConnectorMarker, drawAttackAnimFrame, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, clipToBall, sphericalShade, SINGLE_TILE_FRAC, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, grassShade, cellFill, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, labelTileImage, labelTileRecolor, groundDecorImage, treeCanopyLayers, treeCellSet } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { resolveAssetAnimation } from './assetAnimation'
import { DEPTH_CELL_STEP } from './isoBlock'
import { billboardGeom, pointInTileGeom, outlineSegments, poseMapper, type TileGeom } from './tileHit'
import type { TileSource } from '@/engine/cellStack'
import { frontElevation, type FrontElevation } from './frontElevation'
import { groundSizeFactors, groundDimsActive, type GroundCellDims } from '@/engine/groundDims'
import { getStack } from '@/engine/cellStack'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, type ElementKind, type Style } from '@/game/artStyle'
import { DEFAULT_CHARACTER_ANIMATIONS, activeFrame } from '@/game/runtime/entityAnimation'


/** Draw a placed entity in the TOP (blueprint) renderer — a filled cell badge
 *  with the glyph, drawn over ground/assets/player so it always reads. Living
 *  enemies get a thin HP bar across the top edge of their cell. */
export function drawTopEntity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  entity: Entity,
  combat?: CombatState,
  now: number = idleNow(),
  moving = false,
  inRange = false,
  attackable = false,
  style: Style = ASCII_STYLE,
  isTarget = false,
  isHover = false,
): { x: number; y: number } {
  // The figure spans a footprint (a 3-row figure ≈ 2 cells tall, 1 wide) anchored so
  // the entity's cell is the BOTTOM cell — matching the player's 2-tall look in top view.
  const art = entityAnimFrame(entity, now, moving, inRange)
  const cellsTall = Math.max(2, Math.ceil(art.length / 1.5))
  const spanH = cellsTall * tileSize
  const topY = y - (cellsTall - 1) * tileSize
  const fontSize = Math.max(6, (spanH * 0.9) / art.length)
  const charW = fontSize * 0.6
  const maxW = art.reduce((m, r) => Math.max(m, r.length), 0)
  const cx = x + tileSize / 2
  const textLeft = cx - (maxW * charW) / 2
  const startY = topY + spanH / 2 - ((art.length - 1) / 2) * fontSize

  // Ground shadow at the figure's feet (bottom row) — sized to the figure.
  const footY = startY + (art.length - 1) * fontSize + fontSize * 0.35
  drawGroundShadow(ctx, cx, footY, (maxW * charW) / 2)
  // Selected target: red reticle at the feet (mirrors the iso view's drawSelectionRing).
  if (isTarget) drawSelectionRing(ctx, cx, footY, (maxW * charW) / 2 + tileSize * 0.28)
  else if (isHover) drawHoverRing(ctx, cx, footY, (maxW * charW) / 2 + tileSize * 0.28) // dim white hover reticle
  // In-strike-range indicator: a ring at the feet (#35).
  if (attackable) drawRangeRing(ctx, cx, footY, (maxW * charW) / 2 + tileSize * 0.2, now)
  // NO background panel — the figure draws directly on the map (a colored box behind
  // every monster/NPC made stages unreadable). A 1px shadow keeps it legible.
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // Block style — solid bg per row + bright glyph, so the 2D view matches the iso view.
  const pal = entityPalette(entity)
  // An enemy draws its per-type tile (goblin→👺, wolf→🐺, …); a person draws its per-variant figure
  // (male→🧍‍♂️, old→🧓, …) — both baked images. A brush-placed unit's manual `tileOverride` RE-HOMES onto
  // the active style (resolveEntityDraw) so it RESKINS like a placed asset instead of freezing to the
  // style it was placed in; no pin → the style-derived default, byte-identical to before.
  const edv = resolveEntityDraw(entityKind(entity.kind), style, entity.tileOverride, entityStyleOverride(entity, style), '', pal.fg)
  // Per-entity SIZE scales the drawn figure (a size-2 boss draws twice as big); it grows UP from the
  // feet line (footY) — the `- (drawPx-basePx)*0.5` fixes the BOTTOM — so a bigger figure stays grounded
  // on its shadow. size 1 is byte-identical to before.
  const size = Math.max(1, entity.size ?? 1)
  const isEnemy = entityKind(entity.kind) === 'enemy'
  // The entity's AUTHORED animation frame drives what's drawn — people default to walk/idle, enemies to a
  // static glyph. The frame resolves to a baked image (base or override tile) OR a glyph — honouring flipX
  // — so a moving person animates instead of freezing on the base image. ASCII (no image, empty char) keeps
  // its multi-row sprite below.
  const anims = entity.animations ?? (isEnemy ? undefined : DEFAULT_CHARACTER_ANIMATIONS)
  // The drawn figure's HEAD (top edge in screen y) — set by whichever branch draws, so the vitals bar +
  // quest marker hug the REAL sprite top (emoji billboard vs ascii multi-row figure differ) instead of a
  // fixed lift off the footprint that floated the bar above the emoji.
  let figureTop: number
  if (edv.image || edv.char) {
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    const efImg = frameImage(ef, edv.char, edv.image)
    if (efImg) {
      const baseImgPx = spanH * 0.9
      const imgPx = baseImgPx * size
      const cy = footY - baseImgPx * 0.42 - (imgPx - baseImgPx) * 0.5
      drawStyledImage(ctx, efImg, cx, cy, imgPx, ef.flipX)
      figureTop = cy - imgPx * 0.5
    } else {
      // One emoji replaces the multi-row figure. FIXED cell-multiple size, grounded by its BOTTOM at the
      // shadow (footY) so a smaller enemy doesn't float.
      const baseEmojiPx = tileSize * (isEnemy ? 1.35 : 1.7)
      const emojiPx = baseEmojiPx * size
      const cy = footY - baseEmojiPx * 0.42 - (emojiPx - baseEmojiPx) * 0.5
      ctx.font = `bold ${emojiPx}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = edv.color
      drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), cx, cy, ef.flipX)
      ctx.textAlign = 'left'
      figureTop = cy - emojiPx * 0.5
    }
  } else {
    for (let i = 0; i < art.length; i++) {
      const line = art[i]
      const ly = startY + i * fontSize
      const s = line.length - line.trimStart().length
      const en = line.trimEnd().length
      if (en > s) {
        ctx.fillStyle = pal.bg
        ctx.fillRect(textLeft + s * charW - 1, ly - fontSize * 0.42, (en - s) * charW + 2, fontSize * 0.82)
      }
      ctx.fillStyle = '#000000'
      ctx.fillText(line, textLeft + 1, ly + 1)
      ctx.fillStyle = pal.fg
      ctx.fillText(line, textLeft, ly)
    }
    // Multi-row figure: the TOP row is drawn at startY (middle baseline); its top edge is a half row higher.
    figureTop = startY - fontSize * 0.5
  }
  if (entity.kind !== 'enemy') return { x: cx, y: figureTop - fontSize * 0.6 }

  // Enemy vitals (HP bar + name) drew for EVERY enemy, so a mob-heavy cave/temple became a wall of
  // "skeleton/bat/spider" text. Show them only when the enemy is ENGAGED (in combat proximity) or
  // DAMAGED; an idle distant enemy is just its self-identifying glyph — click it for the Inspector.
  const frac = hpFraction(entity, combat)
  if (frac >= 0.999 && !inRange && !attackable) return { x: cx, y: figureTop - fontSize * 0.6 }
  const barWidth = Math.max(maxW * charW, tileSize * 2.2)
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, fontSize)
  return drawFigureVitals(ctx, cx, figureTop, barWidth, 6, nameSize, frac, label)
}


/** Draw a generated, labeled cell as a single glyph (its label char + zone/theme
 *  color) on a dark backing in the 2D view — the cell IS the tile, matching the
 *  iso (drawIsoLabeledCell) and top renderers so a stage looks the same in
 *  every view (and a zone tree is NEVER spring-green). */
export function draw2DLabeledCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  tileW: number,
  tileH: number,
  asset: GridAsset,
  style: Style,
): void {
  // Paint the cell with the ACTIVE style's tile for its LABEL — the emoji in emoji mode, else the ascii glyph.
  // Never mix: a composition cell is emoji in emoji mode, ascii in ascii mode. Both come from the DB tileset.
  const char = (style.id === 'emoji' && asset.label ? EMOJI_TILESET[asset.label]?.char : undefined) ?? asset.art[0] ?? '?'
  const tint = asset.color ?? '#cccccc'
  // Width/Height/Zoom (scaleX/scaleY/scale) stretch the cell; HEIGHT (scaleY) grows the box UP from its base
  // — the bottom edge stays planted at `baseY` while the top rises — so a labeled tile whose height is
  // animated (the fountain water column) grows in place in 2D exactly like the iso block does, NOT centered
  // and NOT levitating. All axes default to 1 → drawW/drawH == tileW/tileH and `cy` == the old value, so an
  // un-scaled labeled cell is byte-identical to before.
  const zoom = asset.scale ?? 1
  const drawW = tileW * (asset.scaleX ?? 1) * zoom
  const drawH = tileH * (asset.scaleY ?? 1) * zoom
  const cy = baseY - drawH * 0.5
  // The tile's NORMAL 2D front face — its own-colour backing + the label image (or glyph). Shared by the plain
  // square path and the circle path so a rounded tile shows the SAME painting, only its form changes.
  const drawFace = (): void => {
    // Back the cell with the TILE'S OWN colour — not a neutral black box — so 2D shows the same colour ISO
    // does (green trees, brown walls, the roof's red), driven purely by the tile's data. A translucent black
    // pass darkens that backing so the glyph drawn on top (full tint) still reads clearly.
    ctx.fillStyle = tint
    ctx.fillRect(x - drawW / 2, baseY - drawH, drawW, drawH)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(x - drawW / 2, baseY - drawH, drawW, drawH)
    // DISPLAY = "single" (per-tile setting): draw ONE smaller centered tile INSIDE the plain colour cell instead
    // of filling the whole front face, mirroring the iso "single tile inside the block" look. Absent/'all-faces'
    // → the tile fills the cell exactly as before.
    const single = asset.settings?.display === 'single'
    const frac = single ? SINGLE_TILE_FRAC : 1
    // The label's backend IMAGE (ascii: a white tint-target, RECOLOURED to `tint`; emoji: an already-coloured
    // PNG, NEVER recoloured) fills the same cell box the glyph would; a label with no image (most today)
    // falls through to the glyph below, so the cell is never blank.
    const image = asset.label ? labelTileImage(asset.label, style) : undefined
    if (image) {
      drawStyledImage(ctx, image, x, cy, drawW * frac, false, labelTileRecolor(style, tint), drawH * frac)
      return
    }
    ctx.font = `bold ${drawH * 0.8 * frac}px ${ASCII_FONT}`
    ctx.fillStyle = tint
    ctx.fillText(char, x, cy)
  }

  // SHAPE = "circle" is a FORM modifier, not a repaint (the flat analogue of the iso ball): draw the SAME front
  // face but CLIP it to an ellipse so the tile's painting stays and only the silhouette rounds, then overlay a
  // soft sphere shade. Absent/'square' → the plain rectangular face. (The old path drew a solid tinted ball,
  // which lost the tile's art — the bug this fixes.)
  if (asset.shape === 'circle') {
    ctx.save()
    clipToBall(ctx, x, cy, drawW * 0.5, drawH * 0.5)
    drawFace()
    sphericalShade(ctx, x, cy, drawW * 0.5, drawH * 0.5)
    ctx.restore()
    return
  }
  drawFace()
}


// 2D Render function - RPG-style 3/4 top-down view (like Pokemon/Zelda)
export let twoDRenderMsEMA = 0 // rolling avg of render2D() ms, exposed on window.__2dRenderMs (perf probe)

// The static ground layer, baked to an offscreen canvas and blitted per frame. The ground doesn't change
// between frames (a reskin ground has NO time-varying term — the grass flicker is ASCII-only), so
// re-resolving + re-drawing every visible cell EVERY frame is pure waste — the profile showed the 2D frame
// is dominated by per-cell draw calls. We rebuild only when something that affects the ground changes
// (its data, heights, camera, zoom, style, or canvas size); otherwise it's a single drawImage. This is the
// idle-cost fix ("consuming resources while I watch youtube" — the RAF loop keeps rendering while nothing moves).
let _groundLayer: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; key: string; grid: IsometricGrid } | null = null
let _groundPendingKey = '' // the ground key seen LAST frame; we only bake once it repeats (camera held still),
// so actively scrolling draws direct with no extra bake+blit penalty, and only a stationary scene caches.

// ── INVERTED 2D TILE PICK — same model as iso: record each drawn tile's screen silhouette, hit-test IT ──
// render2D records every drawn asset's real screen rect (honouring scaleY/heightLevel lift/zOffset ground-slide
// /pose/zoom) so the picker + highlight resolve the TILE the user sees (e.g. a tall lamp's lifted bulb), not
// the flat ground cell. Refreshed every frame; read on mousemove/mousedown. Canvas-internal pixels.
interface TileHit2D { col: number; row: number; level: number; source: TileSource; geom: TileGeom }
let twoDTileHits: TileHit2D[] = []

/** Every recorded 2D tile whose rect contains (x,y), TOPMOST (last-drawn) first — the frontmost is the pick. */
export function pickTwoDTilesAt(x: number, y: number): TileHit2D[] {
  const hits: TileHit2D[] = []
  for (let i = twoDTileHits.length - 1; i >= 0; i--) {
    if (pointInTileGeom(x, y, twoDTileHits[i].geom)) hits.push(twoDTileHits[i])
  }
  return hits
}

/** The frontmost recorded 2D tile under (x,y), or null (→ the caller falls back to the flat cell). */
export function pickTwoDTileAt(x: number, y: number): TileHit2D | null {
  return pickTwoDTilesAt(x, y)[0] ?? null
}

/** The recorded 2D silhouette of the tile at (col,row,level) drawn this frame (topmost), or null. */
export function twoDRecordedGeom(col: number, row: number, level: number): TileGeom | null {
  for (let i = twoDTileHits.length - 1; i >= 0; i--) {
    const t = twoDTileHits[i]
    if (t.col === col && t.row === row && t.level === level) return t.geom
  }
  return null
}

/** Stroke a recorded 2D tile outline (its rect ring) so the highlight hugs the tile, not the flat cell. */
function stroke2DTileOutline(ctx: CanvasRenderingContext2D, geom: TileGeom): void {
  for (const seg of outlineSegments(geom)) {
    if (seg.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(seg[0].x, seg[0].y)
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y)
    ctx.stroke()
  }
}

export function render2D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  zoom: number = 1.0,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  connectors: Connector[] = [],
  quests: readonly Quest[] = [],
  dayNight: DayNight = 'day',
  attackAnims: readonly AttackAnim[] = [],
  hitMarkers: readonly HitMarker[] = [],
  projectiles: readonly Projectile[] = [],
  attackReach: number = 1,
  style: Style = ASCII_STYLE,
  targetId: string | null = null,
  hoverId: string | null = null,
  selectedCells: ReadonlySet<string> = new Set(),
  hoveredCell: { col: number; row: number; level?: number } | null = null,
) {
  const __t0 = typeof performance !== 'undefined' ? performance.now() : 0
  const playerIsTarget = !!targetId && entities.some(e => e.kind === 'player' && e.id === targetId)
  const playerIsHover = !!hoverId && entities.some(e => e.kind === 'player' && e.id === hoverId)
  // Clear with sky/background color
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const baseTileSize = 24
  const tileW = baseTileSize * zoom // Tile width in pixels
  const tileH = baseTileSize * zoom // Tile height in pixels
  const heightScale = 16 * zoom // Pixels per height unit (objects extend upward)

  // Camera follows player (centered) + pan offset, then CLAMP to the grid so the
  // viewport never shows off-grid void (centre when the grid is smaller than the
  // view). Half-span = half the visible cell count on each axis.
  const camCol = clampCameraAxis(player.x / cellSize - camOffset.x / tileW, w / tileW / 2, grid.cols)
  const camRow = clampCameraAxis(player.z / cellSize - camOffset.y / tileH, h / tileH / 2, grid.rows)

  // Convert grid position to screen
  const toScreen = (col: number, row: number) => ({
    x: w / 2 + (col - camCol) * tileW,
    y: h / 2 + (row - camRow) * tileH
  })

  // Calculate visible range
  const tilesX = Math.ceil(w / tileW) + 4
  const tilesY = Math.ceil(h / tileH) + 4
  const startCol = Math.floor(camCol) - Math.floor(tilesX / 2)
  const startRow = Math.floor(camRow) - Math.floor(tilesY / 2)

  // ─── GROUND LAYER (cached for reskins — see _groundLayer) ─────────
  // Paint every visible ground cell into `tctx`. For a reskin this is a pure function of (ground data,
  // heights, camera, zoom, style, size) — no per-frame term — so it's cacheable; ASCII keeps a live grass
  // flicker so it always paints direct.
  const paintGround = (tctx: CanvasRenderingContext2D): void => {
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

        const p = toScreen(col + 0.5, row + 0.5)
        if (p.x < -tileW || p.x > w + tileW || p.y < -tileH || p.y > h + tileH) continue

        // Step 4a — the FLOOR is read as tile index 0 of the cell's unified stack. getStack projects the
        // SAME ground slug/colour/dims the direct grid.ground/groundColor/groundDims reads produced, so
        // resolveGroundTile/cellFill + the dims path below stay byte-identical — only the SOURCE moved onto
        // the one tile-in-cell adapter. (Props still come from getVisibleAssets below: the TileEntry
        // projection is lossy for a prop — no footprint/cellAnim/baseShadow/bgColor/back-ref — and per-cell
        // iteration would reorder same-row props, either of which would break the pixel-identical contract.)
        const floor = getStack(grid, col, row)[0]
        const tileType = floor.slug || 'grass'
        // Ground LOADS from the tileset (byte-identical noise selection); grass keeps its per-cell shade.
        const gt = resolveGroundTile(ASCII_TILESET, tileType, col, row)
        const char = gt.char
        const fg = gt.fg
        const bg = tileType.includes('grass') ? grassShade(gt.bg, col, row) : gt.bg
        // Active art style (ASCII passthrough → the char+fg above, byte-identical). A reskin tints the
        // flat cell at the tile hue, VARIED per cell (same deterministic noise ASCII grass uses) so an
        // emoji field isn't flat-uniform; ASCII → bg (identical).
        const gk = groundKind(tileType)
        const gdv = resolveDraw(gk, style, undefined, char, fg)
        // Cell fill: a reskin uses the tile's OWN colour (from the catalog DATA), but grass AND the rocky
        // cave floor keep their per-cell shade so it isn't one flat sheet ("grass is just color"); ASCII → bg.
        // Per-cell FLOOR COLOUR override (from the Property panel) wins over the catalog colour; else the catalog fill.
        const fillBg = floor.color ?? cellFill(gdv.tint, bg, tileType.includes('grass') || gk === 'cavefloor', col, row)
        tctx.textAlign = 'center'
        tctx.textBaseline = 'middle'
        tctx.fillStyle = fillBg
        tctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
        if (gdv.tint || gdv.image) {
          // RESKIN: draw the DATA tile FULL-CELL (no 'grid view'). The char + colour come from the tile
          // data — NOT invented in JS; ground variety comes from the map's ground data / the catalog.
          const cell = Math.max(tileW, tileH)
          // The tile's optional POSE (from the emoji tileset entry), applied at the CELL CENTRE. Absent for
          // ~every ground tile → we draw at (p.x,p.y) exactly as before, so the cached ground stays identical.
          const tilePose = style.id === 'emoji' ? EMOJI_TILESET[gk]?.pose : undefined
          // Per-cell FLOOR DIMS override (Width/Height/Depth/Zoom + a per-cell pose) — the SAME settings a
          // prop carries, on THIS one floor tile. Overhead: Width×Zoom scales x, Depth×Zoom scales y (Height
          // has no axis looking down). Unset → the byte-identical direct draws in the final two branches.
          // FLOOR DIMS also ride the floor tile — the SAME GroundCellDims the old `grid.groundDims` read
          // gave (getStack maps scaleX/scaleZ/scale/scaleY/pose → w/d/zoom/scaleY/pose). groundDimsActive
          // + groundSizeFactors resolve identically (an all-unset floor → w:1,d:1 → inactive, {fx:1,fy:1}).
          const gdims: GroundCellDims = { scaleX: floor.w, scaleY: floor.scaleY, scaleZ: floor.d, scale: floor.zoom, pose: floor.pose }
          const dimsOn = groundDimsActive(gdims)
          const cellPose = dimsOn ? gdims.pose : undefined
          if (tilePose || cellPose || dimsOn) {
            const { fx, fy } = groundSizeFactors(gdims)
            tctx.save()
            tctx.translate(p.x, p.y)
            if (tilePose) applyPose(tctx, tilePose, 1, cell)
            if (cellPose) applyPose(tctx, cellPose, 1, cell)
            if (dimsOn) tctx.scale(fx, fy) // overhead: Width×Zoom on x, Depth×Zoom on y
            if (gdv.image) drawStyledImage(tctx, gdv.image, 0, 0, cell * 1.02)
            else { tctx.font = `${cell * 1.04}px ${ASCII_FONT}`; tctx.fillText(gdv.char, 0, 0) }
            tctx.restore()
          } else if (gdv.image) {
            drawStyledImage(tctx, gdv.image, p.x, p.y, cell * 1.02)
          } else {
            tctx.font = `${cell * 1.04}px ${ASCII_FONT}`; tctx.fillText(gdv.char, p.x, p.y)
          }
        } else {
          // ASCII passthrough — byte-identical to before.
          const grassFlicker = tileType.includes('grass') ? Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1 : 1
          tctx.fillStyle = gdv.color
          tctx.globalAlpha = 0.85 + 0.15 * grassFlicker
          tctx.font = `bold ${tileH * 0.7}px ${ASCII_FONT}`
          tctx.fillText(gdv.char, p.x, p.y)
          tctx.globalAlpha = 1
        }

        // Height creates elevated platforms - draw "front face" if height > 0
        const cellHeight = grid.getHeight(col, row)
        if (cellHeight > 0) {
          const elevH = cellHeight * heightScale
          // Top surface (slightly brighter)
          tctx.fillStyle = fillBg
          tctx.fillRect(p.x - tileW / 2, p.y - tileH / 2 - elevH, tileW, tileH)
          tctx.fillStyle = gdv.color
          if (gdv.image) drawStyledImage(tctx, gdv.image, p.x, p.y - elevH, tileH)
          else tctx.fillText(gdv.char, p.x, p.y - elevH)
          // Front face (darker)
          tctx.fillStyle = darkenColor(fillBg, 0.6)
          tctx.fillRect(p.x - tileW / 2, p.y + tileH / 2 - elevH, tileW, elevH)
        }
      }
    }
  }

  // For a reskin the ground is static, so bake it once and blit — rebuild ONLY when the terrain
  // (grid.groundVersion), camera, zoom, style or canvas size changes. This is the idle-cost fix: standing
  // still (watching a video) no longer re-rasterizes the whole map every frame. ASCII paints live.
  const canCacheGround = style.id !== ASCII_STYLE.id && typeof document !== 'undefined'
  if (!canCacheGround) {
    paintGround(ctx)
  } else {
    const key = `${grid.groundVersion}|${Math.round(camCol * 1000)}|${Math.round(camRow * 1000)}|${Math.round(zoom * 1000)}|${style.id}|${w}|${h}`
    if (_groundLayer && _groundLayer.key === key && _groundLayer.grid === grid) {
      ctx.drawImage(_groundLayer.cv, 0, 0) // HIT — the whole static ground in one blit
    } else if (_groundPendingKey === key) {
      // The camera has held this position for a frame → bake the ground now; from here it's a blit.
      let layer = _groundLayer
      if (!layer || layer.cv.width !== w || layer.cv.height !== h) {
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const lctx = cv.getContext('2d')
        layer = lctx ? { cv, ctx: lctx, key: '', grid } : null
      }
      if (!layer) {
        paintGround(ctx)
      } else {
        layer.ctx.clearRect(0, 0, w, h)
        paintGround(layer.ctx)
        layer.key = key
        layer.grid = grid
        _groundLayer = layer
        ctx.drawImage(layer.cv, 0, 0)
      }
    } else {
      // Moving (or first frame at this key) → draw straight to the screen, NO extra bake+blit cost.
      paintGround(ctx)
    }
    _groundPendingKey = key
  }

  // ─── CONNECTOR MARKERS (one per owned cell, same purple ◊ as top view) ──
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col + 0.5, pcell.row + 0.5)
      if (p.x < -tileW || p.x > w + tileW || p.y < -tileH || p.y > h + tileH) continue
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
      ctx.font = `bold ${tileH * 0.6}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Portal marker is a TILE now: 🌀 under a reskin, ◊ under ASCII — over the purple cell backing.
      drawConnectorMarker(ctx, style, p.x, p.y, tileH)
    }
  }

  // ─── OBJECTS LAYER (sorted by row for depth) ─────────────────────
  // Collect all drawable objects: assets + buildings + player. `sortRow` is the depth key (a front-
  // elevation cell sorts at its anchored front row); `level` is its stack level (draw low→high so a roof
  // lands ON TOP of the wall below it).
  const drawables: Array<{
    row: number
    col: number
    type: 'asset' | 'player'
    asset?: GridAsset
    sortRow: number
    level: number
    zIndex: number
  }> = []

  // A BUILDING is just TILES: a pre-built building is stamped as its composition's per-cell assets, so its
  // walls/windows/door/roof render through the SAME per-cell asset path (draw2DLabeledCell) as any stacked
  // tile — no special building drawer. But the 2D view is a FRONT ELEVATION (Width × Height, depth hidden —
  // MAP-MODEL §2-3): a stacked structure must read its TRUE height (level count), not pile its depth rows
  // upward. `frontElevation` collapses depth generically — for each (col, level) only the FRONT-most cell is
  // drawn (anchored at the structure's front row); cells behind it are hidden. A 1-deep tree / flat prop has
  // no depth, so it passes through and draws at its own cell exactly as before.
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camCol), Math.floor(camRow), tilesX, tilesY
  )
  const fe: FrontElevation = frontElevation(visibleAssets)
  const treeCells2D = treeCellSet(grid) // memoized (see shared.treeCellSet) — no per-frame assets rescan
  const isTreeCell2D = (c: number, r: number): boolean => treeCells2D.has(`${c},${r}`)
  for (const asset of visibleAssets) {
    if (fe.hidden.has(asset)) continue // occluded behind a front-elevation face — depth collapsed away
    const anchorRow = fe.draw.get(asset)?.anchorRow ?? asset.row
    drawables.push({ row: asset.row, col: asset.col, type: 'asset', asset, sortRow: anchorRow, level: asset.heightLevel ?? 0, zIndex: asset.zIndex ?? 0 })
  }

  // Add player
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize
  drawables.push({ row: playerRow, col: playerCol, type: 'player', sortRow: playerRow, level: 0, zIndex: 0 })

  // DRAW-PRIORITY first (CSS z-index): a higher zIndex draws LATER (on top / in front) regardless of position —
  // a cell authored with a higher zIndex sits in front of one behind it (a capability for composition
  // optimization). Then the existing keys: (front-elevation) row so things further up screen draw first (=
  // behind); a level tiebreak keeps a structure's higher tiles (roof) drawn after the walls below them. All
  // zIndex default 0 → the first term is 0 and the order is unchanged.
  drawables.sort((a, b) => a.zIndex - b.zIndex || a.sortRow - b.sortRow || a.level - b.level)

  // Draw each object
  twoDTileHits = [] // fresh per-frame record of every drawn 2D tile's silhouette — the inverted picker reads it
  for (const obj of drawables) {
    // A front-elevation cell (part of a stacked structure with depth) projects at its ANCHORED front row so
    // its column stacks as a flat facade — depth is collapsed (MAP-MODEL §2-3). Everything else (a flat
    // prop, a 1-deep tree, the player) projects at its OWN cell.
    const feCell = obj.type === 'asset' && obj.asset ? fe.draw.get(obj.asset) : undefined
    const projRow = feCell ? feCell.anchorRow : obj.row
    // "z position" slides an asset along the iso diagonal; the 2D orthographic (col,row)→(x,y) view projects
    // that to the GROUND-PLANE cell delta (zDir's DEPTH_CELL_STEP × the magnitude), NOT a vertical lift. A
    // non-asset object or z=0 (every generated/existing asset) → no shift, byte-identical to before.
    const zAsset = obj.type === 'asset' ? obj.asset : undefined
    const zStep = zAsset ? DEPTH_CELL_STEP[zAsset.zDir ?? 'right-up'] : null
    const zAmt = zAsset?.zOffset ?? 0
    const p = toScreen(obj.col + 0.5 + (zStep ? zAmt * zStep.dc : 0), projRow + 0.5 + (zStep ? zAmt * zStep.dr : 0))
    const groundHeight = grid.getHeight(Math.floor(obj.col), Math.floor(projRow))
    const elevOffset = groundHeight * heightScale

    if (obj.type === 'player') {
      // Draw player using ASCII art sprite - grounded at cell bottom (lifted mid-jump)
      const playerArt = getPlayerArt(player)
      const baseY = p.y + tileH * 0.5 - elevOffset - (player.jumpHeight ?? 0)

      // Selected target: red reticle at the player's feet (parity with the iso view + the enemies above).
      if (playerIsTarget) drawSelectionRing(ctx, p.x, baseY, tileH * 0.65)
      else if (playerIsHover) drawHoverRing(ctx, p.x, baseY, tileH * 0.65) // dim white hover reticle

      // Draw each line of the ASCII art, stacking upward from baseY
      const fontSize = tileH * 0.7
      const lineHeight = fontSize * 0.9
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw each line from bottom to top (no background). When attacking, HIDE the static arm on
      // the swinging side so the animated swing-arm below doesn't double it (#47/#39).
      const bodyColor = player.armored ? '#bcd4ff' : (player.bodyColor ?? '#ffdd00')
      const swingArmDir2 = player.facing === 'left' ? -1 : 1
      const swinging2 = attackAnims.some(a => a.inHand && time - a.start < a.durationMs)
      const figArt2 = !swinging2
        ? playerArt
        : playerSprite.idle.map(row => (swingArmDir2 > 0 ? row.replace('>', ' ') : row.replace('<', ' ')))
      const pdv = resolveDraw('player', style, personVariantTileId(player.variant, style), '', bodyColor)
      // BOTTOM-ANCHOR the emoji hero EXACTLY like the 2D NPCs (drawTopEntity): the figure's FEET sit on
      // the shadow line (baseY), lifted by 0.42 of its own draw size — so the hero stands on its shadow
      // the SAME way every NPC does. (Replaces the old emojiFootLift band-aid, which nudged only the
      // emoji figure and left the hero anchored differently from every NPC — the 2D float bug.)
      const personImgPx = tileH * 1.8 // image height, matching the 2D NPC figure
      const personGlyphPx = tileH * 1.7 // glyph height, matching the 2D NPC figure
      // The active animation frame drives what's drawn (idle/walk/run) — a baked image or a glyph, honouring
      // flipX — so the hero ANIMATES when moving instead of freezing on the static base image. ASCII keeps
      // its multi-row sprite below.
      // The drawn figure's HEAD (top edge in screen y) — set by whichever branch draws, so the vitals bar
      // hugs the REAL sprite top (emoji billboard vs ascii multi-row figure differ) instead of the phantom
      // ascii-height lift that floated the bar above the emoji hero.
      let headY: number
      if (pdv.image || pdv.char) {
        const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
        const pfImg = frameImage(pf, pdv.char, pdv.image)
        if (pfImg) {
          const cy = baseY - personImgPx * 0.42
          drawStyledImage(ctx, pfImg, p.x, cy, personImgPx, pf.flipX)
          headY = cy - personImgPx * 0.5
        } else {
          const cy = baseY - personGlyphPx * 0.42
          ctx.font = `bold ${personGlyphPx}px ${ASCII_FONT}` // character height, matching npcs
          drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), p.x, cy, pf.flipX)
          ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
          headY = cy - personGlyphPx * 0.5
        }
      } else {
        for (let i = 0; i < figArt2.length; i++) {
          const line = figArt2[figArt2.length - 1 - i] // Reverse order (bottom to top)
          const lineY = baseY - (i + 0.5) * lineHeight
          ctx.fillStyle = bodyColor
          ctx.fillText(line, p.x, lineY)
        }
        // Top row centre is (figArt2.length - 0.5) rows up; its top edge a half row higher is the head.
        headY = baseY - figArt2.length * lineHeight
      }
      // Held weapon — the SAME single blade, swung in-hand when a melee attack is mid-flight
      // (mirrors drawIsoPlayer): at rest it points up; an attack sweeps it through the arc, and an
      // ability recolors it (Fire Slash → red-orange). 2D drew nothing animated here before, so
      // attacks looked like they did nothing — this is the #34 fix.
      // Weapon on the FACING hand, shield on the OFF-hand — both at the ARM row, never the same
      // hand in any facing (#49). (Mirrors drawIsoPlayer.)
      const facingDir = player.facing === 'left' ? -1 : 1
      const armY = baseY - lineHeight * 1.2 // the arm/hand row, shared by weapon + shield
      const inHandSlash = attackAnims.find(a => a.inHand && time - a.start < a.durationMs)
      const swinging = !!inHandSlash // an attack is mid-flight → the ARM drives the swing (#47)
      const swingP = inHandSlash ? Math.min(1, (time - inHandSlash.start) / inHandSlash.durationMs) : 0
      const shoulderX = p.x + facingDir * fontSize * 0.18 // at the body, weapon side
      const shoulderY = baseY - lineHeight * 1.9 // shoulder = TOP of the # row (the pivot)
      drawPlayerArm(ctx, {
        swinging,
        swingP,
        facingDir,
        isEmoji: style.id !== ASCII_STYLE.id, // reskin → no ASCII `>`/`<` bracket beside the emoji figure
        fontSize,
        bodyColor,
        weaponGlyph: player.weaponGlyph,
        weaponPose: player.weaponPose,
        punchGlyph: player.punchGlyph,
        punchPose: player.punchPose,
        weaponTint: '#e0e0e0',
        swingTint: inHandSlash?.tint,
        shoulderX,
        shoulderY,
        restHandX: p.x + facingDir * fontSize * 0.6,
        restHandY: armY,
        shieldGlyph: player.shieldGlyph,
        shieldPose: player.shieldPose,
        shieldX: p.x - facingDir * fontSize * 0.6, // off-hand: opposite the weapon
        shieldY: armY,
        shieldR: fontSize * 0.55,
      })

      // Life bar + name above the head — the SAME treatment enemies get (drawFigureVitals).
      if (player.maxHp != null) {
        const barWidth = Math.max(28, tileH * 2.2)
        const nameSize = Math.max(9, fontSize)
        drawFigureVitals(ctx, p.x, headY, barWidth, 6, nameSize, barFraction(player.hp ?? player.maxHp, player.maxHp), playerDisplayName(player.name))
      }

    } else if (obj.asset) {
      // Live TILE ANIMATION overrides for THIS frame (settings tweens), scoped to the 2D view + active style.
      // null when the asset has no animations / none in scope → the effective asset IS obj.asset (byte-identical);
      // the overlaid asset carries the animated colour/zoom/width/height so every branch below reads them as-is.
      const assetAnim = resolveAssetAnimation(obj.asset, time, style, '2d', dayNight)
      const asset = assetAnim ? assetAnim.asset : obj.asset

      // Base at bottom of cell - tiles stack upward. A FRONT-ELEVATION cell (a building/structure block) is
      // lifted a FULL cell per level, so a 5-level house reads exactly 5 cells tall (its true height, edge-to-
      // edge — no depth added). A stacked prop that isn't part of a front elevation keeps the ~0.9 cell "pile"
      // lift so brush-stacked items read as separate raised objects. heightLevel is absent (→ 0) on every
      // generated/existing flat asset, so that path is a no-op for anything but a deliberately stacked cell.
      const levelStep = feCell ? tileH : tileH * 0.9
      // "z position" is NOT a vertical lift — it's an iso-diagonal ground slide, already folded into `p` above
      // (the ground-plane cell delta), so baseY only carries elevation + the height-level stack, like before.
      const baseY = p.y + tileH * 0.5 - elevOffset - (asset.heightLevel ?? 0) * levelStep
      // The tile's rendered 2D silhouette (rect), recorded below per branch so the inverted picker + highlight
      // hit-test the TILE the user sees (its scaleY/heightLevel-lift/zOffset-slide/pose extent), not the cell.
      let hit2D: TileGeom | null = null

      // Animated screen shift (tile fractions; `y` LIFTS up = −screenY) + opacity fade, wrapped around the WHOLE
      // tile draw so every branch below inherits them. Skipped entirely when not animated → byte-identical.
      const animShiftX = assetAnim ? assetAnim.x * tileW : 0
      const animShiftY = assetAnim ? assetAnim.y * tileH : 0
      const animWrap = !!assetAnim && (animShiftX !== 0 || animShiftY !== 0 || assetAnim.opacity < 1)
      if (animWrap) {
        ctx.save()
        ctx.translate(animShiftX, -animShiftY)
        if (assetAnim!.opacity < 1) ctx.globalAlpha *= assetAnim!.opacity
      }

      // Authored frame animation: offset/rotate/scale the asset around its ground point (sway/wind).
      const ct2d = assetCellTransform(asset.cellAnim, time)
      if (ct2d) applyCellTransform(ctx, p.x, baseY, ct2d, tileW, tileH)

      ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw based on asset type - VIBRANT test-ascii style (Crash Bandicoot palette)
      // Animation flicker based on time
      const flicker = Math.sin(time * 0.003 + obj.col * 0.5 + obj.row * 0.7) * 0.15 + 1

      // Active art style: a mapped kind (or a per-element override) replaces the whole
      // per-type ASCII art with ONE tile. A PLACED tile's override re-homes onto the active
      // style so it RESKINS (resolveAssetDraw), never freezing to the style it was picked in.
      // ASCII + no override → adv.char '' → falls through to the byte-identical per-type branches.
      const adv = resolveAssetDraw(assetKind(asset), style, assetOverride(asset, style), '', '')
      // GROUND DECOR draws its BAKED tile image (resolved by LABEL for the active style) flat on the floor —
      // just the image (transparent surround = subtle litter, no solid cell backing), colour-composited, never
      // a glyph. No baked decor tile for this style (backend gap) → fall through to the paths below (e.g. the
      // emoji curated litter tile via adv.image), still an image.
      const decorImg = asset.type === 'ground_decor' ? groundDecorImage(asset, style) : undefined
      if (decorImg) {
        drawStyledImage(ctx, decorImg, p.x, baseY - tileH * 0.5, tileW, false, asset.color, tileH)
        hit2D = billboardGeom(tileW, tileH, poseMapper({ x: p.x, y: baseY - tileH * 0.5 }, undefined, tileH))
      } else if (adv.image) {
        // A per-asset colour override recolours the baked sprite (#80); undefined → drawn untinted.
        // Per-view tile size (byte-identical when unset: old 1.5 constant), then per-element dims (#77/#78).
        const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
        const d = resolveAssetDrawSize(tileH * (resolveTileSize(vt, '2d') ?? 1.5), asset, 'billboard')
        const cx = p.x, cy = baseY - tileH * 0.7 - d.baseLift
        const pose = asset.pose ?? resolveTilePose(vt, '2d') // per-asset pose (inspector x/y/rotate) wins; else the tileset-kind pose
        if (pose) {
          ctx.save(); ctx.translate(cx, cy); applyPose(ctx, pose, 1, tileH)
          drawStyledImage(ctx, adv.image, 0, 0, d.w, false, asset.color, d.h)
          ctx.restore()
        } else {
          drawStyledImage(ctx, adv.image, cx, cy, d.w, false, asset.color, d.h)
        }
        hit2D = billboardGeom(d.w, d.h, poseMapper({ x: cx, y: cy }, pose, tileH))
      } else if (adv.char) {
        // Trees are drawn TALLER (a 🌲 in one cell reads tiny) — roughly the 3-cell height the ASCII
        // tree gets — anchored at the base so the trunk sits on its cell and the canopy rises.
        const isTree = asset.type === 'tree'
        const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
        const base = (isTree ? tileH * 2.3 : tileH * 1.3) * (resolveTileSize(vt, '2d') ?? 1)
        const d = resolveAssetDrawSize(base, asset, 'billboard') // #universal: Width/Height/Zoom apply to glyphs too
        const lift = (isTree ? tileH * 1.05 : tileH * 0.6) + d.baseLift
        ctx.font = `bold ${d.h}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = asset.color ?? adv.color ?? '#ffffff' // ASCII glyphs / the no-override fillText path
        const pose = asset.pose ?? resolveTilePose(vt, '2d') // per-asset pose (inspector x/y/rotate) wins; else the tileset-kind pose
        const strength = asset.color ? (isTree ? 0.55 : 0.85) : 0 // colour-emoji ignore fillStyle → wash the tint on
        // A tree keeps its 🌲 shape but is recoloured to its SEASON's canopy shade (asset.color).
        ctx.save()
        ctx.translate(p.x, baseY - lift)
        if (pose) applyPose(ctx, pose, 1, tileH)
        if (d.w !== d.h) ctx.scale(d.w / d.h, 1) // non-uniform Width vs Height, like the image branch
        fillTintedGlyph(ctx, adv.char, 0, 0, d.h, asset.color, strength)
        ctx.restore()
        hit2D = billboardGeom(d.w, d.h, poseMapper({ x: p.x, y: baseY - lift }, pose, tileH))
      } else if (asset.label) {
        // Generated multi-cell cell → one glyph in its zone/theme color (the cell
        // IS the tile), matching the iso + top views. No green multi-tile overdraw.
        draw2DLabeledCell(ctx, p.x, baseY, tileW, tileH, asset, style)
        // Match draw2DLabeledCell's rect: Width/Height/Zoom stretch the cell, grown UP from baseY.
        const z = asset.scale ?? 1, dw = tileW * (asset.scaleX ?? 1) * z, dh = tileH * (asset.scaleY ?? 1) * z
        hit2D = billboardGeom(dw, dh, poseMapper({ x: p.x, y: baseY - dh / 2 }, undefined, tileH))
      } else if (asset.type === 'tree') {
        // Layered tree: bark trunk + canopy tinted to the asset's zone/theme color.
        const canopy = treeCanopyLayers(asset.color || '#2e8b2e', flicker)
        // Ground shadow on the tree's base: a generator-marked base cell (always, even when
        // stacked on another tree) or any bottom (ground-contact) cell.
        if (asset.baseShadow || isGroundContact(isTreeCell2D, asset.col, asset.row)) {
          ctx.save()
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
          ctx.beginPath()
          ctx.ellipse(p.x, baseY, tileW * 0.5, tileH * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        const trunkChars = ['W', '0', 'W']
        for (let h = 0; h < 2; h++) {
          const tileTop = baseY - (h + 1) * tileH
          ctx.fillStyle = `rgba(173, 134, 33, 0.96)` // Golden brown
          ctx.fillRect(p.x - tileW * 0.35, tileTop, tileW * 0.7, tileH)
          ctx.fillStyle = `rgba(243, 191, 54, ${0.7 + 0.3 * flicker})` // Bright gold
          ctx.fillText(trunkChars[h] || '0', p.x, tileTop + tileH * 0.5)
        }
        // Layered canopy - tinted to the asset's zone/theme color
        // Upright pyramid: wide base above the trunk (drawn first/lowest), narrow apex on top.
        const layers = [
          { chars: '(@&@&@)', width: 2.0, bg: canopy[0].bg, fg: canopy[0].fg }, // wide base
          { chars: '(@&@)', width: 1.6, bg: canopy[1].bg, fg: canopy[1].fg },   // mid
          { chars: '(&)', width: 1.2, bg: canopy[2].bg, fg: canopy[2].fg },     // apex
        ]
        for (let h = 0; h < layers.length; h++) {
          const layer = layers[h]
          const tileTop = baseY - (h + 3) * tileH
          ctx.fillStyle = layer.bg
          ctx.fillRect(p.x - tileW * layer.width * 0.5, tileTop, tileW * layer.width, tileH)
          ctx.fillStyle = layer.fg
          ctx.font = `bold ${tileH * 0.65}px ${ASCII_FONT}`
          ctx.fillText(layer.chars, p.x, tileTop + tileH * 0.5)
        }
        ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
        hit2D = billboardGeom(tileW * 2, tileH * 6, poseMapper({ x: p.x, y: baseY - tileH * 3 }, undefined, tileH))

      } else if (asset.type === 'lamp') {
        // Legacy single-lamp prop — a STEADY lit bulb. The day/night ambience is now the warm ground GLOW POOL
        // (drawNightLighting), driven by the tile's `light` SETTING and gated to night; this branch just draws
        // the bulb and no longer reads dayNight.
        ctx.fillStyle = '#333333'
        ctx.fillRect(p.x - tileW * 0.12, baseY - tileH * 2, tileW * 0.24, tileH * 2)
        ctx.fillStyle = '#555555'
        ctx.fillText('|', p.x, baseY - tileH * 0.5)
        // Bulb
        ctx.fillStyle = 'rgba(255, 255, 0, 1)'
        ctx.fillRect(p.x - tileW * 0.25, baseY - tileH * 2.4, tileW * 0.5, tileH * 0.5)
        ctx.fillStyle = 'rgba(255, 200, 50, 1)'
        ctx.fillText('o', p.x, baseY - tileH * 2.2)
        hit2D = billboardGeom(tileW * 0.6, tileH * 2.7, poseMapper({ x: p.x, y: baseY - tileH * 1.35 }, undefined, tileH))

      } else if (asset.type === 'npc') {
        // NPC - cleaner humanoid figure matching isometric style
        const layers = [
          { text: '/\\', fg: '#3355aa', bg: '#1a2a55' },     // Legs
          { text: '[=]', fg: '#4466cc', bg: '#223366' },    // Body
          { text: '(o)', fg: '#ffccaa', bg: '#996644' },    // Head
        ]
        for (let h = 0; h < layers.length; h++) {
          const layer = layers[h]
          const tileTop = baseY - (h + 1) * tileH
          const layerWidth = h === 2 ? 0.7 : 0.8

          ctx.fillStyle = layer.bg
          ctx.fillRect(p.x - tileW * layerWidth * 0.5, tileTop, tileW * layerWidth, tileH)
          ctx.fillStyle = layer.fg
          ctx.fillText(layer.text, p.x, tileTop + tileH * 0.5)
        }
        hit2D = billboardGeom(tileW * 0.9, tileH * 3, poseMapper({ x: p.x, y: baseY - tileH * 1.5 }, undefined, tileH))

      } else {
        // Default - still use vibrant colors with animation
        const tileFg = asset.color || '#ffffff'
        const tileBg = asset.bgColor || darkenColor(tileFg, 0.3)
        const char = asset.art[0] || '?'
        ctx.fillStyle = tileBg
        ctx.fillRect(p.x - tileW * 0.5, baseY - tileH, tileW, tileH)
        ctx.fillStyle = tileFg
        ctx.fillText(char, p.x, baseY - tileH * 0.5)
        hit2D = billboardGeom(tileW, tileH, poseMapper({ x: p.x, y: baseY - tileH * 0.5 }, undefined, tileH))
      }

      if (ct2d) ctx.restore() // pop the cell-animation transform
      if (animWrap) ctx.restore() // pop the tile-animation shift/opacity wrap
      // Record this tile's 2D silhouette so the inverted picker + highlight hit-test IT, not the flat cell.
      if (hit2D) twoDTileHits.push({ col: obj.asset.col, row: obj.asset.row, level: obj.asset.heightLevel ?? 0, source: 'asset', geom: hit2D })
    }
  }

  // ─── DEBUG OVERLAY ─────────────────────────────────────────────────
  // Mirrors the iso renderDebugOverlays: a collision tint + per-cell coords on every
  // cell, then a TYPE (+ corner/edge) caption above each asset, then a PLAYER tag.
  // Pass 1: collision tint — shown for the DEBUG overlay OR the lighter "show collisions" overlay.
  // The height numbers are a debug-only extra (kept off the collision-only view).
  if (isDebugMode() || isShowCollisions()) {
    ctx.globalAlpha = 0.6
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue
        const p = toScreen(col + 0.5, row + 0.5)
        const isCollision = grid.collision[row]?.[col]

        // EVERY blocked cell tints its own grounded square — a building's wall cell exactly like a tree/water
        // cell (no raised-facade overlay, no grouped-building read). The stamped HOLLOW footprint blocks only
        // WALL cells, so the tint reads as the building's solid shell with the walkable door/interior clear.
        if (isCollision) {
          ctx.fillStyle = 'rgba(255, 50, 50, 0.4)'
          ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
        }

        const cellHeight = grid.getHeight(col, row)
        if (isDebugMode() && cellHeight > 0) {
          ctx.fillStyle = '#ffff00'
          ctx.font = `bold ${tileH * 0.4}px ${ASCII_FONT}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(cellHeight), p.x, p.y - tileH * 0.3)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  if (isDebugMode()) {
    // Grid lines + the per-cell TILESET LABEL. EVERY cell shows its <TYPE> <POSITION> autotile key —
    // the terrain label (GRASS TOP-LEFT …) or, where a cell carries a placed element, its asset caption
    // (BUILDING TOP-LEFT, TREE CANOPY …). Each label is centred IN its own cell + shrunk to fit, so it
    // aligns to the position it names and never overflows into the neighbour. Coords sit tiny in the corner.
    const assetCaps = assetCaptionByCell(grid.getVisibleAssets(Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), 30, 20))
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue
        const p = toScreen(col + 0.5, row + 0.5)
        ctx.strokeRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
        ctx.font = `${Math.max(6, tileH * 0.22)}px ${ASCII_FONT}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillStyle = grid.collision[row]?.[col] ? 'rgba(255,150,150,0.75)' : 'rgba(150,255,150,0.6)'
        ctx.fillText(`${col},${row}`, p.x - tileW / 2 + 2, p.y - tileH / 2 + 1)
        const ac = assetCaps.get(`${col},${row}`)
        const text = ac?.text ?? terrainLabelAt(grid.ground, col, row)
        const lc = debugLabelColors(ac?.type ?? 'terrain')
        drawCellLabel(ctx, text, p.x, p.y + tileH * 0.12, tileW - 3, lc.fg, lc.bg)
      }
    }

    // PLAYER tag over the player's cell.
    const pp = toScreen(player.x / cellSize, player.z / cellSize)
    ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
    ctx.fillRect(pp.x - 25, pp.y - tileH - 26, 50, 16)
    ctx.fillStyle = '#ffdd00'
    ctx.fillText('PLAYER', pp.x, pp.y - tileH - 18)
  }

  // Placed entities (enemies / NPCs) on top of the world layer — same as Top/iso.
  // Skip the player entity: the live player sprite is drawn above (no ghost double).
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  for (const entity of entities) {
    if (entity.kind === 'player') continue
    const combat = entity.kind === 'enemy' ? enemyCombat.get(entity.id) : undefined
    if (isDeadEnemy(entity, combat)) continue
    const rc = entityRenderCell(entity, time) // same interpolation as iso → no snap in 2D
    const e = toScreen(rc.col, rc.row)
    // Same movement/combat signals the iso path uses, so 2D only swaps walk frames while moving.
    const mot = entityMotion.get(entity.id)
    const moving = !!mot && time < mot.startMs + ENEMY_MOVE_MS
    const inRange = entity.kind === 'enemy' && Math.hypot(entity.col - pCol, entity.row - pRow) <= COMBAT_RANGE
    const attackable = enemyInAttackReach(entity, Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), attackReach)
    const anchor = drawTopEntity(ctx, e.x, e.y, tileW, entity, combat, time, moving, inRange, attackable, style, entity.id === targetId, entity.id === hoverId)
    drawQuestMarker(ctx, entityQuestMarker(entity, quests), anchor.x, anchor.y, Math.max(14, tileW * 1.4))
  }

  // Attack animations (enemy slashes / shots / magic / block) in 2D space — mirrors the iso path.
  // The player's own melee is the in-hand swing drawn above (a.inHand), so skip those here. Without
  // this, 2D combat showed no feedback at all (#34).
  if (attackAnims.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(12, tileH * 0.9)}px ${ASCII_FONT}`
    for (const a of attackAnims) {
      if (a.inHand) continue
      const f = animFrame(a, time)
      if (!f) continue
      const sp = toScreen(f.x / cellSize, f.z / cellSize)
      // Reskin → the ability FX TILE (🔥/⚡/…) recoloured to f.color, keeping the slash-arc rotation;
      // ASCII → the \ | / ─ frame glyph.
      const ay = f.angle != null ? sp.y - tileH : sp.y - tileH * 0.6
      drawAttackAnimFrame(ctx, a, f, style, sp.x, ay, Math.max(12, tileH * 0.9))
    }
  }

  // Travelling projectiles (arrow/bullet/bolt) — lerp along their path in 2D space.
  if (projectiles.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const projPx = Math.max(12, tileH * 0.85)
    ctx.font = `bold ${projPx}px ${ASCII_FONT}`
    ctx.fillStyle = '#ffe9a8'
    for (const pr of projectiles) {
      const pc = projectileCellAt(pr, time)
      const sp = toScreen(pc.col + 0.5, pc.row + 0.5)
      const from = toScreen(pr.fromCol + 0.5, pr.fromRow + 0.5)
      const to = toScreen(pr.toCol + 0.5, pr.toRow + 0.5)
      // Reskin → the arrow/bullet/dart tile IMAGE (warm-tinted like the glyph); ASCII → the rotated glyph.
      drawProjectileGlyph(ctx, pr.glyph, sp.x, sp.y - tileH * 0.6, from.x, from.y, to.x, to.y, style, projPx, '#ffe9a8')
    }
  }

  // Floating "+dmg" hit markers, over everything.
  for (const marker of hitMarkers) {
    const p = toScreen(marker.col + 0.5, marker.row + 0.5)
    drawHitMarker(ctx, p.x, p.y - tileH * 0.6, marker, time)
  }

  // ─── NIGHT LIGHTING ─────────────────────────────────────────────────
  if (dayNight === 'night') {
    const lamps = collectLampGlows(grid, (c, r) => toScreen(c + 0.5, r + 0.5), tileW, tileH * 2.2, w, h, { time, style, view: '2d' })
    drawNightLighting(ctx, w, h, lamps)
  }

  // ─── Hover + selection HIGHLIGHT — INVERTED: outline the ACTUAL rendered TILE (its recorded 2D rect,
  //     scaleY/heightLevel-lift/zOffset/pose aware) so the ring hugs what the user sees, not the flat cell.
  //     A bare floor cell (or a tile not drawn this frame) falls back to the flat cell square. ──────────
  const strokeCellOrTile2D = (col: number, row: number, lvl: number | undefined): void => {
    const geom = lvl !== undefined ? twoDRecordedGeom(col, row, lvl) : null
    if (geom) { stroke2DTileOutline(ctx, geom); return } // the real tile rect (tall/lifted/slid aware)
    const p = toScreen(col, row) // fallback: the flat cell square
    ctx.strokeRect(p.x + 1, p.y + 1, tileW - 2, tileH - 2)
  }

  // Cell/tile-hover outline — a DIM ring on the tile under the cursor, drawn UNDER the yellow selection.
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    strokeCellOrTile2D(hoveredCell.col, hoveredCell.row, hoveredCell.level)
  }

  // Selection outline (property-editor multi-select) — a yellow ring hugging each selected tile/cell.
  if (selectedCells.size > 0) {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    for (const key of selectedCells) {
      const [col, row, lvl] = key.split(',').map(Number) // "col,row,level" = a recorded TILE; "col,row" = flat cell
      strokeCellOrTile2D(col, row, lvl)
    }
  }

  // ─── UI ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillStyle = isDebugMode() ? '#ff6666' : '#4488ff'
  ctx.fillText(isDebugMode() ? '2D DEBUG MODE' : '2D RPG MODE', 10, 50)

  const __ms = (typeof performance !== 'undefined' ? performance.now() : 0) - __t0
  twoDRenderMsEMA = twoDRenderMsEMA === 0 ? __ms : twoDRenderMsEMA * 0.9 + __ms * 0.1
  if (typeof window !== 'undefined') (window as unknown as { __2dRenderMs?: number }).__2dRenderMs = twoDRenderMsEMA
}

import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { type BuildingType } from '@/engine/buildingComposer'
import { buildingRect, doorCellFor, gridBuildingFacing } from '@/engine/buildingEditor'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { isoFacadeOnBack } from '@/engine/isoBuilding'
import { buildingCellColor, wallMaterialTile, wallMaterialImage } from '@/engine/stageGenerator'
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
import { ASCII_FONT, BUILDING_BADGES, COMBAT_RANGE, type DayNight, ENEMY_MOVE_MS, LAMP_GLOW, applyCellTransform, clampCameraAxis, assetCaptionByCell, terrainLabelAt, collectLampGlows, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawConnectorMarker, drawAttackAnimFrame, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, grassShade, cellFill, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, treeCanopyLayers, treeCellSet } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
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
  if (edv.image || edv.char) {
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    const efImg = frameImage(ef, edv.char, edv.image)
    if (efImg) {
      const baseImgPx = spanH * 0.9
      const imgPx = baseImgPx * size
      drawStyledImage(ctx, efImg, cx, footY - baseImgPx * 0.42 - (imgPx - baseImgPx) * 0.5, imgPx, ef.flipX)
    } else {
      // One emoji replaces the multi-row figure. FIXED cell-multiple size, grounded by its BOTTOM at the
      // shadow (footY) so a smaller enemy doesn't float.
      const baseEmojiPx = tileSize * (isEnemy ? 1.35 : 1.7)
      const emojiPx = baseEmojiPx * size
      ctx.font = `bold ${emojiPx}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = edv.color
      drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), cx, footY - baseEmojiPx * 0.42 - (emojiPx - baseEmojiPx) * 0.5, ef.flipX)
      ctx.textAlign = 'left'
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
  }

  // Top of the figure — where above-entity overlays (quest marker) anchor.
  const figureTop = topY - 4
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
): void {
  const char = asset.art[0] ?? '?'
  const cy = baseY - tileH * 0.5
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(x - tileW / 2, cy - tileH / 2, tileW, tileH)
  ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
  ctx.fillStyle = asset.color ?? '#cccccc'
  ctx.fillText(char, x, cy)
}


/** One building FACADE cell rendered as a single tile, using the SAME tiles the layered
 *  house drew (|[]| windows, |==| door, /\ red roof). The cell's structural glyph picks which:
 *  ▀/▔ → red roof, ╫ → door, everything else (█ wall, ▒ window) → the gold |[]| body tile —
 *  so the body looks exactly like #16's dense windowed wall. Painting one tile per cell (not a
 *  whole house per cell) keeps the red roof to the facade's 2 top rows instead of a stack. */
export function draw2DBuildingTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  tileW: number,
  tileH: number,
  asset: GridAsset,
  flicker: number,
): void {
  // Same palette the layered house used.
  const wallColor = 'rgba(180, 132, 65, 0.9)'
  const wallDarkColor = 'rgba(138, 98, 48, 0.9)'
  const roofColor = 'rgba(200, 64, 64, 0.95)'

  const glyph = asset.art[0] ?? '█'
  const isRoof = glyph === '▀' || glyph === '▔'
  const isDoor = glyph === '╫'
  const tile = isRoof
    ? { text: '/\\', fg: `rgba(255, 100, 80, ${0.8 + 0.2 * flicker})`, bg: roofColor }
    : isDoor
    ? { text: '|==|', fg: '#664422', bg: wallColor }
    : { text: '|[]|', fg: `rgba(255, 220, 80, ${0.5 + 0.3 * flicker})`, bg: wallColor } // wall + window → dense |[]| like #16

  const top = baseY - tileH
  ctx.fillStyle = tile.bg
  ctx.fillRect(cx - tileW * 0.5, top, tileW, tileH)

  // Side-wall seams on the gold body tiles (the "connected wall" look) — not on the roof.
  if (!isRoof) {
    ctx.fillStyle = wallDarkColor
    ctx.fillRect(cx - tileW * 0.5 - 2, top, 3, tileH)
    ctx.fillRect(cx + tileW * 0.5 - 1, top, 3, tileH)
  }

  ctx.font = `bold ${tileH * 0.85}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = tile.fg
  ctx.fillText(tile.text, cx, top + tileH * 0.5)
}


/** Everything draw2DBuilding needs that is a PURE function of (building, style): the facade↔footprint
 *  column mapping, the per-building material tile, and the per-building cell colours. Only centerX/baseY/
 *  tileW/tileH/flicker vary per frame, so this is computed ONCE per (building, styleId) and reused —
 *  including the roof colour, which the per-cell loop used to recompute (buildingCellColor) on every roof
 *  cell. */
export interface Building2DDescriptor {
  showFront: boolean
  H: number
  N: number
  identity: boolean
  dFoot: number
  srcCol: (i: number) => number
  wallTile2D: string
  wallImage2D: string | undefined
  roofBg: string
  roofGlyph: string
  roofTint: string
  wallBg: string
  doorBg: string
  windowBg: string
  wallSeam: string
}

function computeBuilding2DDescriptor(b: GridBuilding): Building2DDescriptor {
  const showFront = !isoFacadeOnBack(gridBuildingFacing(b))
  const cells = b.cells
  const H = cells.length
  // Draw ONE elevation column per GROUND-footprint column (b.length), aligned to the footprint's
  // own collision cells — so a drawn wall ALWAYS sits on a blocked cell (the #82 fix). A rotated
  // (east/west) building's footprint col-span is its DEPTH, narrower than the facade length, so the
  // old "draw a facade-length-wide elevation centred on the footprint" spilled a phantom wall column
  // PAST the footprint with no collision behind it — you could walk straight through that drawn wall.
  // We map the footprint's real road-edge door column to the facade's door column and fill the rest
  // from wall columns. Axis-aligned (south/north) buildings have footprint width == facade length
  // with the door already centred, so they take the identity path and render exactly as before.
  const facing = gridBuildingFacing(b)
  const rect = buildingRect(b)
  const N = b.length // footprint column span == collision width
  const identity = facing === 'south' || facing === 'north' // 1:1 facade↔footprint, render unchanged
  const dFoot = doorCellFor(facing, rect).col - b.col // footprint-relative door column
  const bottomRow = cells[H - 1] ?? []
  const dFace = Math.max(0, bottomRow.findIndex(k => k === 'door')) // facade door column
  const wallSrcCols = bottomRow.map((k, c) => (k === 'door' ? -1 : c)).filter(c => c >= 0)
  // facade source column for footprint column i (its door column → the facade door; else a wall column)
  const srcCol = (i: number): number =>
    identity ? i : i === dFoot ? dFace : wallSrcCols.length ? wallSrcCols[i % wallSrcCols.length] : 0
  // Each cell gets its OWN background so a door reads as a dark doorway and a window as glass — not a
  // glyph on identical wall. Colors come from the shared per-building source (real-house wall tones,
  // dark doors, glass windows; store=blue roof, hospital=green roof) so 2D matches the other views.
  const t = b.type as BuildingType
  const wallTile2D = wallMaterialTile(t, b.col) // this building's MATERIAL tile (🪵/🧱/🪨; '' = plaster)
  const wallImage2D = wallMaterialImage(t, b.col) // wood/stone → a Noto image (their glyphs tofu); brick/plaster → undefined
  const a = (col: string): string => withAlpha(col, 0.96)
  // Resolve each per-building colour ONCE. roofColor also feeds the per-cell roof TILE tint (was
  // buildingCellColor recomputed inside the loop for every roof cell) and wallColor feeds the seam.
  const roofColor = buildingCellColor(t, 'roof', b.col)
  const wallColor = buildingCellColor(t, 'wall', b.col)
  const roofBg = a(roofColor)
  const roofGlyph = a(darkenColor(roofColor, 0.58)) // the /\ as a darker roof tone, so it reads
  const wallBg = a(wallColor)
  const doorBg = a(buildingCellColor(t, 'door', b.col))
  const windowBg = a(buildingCellColor(t, 'window', b.col))
  const wallSeam = a(darkenColor(wallColor, 0.72))
  return { showFront, H, N, identity, dFoot, srcCol, wallTile2D, wallImage2D, roofBg, roofGlyph, roofTint: roofColor, wallBg, doorBg, windowBg, wallSeam }
}

// Cache keyed on (building object → styleId). Mirrors the iso descriptor cache: a building EDIT
// REPLACES the object (grid.buildings[idx] = next), so the WeakMap entry drops itself — no staleness,
// no bookkeeping. (Verified: nothing mutates a building's fields in place.) The 2D descriptor's only
// style dependency is via `t = b.type`; keeping the styleId key keeps it in lockstep with the iso cache
// and future-proofs a per-style 2D value. Reused across frames until the building object changes.
const _building2DDescriptors = new WeakMap<GridBuilding, Map<string, Building2DDescriptor>>()

export function building2DDescriptor(b: GridBuilding, style: Style): Building2DDescriptor {
  let byStyle = _building2DDescriptors.get(b)
  if (!byStyle) { byStyle = new Map(); _building2DDescriptors.set(b, byStyle) }
  let d = byStyle.get(style.id)
  if (!d) { d = computeBuilding2DDescriptor(b); byStyle.set(style.id, d) }
  return d
}

/** Visit every DRAWN facade cell of a 2D front elevation, in draw order, yielding each cell's screen `x`,
 *  its RAISED `cellTop` (the EXACT y draw2DBuilding stamps that tile at), the resolved `kind`
 *  (roof/wall/window/door — after the rotated-door→wall and back-wall→wall remaps), and whether it
 *  BLOCKS (everything except the walkable door). 'empty' cells draw nothing and are skipped. This is the
 *  ONE source of the facade's geometry, so the tile draw AND the red collision overlay run through the
 *  same loop and stay aligned BY CONSTRUCTION — the overlay can never drift H rows below the walls (#29). */
export function forEach2DFacadeCell(
  b: GridBuilding,
  d: Building2DDescriptor,
  centerX: number,
  baseY: number,
  tileW: number,
  tileH: number,
  visit: (x: number, cellTop: number, kind: string, blocking: boolean) => void,
): void {
  const { showFront, H, N, identity, dFoot, srcCol } = d
  const cells = b.cells
  for (let r = 0; r < H; r++) {
    for (let i = 0; i < N; i++) {
      const raw = cells[r]?.[srcCol(i)]
      if (!raw || raw === 'empty') continue
      // A door glyph mapped onto a non-door footprint column (rotated buildings) reverts to wall so
      // the entrance stays single + on the real road edge. Identity (axis-aligned) keeps b.cells as-is.
      const cellKind = !identity && raw === 'door' && i !== dFoot ? 'wall' : raw
      // Back of the house → only the DOOR becomes wall (no entrance from behind); windows still show.
      const kind = !showFront && cellKind === 'door' ? 'wall' : cellKind
      const x = centerX + (i - (N - 1) / 2) * tileW
      const cellTop = baseY - (H - r) * tileH // row r (0 = roof apex) stacks up from the front edge
      visit(x, cellTop, kind, kind !== 'door') // door = the walkable entrance → not blocking
    }
  }
}


/** The 2D collision overlay for ONE building: a translucent red tint on every BLOCKING facade cell,
 *  painted through the SAME forEach2DFacadeCell geometry draw2DBuilding uses — so each red rect lands on
 *  exactly its wall/window/roof tile, never on the flat footprint H rows below (case-a fix for #29). The
 *  walkable door column carries no red. `centerX`/`baseY` are the SAME anchor render2D draws the facade at. */
export function draw2DBuildingCollision(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  centerX: number,
  baseY: number,
  tileW: number,
  tileH: number,
  style: Style = ASCII_STYLE,
): void {
  const d = building2DDescriptor(b, style)
  forEach2DFacadeCell(b, d, centerX, baseY, tileW, tileH, (x, cellTop, _kind, blocking) => {
    if (!blocking) return // the walkable door — no collision, no red
    ctx.fillStyle = 'rgba(255, 50, 50, 0.4)'
    ctx.fillRect(x - tileW / 2, cellTop, tileW, tileH)
  })
}


/** 2D FRONT ELEVATION of a building: its facade (b.cells — door-down, windows, peaked/flat roof on
 *  top) drawn upright over the small footprint's front edge. `centerX` is the footprint centre, `baseY`
 *  the bottom of the front row. The ground footprint stays width×depth (collision matches); only the
 *  drawn facade rises tall — the height/footprint decoupling, in 2D. */


/** The town-square fountain in the 2D (3/4) view: ONE front-facing animated park fountain spanning
 *  its plaza — a stone platform, a blue basin, a central tiered column, and water jets. `baseY` is the
 *  bottom of the centre cell; the structure spans `asset.footprint` cells wide and stacks upward. */
export function draw2DTownFountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  tileW: number,
  tileH: number,
  asset: GridAsset,
  time: number,
): void {
  const f = Math.max(2, asset.footprint ?? 3)
  const fw = tileW * f
  const hwid = fw * 0.5
  const stone = '#bcb3a2'
  const water = '#3fb2e6'
  const waterDeep = darkenColor(water, 0.45)
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.003)
  const ellipse = (cy: number, rx: number, ry: number, fill: string): void => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // base PLATFORM — a short stone wall under a wide rounded slab
  const platRy = tileH * 0.5
  const platCy = baseY - platRy * 0.5
  ctx.fillStyle = darkenColor(stone, 0.5)
  ctx.fillRect(x - hwid, platCy, hwid * 2, tileH * 0.45)
  ellipse(platCy, hwid, platRy, lightenColor(stone, 0.08))

  // BASIN — stone bowl + blue water + ripples
  const basinHw = hwid * 0.8
  const basinRy = platRy * 0.8
  const basinCy = platCy - tileH * 0.5
  ctx.fillStyle = darkenColor(stone, 0.4)
  ctx.fillRect(x - basinHw, basinCy, basinHw * 2, tileH * 0.55)
  ellipse(basinCy, basinHw, basinRy, stone)
  ellipse(basinCy, basinHw * 0.82, basinRy * 0.82, waterDeep)
  ellipse(basinCy, basinHw * 0.74, basinRy * 0.74, withAlpha(lightenColor(water, 0.05 + 0.12 * shimmer), 0.96))
  ctx.lineWidth = Math.max(1, tileW * 0.02)
  for (let k = 0; k < 2; k++) {
    const ph = (time * 0.0012 + k / 2) % 1
    ctx.strokeStyle = withAlpha('#e2f5ff', (1 - ph) * 0.4)
    ctx.beginPath()
    ctx.ellipse(x, basinCy, basinHw * 0.74 * (0.2 + ph * 0.8), basinRy * 0.74 * (0.2 + ph * 0.8), 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // central TIERED column — pedestal + wide lower bowl, thin pedestal + small upper bowl
  const lb = basinHw * 0.5
  const lbY = basinCy - basinRy * 0.2 - tileH * 0.9
  ctx.fillStyle = stone
  ctx.fillRect(x - fw * 0.06, lbY, fw * 0.12, basinCy - basinRy * 0.2 - lbY)
  ellipse(lbY, lb, lb * 0.4, stone)
  ellipse(lbY - tileH * 0.05, lb * 0.7, lb * 0.28, withAlpha(lightenColor(water, 0.1 + 0.12 * shimmer), 0.96))
  const ub = basinHw * 0.26
  const ubY = lbY - tileH * 0.7
  ctx.fillStyle = stone
  ctx.fillRect(x - fw * 0.035, ubY, fw * 0.07, lbY - ubY)
  ellipse(ubY, ub, ub * 0.42, stone)
  ellipse(ubY - tileH * 0.04, ub * 0.66, ub * 0.3, withAlpha(lightenColor(water, 0.12 + 0.12 * shimmer), 0.96))

  // JETS — central vertical jet + side arcs into the lower bowl + cascade into the basin (animated)
  const spoutY = ubY - tileH * 0.1
  const jetH = tileH * 1.6 * (0.82 + 0.18 * Math.sin(time * 0.006))
  ctx.fillStyle = withAlpha('#eaf8ff', 0.9)
  ctx.beginPath()
  ctx.moveTo(x, spoutY - jetH)
  ctx.lineTo(x + tileW * 0.06, spoutY)
  ctx.lineTo(x - tileW * 0.06, spoutY)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = withAlpha('#d4f0ff', 0.8)
  ctx.lineWidth = Math.max(1.5, tileW * 0.03)
  ctx.lineCap = 'round'
  for (const dir of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(x, spoutY - jetH * 0.5)
    ctx.quadraticCurveTo(x + dir * lb * 1.4, spoutY - jetH * 0.1, x + dir * lb * 0.9, lbY)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x + dir * lb * 0.9, lbY)
    ctx.quadraticCurveTo(x + dir * basinHw * 0.9, (lbY + basinCy) / 2, x + dir * basinHw * 0.8, basinCy - basinRy * 0.2)
    ctx.stroke()
  }
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
  hoveredCell: { col: number; row: number } | null = null,
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
  // Collect all drawable objects: assets + buildings + player
  const drawables: Array<{
    row: number
    col: number
    type: 'asset' | 'player'
    asset?: GridAsset
  }> = []

  // A BUILDING is just TILES: stampBuildingCells places one `type:'building'` asset per BLOCK, so a
  // building's walls/windows/door/roof render through the SAME per-cell asset path as any stacked tile —
  // no front-elevation drawer. grid.buildings stays only as the building's metadata (used by the DEBUG
  // collision overlay below + whole-building ops); it is no longer a render source. The footprint set still
  // feeds that debug overlay, which tints the raised facade instead of the grounded cells.
  const buildingFootprint2D = new Set<string>()
  // Footprint cell → the building's FRONT (bottom/max) row. A building is a FRONT ELEVATION in 2D: every one
  // of its per-cell tiles projects onto this ONE row and stacks by heightLevel, so the depth rows collapse
  // front-on instead of marching up the screen (§6). Same stamped tiles, regular tile path, no special drawer.
  const buildingFrontRow2D = new Map<string, number>()
  for (const b of grid.buildings ?? []) {
    const top = b.row - (b.height - 1)
    for (let r = 0; r < b.height; r++) for (let c = 0; c < b.length; c++) {
      buildingFootprint2D.add(`${b.col + c},${top + r}`)
      buildingFrontRow2D.set(`${b.col + c},${top + r}`, b.row) // b.row = the bottom/camera-facing front row
    }
  }

  // Add assets — building blocks included, so they render per-block through the asset path below.
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camCol), Math.floor(camRow), tilesX, tilesY
  )
  const treeCells2D = treeCellSet(grid) // memoized (see shared.treeCellSet) — no per-frame assets rescan
  const isTreeCell2D = (c: number, r: number): boolean => treeCells2D.has(`${c},${r}`)
  for (const asset of visibleAssets) {
    drawables.push({ row: asset.row, col: asset.col, type: 'asset', asset })
  }

  // Add player
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize
  drawables.push({ row: playerRow, col: playerCol, type: 'player' })

  // Sort by row (things further up screen drawn first = behind)
  drawables.sort((a, b) => a.row - b.row)

  // Draw each object
  for (const obj of drawables) {
    // Building tiles project onto the building's FRONT row (front elevation, depth collapsed); every other
    // tile projects at its own cell. The stacking-by-heightLevel below then builds the facade + gable over
    // that one row instead of the depth rows spilling up the screen (§6) — regular path, no special drawer.
    const projRow = (obj.asset?.type === 'building' ? buildingFrontRow2D.get(`${obj.col},${obj.row}`) : undefined) ?? obj.row
    const p = toScreen(obj.col + 0.5, projRow + 0.5)
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
      if (pdv.image || pdv.char) {
        const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
        const pfImg = frameImage(pf, pdv.char, pdv.image)
        if (pfImg) {
          drawStyledImage(ctx, pfImg, p.x, baseY - personImgPx * 0.42, personImgPx, pf.flipX)
        } else {
          ctx.font = `bold ${personGlyphPx}px ${ASCII_FONT}` // character height, matching npcs
          drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), p.x, baseY - personGlyphPx * 0.42, pf.flipX)
          ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
        }
      } else {
        for (let i = 0; i < figArt2.length; i++) {
          const line = figArt2[figArt2.length - 1 - i] // Reverse order (bottom to top)
          const lineY = baseY - (i + 0.5) * lineHeight
          ctx.fillStyle = bodyColor
          ctx.fillText(line, p.x, lineY)
        }
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
        const figureTop = baseY - figArt2.length * lineHeight
        const barWidth = Math.max(28, tileH * 2.2)
        const nameSize = Math.max(9, fontSize)
        drawFigureVitals(ctx, p.x, figureTop, barWidth, 6, nameSize, barFraction(player.hp ?? player.maxHp, player.maxHp), playerDisplayName(player.name))
      }

    } else if (obj.asset) {
      const asset = obj.asset

      // Get proper height for 2D RPG view based on asset type
      let heightTiles = 1
      if (asset.type === 'tree') heightTiles = 3
      else if (asset.type === 'building') heightTiles = 4
      else if (asset.type === 'lamp') heightTiles = 2

      // Base at bottom of cell - tiles stack upward. A stacked asset (editor brush, heightLevel > 0)
      // is lifted ~0.9 cell per level so the pile reads as separate raised items instead of overlapping
      // on one spot. heightLevel is absent (→ 0) on every generated/existing asset, so this is a no-op
      // for anything but a deliberately stacked cell.
      const baseY = p.y + tileH * 0.5 - elevOffset - (asset.heightLevel ?? 0) * tileH * 0.9

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
      if (adv.image) {
        // A per-asset colour override recolours the baked sprite (#80); undefined → drawn untinted.
        // Per-view tile size (byte-identical when unset: old 1.5 constant), then per-element dims (#77/#78).
        const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
        const d = resolveAssetDrawSize(tileH * (resolveTileSize(vt, '2d') ?? 1.5), asset, 'billboard')
        const cx = p.x, cy = baseY - tileH * 0.7 - d.baseLift
        const pose = resolveTilePose(vt, '2d') // #1: props finally read a per-view pose (was unwired)
        if (pose) {
          ctx.save(); ctx.translate(cx, cy); applyPose(ctx, pose, 1, tileH)
          drawStyledImage(ctx, adv.image, 0, 0, d.w, false, asset.color, d.h)
          ctx.restore()
        } else {
          drawStyledImage(ctx, adv.image, cx, cy, d.w, false, asset.color, d.h)
        }
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
        const pose = resolveTilePose(vt, '2d')
        const strength = asset.color ? (isTree ? 0.55 : 0.85) : 0 // colour-emoji ignore fillStyle → wash the tint on
        // A tree keeps its 🌲 shape but is recoloured to its SEASON's canopy shade (asset.color).
        ctx.save()
        ctx.translate(p.x, baseY - lift)
        if (pose) applyPose(ctx, pose, 1, tileH)
        if (d.w !== d.h) ctx.scale(d.w / d.h, 1) // non-uniform Width vs Height, like the image branch
        fillTintedGlyph(ctx, adv.char, 0, 0, d.h, asset.color, strength)
        ctx.restore()
      } else if (asset.label) {
        // Generated multi-cell cell → one glyph in its zone/theme color (the cell
        // IS the tile), matching the iso + top views. No green multi-tile overdraw.
        draw2DLabeledCell(ctx, p.x, baseY, tileW, tileH, asset)
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

      } else if (asset.type === 'building') {
        // ONE tile per facade cell (red roof / gold |[]| body / |==| door, picked by the
        // cell's glyph) — the SAME tiles as the old layered house, but not a whole house per
        // cell. That keeps the red roof to the facade's 2 top rows: a compact house.
        draw2DBuildingTile(ctx, p.x, baseY, tileW, tileH, asset, flicker)

      } else if (asset.type === 'lamp') {
        // Lamp post — STEADY bulb (ON at night, dim by day), no time-based pulse/flicker.
        const glow = dayNight === 'night' ? 1 : 0.2
        ctx.fillStyle = '#333333'
        ctx.fillRect(p.x - tileW * 0.12, baseY - tileH * 2, tileW * 0.24, tileH * 2)
        ctx.fillStyle = '#555555'
        ctx.fillText('|', p.x, baseY - tileH * 0.5)
        // Bulb
        ctx.fillStyle = `rgba(255, 255, 0, ${0.4 + 0.6 * glow})`
        ctx.fillRect(p.x - tileW * 0.25, baseY - tileH * 2.4, tileW * 0.5, tileH * 0.5)
        ctx.fillStyle = `rgba(255, 200, 50, ${0.4 + 0.6 * glow})`
        ctx.fillText('o', p.x, baseY - tileH * 2.2)

      } else if (asset.type === 'fountain' && asset.footprint) {
        // The town SQUARE centrepiece: ONE big animated fountain spanning its plaza (not N glyphs).
        draw2DTownFountain(ctx, p.x, baseY, tileW, tileH, asset, time)

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

      } else {
        // Default - still use vibrant colors with animation
        const tileFg = asset.color || '#ffffff'
        const tileBg = asset.bgColor || darkenColor(tileFg, 0.3)
        const char = asset.art[0] || '?'
        ctx.fillStyle = tileBg
        ctx.fillRect(p.x - tileW * 0.5, baseY - tileH, tileW, tileH)
        ctx.fillStyle = tileFg
        ctx.fillText(char, p.x, baseY - tileH * 0.5)
      }

      if (ct2d) ctx.restore() // pop the cell-animation transform
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

        // A building footprint cell is tinted on its RAISED facade below (draw2DBuildingCollision) — NOT
        // grounded here, or the red would sit H rows below the drawn walls (#29). Non-building collision
        // (trees/water/borders) still tints its own flat cell.
        if (isCollision && !buildingFootprint2D.has(`${col},${row}`)) {
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
    // Building collision, painted on the RAISED facade instead of the grounded footprint above — through
    // the SAME anchor + geometry draw2DBuilding uses (toScreen(centre) + tileH*0.5), so each red rect sits
    // exactly on its wall/window/roof tile and the walkable door column stays clear (#29, case a).
    for (const b of grid.buildings ?? []) {
      const bp = toScreen(b.col + b.length / 2, b.row + 0.5)
      draw2DBuildingCollision(ctx, b, bp.x, bp.y + tileH * 0.5, tileW, tileH, style)
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
    const lamps = collectLampGlows(grid, (c, r) => toScreen(c + 0.5, r + 0.5), tileW * LAMP_GLOW.radiusTiles, tileH * 2.2, w, h)
    drawNightLighting(ctx, w, h, lamps)
  }

  // ─── Cell-hover outline — a DIM/translucent square on the cell under the cursor, drawn UNDER the
  //     solid-yellow selection below so it never hides it. Shows on EVERY cell (even one a unit sits on),
  //     in addition to the unit hover reticle, so any floor tile stays targetable. ──────────────────
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    const p = toScreen(hoveredCell.col, hoveredCell.row)
    ctx.strokeRect(p.x + 1, p.y + 1, tileW - 2, tileH - 2)
  }

  // ─── Selection outline (property-editor multi-select) — drawn over the world so
  //     the yellow ring shows on top of tiles/props, mirroring the top view. ────────
  if (selectedCells.size > 0) {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    for (const key of selectedCells) {
      const [col, row] = key.split(',').map(Number)
      const p = toScreen(col, row)
      ctx.strokeRect(p.x + 1, p.y + 1, tileW - 2, tileH - 2)
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

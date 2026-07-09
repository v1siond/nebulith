import { GridAsset, GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { buildingRect, doorCellFor, gridBuildingFacing } from '@/engine/buildingEditor'
import { buildingCellColor } from '@/engine/stageGenerator'
import { type BuildingType } from '@/engine/buildingComposer'
import { assetCellTransform } from '@/engine/cellAnimation'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { topRoleColor } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { Connector } from '@/lib/api'
import { ASCII_FONT, BUILDING_BADGES, type DayNight, LAMP_GLOW, applyCellTransform, clampCameraAxis, collectLampGlows, debugCellCaptions, debugLabelColors, drawConnectorMarker, drawHitMarker, drawHpBar, drawNightLighting, drawQuestMarker, drawStyledImage, fillTintedGlyph, grassShade, cellFill, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, tileImage } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { getStack } from '@/engine/cellStack'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { applyPose } from '@/engine/tileset/pose'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, type Style } from '@/game/artStyle'


/** TOP (blueprint) view: an entity is a single `>` glyph colored by role — yellow player,
 *  red enemy, and NPCs blue / green (offers a quest) / purple (quest in progress). The
 *  glyph is style-resolved (emoji reskin swaps `>` for 👾/🧑/…); ASCII keeps `>`. */
export function drawTopArrow(ctx: CanvasRenderingContext2D, x: number, y: number, tileSize: number, color: string, glyph: string = '>'): void {
  const cx = x + tileSize / 2
  const cy = y + tileSize / 2
  ctx.font = `bold ${tileSize * 0.95}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillText(glyph, cx + 1, cy + 1)
  ctx.fillStyle = color
  ctx.fillText(glyph, cx, cy)
}


/** The town-square fountain in the TOP-DOWN view: a round blue basin (stone rim → water → centre
 *  column boss) spanning its footprint, with expanding ripple rings. A blueprint read of one fountain. */
export function drawTopTownFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, time: number): void {
  const stone = '#bcb3a2'
  const water = '#3fb2e6'
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.003)
  const ring = (r: number, fill: string): void => {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ring(radius, darkenColor(stone, 0.45)) // outer rim shadow
  ring(radius * 0.92, lightenColor(stone, 0.06)) // stone rim
  ring(radius * 0.78, darkenColor(water, 0.4)) // pool depth
  ring(radius * 0.72, withAlpha(lightenColor(water, 0.05 + 0.14 * shimmer), 0.98)) // water surface
  ctx.lineWidth = Math.max(1, radius * 0.06)
  for (let k = 0; k < 3; k++) {
    const ph = (time * 0.0011 + k / 3) % 1
    ctx.strokeStyle = withAlpha('#e2f5ff', (1 - ph) * 0.5)
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.72 * (0.15 + ph * 0.85), 0, Math.PI * 2)
    ctx.stroke()
  }
  ring(radius * 0.26, lightenColor(stone, 0.04)) // central column boss
  ring(radius * 0.1, withAlpha('#eaf8ff', 0.95)) // jet crown
}


// The overhead ROOF palette used by the ASCII blueprint (a reskin uses the roof TILE recoloured to the
// building's DATA roof colour instead — see drawTopBuildingRoof).
const ROOF_TOP_COLORS: Record<string, { fill: string; ridge: string; edge: string }> = {
  house: { fill: '#c0463c', ridge: '#e0786a', edge: '#7a2a24' },
  'big-house': { fill: '#b0673a', ridge: '#d08f5a', edge: '#6e3f22' },
  store: { fill: '#3a7ea5', ridge: '#5fa6cc', edge: '#234e66' },
  hospital: { fill: '#3aa55a', ridge: '#5fcc80', edge: '#23663a' },
}
const roofTopPalette = (t: string) => ROOF_TOP_COLORS[t] ?? { fill: '#a0644a', ridge: '#c08a6a', edge: '#5e3a2a' }


/** ONE building's roof in the TOP (overhead) view. Under a reskin it's a genuine ROOF TILE recoloured to
 *  THIS building's data roof colour, tiled across the footprint (a reskinnable roof-from-above that agrees
 *  with the 2D/iso recoloured-roof-tile); under ASCII it's the blueprint (filled roof + edge + gable ridge +
 *  a door notch on the road-facing side). A STORE/HOSPITAL badge floats over both. `rx/ry/rw/rh` = the
 *  building's footprint rect in screen px; `offsetX/offsetY` map a cell to screen for the door-notch centre. */
export function drawTopBuildingRoof(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  rx: number, ry: number, rw: number, rh: number,
  offsetX: number, offsetY: number,
  tileSize: number, fontSize: number,
  style: Style,
): void {
  const roofC = buildingCellColor(b.type as BuildingType, 'roof', b.col)
  const roofDV = resolveDraw('roof', style, undefined, '', roofC)
  if (roofDV.image || roofDV.tint) {
    // RESKIN: the roof is a TILE. Fill the footprint with the roof-colour base, then stamp the roof tile
    // RECOLOURED to roofC over each footprint cell — a clean roof-from-above that stays reskinnable.
    ctx.fillStyle = roofC
    ctx.fillRect(rx, ry, rw, rh)
    const cols = Math.max(1, Math.round(rw / tileSize))
    const rows = Math.max(1, Math.round(rh / tileSize))
    ctx.font = `bold ${tileSize * 1.02}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = rx + (c + 0.5) * tileSize
        const cy = ry + (r + 0.5) * tileSize
        if (roofDV.image && tileImage(roofDV.image.src)) drawStyledImage(ctx, roofDV.image, cx, cy, tileSize, false, roofC)
        else fillTintedGlyph(ctx, roofDV.char || '🟥', cx, cy, tileSize, roofC, 1)
      }
    }
  } else {
    // ASCII blueprint: filled roof + darker edge + gable ridge + a door notch on the road-facing edge.
    const pal = roofTopPalette(b.type)
    ctx.fillStyle = pal.fill
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeStyle = pal.edge
    ctx.lineWidth = Math.max(1, tileSize * 0.12)
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
    // ridge down the longer axis (gable read)
    ctx.strokeStyle = pal.ridge
    ctx.lineWidth = Math.max(1, tileSize * 0.16)
    ctx.beginPath()
    if (rw >= rh) {
      const my = ry + rh / 2
      ctx.moveTo(rx + tileSize * 0.25, my)
      ctx.lineTo(rx + rw - tileSize * 0.25, my)
    } else {
      const mx = rx + rw / 2
      ctx.moveTo(mx, ry + tileSize * 0.25)
      ctx.lineTo(mx, ry + rh - tileSize * 0.25)
    }
    ctx.stroke()
    // door notch (dark) centred on the actual walkable DOOR cell, on the road-facing edge.
    const dn = Math.max(3, tileSize * 0.4)
    const door = doorCellFor(gridBuildingFacing(b), buildingRect(b))
    ctx.fillStyle = '#241308'
    if ((b.facing ?? 0) === 0) {
      const dcx = offsetX + (door.col + 0.5) * tileSize // centre of the door cell's column
      const dy = b.facadeOnBack ? ry - dn * 0.25 : ry + rh - dn * 0.75
      ctx.fillRect(dcx - dn / 2, dy, dn, dn * 0.5)
    } else {
      const dcy = offsetY + (door.row + 0.5) * tileSize // centre of the door cell's row
      const dx = b.facadeOnBack ? rx - dn * 0.25 : rx + rw - dn * 0.75
      ctx.fillRect(dx, dcy - dn / 2, dn * 0.5, dn)
    }
  }
  // Type signage (STORE / HOSPITAL) on the roof — same badge the iso + 2D views show (both styles).
  const badge = BUILDING_BADGES[b.type]
  if (badge && tileSize > 8) {
    const bf = Math.max(7, tileSize * (badge.text.length > 1 ? 0.34 : 0.7))
    ctx.font = `bold ${bf}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const bw = ctx.measureText(badge.text).width
    const bx = rx + rw / 2
    const by = ry + rh / 2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
    ctx.fillRect(bx - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
    ctx.fillStyle = badge.color
    ctx.fillText(badge.text, bx, by)
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}` // restore the cell font for subsequent draws
  }
}


/** The town-square fountain in the TOP view. Under a reskin it's the fountain TILE (⛲) drawn over the
 *  basin footprint; under ASCII it's the procedural round basin (drawTopTownFountain). `cx/cy` = the
 *  footprint centre in screen px; `f` = the basin side in cells; `tileSize` the per-cell px. */
export function drawTopFountain(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  f: number,
  tileSize: number,
  style: Style,
  color: string | undefined,
  now: number,
): void {
  const dv = resolveDraw('fountain', style, undefined, '', color ?? '#4a90e2')
  if (dv.image || dv.tint) {
    // RESKIN: the fountain is its TILE, sized to span the plaza footprint (flat overhead read).
    const size = f * tileSize * 0.94
    if (dv.image && tileImage(dv.image.src)) { drawStyledImage(ctx, dv.image, cx, cy, size, false, color); return }
    ctx.font = `bold ${size}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fillTintedGlyph(ctx, dv.char || '⛲', cx, cy, size, color, 0.85)
    return
  }
  drawTopTownFountain(ctx, cx, cy, f * tileSize * 0.5 * 0.94, now)
}


// Top-down 2D blueprint view - flat, no height, just positions
// Dark, neutral-ish backing per asset type so each cell's OWN glyph + color (the
// label glyph for generated cells, the zone tint for trees) reads clearly.
export const TOP_ASSET_BACKDROP: Record<string, string> = {
  building: '#2a1810',
  tree: '#0a1f0a',
  water: '#0a1c2e',
  fountain: '#0a1c2e',
  decoration: '#241a0e',
  crate: '#241a0e',
  lamp: '#241f08',
  flower: '#1a0a12',
  npc: '#1a1a0a',
  rock: '#1a181c',
  boss: '#2a0e0e',
  column: '#1c1c1c',
}


export function renderTopView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  zoom: number = 1.0,
  selectedCells: Set<string> = new Set(),
  connectors: Connector[] = [],
  connectorMode: boolean = false,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  hitMarkers: readonly HitMarker[] = [],
  now: number = 0,
  quests: readonly Quest[] = [],
  dayNight: DayNight = 'day',
  style: Style = ASCII_STYLE,
  hoveredCell: { col: number; row: number } | null = null,
) {
  // Clear
  ctx.fillStyle = '#0a0a10'
  ctx.fillRect(0, 0, w, h)

  // Calculate tile size with zoom
  const baseTileSize = 16
  const tileSize = baseTileSize * zoom

  // Center on player position + pan offset
  const cellSize = grid.cellSize
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize

  // Camera focus (cols/rows) = player + pan, CLAMPED to the grid so the viewport
  // never shows off-grid void (centre when the grid is smaller than the view); then
  // derive the draw offset from the clamped focus.
  const focusCol = clampCameraAxis(playerCol - camOffset.x / tileSize, w / tileSize / 2, grid.cols)
  const focusRow = clampCameraAxis(playerRow - camOffset.y / tileSize, h / tileSize / 2, grid.rows)
  const offsetX = w / 2 - focusCol * tileSize
  const offsetY = h / 2 - focusRow * tileSize

  const fontSize = Math.max(8, tileSize * 0.6)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Calculate visible range
  const startCol = Math.max(0, Math.floor(-offsetX / tileSize) - 1)
  const endCol = Math.min(grid.cols, Math.ceil((w - offsetX) / tileSize) + 1)
  const startRow = Math.max(0, Math.floor(-offsetY / tileSize) - 1)
  const endRow = Math.min(grid.rows, Math.ceil((h - offsetY) / tileSize) + 1)

  // Build a map of assets by position for quick lookup
  const assetMap: Record<string, GridAsset> = {}
  for (const asset of grid.assets) {
    assetMap[`${asset.col},${asset.row}`] = asset
  }

  // Draw each cell - show ground OR asset (asset takes priority)
  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const x = offsetX + col * tileSize
      const y = offsetY + row * tileSize
      const key = `${col},${row}`
      const asset = assetMap[key]
      // Step 4c — a bare GROUND cell reads its FLOOR from tile index 0 of the cell's unified stack (mirrors
      // 2D's 4a / iso's 4b). getStack projects the SAME ground slug/colour the direct grid.ground/groundColor
      // reads gave, so the blueprint fill stays byte-identical — only the SOURCE moved onto the tile-in-cell
      // adapter. birdseye's overhead floor never uses groundDims (the dims path is asset-only, via `asset ?? {}`
      // below), so only slug + the colour override migrate. Props keep their assetMap path: asset cells skip
      // the stack (a TileEntry is lossy for a prop, and the asset-takes-priority draw order must be preserved).
      const floor = asset ? undefined : getStack(grid, col, row)[0]

      let char: string
      let fg: string
      let bg: string
      let grassy = false
      let kind: ReturnType<typeof assetKind>

      if (asset) {
        // Show the cell's OWN glyph + color — the label glyph for generated
        // multi-cell assets (╨│@♣ trees, autotiled masses, roofs/doors) and the
        // zone tint for trees — over a dark type-flavored backing for contrast.
        char = asset.art[0] ?? '?'
        fg = asset.color ?? '#cccccc'
        bg = TOP_ASSET_BACKDROP[asset.type] ?? '#141414'
        kind = assetKind(asset)
      } else {
        // Ground tile — slug from the floor tile (stack index 0); `|| 'grass'` matches the old direct read.
        const tileType = floor?.slug || 'grass'
        // Ground LOADS from the tileset's terrain data; the blueprint view uses the base variant (index 0).
        const colors = ASCII_TILESET.terrain[tileType] ?? ASCII_TILESET.terrain.grass
        char = colors.char[0]
        fg = colors.fg[0]
        kind = groundKind(tileType)
        // Grass AND the rocky cave floor vary per-cell into natural tones (deterministic hash); flat else.
        grassy = tileType.includes('grass') || kind === 'cavefloor'
        bg = grassy ? grassShade(colors.bg[0], col, row) : colors.bg[0]
      }

      // Resolve the active art style (ASCII passthrough → the defaults above, unchanged). A PLACED
      // tile's override re-homes onto the active style so it RESKINS (resolveAssetDraw); a bare ground
      // cell (no asset) passes undefined → the coarse kind, unchanged.
      const dv = resolveAssetDraw(kind, style, asset ? assetOverride(asset, style) : undefined, char, fg)

      // Draw cell — a reskin tints the blueprint cell at the tile hue (agrees with iso/2D), but grass
      // keeps its per-cell shade so a field isn't one flat green ("grass is just color"); ASCII → bg.
      // A per-cell FLOOR COLOUR override (Property panel) wins on a bare GROUND cell (asset cells keep the
      // asset tint, matching the separate ground layer under props in 2D/iso). The override now rides the
      // floor tile (getStack maps groundColor → color); byte-identical since null / a missing value both
      // fall through the `?? cellFill` below exactly as the old direct read did.
      const floorOverride = !asset ? floor?.color : null
      ctx.fillStyle = floorOverride ?? cellFill(dv.tint, bg, grassy, col, row)
      ctx.fillRect(x, y, tileSize - 1, tileSize - 1)

      ctx.fillStyle = dv.color
      // Authored frame animation moves the asset GLYPH (not its cell backing) around its centre.
      const gx = x + tileSize / 2, gy = y + tileSize / 2
      const ctTop = asset ? assetCellTransform(asset.cellAnim, now) : null
      if (ctTop) applyCellTransform(ctx, gx, gy, ctTop, tileSize, tileSize)
      if (dv.image) {
        // Per-view tile size (byte-identical when unset: old tileSize base), then per-element dims (#77/#78).
        const vt = style.id === 'emoji' && asset ? EMOJI_TILESET[assetKind(asset)] : undefined
        const d = resolveAssetDrawSize(tileSize * (resolveTileSize(vt, 'top') ?? 1), asset ?? {}, 'overhead')
        const pose = resolveTilePose(vt, 'top') // #1: props finally read a per-view pose (was unwired)
        if (pose) {
          ctx.save(); ctx.translate(gx, gy); applyPose(ctx, pose, 1, tileSize)
          drawStyledImage(ctx, dv.image, 0, 0, d.w, false, asset?.color, d.h)
          ctx.restore()
        } else {
          drawStyledImage(ctx, dv.image, gx, gy, d.w, false, asset?.color, d.h) // #80 colour override tints the sprite
        }
      } else {
        // GLYPH tile (no image): honour the per-view tile size + per-element dims + the colour override,
        // mirroring topdown's 2D glyph path (here the overhead view → Width × Depth). A bare ground glyph
        // (no asset, dims 1, no tint) falls through fillTintedGlyph to a plain centred fillText at the old
        // font size — byte-identical to before.
        const vt = style.id === 'emoji' && asset ? EMOJI_TILESET[assetKind(asset)] : undefined
        const d = resolveAssetDrawSize(fontSize * (resolveTileSize(vt, 'top') ?? 1), asset ?? {}, 'overhead')
        const pose = resolveTilePose(vt, 'top')
        const strength = asset?.color ? 0.85 : 0 // colour-emoji ignore fillStyle → wash the tint on
        ctx.font = `bold ${d.h}px ${ASCII_FONT}`
        ctx.save()
        ctx.translate(gx, gy)
        if (pose) applyPose(ctx, pose, 1, tileSize)
        if (d.w !== d.h) ctx.scale(d.w / d.h, 1) // non-uniform Width vs Depth, like the image branch
        fillTintedGlyph(ctx, dv.char, 0, 0, d.h, asset?.color, strength)
        ctx.restore()
        ctx.font = `bold ${fontSize}px ${ASCII_FONT}` // restore the loop's shared font for the next cell
      }
      if (ctTop) ctx.restore()

      // Height indicator (show in corner if height > 0)
      const cellHeight = grid.getHeight(col, row)
      if (cellHeight > 0 && tileSize > 10) {
        // Draw height badge in top-right corner
        const badgeSize = Math.max(10, tileSize * 0.4)
        ctx.fillStyle = '#00ccff'
        ctx.fillRect(x + tileSize - badgeSize - 2, y + 1, badgeSize, badgeSize)
        ctx.fillStyle = '#000000'
        ctx.font = `bold ${Math.max(8, badgeSize * 0.8)}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(cellHeight.toString(), x + tileSize - badgeSize / 2 - 2, y + badgeSize / 2 + 1)
        // Reset font
        ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
      }

      // Selection highlight
      if (selectedCells.has(`${col},${row}`)) {
        ctx.strokeStyle = '#ffff00'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, tileSize - 3, tileSize - 3)
      }

      // Debug: show cell coordinates
      if (isDebugMode() && tileSize > 12) {
        ctx.font = `${Math.max(6, tileSize * 0.35)}px ${ASCII_FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${col},${row}`, x + 1, y + 1)
      }
    }
  }

  // ── BUILDING ROOFS (top-down): each building drawn as a cohesive roof seen from above (like a
  //    neighborhood map) over its footprint — filled roof + edge + ridge line + a door notch on the
  //    road-facing side. Overlays the per-cell building tiles for a clean blueprint look.
  for (const b of grid.buildings ?? []) {
    const topRow = b.row - (b.height - 1)
    if (b.col + b.length <= startCol || b.col >= endCol || topRow + b.height <= startRow || topRow >= endRow) continue
    const rx = offsetX + b.col * tileSize
    const ry = offsetY + topRow * tileSize
    const rw = b.length * tileSize
    const rh = b.height * tileSize
    drawTopBuildingRoof(ctx, b, rx, ry, rw, rh, offsetX, offsetY, tileSize, fontSize, style)
  }

  // Town-square fountain (top-down): a round blue basin spanning its footprint, drawn over the
  // paved plaza as ONE fountain (the centre prop carries the basin span). Overlays the per-cell pass.
  for (const a of grid.assets) {
    if (a.type !== 'fountain' || !a.footprint) continue
    const f = a.footprint
    if (a.col + f < startCol || a.col - f > endCol || a.row + f < startRow || a.row - f > endRow) continue
    const cx = offsetX + (a.col + 0.5) * tileSize
    const cy = offsetY + (a.row + 0.5) * tileSize
    drawTopFountain(ctx, cx, cy, f, tileSize, style, a.color, now)
  }

  // Collision overlay — drawn LAST (over the roofs + fountains) so it shows on BUILDING cells too; the
  // per-cell pass is painted before the roof blueprint, which would otherwise hide the tint on buildings.
  // Debug overlay OR the lighter "show collisions" toggle.
  if (isDebugMode() || isShowCollisions()) {
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        if (!grid.collision[row]?.[col]) continue
        ctx.fillStyle = 'rgba(255, 50, 50, 0.4)'
        ctx.fillRect(offsetX + col * tileSize, offsetY + row * tileSize, tileSize - 1, tileSize - 1)
      }
    }
  }

  // Debug: per-cell TYPE + POSITION captions — the SAME flattened captions the 2D + iso overlays
  // draw, so a cell reads identically in every view (the consistent labeling standard).
  if (isDebugMode()) {
    ctx.font = `bold ${Math.max(8, tileSize * 0.5)}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cap of debugCellCaptions(grid.assets)) {
      if (cap.col < startCol || cap.col >= endCol || cap.row < startRow || cap.row >= endRow) continue
      const cx = offsetX + (cap.col + 0.5) * tileSize
      const labelY = offsetY + cap.row * tileSize - tileSize * 0.25
      const { fg: labelColor, bg: labelBg } = debugLabelColors(cap.type)
      const metrics = ctx.measureText(cap.text)
      ctx.fillStyle = labelBg
      ctx.fillRect(cx - metrics.width / 2 - 3, labelY - 8, metrics.width + 6, 16)
      ctx.fillStyle = labelColor
      ctx.fillText(cap.text, cx, labelY)
    }
  }

  // Grid lines (subtle)
  if (tileSize > 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let col = startCol; col <= endCol; col++) {
      const x = offsetX + col * tileSize
      ctx.beginPath()
      ctx.moveTo(x, offsetY + startRow * tileSize)
      ctx.lineTo(x, offsetY + endRow * tileSize)
      ctx.stroke()
    }
    for (let row = startRow; row <= endRow; row++) {
      const y = offsetY + row * tileSize
      ctx.beginPath()
      ctx.moveTo(offsetX + startCol * tileSize, y)
      ctx.lineTo(offsetX + endCol * tileSize, y)
      ctx.stroke()
    }
  }

  // Draw player position (1x1 cell footprint)
  const playerCellCol = Math.floor(player.x / cellSize)
  const playerCellRow = Math.floor(player.z / cellSize)
  const px = offsetX + playerCellCol * tileSize
  const py = offsetY + playerCellRow * tileSize

  // Player cell background + bold outline so it never gets lost in the foliage
  ctx.fillStyle = '#ffdd00'
  ctx.fillRect(px, py, tileSize - 1, tileSize - 1)
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = 2
  ctx.strokeRect(px + 1, py + 1, tileSize - 3, tileSize - 3)

  // Direction arrow
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${tileSize * 0.7}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let dirChar = 'v'
  switch (player.facing) {
    case 'up': dirChar = '^'; break
    case 'down': dirChar = 'v'; break
    case 'left': dirChar = '<'; break
    case 'right': dirChar = '>'; break
  }
  const pdv = resolveDraw('player', style, personVariantTileId(player.variant, style), dirChar, '#000000')
  // genderize the person glyph so the hero's male/female figure shows in top view too (matches
  // iso/2d); the ASCII direction arrow passes through genderize unchanged.
  if (pdv.image) drawStyledImage(ctx, pdv.image, px + tileSize / 2, py + tileSize / 2, tileSize)
  else ctx.fillText(genderize(pdv.char, player.variant), px + tileSize / 2, py + tileSize / 2)

  // Life bar above the player cell — the SAME drawHpBar enemies get in this view (below).
  if (player.maxHp != null) {
    drawHpBar(ctx, px + tileSize / 2, py - 3, tileSize, 3, barFraction(player.hp ?? player.maxHp, player.maxHp))
  }

  // Draw connectors — one marker per cell the connector owns; the label rides on
  // the connector's first cell only.
  for (const connector of connectors) {
    connector.cells.forEach((pcell, idx) => {
      const cx = offsetX + pcell.col * tileSize
      const cy = offsetY + pcell.row * tileSize

      // Portal/connector appearance
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.fillRect(cx, cy, tileSize - 1, tileSize - 1)

      // Draw portal marker — a TILE now: 🌀 under a reskin, ◊ under ASCII.
      ctx.font = `bold ${tileSize * 0.6}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      drawConnectorMarker(ctx, style, cx + tileSize / 2, cy + tileSize / 2, tileSize)

      // Draw pulsing border in connector mode
      if (connectorMode) {
        ctx.strokeStyle = '#ff88ff'
        ctx.lineWidth = 2
        ctx.strokeRect(cx, cy, tileSize - 1, tileSize - 1)
      }

      // Label (if room) — only on the first cell so multi-cell connectors aren't noisy
      if (idx === 0 && tileSize > 20 && connector.targetTemplateName) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(cx - 5, cy - 12, tileSize + 10, 12)
        ctx.fillStyle = '#ff88ff'
        ctx.font = `bold 9px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText(connector.targetTemplateName.slice(0, 10), cx + tileSize / 2, cy - 5)
      }
    })
  }

  // Draw placed entities last — each a single `>` glyph colored by role (blueprint legend).
  for (const entity of entities) {
    const combat = entity.kind === 'enemy' ? enemyCombat.get(entity.id) : undefined
    if (isDeadEnemy(entity, combat)) continue // hidden until it respawns
    const ex = offsetX + entity.col * tileSize
    const ey = offsetY + entity.row * tileSize
    // A brush-placed unit's manual `tileOverride` RE-HOMES onto the active style (resolveEntityDraw) so it
    // RESKINS like a placed asset instead of freezing to the style it was placed in; no pin → the style-
    // derived default (entityStyleOverride), byte-identical to before.
    const edv = resolveEntityDraw(entityKind(entity.kind), style, entity.tileOverride, entityStyleOverride(entity, style), '>', topRoleColor(entity, quests))
    // genderize so npcs show their male/female figure in top view too (the ASCII `>` fallback and 👾
    // pass through unchanged); matches iso/2d.
    if (edv.image) drawStyledImage(ctx, edv.image, ex + tileSize / 2, ey + tileSize / 2, tileSize)
    else drawTopArrow(ctx, ex, ey, tileSize, edv.color, genderize(edv.char, entity.variant))
    // Only DAMAGED enemies show a bar in the overview — a full-HP mob adds nothing but clutter (its
    // glyph already marks its position); matches the engaged/damaged gate iso + 2D use for vitals.
    if (entity.kind === 'enemy') { const f = hpFraction(entity, combat); if (f < 0.999) drawHpBar(ctx, ex + tileSize / 2, ey - 3, tileSize, 3, f) }
    drawQuestMarker(ctx, entityQuestMarker(entity, quests), ex + tileSize / 2, ey - tileSize * 0.9, Math.max(12, tileSize * 1.1))
  }

  // ─── Cell-hover outline — a DIM/translucent square on the cell under the cursor, drawn OVER the
  //     entities/roofs so it shows even when a unit occupies the cell (in addition to the unit reticle),
  //     keeping the floor tile targetable. Mirrors the yellow per-cell selection but subtle. ──────────
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    const hx = offsetX + hoveredCell.col * tileSize
    const hy = offsetY + hoveredCell.row * tileSize
    ctx.strokeRect(hx + 1, hy + 1, tileSize - 3, tileSize - 3)
  }

  // Floating "+dmg" hit markers (cell-centred in top space).
  for (const marker of hitMarkers) {
    const mx = offsetX + (marker.col + 0.5) * tileSize
    const my = offsetY + marker.row * tileSize
    drawHitMarker(ctx, mx, my, marker, now)
  }

  // ─── NIGHT LIGHTING ─────────────────────────────────────────────────
  if (dayNight === 'night') {
    const lamps = collectLampGlows(
      grid,
      (c, r) => ({ x: offsetX + (c + 0.5) * tileSize, y: offsetY + (r + 0.5) * tileSize }),
      tileSize * LAMP_GLOW.radiusTiles,
      0,
      w,
      h,
    )
    drawNightLighting(ctx, w, h, lamps)
  }

  // UI
  ctx.fillStyle = isDebugMode() ? '#ff6666' : '#55aaff'
  ctx.font = `bold 16px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(isDebugMode() ? 'TOP VIEW + DEBUG' : 'TOP VIEW', w / 2, 20)

  ctx.fillStyle = '#888'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`WASD move | Scroll zoom (${zoom.toFixed(1)}x) | Click to select`, w / 2, 38)

  // Selection info
  if (selectedCells.size > 0) {
    ctx.fillStyle = '#ffff00'
    ctx.fillText(`${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''} selected`, w / 2, 54)
  }

  ctx.fillStyle = '#666'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`${grid.cols}x${grid.rows} grid | Cell: ${playerCellCol},${playerCellRow}`, w / 2, h - 15)
}

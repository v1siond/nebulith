import { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { buildingRect, doorCellFor, gridBuildingFacing } from '@/engine/buildingEditor'
import { assetCellTransform } from '@/engine/cellAnimation'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { topRoleColor } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { GROUND_COLORS } from '@/levels/village'
import { Connector } from '@/lib/api'
import { ASCII_FONT, BUILDING_BADGES, type DayNight, LAMP_GLOW, applyCellTransform, clampCameraAxis, collectLampGlows, debugCellCaptions, debugLabelColors, drawHitMarker, drawHpBar, drawNightLighting, drawQuestMarker, drawStyledImage, grassShade, cellFill, isDeadEnemy, isDebugMode, resolveDraw } from './shared'
import { ASCII_STYLE, assetKind, entityKind, enemyTileId, genderize, groundKind, type Style } from '@/game/artStyle'


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
        // Ground tile
        const tileType = grid.ground[row]?.[col] || 'grass'
        const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass
        char = colors.char[0]
        fg = colors.fg[0]
        kind = groundKind(tileType)
        // Grass AND the rocky cave floor vary per-cell into natural tones (deterministic hash); flat else.
        grassy = tileType.includes('grass') || kind === 'cavefloor'
        bg = grassy ? grassShade(colors.bg[0], col, row) : colors.bg[0]
      }

      // Resolve the active art style (ASCII passthrough → the defaults above, unchanged).
      const dv = resolveDraw(kind, style, asset?.tileOverride, char, fg)

      // Draw cell — a reskin tints the blueprint cell at the tile hue (agrees with iso/2D), but grass
      // keeps its per-cell shade so a field isn't one flat green ("grass is just color"); ASCII → bg.
      ctx.fillStyle = cellFill(dv.tint, bg, grassy, col, row)
      ctx.fillRect(x, y, tileSize - 1, tileSize - 1)

      ctx.fillStyle = dv.color
      // Authored frame animation moves the asset GLYPH (not its cell backing) around its centre.
      const gx = x + tileSize / 2, gy = y + tileSize / 2
      const ctTop = asset ? assetCellTransform(asset.cellAnim, now) : null
      if (ctTop) applyCellTransform(ctx, gx, gy, ctTop, tileSize, tileSize)
      if (dv.image) drawStyledImage(ctx, dv.image, gx, gy, tileSize)
      else ctx.fillText(dv.char, gx, gy)
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
  const ROOF_TOP_COLORS: Record<string, { fill: string; ridge: string; edge: string }> = {
    house: { fill: '#c0463c', ridge: '#e0786a', edge: '#7a2a24' },
    'big-house': { fill: '#b0673a', ridge: '#d08f5a', edge: '#6e3f22' },
    store: { fill: '#3a7ea5', ridge: '#5fa6cc', edge: '#234e66' },
    hospital: { fill: '#3aa55a', ridge: '#5fcc80', edge: '#23663a' },
  }
  const roofPalette = (t: string) => ROOF_TOP_COLORS[t] ?? { fill: '#a0644a', ridge: '#c08a6a', edge: '#5e3a2a' }
  for (const b of grid.buildings ?? []) {
    const topRow = b.row - (b.height - 1)
    if (b.col + b.length <= startCol || b.col >= endCol || topRow + b.height <= startRow || topRow >= endRow) continue
    const rx = offsetX + b.col * tileSize
    const ry = offsetY + topRow * tileSize
    const rw = b.length * tileSize
    const rh = b.height * tileSize
    const pal = roofPalette(b.type)
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
    // door notch (dark) centred on the actual walkable DOOR cell, on the road-facing edge: facing 0 =
    // horizontal street, 1 = vertical road; facadeOnBack flips near/far so the notch sits toward the
    // road. Centring on doorCellFor (not the roof mid-width) keeps even-length buildings aligned too.
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
    // Type signage (STORE / HOSPITAL) on the roof — same badge the iso + 2D views show, so a shop /
    // clinic reads at a glance on the top-down map too.
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

  // Town-square fountain (top-down): a round blue basin spanning its footprint, drawn over the
  // paved plaza as ONE fountain (the centre prop carries the basin span). Overlays the per-cell pass.
  for (const a of grid.assets) {
    if (a.type !== 'fountain' || !a.footprint) continue
    const f = a.footprint
    if (a.col + f < startCol || a.col - f > endCol || a.row + f < startRow || a.row - f > endRow) continue
    const cx = offsetX + (a.col + 0.5) * tileSize
    const cy = offsetY + (a.row + 0.5) * tileSize
    drawTopTownFountain(ctx, cx, cy, f * tileSize * 0.5 * 0.94, now)
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
  const pdv = resolveDraw('player', style, undefined, dirChar, '#000000')
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

      // Draw portal symbol
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${tileSize * 0.6}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('◊', cx + tileSize / 2, cy + tileSize / 2)

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
    const bdvOverride = entity.tileOverride ?? (entity.kind === 'enemy' ? enemyTileId(entity.enemyType, style) : undefined)
    const edv = resolveDraw(entityKind(entity.kind), style, bdvOverride, '>', topRoleColor(entity, quests))
    // genderize so npcs show their male/female figure in top view too (the ASCII `>` fallback and 👾
    // pass through unchanged); matches iso/2d.
    if (edv.image) drawStyledImage(ctx, edv.image, ex + tileSize / 2, ey + tileSize / 2, tileSize)
    else drawTopArrow(ctx, ex, ey, tileSize, edv.color, genderize(edv.char, entity.variant))
    if (entity.kind === 'enemy') drawHpBar(ctx, ex + tileSize / 2, ey - 3, tileSize, 3, hpFraction(entity, combat))
    drawQuestMarker(ctx, entityQuestMarker(entity, quests), ex + tileSize / 2, ey - tileSize * 0.9, Math.max(12, tileSize * 1.1))
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

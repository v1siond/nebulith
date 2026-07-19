import { GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { assetCellTransform } from '@/engine/cellAnimation'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { topRoleColor } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { Connector } from '@/lib/api'
import { ASCII_FONT, type DayNight, applyCellTransform, clampCameraAxis, collectLampGlows, debugCellCaptions, debugLabelColors, drawConnectorMarker, drawHitMarker, drawHpBar, drawNightLighting, drawQuestMarker, drawStyledImage, drawFlatTileForShape, SINGLE_TILE_FRAC, fillTintedGlyph, grassShade, cellFill, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, labelTileImage, labelTileRecolor, tileImage } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { resolveAssetAnimation } from './assetAnimation'
import { DEPTH_CELL_STEP } from './isoBlock'
import { getStack } from '@/engine/cellStack'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { applyPose } from '@/engine/tileset/pose'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, type Style } from '@/game/artStyle'


/** TOP (blueprint) view: an entity is a single `>` glyph colored by role — yellow player,
 *  red enemy, and NPCs blue / green (offers a quest) / purple (quest in progress). The
 *  glyph is style-resolved (emoji reskin swaps `>` for 👾/🧑/…); ASCII keeps `>`. */
function drawTopArrow(ctx: CanvasRenderingContext2D, x: number, y: number, tileSize: number, color: string, glyph: string = '>'): void {
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




// Top-down 2D blueprint view - flat, no height, just positions. An asset cell's backing is now the tile's
// OWN colour (darkened for glyph legibility) — no per-type backdrop map; colour comes purely from tile data.


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

  // Build a map of ONE asset per cell for quick lookup — the tile shown from above. DRAW-PRIORITY (CSS z-index)
  // decides the winner: a HIGHER zIndex takes the cell (draws on top). `>=` keeps the LAST-placed asset winning
  // when priorities tie — so with every zIndex at the default 0 this is byte-identical to the old unconditional
  // "last write wins" (the roof, placed last, still wins its footprint cell).
  const assetMap: Record<string, GridAsset> = {}
  for (const asset of grid.assets) {
    const key = `${asset.col},${asset.row}`
    const cur = assetMap[key]
    if (!cur || (asset.zIndex ?? 0) >= (cur.zIndex ?? 0)) assetMap[key] = asset
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
        // Show the cell's OWN tile for its LABEL — the emoji in emoji mode (a composition cell resolves its
        // per-part emoji, never the kind's whole-tree image and never ascii-in-emoji), else the ascii glyph.
        // resolveAssetDraw below falls back to THIS char since the composition kind has no emoji of its own.
        char = (style.id === 'emoji' && asset.label ? EMOJI_TILESET[asset.label]?.char : undefined) ?? asset.art[0] ?? '?'
        fg = asset.color ?? '#cccccc'
        // Back the footprint cell with the tile's OWN colour (darkened below so the glyph reads), not a
        // per-type dark map — so Top shows the same colour ISO/2D do, driven purely by the tile's data.
        bg = asset.color ?? '#141414'
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
      // Darken an ASSET cell's tile-colour backing so its glyph (drawn below in the full tile colour) reads;
      // ground cells keep their resolved fill. Matches the 2D labeled-cell backing.
      if (asset) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
        ctx.fillRect(x, y, tileSize - 1, tileSize - 1)
      }

      ctx.fillStyle = dv.color
      // "z position" slides an asset along the iso diagonal; from ABOVE that projects to the ground-plane cell
      // delta (zDir's DEPTH_CELL_STEP × the magnitude), so the tile ART slides in the footprint. The cell BACKING
      // stays put (like iso/2D keep the ground cell under a slid prop). 0 / bare ground → no shift, unchanged.
      const zStep = asset ? DEPTH_CELL_STEP[asset.zDir ?? 'right-up'] : null
      const zAmt = asset?.zOffset ?? 0
      const gx = x + tileSize / 2 + (zStep ? zAmt * zStep.dc * tileSize : 0)
      const gy = y + tileSize / 2 + (zStep ? zAmt * zStep.dr * tileSize : 0)
      // Live TILE ANIMATION overrides for THIS frame, scoped to the top view + active style. null → the effective
      // asset IS `asset` and no shift/opacity change (byte-identical). `dAsset` carries the animated colour/zoom/
      // width/height so the draw reads them; the shift + opacity wrap the tile draw (not the cell backing above).
      const assetAnim = asset ? resolveAssetAnimation(asset, now, style, 'top', dayNight) : null
      const dAsset = assetAnim ? assetAnim.asset : asset
      const animShiftX = assetAnim ? assetAnim.x * tileSize : 0
      const animShiftY = assetAnim ? assetAnim.y * tileSize : 0
      const animWrap = !!assetAnim && (animShiftX !== 0 || animShiftY !== 0 || assetAnim.opacity < 1)
      if (animWrap) {
        ctx.save()
        ctx.translate(animShiftX, -animShiftY)
        if (assetAnim!.opacity < 1) ctx.globalAlpha *= assetAnim!.opacity
      }
      const ctTop = asset ? assetCellTransform(asset.cellAnim, now) : null
      if (ctTop) applyCellTransform(ctx, gx, gy, ctTop, tileSize, tileSize)
      // A composition cell's LABEL resolves its OWN backend image directly (mirrors the char lookup
      // above) — ascii: a tint-target, ALWAYS recoloured to the resolved tint; emoji: an already-coloured
      // PNG, NEVER recoloured. Takes priority over the kind-driven `dv.image` (which already happens to
      // agree for building parts, since their label IS their kind) so a label with backend art renders it
      // even where kind-resolution can't (e.g. per-part tree labels collapse to the generic 'tree' kind).
      const labelImage = asset?.label ? labelTileImage(asset.label, style) : undefined
      const img = labelImage ?? dv.image
      // The tile's NORMAL overhead draw — the label/kind image, or the glyph. Shared by the plain square path
      // and the circle path so a rounded footprint shows the SAME painting; only its form changes.
      const drawTopTile = (): void => {
        if (img) {
          // Per-view tile size (byte-identical when unset: old tileSize base), then per-element dims (#77/#78).
          const vt = style.id === 'emoji' && asset ? EMOJI_TILESET[assetKind(asset)] : undefined
          const d = resolveAssetDrawSize(tileSize * (resolveTileSize(vt, 'top') ?? 1), dAsset ?? {}, 'overhead')
          const pose = asset?.pose ?? resolveTilePose(vt, 'top') // per-asset pose (inspector x/y/rotate) wins; else the tileset-kind pose
          const recolor = labelImage ? labelTileRecolor(style, dAsset?.color ?? '#cccccc') : dAsset?.color
          // DISPLAY = "single": draw ONE smaller centered tile inside the plain cell (the cell backing already
          // painted above shows around it), matching the iso/2D "single tile inside the block" look. Absent → 1×.
          const frac = asset?.settings?.display === 'single' ? SINGLE_TILE_FRAC : 1
          if (pose) {
            ctx.save(); ctx.translate(gx, gy); applyPose(ctx, pose, 1, tileSize)
            drawStyledImage(ctx, img, 0, 0, d.w * frac, false, recolor, d.h * frac)
            ctx.restore()
          } else {
            drawStyledImage(ctx, img, gx, gy, d.w * frac, false, recolor, d.h * frac) // #80 colour override tints the sprite
          }
          return
        }
        // GLYPH tile (no image): honour the per-view tile size + per-element dims + the colour override,
        // mirroring topdown's 2D glyph path (here the overhead view → Width × Depth). A bare ground glyph
        // (no asset, dims 1, no tint) falls through fillTintedGlyph to a plain centred fillText at the old
        // font size — byte-identical to before.
        const vt = style.id === 'emoji' && asset ? EMOJI_TILESET[assetKind(asset)] : undefined
        const d = resolveAssetDrawSize(fontSize * (resolveTileSize(vt, 'top') ?? 1), dAsset ?? {}, 'overhead')
        const pose = asset?.pose ?? resolveTilePose(vt, 'top') // per-asset pose (inspector x/y/rotate) wins; else the tileset-kind pose
        const strength = dAsset?.color ? 0.85 : 0 // colour-emoji ignore fillStyle → wash the tint on
        ctx.font = `bold ${d.h}px ${ASCII_FONT}`
        ctx.save()
        ctx.translate(gx, gy)
        if (pose) applyPose(ctx, pose, 1, tileSize)
        if (d.w !== d.h) ctx.scale(d.w / d.h, 1) // non-uniform Width vs Depth, like the image branch
        fillTintedGlyph(ctx, dv.char, 0, 0, d.h, dAsset?.color, strength)
        ctx.restore()
        ctx.font = `bold ${fontSize}px ${ASCII_FONT}` // restore the loop's shared font for the next cell
      }

      // SHAPE = "circle" is a FORM modifier, not a repaint (the overhead analogue of the iso ball): CLIP the SAME
      // tile to a circle so its painting stays and only the footprint silhouette rounds, then overlay a soft
      // sphere shade (the square cell backing painted above frames it). Routed through the shared shape dispatch
      // (drawFlatTileForShape) — the SAME map iso uses — so 2D/Top never branch on shape; absent/'square' → plain.
      drawFlatTileForShape(ctx, asset?.shape, drawTopTile, gx, gy, tileSize * 0.5, tileSize * 0.5)
      if (ctTop) ctx.restore()
      if (animWrap) ctx.restore() // pop the tile-animation shift/opacity wrap

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

  // A BUILDING is just TILES: a pre-built building is stamped as its composition's per-cell assets, so the
  // overhead view already draws them through the per-cell pass above — each footprint cell shows the TOP of
  // its column, the ROOF tile (placed last, so it wins the cell in the assetMap), giving a per-cell roof
  // read from above with no building-specific drawer and no grouped-building array.


  // Collision overlay — drawn LAST (over the per-cell building tiles + fountains) so it shows on BUILDING
  // cells too. Debug overlay OR the lighter "show collisions" toggle.
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
      tileSize,
      0,
      w,
      h,
      { time: now, style, view: 'top' },
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

import { FLOOR_TYPE, type GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { IsoDiagonal, ThicknessReach } from '@/engine/render/isoBlock'
import type { TilePose } from '@/engine/tileset/pose'

/**
 * A MAP, BETWEEN THE EDITOR'S GRID AND THE ROWS THE BACKEND KEEPS.
 *
 * Phase 3 replaced three JSON blobs with `maps`, `grids`, `cells` and `cell_tiles`. This is the
 * translation at that boundary, and it is the only one: a payload key IS a column name, spelled the
 * way the column is spelled, so there is no second vocabulary to keep in step.
 *
 * ## What travels, and what does not
 *
 * A tile speaks by LABEL, never by row id. A style is only a different picture for the same label, so
 * the engine resolves what to draw by label and the backend resolves the label to a row.
 *
 * Three fields the editor carries have no column, and the spec says where each goes (§9):
 *
 *   - `baseShadow` is DELETED. Shadows come from the sun, not from a flag on a tile.
 *   - `cellPart` becomes `tiles.autotile_slot`. It belongs to the TILE, not to a placement, and its
 *     own comment says it never touches the renderers.
 *   - `settings.collision` becomes `collision_boxes`, in phase 4. A tile's own served collision still
 *     applies meanwhile, because that is what `declaredBoxes` falls back to.
 *
 * ## Two things that are converted, once, here
 *
 * ROTATION. The editor holds radians and the control shows degrees; the column is DEGREES, because a
 * value copied between two places that disagree is silently 57x wrong. The conversion happens at this
 * boundary and nowhere else.
 *
 * SPAN. The editor counts cells BEYOND the anchor and the column counts cells INCLUDING it, so a tile
 * that spans nothing extra is 0 there and 1 here. `spanForward` already counted inclusively, which is
 * part of why the two ever got confused.
 */

/** The four iso diagonals, in the order the columns name them. */
const REACHES: ReadonlyArray<[IsoDiagonal, 'thickness_lu' | 'thickness_ru' | 'thickness_ld' | 'thickness_rd']> = [
  ['left-up', 'thickness_lu'],
  ['right-up', 'thickness_ru'],
  ['left-down', 'thickness_ld'],
  ['right-down', 'thickness_rd'],
]

/** Quarter turns, as the engine counts them, against the headings the column admits. */
const HEADINGS = ['e', 's', 'w', 'n'] as const

export interface MapPayload {
  map?: Record<string, unknown>
  grid?: Record<string, unknown>
  cells: CellPayload[]
}

export interface CellPayload {
  col: number
  row: number
  ground_height?: number
  texture_label?: string | null
  tiles: Record<string, unknown>[]
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Decimals travel as strings so a value survives the trip without a float rounding it. */
const dec = (v: number): string => String(v)

/** A decimal off the wire. It travels as a STRING so no float rounds it, so every read coerces. */
const fromDec = (v: unknown, fallback: number): number => {
  if (v == null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const degrees = (radians: number): number => (radians * 180) / Math.PI
const radians = (degrees: number): number => (degrees * Math.PI) / 180

/** What a tile draws as. A style owns only its picture, so this is the whole identity on the wire. */
export function labelOf(asset: GridAsset): string | undefined {
  return asset.label ?? asset.tileOverride ?? asset.tileKey ?? asset.type
}

/** One placed tile, as the columns spell it. */
export function tileToPayload(asset: GridAsset): Record<string, unknown> {
  const pose: TilePose = asset.pose ?? {}
  const reach: ThicknessReach = asset.thickness ?? {}
  const settings = asset.settings ?? {}

  const out: Record<string, unknown> = {
    label: labelOf(asset),
    stack_level: Math.round(num(asset.heightLevel, 0)),

    width: dec(num(asset.scaleX, 1)),
    // THE ONE HEIGHT, in blocks. The editor keeps a block height and a vertical stretch and multiplies
    // them to show a single number; the column IS that single number (D6).
    height: dec(num(asset.height, 1) * num(asset.scaleY, 1)),
    depth: dec(num(asset.depth, 1)),

    span_forward: Math.round(num(asset.spanForward, 1)),
    span_back: Math.round(num(asset.spanBack, 0)) + 1,
    span_perp: Math.round(num(asset.spanPerp, 0)) + 1,
    span_perp_back: Math.round(num(asset.spanPerpBack, 0)) + 1,

    nudge_x: dec(num(pose.dx, 0)),
    nudge_y: dec(num(pose.dy, 0)),
    rotation: dec(degrees(num(pose.rot, 0))),
    mirror: pose.flip === true,
    art_scale: dec(num(pose.scale, 1)),

    slide_amount: dec(num(asset.zOffset, 0)),
    draw_order: Math.round(num(asset.zIndex, 0)),

    opacity: dec(num(asset.opacity, 1)),
    brightness: dec(num(asset.brightness, 1)),

    act_as_tile: settings.actAsTile !== false,
    display: settings.display === 'single' ? 'single' : 'all_faces',
    transparent: settings.transparent === true,
    fade_near: settings.fadeNear === true,
    cutaway_near: settings.cutawayRoof === true,
    shape: asset.shape === 'circle' || asset.shape === 'cone' ? asset.shape : 'square',
  }

  for (const [dir, column] of REACHES) {
    out[column] = dec(num(reach[dir], 1))
  }

  // Absent means absent, and a null in a nullable column is not the same as a default in a defaulted
  // one. Only what the tile actually carries is stated.
  if (asset.spanAxis) out.span_axis = asset.spanAxis
  if (asset.zDir) out.slide_direction = asset.zDir
  if (asset.color) out.color = asset.color
  if (asset.sideColor) out.side_color = asset.sideColor
  if (asset.bgColor) out.bg_color = asset.bgColor
  if (typeof settings.minAlpha === 'number') out.min_alpha = dec(settings.minAlpha)
  if (typeof pose.muzzle === 'number') out.muzzle = dec(pose.muzzle)
  if (settings.badge?.text) out.sign_text = settings.badge.text
  if (settings.badge?.color) out.sign_color = settings.badge.color
  if (typeof asset.flow === 'number' && HEADINGS[asset.flow % 4]) out.water_heading = HEADINGS[asset.flow % 4]

  return out
}

/** The reverse: a served tile, as the editor's asset. */
export function payloadToTile(tile: Record<string, unknown>, col: number, row: number): GridAsset {
  const pose: TilePose = {}
  if (fromDec(tile.nudge_x, 0) !== 0) pose.dx = fromDec(tile.nudge_x, 0)
  if (fromDec(tile.nudge_y, 0) !== 0) pose.dy = fromDec(tile.nudge_y, 0)
  if (fromDec(tile.rotation, 0) !== 0) pose.rot = radians(fromDec(tile.rotation, 0))
  if (tile.mirror === true) pose.flip = true
  if (fromDec(tile.art_scale, 1) !== 1) pose.scale = fromDec(tile.art_scale, 1)
  if (tile.muzzle != null) pose.muzzle = fromDec(tile.muzzle, 0)

  const reach: ThicknessReach = {}
  for (const [dir, column] of REACHES) {
    const value = fromDec(tile[column], 1)
    if (value !== 1) reach[dir] = value
  }

  const label = typeof tile.label === 'string' ? tile.label : undefined

  const settings: Record<string, unknown> = {}
  if (tile.display === 'single') settings.display = 'single'
  if (tile.transparent === true) settings.transparent = true
  if (tile.fade_near === true) settings.fadeNear = true
  if (tile.cutaway_near === true) settings.cutawayRoof = true
  if (tile.act_as_tile === false) settings.actAsTile = false
  if (tile.min_alpha != null) settings.minAlpha = fromDec(tile.min_alpha, 1)
  if (tile.sign_text) settings.badge = { text: String(tile.sign_text), color: String(tile.sign_color ?? '#ffffff') }

  const asset: GridAsset = {
    art: [''],
    col,
    row,
    type: label ?? 'decoration',
    label,
    tileKey: label,
    heightLevel: Math.round(fromDec(tile.stack_level, 0)),
    // The one height comes back whole: the column IS the number, so nothing multiplies it again.
    height: fromDec(tile.height, 1),
    scaleX: fromDec(tile.width, 1),
    depth: fromDec(tile.depth, 1),
    spanForward: Math.round(fromDec(tile.span_forward, 1)),
    zIndex: Math.round(fromDec(tile.draw_order, 0)),
    opacity: fromDec(tile.opacity, 1),
    brightness: fromDec(tile.brightness, 1),
    shape: tile.shape === 'circle' || tile.shape === 'cone' ? tile.shape : undefined,
  }

  // Counts come back as counts: the editor holds cells BEYOND the anchor.
  const back = Math.round(fromDec(tile.span_back, 1)) - 1
  const perp = Math.round(fromDec(tile.span_perp, 1)) - 1
  const perpBack = Math.round(fromDec(tile.span_perp_back, 1)) - 1
  if (back > 0) asset.spanBack = back
  if (perp > 0) asset.spanPerp = perp
  if (perpBack > 0) asset.spanPerpBack = perpBack

  if (tile.span_axis) asset.spanAxis = tile.span_axis as IsoDiagonal
  if (tile.slide_direction) asset.zDir = tile.slide_direction as IsoDiagonal
  if (fromDec(tile.slide_amount, 0) !== 0) asset.zOffset = fromDec(tile.slide_amount, 0)
  if (tile.color) asset.color = String(tile.color)
  if (tile.side_color) asset.sideColor = String(tile.side_color)
  if (tile.bg_color) asset.bgColor = String(tile.bg_color)
  if (Object.keys(pose).length) asset.pose = pose
  if (Object.keys(reach).length) asset.thickness = reach
  if (Object.keys(settings).length) asset.settings = settings as GridAsset['settings']

  const heading = HEADINGS.indexOf(tile.water_heading as (typeof HEADINGS)[number])
  if (heading >= 0) asset.flow = heading

  return asset
}

/**
 * THE WHOLE GRID, as the map API takes it.
 *
 * A cell row exists where the map says anything about that square: its ground, its height, or a tile
 * standing in it. A square nobody has touched gets no row, which is what keeps a 40x40 map from
 * writing 1600 rows of nothing.
 */
export function gridToMapPayload(
  grid: IsometricGrid,
  /**
   * Assets that are NOT tiles standing in a cell.
   *
   * Entities, quests, the active style and the cell triggers ride inside the asset array as marked
   * records, because they had no field of their own. They get real tables in phases 8, 10 and 11; until
   * then they keep riding the template and must not be written as cells, or a quest marker becomes a
   * tile standing on the map.
   */
  isMarker: (asset: GridAsset) => boolean = () => false,
): MapPayload {
  const ground = grid.groundSlugs()
  const byCell = new Map<string, GridAsset[]>()

  for (const asset of grid.assets) {
    if (isMarker(asset)) continue

    const key = `${asset.col},${asset.row}`
    const at = byCell.get(key)
    at ? at.push(asset) : byCell.set(key, [asset])
  }

  const cells: CellPayload[] = []

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const here = byCell.get(`${col},${row}`) ?? []
      const texture = ground[row]?.[col]
      const height = grid.height[row]?.[col] ?? 0

      if (!here.length && !texture && !height) continue

      cells.push({
        col,
        row,
        ground_height: Math.round(height),
        texture_label: texture ?? null,
        tiles: [...here]
          .sort((a, b) => num(a.heightLevel, 0) - num(b.heightLevel, 0))
          .map(tileToPayload),
      })
    }
  }

  return {
    grid: {
      cols: grid.cols,
      rows: grid.rows,
      cell_size: grid.cellSize,
      iso_scale: dec(grid.isoScale),
      slab_blocks: grid.slabBlocks,
    },
    cells,
  }
}

/** The reverse: a served map, onto the grid the editor already has. */
export function applyMapPayload(payload: MapPayload, grid: IsometricGrid): IsometricGrid {
  const served = payload.grid ?? {}

  // The map's own shape, read back. It saves with the map and used to travel nowhere.
  if (served.cell_size != null) grid.cellSize = fromDec(served.cell_size, grid.cellSize)
  if (served.iso_scale != null) grid.isoScale = fromDec(served.iso_scale, grid.isoScale)
  if (served.slab_blocks != null) grid.slabBlocks = fromDec(served.slab_blocks, grid.slabBlocks)

  const assets: GridAsset[] = []

  for (const cell of payload.cells ?? []) {
    grid.setHeight(cell.col, cell.row, fromDec(cell.ground_height, 0))

    for (const tile of cell.tiles ?? []) {
      assets.push(payloadToTile(tile, cell.col, cell.row))
    }
  }

  grid.setAssets(assets)
  return grid
}

/** A floor is a regular tile, so this is only the discriminator the stack helpers look for. */
export const isFloor = (asset: GridAsset): boolean => asset.type === FLOOR_TYPE

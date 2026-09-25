import { resolveTileHeight } from '@/engine/tileset/tileHeight'
import { carriedColumns, defaultOf, numericDefault } from '@/lib/tileDefaults'
import { FLOOR_TYPE, type GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import type { IsoDiagonal, ThicknessReach } from '@/engine/render/isoBlock'
import { poseDeviates, type TilePose } from '@/engine/tileset/pose'

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

/**
 * WHAT A COLUMN SAYS WHEN THE PLACEMENT DOES NOT, on both sides of this boundary.
 *
 * Every literal that used to sit in a `??` here was the engine holding a second opinion about a value
 * the database already states. They are unreachable in practice, because every writer states every
 * setting now, but an unreachable literal is still the thing that wins the day something stops stating
 * its value, and that is how the ground came to be a field of cubes.
 */
const columnNumber = (field: string): number => numericDefault(field)

/** The same, for the four span counts, which the columns count inclusively and the editor counts beyond. */
const beyondAnchor = (field: string): number => numericDefault(field) - 1

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
    // THE COLUMNS THIS FILE DOES NOT RESHAPE, exactly as they came in. First in the literal on purpose:
    // anything named below overrides one, so there is never a question about which of two spellings is
    // the value.
    ...asset.columns,

    label: labelOf(asset),
    stack_level: Math.round(num(asset.heightLevel, 0)),

    width: dec(num(asset.width, columnNumber('width'))),
    // THE ONE HEIGHT, in blocks. The editor keeps a block height and a vertical stretch and multiplies
    // them to show a single number; the column IS that single number (D6).
    height: dec(resolveTileHeight(asset)),
    depth: dec(num(asset.depth, columnNumber('depth'))),

    span_forward: Math.round(num(asset.spanForward, columnNumber('span_forward'))),
    span_back: Math.round(num(asset.spanBack, beyondAnchor('span_back'))) + 1,
    span_perp: Math.round(num(asset.spanPerp, beyondAnchor('span_perp'))) + 1,
    span_perp_back: Math.round(num(asset.spanPerpBack, beyondAnchor('span_perp_back'))) + 1,

    nudge_x: dec(num(pose.dx, columnNumber('nudge_x'))),
    nudge_y: dec(num(pose.dy, columnNumber('nudge_y'))),
    rotation: dec(degrees(num(pose.rot, radians(columnNumber('rotation'))))),
    mirror: pose.flip === true,
    art_scale: dec(num(pose.scale, columnNumber('art_scale'))),

    slide_amount: dec(num(asset.zOffset, columnNumber('slide_amount'))),
    draw_order: Math.round(num(asset.zIndex, columnNumber('draw_order'))),

    opacity: dec(num(asset.opacity, columnNumber('opacity'))),
    brightness: dec(num(asset.brightness, columnNumber('brightness'))),

    act_as_tile: settings.actAsTile !== false,
    display: settings.display === 'single' ? 'single' : 'all_faces',
    transparent: settings.transparent === true,
    fade_near: settings.fadeNear === true,
    cutaway_near: settings.cutawayRoof === true,
    shape: asset.shape === 'circle' || asset.shape === 'cone' ? asset.shape : 'square',
  }

  for (const [dir, column] of REACHES) {
    out[column] = dec(num(reach[dir], columnNumber(column)))
  }

  // A nullable column is the one case where absent is the value: `span_axis` has no default, and a
  // tile that spans nothing has no axis. Everything with a default is stated above, always.
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

  // THE MOTION, which had no column at all until now and so was simply dropped: a fountain rose and
  // faded when it was stamped and sat still forever after a reload. Absent is the value for a tile that
  // does not move, so a nullable column and no default, like `span_axis`.
  if (asset.animations?.length) {
    out.animations = asset.animations
    out.placed_at = dec(num(asset.placedAt, 0))
  }

  return out
}

/**
 * The reverse: a served tile, as the editor's asset.
 *
 * `groundLabel` is the cell's own `texture_label`, and it is what tells a floor apart from anything else
 * standing in the same square. The grid answers "what is the ground here" from the placement's TYPE, and
 * nothing on the wire carries that type, so a floor loaded as a plain tile left the grid with no ground
 * at all: no floor index, no ground slugs, and every ground-shaped question answered empty.
 */
export function payloadToTile(tile: Record<string, unknown>, col: number, row: number, groundLabel?: string | null): GridAsset {
  // EVERY field, stated. A setting is never implied by its own absence (law 6): the column has a
  // default, the payload carries it, and a renderer that receives an absent field is a renderer that
  // has to invent one. That invention is the defect this phase exists to delete.
  const pose: TilePose = {
    dx: fromDec(tile.nudge_x, columnNumber('nudge_x')),
    dy: fromDec(tile.nudge_y, columnNumber('nudge_y')),
    rot: radians(fromDec(tile.rotation, columnNumber('rotation'))),
    flip: tile.mirror === true,
    scale: fromDec(tile.art_scale, columnNumber('art_scale')),
  }
  if (tile.muzzle != null) pose.muzzle = fromDec(tile.muzzle, 0)

  // A REACH OF 1 IS NOT A THINNING, IT IS THE ABSENCE OF ONE, and the difference is not cosmetic.
  //
  // The columns are always stated, which is right: every one of the four has a default and the wire
  // carries it. On the engine's side, though, `thickness` present means "this tile is thinner than its
  // cell", and the live stamp says so by leaving it undefined. Building a full map of 1s here made the
  // two paths disagree, and every renderer fast path that asks "does this tile deviate at all?" answered
  // yes for all of them, so a whole map's worth of tiles took the slow branch every frame.
  const reach: ThicknessReach = {}
  let thinned = false
  for (const [dir, column] of REACHES) {
    const value = fromDec(tile[column], columnNumber(column))
    if (value >= 1) continue
    reach[dir] = value
    thinned = true
  }

  const label = typeof tile.label === 'string' ? tile.label : undefined

  const settings: Record<string, unknown> = {
    display: tile.display === 'single' ? 'single' : 'all_faces',
    transparent: tile.transparent === true,
    fadeNear: tile.fade_near === true,
    cutawayRoof: tile.cutaway_near === true,
    actAsTile: tile.act_as_tile !== false,
  }
  // `min_alpha` is nullable and has no column default, and this branch runs only when the row states
  // one, so there is nothing here to fall back to. Borrowing another column's default would be a made-up
  // number wearing a lookup.
  if (tile.min_alpha != null) settings.minAlpha = Number(tile.min_alpha)
  // The sign and its colour are two nullable columns. A sign with no colour of its own keeps none, and
  // the badge drawer uses its own ink; inventing a white here put one on the row as though it was meant.
  if (tile.sign_text) {
    settings.badge = { text: String(tile.sign_text), color: tile.sign_color ? String(tile.sign_color) : '' }
  }

  const columns: Record<string, unknown> = {}
  for (const column of carriedColumns()) {
    columns[column] = tile[column] !== undefined ? tile[column] : defaultOf(column)
  }

  const asset: GridAsset = {
    art: [''],
    col,
    row,
    columns,
    // The ground course of the square it sits in is the floor. A tile of the same label standing at a
    // higher level is a tile, not the ground.
    type: label && label === groundLabel && Math.round(fromDec(tile.stack_level, 0)) === 0 ? FLOOR_TYPE : (label ?? 'decoration'),
    label,
    tileKey: label,
    heightLevel: Math.round(fromDec(tile.stack_level, 0)),
    // The one height comes back whole: the column IS the number, so nothing multiplies it again.
    height: fromDec(tile.height, columnNumber('height')),
    width: fromDec(tile.width, columnNumber('width')),
    depth: fromDec(tile.depth, columnNumber('depth')),
    spanForward: Math.round(fromDec(tile.span_forward, columnNumber('span_forward'))),
    // Counts come back as counts: the editor holds cells BEYOND the anchor and the column counts
    // inclusively. Stated in the literal rather than assigned after it, so the type can see them.
    spanBack: Math.max(0, Math.round(fromDec(tile.span_back, columnNumber('span_back'))) - 1),
    spanPerp: Math.max(0, Math.round(fromDec(tile.span_perp, columnNumber('span_perp'))) - 1),
    spanPerpBack: Math.max(0, Math.round(fromDec(tile.span_perp_back, columnNumber('span_perp_back'))) - 1),
    zIndex: Math.round(fromDec(tile.draw_order, columnNumber('draw_order'))),
    opacity: fromDec(tile.opacity, columnNumber('opacity')),
    brightness: fromDec(tile.brightness, columnNumber('brightness')),
    shape: tile.shape === 'circle' || tile.shape === 'cone' ? tile.shape : undefined,
  }

  if (tile.span_axis) asset.spanAxis = tile.span_axis as IsoDiagonal
  if (tile.slide_direction) asset.zDir = tile.slide_direction as IsoDiagonal
  asset.zOffset = fromDec(tile.slide_amount, columnNumber('slide_amount'))
  if (tile.color) asset.color = String(tile.color)
  if (tile.side_color) asset.sideColor = String(tile.side_color)
  if (tile.bg_color) asset.bgColor = String(tile.bg_color)
  // A POSE THAT MOVES NOTHING IS NOT A POSE, same rule as the thickness above and for the same reason:
  // a tile's own pose is per view, and a placement that states an identity one overrides it in every
  // view. The columns still carry all five, always; what is rebuilt here is an override.
  if (poseDeviates(pose)) asset.pose = pose
  if (thinned) asset.thickness = reach
  asset.settings = settings as GridAsset['settings']

  // …and back. `placedAt` is the clock origin, so a loop that was anchored at 0 comes back anchored at 0
  // and every copy of the same object stays in step.
  if (Array.isArray(tile.animations) && tile.animations.length) {
    asset.animations = tile.animations as GridAsset['animations']
    asset.placedAt = fromDec(tile.placed_at, columnNumber('placed_at'))
  }

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
  /**
   * The art style this map is saved in, as the tileset ROW ID.
   *
   * `docs/SPEC.md` phase 1 REWIRE: the style stops being "a marker asset hidden at cell (-1, -1)" and
   * becomes a column. Passed in rather than read here, because this module turns a grid into a payload
   * and knows nothing about which style is on.
   */
  tilesetId?: number | string,
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
    map: tilesetId == null ? {} : { tileset_id: tilesetId },
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
      assets.push(payloadToTile(tile, cell.col, cell.row, cell.texture_label))
    }
  }

  grid.setAssets(assets)
  return grid
}

/** A floor is a regular tile, so this is only the discriminator the stack helpers look for. */
export const isFloor = (asset: GridAsset): boolean => asset.type === FLOOR_TYPE

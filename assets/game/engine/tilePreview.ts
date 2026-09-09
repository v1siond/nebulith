/**
 * TILE PREVIEWS — the facts and the geometry behind every picture the library shows.
 *
 * Alexander, 2026-09-08:
 *
 *   > there's no preview in objects, in general we need preview for everything.
 *   > the ascii art unit tiles aren't distinguishable at all right now, they're supper small and not clear,
 *   > we don't know what does it mean "static vs moving" options, there's no preview
 *   > compositions like houses, fountain, etc, don't have any preview until you look toplace it in grid,
 *   > which works different to all the other tiles
 *
 * Nothing here draws. Every function is a pure read of the LOADED catalog, so the React layer is a thin
 * renderer and all of this is unit-testable. Two rules it exists to honour:
 *
 *  · **Read through functions, never a module const.** The catalog arrives over the network; a top-level
 *    `const TILES = styleTiles('ascii')` would capture the empty catalog forever. Every accessor below
 *    takes the style id and asks the store at call time.
 *  · **No fallbacks.** A label with no picture returns `undefined`/`null`, and the UI shows the hole. It
 *    does NOT substitute a glyph, an emoji or another style's art — that is how 15 pictureless items came
 *    to look finished in the old inventory panel.
 */
import { styleCatalog, styleTile } from './tileset/styleTiles'
import type { Composition, CompositionCell } from './tileset/tileset'

/** What the preview strip states about one tile. Every field is read, none is derived. */
export interface TileFacts {
  label: string
  /** Display name. Falls back to the label itself only for the NAME — never for art. */
  name: string
  /** The tile's baked picture in this style, or undefined when this style has no such label. */
  image?: string
  /** Every animation frame's picture, in order. One entry = a still. */
  frames: readonly string[]
  /** Milliseconds per frame, when the tile authors an animation. */
  frameMs?: number
  /** How many rows of characters the ascii picture was baked from (0 when it wasn't). */
  artRows: number
  category?: string
  /** True when the hero cannot walk through it. */
  blocks: boolean
  /** Block height: 0 = flat on the ground, N = N blocks tall. */
  height?: number
  /** How many levels the tile repeats upward (a 4-high brick wall is ONE cell with scaleY 4). */
  scaleY?: number
  /** The cell behaves as if already filled, so the next tile stacks on top (roads, walk-over floors). */
  stacks: boolean
}

/** The frames a tile animates through. A tile with no `settings.frames` animates through its one picture. */
export function tileFrames(styleId: string, label: string): readonly string[] {
  const tile = styleTile(styleId, label)
  if (!tile) return []
  const served = (tile.settings as { frames?: unknown } | undefined)?.frames
  if (Array.isArray(served) && served.length > 0) return served.filter((f): f is string => typeof f === 'string')
  return tile.image ? [tile.image] : []
}

/** Read one setting off a tile without trusting the blob's shape. */
function setting<T>(tile: { settings?: Record<string, unknown> } | undefined, key: string, guard: (v: unknown) => v is T): T | undefined {
  const value = tile?.settings?.[key]
  return guard(value) ? value : undefined
}
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isRowGrid = (v: unknown): v is string[][] => Array.isArray(v) && Array.isArray(v[0])

/** Everything the library states about a tile. `undefined` when this style has no such label. */
export function tileFacts(styleId: string, label: string): TileFacts | undefined {
  const tile = styleTile(styleId, label)
  if (!tile) return undefined
  const artFrames = setting(tile, 'artFrames', isRowGrid)
  return {
    label,
    name: tile.title ?? label,
    image: tile.image,
    frames: tileFrames(styleId, label),
    frameMs: setting(tile, 'frameMs', isNumber),
    artRows: artFrames?.[0]?.length ?? 0,
    category: tile.category,
    blocks: !tile.walkable,
    height: tile.height,
    scaleY: setting(tile, 'scaleY', isNumber),
    stacks: tile.settings?.actAsTile === true,
  }
}

/** One square of an object's footprint: the ground it claims, and whether you can walk across it. */
export interface PlanCell {
  dx: number
  dy: number
  /** True only when EVERY tile stacked on this square is walkable — that is what a doorway looks like. */
  walkable: boolean
}

/** One tile in an object's front elevation: which column, which level, and what to draw. */
export interface ElevationCell {
  col: number
  level: number
  label: string
}

/** An object's two previews plus the facts about it. */
export interface CompositionPreview {
  slug: string
  name: string
  category?: string
  /** Cells across × cells deep, from the composition's own footprint. */
  width: number
  depth: number
  /**
   * How tall it actually is, over EVERY cell. This is a FACT shown to the user.
   * Kept separate from `drawnLevels` on purpose: measuring the height from the front row alone understated
   * a castle by three levels, and once that was fixed the drawing floated in empty rows. One number cannot
   * answer both "how tall is it" and "how many rows must I draw".
   */
  levels: number
  /** How many rows the elevation needs. Never used as the height. */
  drawnLevels: number
  /** Total cells the object places. */
  cellCount: number
  /** How many footprint squares can be walked across (usually the door). */
  walkableCount: number
  plan: readonly PlanCell[]
  elevation: readonly ElevationCell[]
}

/** How many levels a composition cell spans upward (`scaleY` repeats one authored tile). */
function levelSpan(cell: CompositionCell): number {
  const scaleY = cell.settings?.scaleY
  return isNumber(scaleY) && scaleY >= 1 ? Math.floor(scaleY) : 1
}

/** The frontmost row of each column — the only cells a front elevation can see. */
function frontRowByColumn(cells: readonly CompositionCell[]): Map<number, number> {
  const front = new Map<number, number>()
  for (const cell of cells) {
    const deepest = front.get(cell.dx)
    if (deepest === undefined || cell.dy > deepest) front.set(cell.dx, cell.dy)
  }
  return front
}

/** The plan: one entry per occupied square, walkable only when nothing on it blocks. */
function planOf(cells: readonly CompositionCell[]): PlanCell[] {
  const byKey = new Map<string, PlanCell>()
  for (const cell of cells) {
    const key = `${cell.dx},${cell.dy}`
    const existing = byKey.get(key)
    const walkable = cell.walkable === true
    if (!existing) byKey.set(key, { dx: cell.dx, dy: cell.dy, walkable })
    else existing.walkable = existing.walkable && walkable
  }
  return [...byKey.values()]
}

/** Build both previews for one composition. `undefined` when this style has no such object. */
export function compositionPreview(styleId: string, slug: string): CompositionPreview | undefined {
  const composition: Composition | undefined = styleCatalog(styleId).compositions[slug]
  if (!composition) return undefined
  const cells = composition.cells
  if (cells.length === 0) return undefined

  const front = frontRowByColumn(cells)
  const elevation: ElevationCell[] = []
  let drawnLevels = 0
  let levels = 0
  for (const cell of cells) {
    const base = cell.level ?? 0
    const top = base + levelSpan(cell)
    levels = Math.max(levels, top)
    if (front.get(cell.dx) !== cell.dy) continue
    for (let level = base; level < top; level++) {
      elevation.push({ col: cell.dx, level, label: cell.label })
      drawnLevels = Math.max(drawnLevels, level + 1)
    }
  }
  const plan = planOf(cells)
  return {
    slug,
    name: composition.title ?? slug.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    category: composition.category,
    width: composition.footprint.w,
    depth: composition.footprint.h,
    levels,
    drawnLevels,
    cellCount: cells.length,
    walkableCount: plan.filter((c) => c.walkable).length,
    plan,
    elevation,
  }
}

/** Every browseable object in a style, named and sized. Compositions with no `category` are not browseable. */
export function browseableCompositions(styleId: string): CompositionPreview[] {
  const catalog = styleCatalog(styleId)
  const out: CompositionPreview[] = []
  for (const slug of Object.keys(catalog.compositions)) {
    const preview = compositionPreview(styleId, slug)
    if (preview) out.push(preview)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

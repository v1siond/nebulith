/**
 * A PREVIEW IS A TINY MAP — built by the map's own code, so it cannot disagree with the map.
 *
 * Alexander, 2026-09-09: *"the previews of the objects don't match the selected view at all, ig infact, the
 * example ofn the element in the list itself doesn't match their actual look / fountain, lamp post and well
 * are the worst offenders"* and *"also, the preview should be how it looks in the map."*
 *
 * The old previews DREW THEIR OWN PICTURE: a "front elevation" composed from a composition's parts, plus a
 * flat plan grid. That is a second opinion about what a thing looks like, and it was wrong in exactly the
 * cases where it had the most work to do — a fountain (animated water columns), a lamp post (a glow anchor
 * whose art is not its footprint) and a well (a 5×3 composition). Anything that makes a tile interesting is
 * something a hand-rolled elevation does not know about.
 *
 * So this builds a REAL grid, puts the subject into it through the SAME functions the editor's brush and the
 * generator use — `placeGroundTile` / `stackAssetTile` / `stampComposition` — and hands it back for the
 * ACTIVE view's renderer to draw. Height runs, thickness, per-cell settings, animation, art frames and
 * stacking all arrive for free, because none of them are re-implemented here.
 *
 * It is deliberately pure and canvas-free: the scene is data, the drawing is `MapPreview`'s job.
 */
import { IsometricGrid } from '@/engine/IsometricGrid'
import { generateStage, type NatureDensity, type VariantId } from '@/engine/stageGenerator'
import { applyStageToGrid } from '@/game/editor/applyStage'
import { resolveComposition } from '@/engine/tileset/tileset'
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { ZONE_PALETTES, type ZoneId } from '@/engine/zones'
import { placeGroundTile, stackAssetTile } from '@/game/editor/tileBrush'
import { tileSlug, placementFor } from '@/game/editor/tilePlacement'
import { stampComposition } from '@/game/runtime/composition'
import { tilesForStyle, type TileDef } from '@/game/artStyle'

/** What the preview is OF. */
export type PreviewSubject =
  | { kind: 'tile'; tile: TileDef }
  | { kind: 'composition'; comp: string }
  /**
   * A whole generated LEVEL — what a preset card shows.
   *
   * Alexander, 2026-09-08: *"yes we want this feature"* (preset thumbnails). It is the same machinery as a
   * tile preview, one level up: generate the stage the preset would build, put it in a scratch grid through
   * the editor's own applier, and let the map's renderer draw it. So the thumbnail cannot promise something
   * the button does not deliver — and with the new Woodland preset beside two Meadows, the difference
   * between them is the whole reason to look.
   */
  | {
      kind: 'stage'
      zone: ZoneId
      variant: VariantId
      layout?: string
      /** The generator's nature densities — `canopy` is what makes a woodland thumbnail a woodland. */
      nature?: NatureDensity
      /** Fixed so a card's picture never re-rolls between renders. */
      seed: number
      cols: number
      rows: number
    }

export interface PreviewScene {
  grid: IsometricGrid
  /** The subject's footprint in cells — what the camera has to frame. */
  span: { cols: number; rows: number }
  /** Where in the grid the subject was placed (its top-left cell). */
  anchor: { col: number; row: number }
  /** True when the subject is a CHARACTER: it is an entity, not a grid tile, so the caller draws it as one. */
  entity: boolean
  /** How many levels tall the tallest stack in the footprint is — vertical room the camera must leave. */
  levels: number
}

/**
 * One clear cell of margin on every side.
 *
 * Not padding for looks: an iso silhouette is taller and wider than its footprint, and a tile placed hard
 * against the grid edge has its own volume clipped by the edge of the world rather than by the canvas.
 */
const MARGIN = 1

/** The cell size the preview grid uses. Big enough that a baked 128px tile is not downsampled to mush. */
const PREVIEW_CELL = 24

/** The footprint a composition occupies, from the loaded catalog. Undefined when the catalog lacks it. */
export function compositionSpan(comp: string): { cols: number; rows: number } | undefined {
  const resolved = resolveComposition(styleCatalog('ascii'), comp)
  if (!resolved) return undefined
  return { cols: resolved.footprint.w, rows: resolved.footprint.h }
}

/**
 * Build the scene for a subject, or null when the loaded catalog cannot describe it.
 *
 * Null is the honest answer to a missing subject — the caller renders nothing and says so. There is no
 * stand-in tile and no invented footprint: a preview of something the backend does not serve would be a
 * picture of a thing that does not exist.
 */
export function buildPreviewScene(subject: PreviewSubject, zone: ZoneId, styleId: string): PreviewScene | null {
  if (subject.kind === 'stage') return buildStageScene(subject)
  const span = subject.kind === 'composition' ? compositionSpan(subject.comp) : { cols: 1, rows: 1 }
  if (!span) return null

  const cols = span.cols + MARGIN * 2
  const rows = span.rows + MARGIN * 2
  const grid = new IsometricGrid({ cols, rows, cellSize: PREVIEW_CELL, isoScale: 2.5 })

  // THE SAME GROUND THE MAP WOULD HAVE under it, from the zone's own palette — so a tile is previewed
  // standing on the surface it will actually stand on, not floating in a void. `groundTypes[0]` is the
  // palette's base, exactly as `generateStage` reads it.
  const groundTile = groundTileFor(zone, styleId)
  if (groundTile) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) placeGroundTile(grid, c, r, groundTile)
    }
  }

  const anchor = { col: MARGIN, row: MARGIN }

  if (subject.kind === 'composition') {
    // The generator's own stamp. Variant 0 and rotation 0 so the same preset always previews identically —
    // a thumbnail that re-rolls its material every render is not a reference.
    const placed = stampComposition(grid, subject.comp, anchor.col, anchor.row, zone, 0, 0)
    if (placed === 0) return null
    return { grid, span, anchor, entity: false, levels: tallestStack(grid, anchor, span) }
  }

  const how = placementFor(subject.tile)
  if (how === 'entity') return { grid, span, anchor, entity: true, levels: 1 }
  // The brush's own two paths: ground REPLACES the floor, everything else STACKS on it.
  if (how === 'terrain') placeGroundTile(grid, anchor.col, anchor.row, subject.tile)
  else stackAssetTile(grid, anchor.col, anchor.row, subject.tile)
  return { grid, span, anchor, entity: false, levels: tallestStack(grid, anchor, span) }
}

/**
 * The tallest stack anywhere in the footprint, in LEVELS.
 *
 * Measured off the grid after stamping rather than read from the composition, because `stampComposition`
 * collapses each vertical run of identical tiles into one block with a `scaleY` — so a four-high wall is a
 * single asset four levels tall, and counting assets would report 1.
 */
function tallestStack(grid: IsometricGrid, anchor: { col: number; row: number }, span: { cols: number; rows: number }): number {
  let top = 1
  for (let r = anchor.row; r < anchor.row + span.rows; r++) {
    for (let c = anchor.col; c < anchor.col + span.cols; c++) {
      for (const asset of grid.getAssetsAtCell(c, r)) {
        top = Math.max(top, (asset.heightLevel ?? 0) + Math.max(1, asset.scaleY ?? 1))
      }
    }
  }
  return top
}

/**
 * The zoom each renderer needs to fit the whole scene in a box — derived from that renderer's OWN
 * projection constants, not guessed.
 *
 * · **iso** maps screen x to `(col - row)` at `Kx = cellSize · isoScale · zoom · 0.71` and screen y to
 *   `(col + row)` at `Ky = … · 0.36`, lifting `cellSize · isoScale · zoom · 0.4` per level.
 * · **2D** draws a `24 · zoom` tile and lifts `16 · zoom` per height unit.
 * · **top** draws a `16 · zoom` tile flat.
 *
 * `FILL` leaves a little air so a silhouette wider than its footprint is not shaved by the canvas edge.
 */
const FILL = 0.88

export function fitZoom(
  view: 'iso' | '2d' | 'top',
  box: { w: number; h: number },
  scene: Pick<PreviewScene, 'grid' | 'levels'>,
): number {
  const { grid, levels } = scene
  const cs = grid.cellSize
  const w = box.w * FILL
  const h = box.h * FILL
  if (view === 'top') return Math.min(w / (grid.cols * 16), h / (grid.rows * 16))
  if (view === '2d') return Math.min(w / (grid.cols * 24), h / (grid.rows * 24 + levels * 16))
  // ISO: the diamond spans (cols + rows) in both diagonal axes, and the stack adds 0.4 per level on y.
  const diagonal = grid.cols + grid.rows
  const perZoomX = cs * grid.isoScale * 0.71 * diagonal
  const perZoomY = cs * grid.isoScale * (0.36 * diagonal + 0.4 * levels)
  return Math.min(w / perZoomX, h / perZoomY)
}

/**
 * The zone's base ground tile, IN THE STYLE BEING PREVIEWED.
 *
 * Looked up in the real library rather than assembled here. An earlier version of this function built a
 * `TileDef` by hand and hardcoded `'ascii'` — which is the "one engine, many styles" rule broken twice over:
 * it invented a tile the catalog never served, and it would have previewed emoji tiles standing on ASCII
 * ground. A label owns the facts, a style owns only the picture, so the style must come from the caller.
 *
 * Read through a function, never a module const: the catalog is empty until the backend answers, and a
 * module-level lookup would capture that empty state for the life of the page.
 */
function groundTileFor(zone: ZoneId, styleId: string): TileDef | undefined {
  const label = ZONE_PALETTES[zone]?.groundTypes[0]
  if (!label) return undefined
  return tilesForStyle(styleId).terrain.find(tile => tileSlug(tile.id) === label)
}

/**
 * The subject for a library row — the one place that maps "which library, which label" onto what to build.
 *
 * Kept here rather than in the page so it can be tested without a canvas, and so the three libraries cannot
 * drift into three different answers. Null when the label is absent or the catalog does not carry it: the
 * preview then says so instead of drawing a stand-in.
 */
export function subjectFor(
  kind: 'tiles' | 'objects' | 'chars' | null,
  label: string | null,
  styleId: string,
): PreviewSubject | null {
  if (!kind || !label) return null
  if (kind === 'objects') return compositionSpan(label) ? { kind: 'composition', comp: label } : null
  const groups = tilesForStyle(styleId)
  const pool = kind === 'chars' ? groups.units : Object.values(groups).flat()
  const tile = pool.find(t => tileSlug(t.id) === label)
  return tile ? { kind: 'tile', tile } : null
}

/**
 * A whole level, generated small and seeded, for a preset card.
 *
 * Generated at a REDUCED size — a thumbnail is 100-odd pixels, and generating the preset's real 30×24 to
 * draw it at 4px a cell is work thrown away. The layout still reads correctly because every archetype
 * scales its features from `cols`/`rows` rather than placing them at absolute coordinates.
 *
 * The seed is fixed by the caller, which is what makes the card stable: an unseeded thumbnail re-rolls its
 * world on every re-render and stops being a reference you can compare against the card next to it.
 */
function buildStageScene(subject: Extract<PreviewSubject, { kind: 'stage' }>): PreviewScene | null {
  const { zone, variant, layout, nature, seed, cols, rows } = subject
  const grid = new IsometricGrid({ cols, rows, cellSize: PREVIEW_CELL, isoScale: 2.5 })
  const stage = generateStage({
    zone,
    variant,
    layout: layout as never,
    cols,
    rows,
    nature,
    // Per-layer seeds derived from the one seed, exactly as the editor derives them, so the thumbnail is
    // the same world the button will build for that seed.
    seeds: { layout: seed, buildings: seed + 1, nature: seed + 2, decor: seed + 3 },
  })
  applyStageToGrid(stage, grid, seed + 4)
  return {
    grid,
    span: { cols, rows },
    anchor: { col: 0, row: 0 },
    entity: false,
    levels: 1,
  }
}

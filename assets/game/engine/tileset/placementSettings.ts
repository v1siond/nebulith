/**
 * THE SETTINGS A PLACEMENT IS BORN WITH.
 *
 * A leaf module: it reads the catalogue and nothing else, so the grid, the stamp and the composition
 * mapper can all call it without a cycle.
 *
 * ## Why this exists
 *
 * `assetSetting` reads the PLACEMENT first and falls back to the tile. That made two writers disagree
 * without either of them being obviously wrong:
 *
 *   - the stamp left `display` unsaid, so the tile's own `single` answered, and an ornament drew as one
 *     billboard.
 *   - the load stated `display: 'all_faces'`, because every column has a default and the payload carries
 *     it, so the placement answered and the tile was never consulted. The same ornament came back a cube.
 *
 * Neither path was lying. They were answering different questions, and a map looked different after a
 * reload than it did when it was generated.
 *
 * The laws settle it: the catalog is thin and the placement is fat, and context is written by the
 * generator ONTO the placement (law 5). So the placement states it, every time, and it starts from what
 * the catalogue says rather than from a literal. The tile fallback in `assetSetting` stops being load
 * bearing, which is the point: one question, one place that answers it.
 */
import { labelTile, loadedStyleIds, styleCatalog } from './styleTiles'
import { booleanDefault, stringDefault } from '@/lib/tileDefaults'
import { tileColorByLabel, tileRenderBehavior, type TileDisplay } from './tileset'

/**
 * What a renderer asks of a placed tile.
 *
 * Declared structurally, field for field against `AssetSettings`, rather than imported from the grid:
 * the grid imports this module, so naming its type here would close the loop. No index signature, so a
 * field added to one and not the other is a compile error instead of a value that quietly never arrives.
 */
export interface PlacementSettings {
  display?: TileDisplay
  transparent?: boolean
  fadeNear?: boolean
  cutawayRoof?: boolean
  minAlpha?: number
  actAsTile?: boolean
  collision?: Array<{ x: number; y: number; w: number; h: number }>
  badge?: { text: string; color: string }
}

/**
 * The catalogue's render behaviour for a label, with whatever the caller states on top.
 *
 * The caller always wins: a composition cell that pins `display: 'single'` on a tile the catalogue draws
 * on every face still gets its billboard. What the caller leaves out comes from the catalogue rather
 * than from silence.
 *
 * A label the catalogue does not know contributes nothing, which is the honest answer, and the caller's
 * own settings still come through.
 */
export function placementSettings(label: string | undefined, stated?: PlacementSettings): PlacementSettings {
  const tile = label ? labelTile(label) : undefined
  const own = tile?.settings as Record<string, unknown> | undefined
  // `tileRenderBehavior` emits a field only when the catalogue turns it ON, which is the right shape for
  // asking "what does this tile opt into". It is the wrong shape for being the placement's whole answer,
  // so the four booleans below are filled in from it rather than left out.
  const fromCatalog = tileRenderBehavior(own) ?? {}

  // EVERY DEFAULT HERE IS THE COLUMN'S. `display` used to read `?? 'all_faces'`, which is a literal, and
  // a wrong one twice over: the column spells it `all_faces`, so the engine was inventing both the value
  // and its spelling.
  const complete: PlacementSettings = {
    display: fromCatalog.display ?? (stringDefault('display') as TileDisplay),
    transparent: fromCatalog.transparent ?? booleanDefault('transparent'),
    fadeNear: fromCatalog.fadeNear ?? booleanDefault('fade_near'),
    cutawayRoof: fromCatalog.cutawayRoof ?? booleanDefault('cutaway_near'),
    actAsTile: typeof own?.actAsTile === 'boolean' ? own.actAsTile : booleanDefault('act_as_tile'),
  }
  if (typeof fromCatalog.minAlpha === 'number') complete.minAlpha = fromCatalog.minAlpha
  if (fromCatalog.collision) complete.collision = fromCatalog.collision

  return { ...complete, ...(stated ?? {}) }
}

/**
 * A PLACEMENT'S COLOUR, from the catalogue, or nothing.
 *
 * `#ffffff` used to stand here as the answer for a tile that states no colour, and a white invented by
 * the engine is exactly what law 7 calls a defect: `color` is nullable with no column default, so
 * "nobody said" is a real answer and the renderer already knows what to do with it, which is to draw
 * the tile's own art untinted rather than wash it white.
 *
 * The colour a tile carries is per ZONE, and the zone is the map's, so a caller that knows its zone
 * passes it. A label the catalogue does not know contributes nothing.
 */
export function placementColor(label: string | undefined, stated?: string, zone?: string): string | undefined {
  if (stated) return stated
  if (!label) return undefined

  // A COLOUR IS THE LABEL'S, not a style's. Naming a style here made the ascii catalog the authority on
  // what colour an emoji tile is, and left the answer depending on which style happened to load first.
  for (const style of loadedStyleIds()) {
    const color = tileColorByLabel(styleCatalog(style), label, zone)
    if (color) return color
  }

  return undefined
}

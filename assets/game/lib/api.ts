/**
 * API Client for Templates
 */

import type { Action as TriggerAction } from '@/engine/triggers'
import type { Entity, Quest } from '@/game/types'
import type { Animation } from '@/engine/animation/tileAnimation'
import type { AssetLight } from '@/engine/tileset/tileset'
import { NEBULITH_API } from './nebulithApi'
import { apiFailure } from './apiError'
import { unitStandLevel } from '@/engine/cellStack'
import { assetIsSolid } from '@/engine/collisionBoxes'
import type { MapPayload } from './mapPayload'

export interface Connector {
  // A connector owns a SET of cells, one connector can span many selected cells.
  // Legacy saves stored a single { col, row }; normalizeConnector() migrates those.
  cells: { col: number; row: number }[]
  targetTemplateId: string
  targetTemplateName?: string  // For display
  interaction: 'walk' | 'interact' | 'auto'  // How player triggers it
  spawnCol: number  // Where to spawn in target template
  spawnRow: number
  // Optional TYPED action (triggers generalization). When present it overrides the
  // default teleport: move within the stage, collect an item, or reveal content.
  // Absent = legacy "go to target template" (teleport). Round-trips as JSON.
  action?: TriggerAction
}

export interface TemplateListItem {
  id: string
  name: string
  description: string | null
  category: string
  cols: number
  rows: number
  thumbnail: string | null
  isPublic: boolean
  tags: string[]
  connectors?: Connector[]
  createdAt: string
  updatedAt: string
}

export interface TemplateData {
  id: string
  name: string
  description: string | null
  category: string
  cols: number
  rows: number
  cellSize: number
  isoScale: number
  /** The map's BODY thickness in blocks, the grid's own height, saved with the level. */
  slabBlocks?: number
  spawnCol: number
  spawnRow: number
  groundData: string[][]
  heightData: number[][]
  assetsData: Array<{
    art: string[]
    col: number
    row: number
    type: string
    color?: string
    scale?: number   // uniform Zoom (#77/#78)
    zIndex?: number  // draw-priority (CSS z-index): a higher value draws on top / in front, overriding the depth sort
    scaleX?: number  // Width, horizontal sprite scale (#77/#78)
    scaleY?: number  // Height, vertical sprite scale, grows up (#77/#78)
    scaleZ?: number  // Depth, overhead-view vertical scale (#77/#78)
    bgColor?: string
    height?: number
    heightLevel?: number
    tileKey?: string
    label?: string
    shape?: string            // per-instance render SHAPE ('square' cube default | 'circle' ball), round-trips
                              // via the shallow clone in deserializeToGrid, like scaleX/pose/display
    light?: AssetLight        // per-instance LIGHT setting (night ground glow pool), round-trips via the shallow
                              // clone, like shape; the lamp_post bulb ships one as a composition default
    animations?: Animation[]  // authored TILE ANIMATIONS (settings tweens), round-trips like cellAnim; the
                              // fountain's water cells ship the rise/fade loop as a composition default
    placedAt?: number         // clock anchor (ms) a tile animation's start/loop delays are measured from
  }>
  connectors: Connector[]
  // Placed entities (enemies / npcs / player) and authored quests for this room.
  entities: Entity[]
  quests: Quest[]
  thumbnail: string | null
  isPublic: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateTemplateInput {
  name: string
  description?: string
  category?: string
  cols: number
  rows: number
  cellSize: number
  isoScale: number
  /** The map's BODY thickness in blocks, the grid's own height, saved with the level. */
  slabBlocks?: number
  spawnCol: number
  spawnRow: number
  groundData: string[][]
  heightData: number[][]
  assetsData: unknown[]
  connectors?: Connector[]
  entities?: Entity[]
  quests?: Quest[]
  thumbnail?: string
  isPublic?: boolean
  tags?: string[]
}

// ═══════════════════════════════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════════════════════════════

// Templates persist in the nebulith ELIXIR backend (like the tilesets at /api/tilesets). Base URL comes
// from the shared, env-configurable NEBULITH_API (see src/lib/nebulithApi.ts). The Elixir endpoint returns
// the SAME shapes this client expects ({templates,total} list, bare object show/create/update, {success,id}
// delete), so only the base URL moves.
const API_BASE = `${NEBULITH_API}/templates`

export async function listTemplates(options: {
  category?: string
  limit?: number
  offset?: number
} = {}): Promise<{ templates: TemplateListItem[]; total: number }> {
  const params = new URLSearchParams()
  if (options.category) params.set('category', options.category)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))

  const response = await fetch(`${API_BASE}?${params}`)
  if (!response.ok) {
    throw await apiFailure(response, 'The map library could not be loaded')
  }
  return response.json()
}

export async function getTemplate(id: string): Promise<TemplateData> {
  const response = await fetch(`${API_BASE}/${id}`)
  // The 404 is no longer singled out here: `ApiError` carries the status, so the CALLER decides what
  // a missing map means. In the editor that is "this map is gone, here is the library", which is a
  // different screen from "the backend is down", a distinction a thrown sentence could not make.
  if (!response.ok) {
    throw await apiFailure(response, 'This map could not be loaded')
  }
  return response.json()
}

/** Default the JSON collections so a save always sends concrete arrays, mirrors the
 *  API route's destructure defaults, so what the editor sends matches what's stored. */
export function withTemplateDefaults(
  input: CreateTemplateInput,
): CreateTemplateInput & { connectors: Connector[]; entities: Entity[]; quests: Quest[] } {
  return {
    ...input,
    connectors: input.connectors ?? [],
    entities: input.entities ?? [],
    quests: input.quests ?? [],
  }
}

export async function createTemplate(input: CreateTemplateInput): Promise<TemplateData> {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(withTemplateDefaults(input)),
  })
  if (!response.ok) {
    throw await apiFailure(response, 'This map could not be saved')
  }
  return response.json()
}

export async function updateTemplate(
  id: string,
  input: Partial<CreateTemplateInput>
): Promise<TemplateData> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw await apiFailure(response, 'This map could not be saved')
  }
  return response.json()
}

export async function deleteTemplate(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw await apiFailure(response, 'This map could not be deleted')
  }
}

// ═══════════════════════════════════════════════════════════════════
// Games, a GAME is a named, ordered flow of templates (many-to-many).
// Persisted in the Elixir backend (/api/games); templates are a reusable resource.
// ═══════════════════════════════════════════════════════════════════

export interface Game {
  id: string
  name: string
  description: string | null
  /** The template the game reopens to (the last one watched). */
  lastTemplateId: string | null
  /** Ordered member templates, index 0 = level 1. */
  templateIds: string[]
}

const GAMES_BASE = `${NEBULITH_API}/games`

export async function listGames(): Promise<Game[]> {
  const res = await fetch(GAMES_BASE)
  if (!res.ok) throw await apiFailure(res, 'The game list could not be loaded')
  const data = await res.json()
  return data.games ?? []
}

export async function getGame(id: string): Promise<Game> {
  const res = await fetch(`${GAMES_BASE}/${id}`)
  if (!res.ok) throw await apiFailure(res, 'This game could not be loaded')
  return res.json()
}

export async function createGame(input: {
  name: string
  description?: string
  templateIds?: string[]
  lastTemplateId?: string
}): Promise<Game> {
  const res = await fetch(GAMES_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw await apiFailure(res, 'This game could not be created')
  return res.json()
}

export async function updateGame(
  id: string,
  input: Partial<{ name: string; description: string; templateIds: string[]; lastTemplateId: string }>,
): Promise<Game> {
  const res = await fetch(`${GAMES_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw await apiFailure(res, 'This game could not be saved')
  return res.json()
}

export async function deleteGame(id: string): Promise<void> {
  const res = await fetch(`${GAMES_BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw await apiFailure(res, 'This game could not be deleted')
}

// ═══════════════════════════════════════════════════════════════════
// Grid Serialization Helpers
// ═══════════════════════════════════════════════════════════════════

import { IsometricGrid, GridAsset, FLOOR_TYPE } from '@/engine/IsometricGrid'

export function serializeGrid(grid: IsometricGrid): {
  groundData: string[][]
  heightData: number[][]
  assetsData: GridAsset[]
} {
  return {
    // The authoritative floor data lives in `assetsData` (floors are level-0 assets). `groundData` is kept in
    // the wire format only for backward compatibility, derived from the floor assets on the way out, and read
    // back only by the legacy fallback in deserializeToGrid (saves that predate floors-as-assets).
    groundData: grid.groundSlugs(),
    heightData: grid.height,
    assetsData: grid.assets,
  }
}


/**
 * WHAT IS SOLID, DERIVED FROM THE ASSETS.
 *
 * A saved map has no collision layer (`groundData`, `heightData`, `assetsData`, `connectors`, `entities`,
 * `quests`), so this is how a loaded map gets one back. GROUND-level blocks only, the same rule the
 * composition stamp follows: the map is 2D, one flag per cell, while a building is 3D, so blocking a cell for
 * a tile at ANY level made an upper storey seal the floor beneath it. A saved village held 89 blocking assets
 * above ground (windows at L2/L4/L6, wall courses at L3/L5, awnings at L2) and the collision map traced those
 * storeys instead of the walls, *"the collissions don't match the generated building"*. A unit walks on the
 * ground, so the ground is what this flat map means.
 *
 * IT ASKS `assetIsSolid` AS WELL AS `blocking`. Loading used to consult only `blocking`, the flag the
 * collision-box system replaced, while PLACING an asset consults its boxes. So building a map and loading the
 * same map disagreed about what stops you: measured on a saved 2,706-asset woodland, 387 assets carry boxes
 * and exactly 4 carry `blocking`, which is why a reload came back with four solid cells and a river you could
 * stroll across. Both are asked, because `blocking` is deprecated but still the only thing some assets carry
 * (20 tile rows in the catalog say `blocking` while declaring no box, and a generated pillar is one of them).
 *
 * CALL IT AGAIN WHEN THE TILESET ARRIVES. `assetIsSolid` falls back to the served tile when an asset pins no
 * boxes of its own, so running this before the tileset has loaded answers "nothing is solid" for every asset
 * that relies on its tile, water included. That race is why the bug came and went: of three identical runs,
 * one restored all 92 solid water cells and two restored one. It is idempotent by construction (it only ever
 * turns cells ON), so re-running it the moment the catalog lands is the whole fix.
 */
export function rebuildCollisionFromAssets(grid: IsometricGrid): void {
  for (const asset of grid.assets) {
    if (!assetIsSolid(asset)) continue
    if ((asset.heightLevel) > unitStandLevel(grid, asset.col, asset.row)) continue // an upper storey
    grid.setCollision(asset.col, asset.row, true)
  }
}

export function deserializeToGrid(
  data: TemplateData,
  existingGrid?: IsometricGrid
): IsometricGrid {
  const grid = existingGrid || new IsometricGrid({
    cols: data.cols,
    rows: data.rows,
    cellSize: data.cellSize,
    isoScale: data.isoScale,
    slabBlocks: data.slabBlocks,
  })

  // THE MAP'S OWN SHAPE, READ BACK.
  //
  // These three describe the map, they save with it, and until now a load only applied them when it
  // had to BUILD the grid. The editor always hands in the grid it already has, so every saved map
  // opened at whatever cell size and iso scale the editor happened to be holding, and the numbers it
  // had written travelled nowhere. A value that is written and never read is not a setting.
  //
  // Only what the payload actually states: an older row that carries no slab thickness keeps the
  // grid's, rather than being reset to a number nobody chose.
  if (existingGrid) {
    if (data.cellSize !== undefined) grid.cellSize = data.cellSize
    if (data.isoScale !== undefined) grid.isoScale = data.isoScale
    if (data.slabBlocks !== undefined) grid.slabBlocks = data.slabBlocks
  }

  // Load height data
  for (let r = 0; r < data.rows && r < data.heightData.length; r++) {
    for (let c = 0; c < data.cols && c < data.heightData[r].length; c++) {
      grid.setHeight(c, r, data.heightData[r][c])
    }
  }

  // Load assets, preserve EVERY saved field (clone). Cherry-picking columns used to DROP generator
  // metadata that the renderers key on: `footprint` (the town-square fountain reverted to a single
  // cell on load, #72), `cellAnim`/`cycles` (authored animations), `edge`/`cellPart` (debug labels),
  // `baseShadow`, `buildingType`. serializeGrid saves the full GridAsset, so a shallow clone round-
  // trips them all; new GridAsset fields are carried automatically. THE FLOOR is a normal asset now, so
  // it rides here too, including CLEARED cells, which simply have no floor asset (grass-for-empty in
  // the legacy groundData channel could never represent that).
  grid.setAssets(data.assetsData.map(a => ({ ...a }) as unknown as GridAsset))

  // LEGACY fallback: templates saved BEFORE floors were assets carry the terrain only in `groundData`.
  // Synthesize floor assets from it, but ONLY when the saved assets contain none (a new save is
  // self-describing via its floor assets, and replaying groundData would resurrect its cleared cells).
  if (!grid.assets.some(a => a.type === FLOOR_TYPE)) {
    for (let r = 0; r < data.rows && r < data.groundData.length; r++) {
      for (let c = 0; c < data.cols && c < data.groundData[r].length; c++) {
        grid.setGround(c, r, data.groundData[r][c])
      }
    }
  }

  rebuildCollisionFromAssets(grid)

  return grid
}


/**
 * THE MAP, AS ROWS.
 *
 * Phase 3 moved a map's contents off `Template`'s three JSON blobs onto `maps`, `grids`, `cells` and
 * `cell_tiles`. These two calls are that boundary. The editor still addresses a map by its template id
 * while both tables exist; `for_template` imports on the first ask, so a map authored before phase 3
 * answers rather than 404ing.
 *
 * What the template still carries is what phase 3 does not own: its name and spawn, its connectors,
 * and the entity / quest / style / trigger markers that ride inside the asset array until phases 8, 10
 * and 11 give them tables.
 */
export async function loadMapForTemplate(templateId: string): Promise<MapPayload & { map?: Record<string, unknown> }> {
  const res = await fetch(`/api/maps/for_template/${encodeURIComponent(templateId)}`)
  if (!res.ok) throw new Error(`map for template ${templateId}: ${res.status}`)
  return (await res.json()).data
}

export async function saveMap(mapId: string, payload: MapPayload): Promise<void> {
  const res = await fetch(`/api/maps/${encodeURIComponent(mapId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`saving map ${mapId}: ${res.status} ${(await res.text()).slice(0, 200)}`)
}

/**
 * API Client for Templates
 */

import type { Action as TriggerAction } from '@/engine/triggers'
import type { Entity, Quest } from '@/game/types'

export interface Connector {
  // A connector owns a SET of cells — one connector can span many selected cells.
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
  spawnCol: number
  spawnRow: number
  groundData: string[][]
  heightData: number[][]
  assetsData: Array<{
    art: string[]
    col: number
    row: number
    type: string
    blocking?: boolean
    color?: string
    scale?: number   // uniform Zoom (#77/#78)
    scaleX?: number  // Width — horizontal sprite scale (#77/#78)
    scaleY?: number  // Height — vertical sprite scale, grows up (#77/#78)
    scaleZ?: number  // Depth — overhead-view vertical scale (#77/#78)
    bgColor?: string
    height?: number
    heightLevel?: number
    tileKey?: string
    label?: string
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

// Templates persist in the nebulith ELIXIR backend (like the tilesets at /api/tilesets)
// Dev points straight at :4001; later this becomes configurable / same-origin behind a proxy (mirrors
// src/engine/tileset/tilesetLoader.ts). The Elixir endpoint returns the SAME shapes this client expects
// ({templates,total} list, bare object show/create/update, {success,id} delete), so only the base URL moves.
const NEBULITH_API = 'http://localhost:4001/api'
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
    throw new Error(`Failed to list templates: ${response.statusText}`)
  }
  return response.json()
}

export async function getTemplate(id: string): Promise<TemplateData> {
  const response = await fetch(`${API_BASE}/${id}`)
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Template not found')
    }
    throw new Error(`Failed to get template: ${response.statusText}`)
  }
  return response.json()
}

/** Default the JSON collections so a save always sends concrete arrays — mirrors the
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
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `Failed to create template: ${response.statusText}`)
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
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `Failed to update template: ${response.statusText}`)
  }
  return response.json()
}

export async function deleteTemplate(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || `Failed to delete template: ${response.statusText}`)
  }
}

// ═══════════════════════════════════════════════════════════════════
// Games — a GAME is a named, ordered flow of templates (many-to-many).
// Persisted in the Elixir backend (/api/games); templates are a reusable resource.
// ═══════════════════════════════════════════════════════════════════

export interface Game {
  id: string
  name: string
  description: string | null
  /** The template the game reopens to (the last one watched). */
  lastTemplateId: string | null
  /** Ordered member templates — index 0 = level 1. */
  templateIds: string[]
}

const GAMES_BASE = `${NEBULITH_API}/games`

export async function listGames(): Promise<Game[]> {
  const res = await fetch(GAMES_BASE)
  if (!res.ok) throw new Error(`Failed to list games: ${res.statusText}`)
  const data = await res.json()
  return data.games ?? []
}

export async function getGame(id: string): Promise<Game> {
  const res = await fetch(`${GAMES_BASE}/${id}`)
  if (!res.ok) throw new Error(`Failed to get game: ${res.statusText}`)
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
  if (!res.ok) throw new Error(`Failed to create game: ${res.statusText}`)
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
  if (!res.ok) throw new Error(`Failed to update game: ${res.statusText}`)
  return res.json()
}

export async function deleteGame(id: string): Promise<void> {
  const res = await fetch(`${GAMES_BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete game: ${res.statusText}`)
}

// ═══════════════════════════════════════════════════════════════════
// Grid Serialization Helpers
// ═══════════════════════════════════════════════════════════════════

import { IsometricGrid, GridAsset } from '@/engine/IsometricGrid'

export function serializeGrid(grid: IsometricGrid): {
  groundData: string[][]
  heightData: number[][]
  assetsData: GridAsset[]
} {
  return {
    groundData: grid.ground,
    heightData: grid.height,
    assetsData: grid.assets,
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
  })

  // Load ground data
  for (let r = 0; r < data.rows && r < data.groundData.length; r++) {
    for (let c = 0; c < data.cols && c < data.groundData[r].length; c++) {
      grid.setGround(c, r, data.groundData[r][c])
    }
  }

  // Load height data
  for (let r = 0; r < data.rows && r < data.heightData.length; r++) {
    for (let c = 0; c < data.cols && c < data.heightData[r].length; c++) {
      grid.setHeight(c, r, data.heightData[r][c])
    }
  }

  // Load assets — preserve EVERY saved field (clone). Cherry-picking columns used to DROP generator
  // metadata that the renderers key on: `footprint` (the town-square fountain reverted to a single
  // cell on load — #72), `cellAnim`/`cycles` (authored animations), `edge`/`cellPart` (debug labels),
  // `baseShadow`, `buildingType`. serializeGrid saves the full GridAsset, so a shallow clone round-
  // trips them all; new GridAsset fields are carried automatically.
  grid.setAssets(data.assetsData.map(a => ({ ...a }) as unknown as GridAsset))

  // Rebuild collision grid from assets. Blocks are collision regardless of any
  // visual height level — a blocking asset always blocks its cell.
  for (const asset of grid.assets) {
    if (asset.blocking) {
      grid.setCollision(asset.col, asset.row, true)
    }
  }

  return grid
}

/**
 * GRID CODEC — entity / quest / building ↔ GridAsset persistence
 *
 * Extracted verbatim from the game-engine templates page. The template schema
 * (api.ts) has no entities/quests/buildings fields and is read-only here, so
 * these ride inside the existing `assetsData` array as marked records. Pairs
 * with api.ts's serializeGrid/deserializeToGrid. Pure + module-level so they
 * aren't re-allocated per render and stay unit-testable.
 */
import type { Entity, EntityKind, Quest } from '@/game/types'
import type { GridAsset } from '@/engine/IsometricGrid'
import { type GroundCellDims, groundDimsActive } from '@/engine/groundDims'
import type { Trigger } from '@/game/runtime/trigger'

/** Glyph drawn for each entity kind, over a dark backing (spec §1). */
export const ENTITY_GLYPH: Record<EntityKind, string> = {
  player: '☻',
  enemy: 'E', // enemies fall back to this; a typed enemy uses its first letter
  npc: '☺',
}

/** Distinct colours so kinds read at a glance: player yellow, enemy red, npc cyan. */
const ENTITY_COLOR: Record<EntityKind, string> = {
  player: '#ffdd00',
  enemy: '#ff4d4d',
  npc: '#33d6ff',
}

/** The glyph an entity renders as — enemies use their type's first letter. */
function entityGlyph(entity: Entity): string {
  if (entity.kind !== 'enemy') return ENTITY_GLYPH[entity.kind]
  const first = entity.enemyType?.trim()?.[0]
  return first ? first.toUpperCase() : ENTITY_GLYPH.enemy
}

// ── persistence codec ────────────────────────────────────────────────
// Entities ride inside the existing `assetsData` array as marked records so
// they round-trip through createTemplate/updateTemplate without touching
// api.ts. The marker type keeps them out of the visible asset renderers.

export interface AssetCodec<T> {
  /** Serialize items into the marker records appended to assetsData. */
  toAssets: (items: readonly T[]) => GridAsset[]
  /** Pull every item back out of a loaded asset list (drops malformed ones). */
  fromAssets: (assets: readonly GridAsset[]) => T[]
  /** True for the marker records this codec produced. */
  isMarker: (asset: GridAsset) => boolean
}

/**
 * Build one entity/quest/building codec. Only two things differ per type:
 * `toRecord` (how an item is shaped into a marked GridAsset) and `validate`
 * (the guard on a parsed payload). The marker check, JSON parse + try/catch,
 * and the filter/decode loop are identical, so they live here once.
 */
export function makeAssetCodec<T>(
  markerType: string,
  toRecord: (item: T) => GridAsset,
  validate: (parsed: T) => boolean,
): AssetCodec<T> {
  const isMarker = (asset: GridAsset): boolean => asset.type === markerType
  const fromAsset = (asset: GridAsset): T | null => {
    if (!asset.label) return null
    try {
      const parsed = JSON.parse(asset.label) as T
      return validate(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  const fromAssets = (assets: readonly GridAsset[]): T[] => {
    const out: T[] = []
    for (const asset of assets) {
      if (!isMarker(asset)) continue
      const item = fromAsset(asset)
      if (item) out.push(item)
    }
    return out
  }
  return { toAssets: items => items.map(toRecord), fromAssets, isMarker }
}

export const ENTITY_ASSET_TYPE = 'nebulith:entity'
const entityCodec = makeAssetCodec<Entity>(
  ENTITY_ASSET_TYPE,
  entity => ({
    art: [entityGlyph(entity)],
    col: entity.col,
    row: entity.row,
    type: ENTITY_ASSET_TYPE,
    blocking: false, // entities are not terrain collision
    color: ENTITY_COLOR[entity.kind],
    label: JSON.stringify(entity), // the round-trip payload
  }),
  parsed => !!(parsed?.kind && typeof parsed.col === 'number' && typeof parsed.row === 'number'),
)
export const entitiesToAssets = entityCodec.toAssets
export const entitiesFromAssets = entityCodec.fromAssets
export const isEntityAsset = entityCodec.isMarker

// ── quest persistence codec ──────────────────────────────────────────
// Quests ride the same assetsData channel as entities (api.ts has no quest
// field and is read-only here). Each quest becomes one off-grid marker asset so
// the set round-trips through create/updateTemplate; load splits them back out.
// The NPC↔quest link survives independently via the entity's own questId field.

export const QUEST_ASSET_TYPE = 'nebulith:quest'
const questCodec = makeAssetCodec<Quest>(
  QUEST_ASSET_TYPE,
  quest => ({
    art: [' '],
    col: -1, // off-grid: never drawn by the tile/asset renderers
    row: -1,
    type: QUEST_ASSET_TYPE,
    blocking: false,
    color: '#000000',
    label: JSON.stringify(quest), // the round-trip payload
  }),
  parsed => !!(parsed?.id && Array.isArray(parsed.objectives) && Array.isArray(parsed.rewards)),
)
export const questsToAssets = questCodec.toAssets
export const questsFromAssets = questCodec.fromAssets
export const isQuestAsset = questCodec.isMarker

// Buildings are NOT persisted through a marker codec anymore: a pre-built building is stamped as its
// composition's per-cell tiles (game/runtime/composition.ts), which are plain GridAssets, so they
// serialize/deserialize with the rest of grid.assets — exactly like a stamped tree. There is no
// grouped-building metadata to round-trip.

// ── cell-trigger persistence codec ───────────────────────────────────
// Cell triggers (on enter / on interact → action) belong to a CELL, but the
// template schema has no per-cell channel. So — exactly like quests + buildings —
// each cell's trigger group rides assetsData as ONE off-grid marker record, split
// back out on load. (On-DEFEAT triggers live on the entity itself and ride the
// `entities` field, so they're not part of this codec.) The group carries its own
// col/row in the payload; the marker asset is off-grid so no renderer draws it.

/** All triggers authored on one cell — the persisted unit for cell triggers. */
export interface CellTriggerGroup {
  col: number
  row: number
  triggers: Trigger[]
}

export const TRIGGER_ASSET_TYPE = 'nebulith:trigger'
const triggerCodec = makeAssetCodec<CellTriggerGroup>(
  TRIGGER_ASSET_TYPE,
  group => ({
    art: [' '],
    col: -1, // off-grid: never drawn by the tile/asset renderers
    row: -1,
    type: TRIGGER_ASSET_TYPE,
    blocking: false,
    color: '#000000',
    label: JSON.stringify(group), // the round-trip payload (cell + its triggers)
  }),
  parsed => !!(Array.isArray(parsed?.triggers) && typeof parsed.col === 'number' && typeof parsed.row === 'number'),
)
export const cellTriggersToAssets = triggerCodec.toAssets
export const cellTriggersFromAssets = triggerCodec.fromAssets
export const isTriggerAsset = triggerCodec.isMarker

/** The triggers authored on (col,row), or an empty list when the cell has none. */
export function triggersAtCell(groups: readonly CellTriggerGroup[], col: number, row: number): Trigger[] {
  return groups.find(g => g.col === col && g.row === row)?.triggers ?? []
}

// ── active-art-style persistence ─────────────────────────────────────
// The active GLOBAL art style (a single style id) rides assetsData as ONE off-grid marker,
// exactly like buildings — so it saves/loads with the template without touching api.ts. A
// scalar, not a list, so it's a small pair rather than the list codec. Absent on load →
// the editor keeps ASCII (styleById defaults to ASCII).

export const STYLE_ASSET_TYPE = 'nebulith:style'

/** One off-grid marker carrying the active style id (empty when ASCII/default → no marker). */
export function styleToAssets(styleId: string | null | undefined): GridAsset[] {
  if (!styleId || styleId === 'ascii') return []
  return [{ art: [' '], col: -1, row: -1, type: STYLE_ASSET_TYPE, blocking: false, color: '#000000', label: styleId }]
}

/** The saved active style id (or null when none was persisted). */
export function styleFromAssets(assets: readonly GridAsset[]): string | null {
  const marker = assets.find(a => a.type === STYLE_ASSET_TYPE)
  return marker?.label ?? null
}

export const isStyleAsset = (asset: GridAsset): boolean => asset.type === STYLE_ASSET_TYPE

// ── floor-colour persistence ─────────────────────────────────────────
// Per-cell FLOOR colour overrides (grid.groundColor, indexed [row][col]) ride as ONE off-grid marker
// carrying a sparse { "col,row": color } map of only the recoloured cells — serializeGrid has no
// groundColor field, so this keeps floor colour out of the schema like the rest. Empty → no marker.

export const GROUND_COLOR_ASSET_TYPE = 'nebulith:groundColor'

/** One off-grid marker with the sparse floor-colour map (empty → no marker). */
export function groundColorToAssets(groundColor: readonly (readonly (string | null)[])[]): GridAsset[] {
  const map: Record<string, string> = {}
  for (let row = 0; row < groundColor.length; row++) {
    const cells = groundColor[row]
    for (let col = 0; col < (cells?.length ?? 0); col++) {
      const color = cells[col]
      if (color) map[`${col},${row}`] = color
    }
  }
  if (Object.keys(map).length === 0) return []
  return [{ art: [], col: -1, row: -1, type: GROUND_COLOR_ASSET_TYPE, blocking: false, label: JSON.stringify(map) }]
}

/** The saved floor-colour map, keyed "col,row" (empty when none was persisted). */
export function groundColorFromAssets(assets: readonly GridAsset[]): Record<string, string> {
  const marker = assets.find(a => a.type === GROUND_COLOR_ASSET_TYPE)
  if (!marker?.label) return {}
  try {
    const parsed = JSON.parse(marker.label)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export const isGroundColorAsset = (asset: GridAsset): boolean => asset.type === GROUND_COLOR_ASSET_TYPE

// ── floor-dims persistence ───────────────────────────────────────────
// Per-cell FLOOR dims (grid.groundDims, indexed [row][col]) ride as ONE off-grid marker carrying a
// sparse { "col,row": GroundCellDims } map of only the OVERRIDDEN cells — serializeGrid has no
// groundDims field, so this keeps floor dims out of the schema like groundColor. All-default → no marker.

export const GROUND_DIMS_ASSET_TYPE = 'nebulith:groundDims'

/** One off-grid marker with the sparse floor-dims map (only cells that actually deviate; empty → none). */
export function groundDimsToAssets(groundDims: readonly (readonly (GroundCellDims | undefined)[])[]): GridAsset[] {
  const map: Record<string, GroundCellDims> = {}
  for (let row = 0; row < groundDims.length; row++) {
    const cells = groundDims[row]
    for (let col = 0; col < (cells?.length ?? 0); col++) {
      const d = cells[col]
      if (d && groundDimsActive(d)) map[`${col},${row}`] = d
    }
  }
  if (Object.keys(map).length === 0) return []
  return [{ art: [], col: -1, row: -1, type: GROUND_DIMS_ASSET_TYPE, blocking: false, label: JSON.stringify(map) }]
}

/** The saved floor-dims map, keyed "col,row" (empty when none was persisted). */
export function groundDimsFromAssets(assets: readonly GridAsset[]): Record<string, GroundCellDims> {
  const marker = assets.find(a => a.type === GROUND_DIMS_ASSET_TYPE)
  if (!marker?.label) return {}
  try {
    const parsed = JSON.parse(marker.label)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, GroundCellDims>) : {}
  } catch {
    return {}
  }
}

export const isGroundDimsAsset = (asset: GridAsset): boolean => asset.type === GROUND_DIMS_ASSET_TYPE

/**
 * BUILDINGS AT ANY SIZE — the client for `/api/buildings`.
 *
 * Alexander, 2026-09-08: *"i think we should NOT have a fixed size, but a default one and allow user to
 * specify the size of the element they want to put — for example, why having 3 size house when we can have
 * 1 house button and allow user to make a house as big or as small as he wants??? … i want to be able to
 * generate a store of any size, a hospital of any size, etc."*
 *
 * Two calls and one install. `fetchBuildingTypes` gets the types with their default footprints;
 * `composeBuilding` asks the backend to lay one out and installs the answer into the loaded catalog under a
 * synthetic kind, so the editor's existing stamp path places it. Nothing downstream learns that a building
 * was composed rather than seeded — that distinction stops here.
 *
 * NO LAYOUT LOGIC LIVES IN THIS FILE, and that is the point. The recipe is Elixir's
 * (`BuildingCompositions.compose_building/4`), beside the composition seeds, because a composition is DATA
 * and data is the backend's. A frontend that could lay out a building would be a second opinion about what
 * a house is.
 */
import { NEBULITH_API } from './nebulithApi'
import { setStyleComposition, styleCatalog } from '@/engine/tileset/styleTiles'

const BASE = `${NEBULITH_API}/buildings`

export interface Footprint {
  w: number
  h: number
}

export interface BuildingType {
  key: string
  /** The type's own authored footprint — Alexander: *"you can pick one of the old hardcoded values."* */
  default: Footprint
}

export interface BuildingTypeCatalog {
  types: readonly BuildingType[]
  /** The smallest size to OFFER. The backend composes what it is asked; this is the UI's floor. */
  min: Footprint
}

export const EMPTY_BUILDING_TYPES: BuildingTypeCatalog = { types: [], min: { w: 4, h: 3 } }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parseFootprint(v: unknown): Footprint | undefined {
  if (!isObject(v)) return undefined
  const w = typeof v.w === 'number' ? v.w : undefined
  const h = typeof v.h === 'number' ? v.h : undefined
  return w === undefined || h === undefined ? undefined : { w, h }
}

/** The types the backend can compose. A row it cannot describe is dropped rather than guessed at. */
export function parseBuildingTypes(body: unknown): BuildingTypeCatalog {
  const data = isObject(body) && isObject(body.data) ? body.data : undefined
  if (!data) return EMPTY_BUILDING_TYPES
  const min = parseFootprint(data.min) ?? EMPTY_BUILDING_TYPES.min
  const rows = Array.isArray(data.types) ? data.types : []
  const types = rows.flatMap(row => {
    if (!isObject(row) || typeof row.key !== 'string') return []
    const def = parseFootprint(row.default)
    return def ? [{ key: row.key, default: def }] : []
  })
  return { types, min }
}

export async function fetchBuildingTypes(): Promise<BuildingTypeCatalog> {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error(`Failed to load the building types: ${res.statusText}`)
  return parseBuildingTypes(await res.json())
}

/**
 * The synthetic kind a composed building is installed under.
 *
 * It carries the size, so two sizes of house are two entries in the catalog and the arming code keeps
 * working on a plain kind string. The `@` is deliberate: no seeded composition name contains one, so a
 * composed kind can never collide with an authored one.
 */
export function composedKind(type: string, size: Footprint): string {
  return `${type}@${size.w}x${size.h}`
}

export interface ComposeOptions {
  material?: string
  roof?: string
  roofTop?: string
  /** Reproducible material roll — pass one for a stable picture, omit for a fresh roll. */
  seed?: number
}

/**
 * Ask the backend for a building of this size and install it, returning the kind to arm.
 *
 * Already-installed sizes are served from the catalog rather than re-fetched: a user stepping a size
 * control from 4 to 8 would otherwise fire five requests and re-install identical data.
 */
export async function composeBuilding(
  styleId: string,
  type: string,
  size: Footprint,
  opts: ComposeOptions = {},
): Promise<string> {
  const kind = composedKind(type, size)
  if (styleCatalog(styleId)?.compositions?.[kind]) return kind

  const query = new URLSearchParams({ width: String(size.w), depth: String(size.h) })
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const res = await fetch(`${BASE}/${encodeURIComponent(type)}?${query}`)
  if (!res.ok) throw new Error(`Could not build a ${size.w}x${size.h} ${type}: ${res.statusText}`)
  const body: unknown = await res.json()
  const data = isObject(body) && isObject(body.data) ? body.data : undefined
  const footprint = parseFootprint(data?.footprint)
  if (!data || !footprint || !Array.isArray(data.cells)) {
    throw new Error(`The backend served no usable ${type} at ${size.w}x${size.h}`)
  }

  // Installed in the SAME shape the tileset loader installs a seeded composition, so every reader —
  // the ghost, the stamp, the preview, the palette — treats it identically.
  setStyleComposition(styleId, kind, {
    footprint,
    cells: data.cells,
    category: 'buildings',
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
  } as never)
  return kind
}

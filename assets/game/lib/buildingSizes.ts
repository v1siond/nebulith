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
  return `${backendTypeKey(type)}@${size.w}x${size.h}`
}

/**
 * The BACKEND's spelling of a building type.
 *
 * The frontend's `BuildingType` uses hyphens (`big-house`); the backend's keys use underscores
 * (`big_house`), and it documents that convention itself — *"keyed by type_length (hyphens in the type
 * become underscores)"*. One place converts, so a plan naming `big-house` still finds the composition that
 * was pre-composed under `big_house` instead of silently placing nothing.
 */
export function backendTypeKey(type: string): string {
  return type.replace(/-/g, '_')
}

/**
 * The TYPE inside a kind, composed or not — `house@6x4` → `house`, `fountain` → `fountain`.
 *
 * The inverse of `composedKind`, and the palette needs it: arming a composed building sets the armed kind
 * to the synthetic one, so a palette matching `armedKind === item.kind` immediately stopped recognising its
 * own entry — the size control vanished after the first change and the swatch un-highlighted.
 */
export function typeOfComposedKind(kind: string): string {
  const at = kind.indexOf('@')
  return at === -1 ? kind : kind.slice(0, at)
}

/** The size inside a composed kind, or undefined when it carries none. */
export function sizeOfComposedKind(kind: string): Footprint | undefined {
  const match = /@(\d+)x(\d+)$/.exec(kind)
  return match ? { w: Number(match[1]), h: Number(match[2]) } : undefined
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

/**
 * A `BuildingSizes` backed by the BACKEND's default footprints.
 *
 * Alexander, 2026-09-09: *"user will specify the size or we'd use the default one. For randomizers, we
 * randomize the footprint and house adapts to it … even the footprint should come from backend, then
 * frontend draws."* So the generator rolls around these numbers and the building is composed to fit
 * whatever it rolls — nothing snaps to an authored size.
 *
 * Undefined until `/api/buildings` has answered, and the planner then keeps using the composition-backed
 * source. That is not a fallback in the forbidden sense: it is the OLD behaviour, unchanged, for the window
 * before the backend has spoken.
 */
export function buildingSizeSource(catalog: BuildingTypeCatalog): {
  depthOf: (type: string, length: number) => number | null
  lengthOf: (type: string) => number | null
  defaultOf: (type: string) => Footprint | null
} | undefined {
  if (catalog.types.length === 0) return undefined
  const byKey = new Map(catalog.types.map(t => [t.key, t]))
  // Looked up by the BACKEND's spelling — see `backendTypeKey`.
  const defaultOf = (type: string) => byKey.get(backendTypeKey(type))?.default ?? null
  return {
    defaultOf,
    lengthOf: (type: string) => defaultOf(type)?.w ?? null,
    depthOf: (type: string) => defaultOf(type)?.h ?? null,
  }
}

/**
 * Install every composition a generated stage names, so the synchronous stamp can find them.
 *
 * The generator plans first and stamps second, which is the seam this uses: by the time a stage exists it
 * has already decided each building's footprint and named the composition for it, so the names can be
 * collected and fetched before anything is placed.
 *
 * DISTINCT kinds only, and `composeBuilding` returns early for one already in the catalog — so a town of
 * eighteen buildings is a handful of requests, and a re-generate at the same sizes is none. A kind that
 * fails to compose is warned about and skipped: the stamp then places nothing for that plot, which is the
 * correct outcome for a building the backend could not lay out.
 */
export async function installComposedBuildings(
  stage: { buildings: readonly { kind: string }[] },
  styleId: string,
): Promise<void> {
  const wanted = new Map<string, Footprint>()
  for (const building of stage.buildings) {
    const size = sizeOfComposedKind(building.kind)
    if (size) wanted.set(building.kind, size)
  }
  await Promise.all(
    [...wanted].map(([kind, size]) =>
      composeBuilding(styleId, typeOfComposedKind(kind), size).catch((err: unknown) =>
        console.warn(`[buildings] the stage wants ${kind} and the backend could not compose it`, err),
      ),
    ),
  )
}

/**
 * Install every footprint a GENERATE could plan, before it plans.
 *
 * The ordering problem this solves: `generateStage` reads each building's composition while planning, to
 * learn its real DOOR SPAN — so composing after the plan is too late, and the generator correctly warns
 * that it is "opening a GUESSED 1-cell entrance". But the kinds are not known until the plan exists,
 * because they depend on the footprints it rolls.
 *
 * The way out is that the rolls are not arbitrary: `plotWidth` picks a house width from the SERVED
 * `houseWidths` and every other type takes its served default. So the set of footprints a generate could
 * possibly want is enumerable up front — a handful, about ten for a town — and composing them first makes
 * the generate single-pass, deterministic and warning-free.
 *
 * Failures are warned and skipped, never thrown: one type the backend cannot lay out must not stop a whole
 * world from generating.
 */
export async function installPlannableBuildings(
  styleId: string,
  catalog: BuildingTypeCatalog,
  houseWidths: readonly number[] = [],
): Promise<void> {
  if (catalog.types.length === 0) return
  const wanted = new Map<string, { type: string; size: Footprint }>()
  const want = (type: string, size: Footprint) => wanted.set(composedKind(type, size), { type, size })

  for (const { key, default: size } of catalog.types) {
    want(key, size)
    // A house is the one type the settlement config re-weights, so its widths come from there — at the
    // type's own default depth, which is what `plotDepth` uses.
    if (key === 'house') for (const w of new Set(houseWidths)) want(key, { w, h: size.h })
  }

  await Promise.all(
    [...wanted.values()].map(({ type, size }) =>
      composeBuilding(styleId, type, size).catch((err: unknown) =>
        console.warn(`[buildings] could not pre-compose a ${size.w}x${size.h} ${type}`, err),
      ),
    ),
  )
}

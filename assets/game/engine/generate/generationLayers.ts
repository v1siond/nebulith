/**
 * THE GENERATION LAYERS, as the backend serves them.
 *
 * *"I think these layers should be backend based and I think we should be able to create them in the backend …
 * I just don't want anything hardcoded on the frontend, of course, tests ARE OK … but we're also hardcoding on
 * the actual engine, that's where we need to update it"* (2026-09-14).
 *
 * So there is no list of layer names in this repo any more. The engine asks what the layers ARE and binds its
 * passes to the keys that come back; the editor builds its re-roll panel from the same answer. Adding fog,
 * shadow, lighting, reprocess or water reflection is a row in the backend, not a release here.
 *
 * WHAT IS SERVED AND WHAT IS CODE. A layer's IDENTITY is served: `key`, `label`, `hint`, the `position` it runs
 * at, and whether it is `seedable`. Its BEHAVIOUR is a function in `stageGenerator`, bound by `key`. A served
 * layer the engine has no pass for is simply not run, and a pass whose layer is not served does not run either:
 * the served list is the order, so the backend decides what happens and when.
 *
 * READ IT WITH A FUNCTION, NEVER AT MODULE SCOPE. A `const` here would freeze the EMPTY list at import time and
 * every caller would see no layers for the life of the tab, which is the exact shape of the bug that once
 * served a brute 8 damage instead of 18.
 */
import { NEBULITH_API } from '@/lib/nebulithApi'

/** One step of generation, as served. */
export interface GenerationLayer {
  /** What the engine binds its pass to. Lower snake_case, unique. */
  key: string
  /** What the panel calls it. */
  label: string
  /** What the panel says about it. */
  hint: string
  /** Where it runs in the order. Lower runs first. */
  position: number
  /** Whether it draws from a seed you can re-roll. A layer decided entirely by the ones above it says false,
   *  and the panel offers no button rather than one that does nothing. */
  seedable: boolean
}

/** The loaded list. Empty until something installs one: an empty list is "the backend has not answered", and
 *  every reader treats that as "no layers", never as a reason to fall back to a list of its own. */
let loaded: readonly GenerationLayer[] = []

/** Turn a `/api/generation_layers` body into layers, in run order. A row missing the two things that make it a
 *  layer (a key to bind to, a label to show) is DROPPED rather than half-installed. */
export function parseGenerationLayers(body: unknown): readonly GenerationLayer[] {
  const rows = (body as { generationLayers?: unknown })?.generationLayers
  if (!Array.isArray(rows)) return []
  return rows
    .map(row => row as Partial<GenerationLayer>)
    .filter(row => typeof row.key === 'string' && row.key !== '' && typeof row.label === 'string' && row.label !== '')
    .map(row => ({
      key: row.key!,
      label: row.label!,
      hint: typeof row.hint === 'string' ? row.hint : '',
      position: typeof row.position === 'number' ? row.position : 0,
      seedable: row.seedable !== false,
    }))
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
}

/** Install a served payload. The one door in, so a test installs a body exactly as the app does. */
export function installGenerationLayers(body: unknown): void {
  loaded = parseGenerationLayers(body)
}

/** Every layer the backend serves, in run order. A FUNCTION on purpose: see the note above. */
export function generationLayers(): readonly GenerationLayer[] {
  return loaded
}

/** The keys, in run order. What the engine walks and what the panel lists. */
export function generationLayerKeys(): readonly string[] {
  return loaded.map(layer => layer.key)
}

/** The keys that draw from a seed, so the panel offers a re-roll only where one means something. */
export function seedableLayerKeys(): readonly string[] {
  return loaded.filter(layer => layer.seedable).map(layer => layer.key)
}

/** Fetch the layers from the backend and install them. Throws like every other client so a failed load is
 *  reported rather than silently leaving the editor with no layers. */
export async function loadGenerationLayers(): Promise<readonly GenerationLayer[]> {
  const response = await fetch(`${NEBULITH_API}/generation_layers`)
  if (!response.ok) throw new Error(`The generation layers could not be loaded (${response.status})`)
  installGenerationLayers(await response.json())
  return generationLayers()
}

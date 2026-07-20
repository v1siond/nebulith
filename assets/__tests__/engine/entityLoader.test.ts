/**
 * The entity resolution loader — the frontend's SOLE source of how an enemy `enemyType` / a person
 * `variant` resolves to a baked tile slug. `loadEntitiesFromBackend` fetches `GET /api/entities` and
 * installs the payload into the (empty) holder; there is NO bundled fallback.
 *
 * GATE + NO-FALLBACK contract (the twin of tilesetGate.test.ts): a successful load installs the map and
 * returns true (the render gate's entity requirement is met); a failed/non-OK/malformed load installs
 * NOTHING and returns false, so the caller keeps the render gated (the full UI gate is validated on the
 * running page). This proves the data contract the gate composes with `loadTilesetsFromBackend`.
 */
import { loadEntitiesFromBackend, installEntityPayload } from '@/engine/entity/entityLoader'
import { getEntityResolution, clearEntityResolution, type EntityResolution } from '@/engine/entity/entityResolution'

const realFetch = global.fetch

const PAYLOAD: EntityResolution = {
  dir: '/tiles/emoji/baked/entities',
  tiles: { goblin: '👺', man: '🧍‍♂️', robot: '🤖' },
  enemyTypeSlug: { goblin: 'goblin', bandit: 'ninja', orc: 'ogre' },
  variantSlug: { male: 'man', robot: 'robot' },
}

// Reset the holder to empty after each case so nothing leaks to a sibling test (the success case installs).
afterEach(() => {
  ;(global as { fetch: typeof fetch }).fetch = realFetch
  clearEntityResolution()
})

describe('installEntityPayload — installs the resolution into the live holder', () => {
  test('a captured payload becomes the live resolution (no network)', () => {
    installEntityPayload(PAYLOAD)
    const r = getEntityResolution()
    expect(r.enemyTypeSlug.bandit).toBe('ninja') // a bandit draws the ninja tile
    expect(r.variantSlug.male).toBe('man')
    expect('goblin' in r.tiles).toBe(true)
  })
})

describe('loadEntitiesFromBackend — a successful load opens the gate', () => {
  test('installs the backend map and returns true', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: PAYLOAD }) }) as unknown as typeof fetch
    const ok = await loadEntitiesFromBackend()
    expect(ok).toBe(true)
    expect(getEntityResolution().enemyTypeSlug.orc).toBe('ogre')
  })

  test('accepts an un-enveloped body too (no `data` wrapper)', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => PAYLOAD }) as unknown as typeof fetch
    const ok = await loadEntitiesFromBackend()
    expect(ok).toBe(true)
    expect(getEntityResolution().variantSlug.robot).toBe('robot')
  })
})

describe('loadEntitiesFromBackend — no fallback (the render stays gated)', () => {
  test('a FAILED fetch installs nothing and returns false', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const ok = await loadEntitiesFromBackend()
    expect(ok).toBe(false)
    expect(Object.keys(getEntityResolution().tiles)).toHaveLength(0) // holder untouched — NO bundled fallback
  })

  test('a non-OK response installs nothing and returns false', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    const ok = await loadEntitiesFromBackend()
    expect(ok).toBe(false)
    expect(Object.keys(getEntityResolution().enemyTypeSlug)).toHaveLength(0)
  })

  test('a malformed body (missing tiles) installs nothing and returns false', async () => {
    ;(global as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { dir: '/x' } }) }) as unknown as typeof fetch
    const ok = await loadEntitiesFromBackend()
    expect(ok).toBe(false)
    expect(Object.keys(getEntityResolution().tiles)).toHaveLength(0)
  })
})

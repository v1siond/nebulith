/**
 * THE ONE-SHOT localStorage → BACKEND GAMES IMPORT.
 *
 * §5.3 rates deleting the localStorage games system **HIGH risk**: "Any user with data under
 * `nebulith:games` loses it. Needs a one-shot migration (read the key, POST /api/games each,
 * clear)." This is that migration, so the risk is retired rather than accepted.
 *
 * The behaviour that matters is the failure path: a half-finished import that clears the key
 * DESTROYS the very data it was written to save. So the key is cleared only when every game landed.
 */
import { GAMES_STORAGE_KEY, importLocalGames } from '@/lib/gamesMigration'

const stored = (games: unknown) => JSON.stringify(games)
const ONE_GAME = [{ id: 'game_x', name: 'Boss', templateIds: ['t1', 't2'] }]

/** A stub of the migration's three seams: read the key, create a backend game, clear the key. */
function harness(raw: string | null, create?: jest.Mock) {
  const clear = jest.fn()
  const createGame = create ?? jest.fn(async () => ({ id: 'uuid-1' }))
  return { deps: { read: () => raw, clear, createGame }, clear, createGame }
}

describe('importLocalGames', () => {
  it('does nothing when there is no stored key', async () => {
    const { deps, clear, createGame } = harness(null)
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 0, skipped: 0 })
    expect(createGame).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  it('posts each stored game to the backend, keeping its name and level order', async () => {
    const { deps, createGame } = harness(stored(ONE_GAME))
    await importLocalGames(deps)
    expect(createGame).toHaveBeenCalledWith({ name: 'Boss', templateIds: ['t1', 't2'] })
  })

  it('clears the key once every game is safely in the backend', async () => {
    const { deps, clear } = harness(stored(ONE_GAME))
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 1, skipped: 0 })
    expect(clear).toHaveBeenCalled()
  })

  it('KEEPS the key when a create fails — a half-import must not destroy the source', async () => {
    const createGame = jest.fn()
      .mockResolvedValueOnce({ id: 'uuid-1' })
      .mockRejectedValueOnce(new Error('backend down'))
    const twoGames = [...ONE_GAME, { id: 'game_y', name: 'Caves', templateIds: ['t3'] }]
    const { deps, clear } = harness(stored(twoGames), createGame)

    await expect(importLocalGames(deps)).rejects.toThrow('backend down')
    expect(clear).not.toHaveBeenCalled()
  })

  it('skips malformed entries rather than throwing — a broken key must not block the editor', async () => {
    const mixed = [...ONE_GAME, { id: 42 }, null, { name: 'no id' }]
    const { deps, createGame, clear } = harness(stored(mixed))
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 1, skipped: 3 })
    expect(createGame).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalled()
  })

  it('clears a key holding nothing importable, so it stops being asked about', async () => {
    const { deps, clear, createGame } = harness(stored([{ nope: true }]))
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 0, skipped: 1 })
    expect(createGame).not.toHaveBeenCalled()
    expect(clear).toHaveBeenCalled()
  })

  it('survives unparseable JSON', async () => {
    const { deps, clear } = harness('{not json')
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 0, skipped: 0 })
    expect(clear).not.toHaveBeenCalled()
  })

  it('survives a payload that is not a list', async () => {
    const { deps } = harness(stored({ games: [] }))
    await expect(importLocalGames(deps)).resolves.toEqual({ imported: 0, skipped: 0 })
  })

  it('names an unnamed game rather than posting a blank', async () => {
    const { deps, createGame } = harness(stored([{ id: 'g', name: '   ', templateIds: [] }]))
    await importLocalGames(deps)
    expect(createGame).toHaveBeenCalledWith({ name: 'Imported game', templateIds: [] })
  })
})

describe('the storage key', () => {
  it('is the one the old store actually wrote', () => {
    expect(GAMES_STORAGE_KEY).toBe('nebulith:games')
  })
})

import {
  GAMES_STORAGE_KEY,
  parseGames,
  serializeGames,
  loadGames,
  saveGames,
} from '@/game/gamesStore'
import { addTemplate, createGame, reorderTemplate } from '@/game/games'

describe('gamesStore — parse/serialize (pure)', () => {
  it('round-trips a games list', () => {
    const games = [createGame('A', ['t1', 't2']), createGame('B', ['t3'])]
    const back = parseGames(serializeGames(games))
    expect(back).toEqual(games)
  })

  it('returns [] for null/empty/garbage payloads (never throws)', () => {
    expect(parseGames(null)).toEqual([])
    expect(parseGames('')).toEqual([])
    expect(parseGames('not json {')).toEqual([])
    expect(parseGames('{"not":"an array"}')).toEqual([])
  })

  it('drops malformed entries but keeps the valid ones', () => {
    const valid = createGame('Good', ['a'])
    const raw = JSON.stringify([
      valid,
      { id: 'x', name: 'no ids' }, // missing templateIds
      { name: 'no id', templateIds: [] }, // missing id
      { id: 'y', name: 'bad ids', templateIds: ['ok', 5] }, // non-string id
      42,
      null,
    ])
    const parsed = parseGames(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toEqual(valid)
  })

  it('copies templateIds (no shared references with the parsed source string)', () => {
    const parsed = parseGames(JSON.stringify([createGame('A', ['a', 'b'])]))
    parsed[0].templateIds.push('c')
    const reparsed = parseGames(JSON.stringify([createGame('A', ['a', 'b'])]))
    expect(reparsed[0].templateIds).toEqual(['a', 'b'])
  })
})

describe('gamesStore — localStorage round-trip (create / edit / reload)', () => {
  // jest.setup mocks localStorage with no backing store, so back it with an in-memory
  // Map here (the global beforeEach only mockClear()s these — implementations survive).
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    ;(window.localStorage.getItem as jest.Mock).mockImplementation((k: string) => store.get(k) ?? null)
    ;(window.localStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
      store.set(k, v)
    })
  })

  it('saves under the nebulith:games key and reloads identically', () => {
    const games = [createGame('Campaign', ['lvl1', 'lvl2'])]
    saveGames(games)
    expect(window.localStorage.getItem(GAMES_STORAGE_KEY)).toBeTruthy()
    expect(loadGames()).toEqual(games)
  })

  it('persists edits across a reload (add a level, reorder, save again)', () => {
    let game = createGame('Campaign', ['lvl1', 'lvl2'])
    saveGames([game])

    // edit: add a level + reorder, persist, then "reload"
    game = addTemplate(game, 'lvl3')
    game = reorderTemplate(game, 2, 0) // lvl3 becomes level 1
    saveGames([game])

    const reloaded = loadGames()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].templateIds).toEqual(['lvl3', 'lvl1', 'lvl2'])
  })

  it('loads [] when nothing has been saved', () => {
    expect(loadGames()).toEqual([])
  })
})

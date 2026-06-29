import {
  createGame,
  renameGame,
  addTemplate,
  reorderTemplate,
  removeTemplate,
  levelTemplate,
  levelCount,
  getGame,
  upsertGame,
  deleteGame,
  type Game,
} from '@/game/games'

/** A game with three ordered levels: a (lvl1), b (lvl2), c (lvl3). */
const threeLevels = (): Game => createGame('Dungeon Run', ['a', 'b', 'c'])

describe('games — createGame', () => {
  it('builds a game with a unique id, the given name, and ordered templateIds', () => {
    const g = createGame('My Game', ['x', 'y'])
    expect(g.name).toBe('My Game')
    expect(g.templateIds).toEqual(['x', 'y'])
    expect(g.id).toMatch(/^game_/)
  })

  it('defaults to an empty level list and trims/falls back blank names', () => {
    expect(createGame('Solo').templateIds).toEqual([])
    expect(createGame('  Trim Me  ').name).toBe('Trim Me')
    expect(createGame('   ').name).toBe('Untitled game')
  })

  it('gives two games distinct ids', () => {
    expect(createGame('a').id).not.toBe(createGame('b').id)
  })

  it('copies the input ids (does not alias the caller array)', () => {
    const src = ['a', 'b']
    const g = createGame('G', src)
    src.push('c')
    expect(g.templateIds).toEqual(['a', 'b'])
  })
})

describe('games — renameGame', () => {
  it('returns a new game with the new name, ids untouched', () => {
    const g = threeLevels()
    const r = renameGame(g, 'Renamed')
    expect(r.name).toBe('Renamed')
    expect(r.templateIds).toEqual(['a', 'b', 'c'])
    expect(g.name).toBe('Dungeon Run') // input untouched
  })
})

describe('games — addTemplate (append as next level)', () => {
  it('appends a template as the new highest level', () => {
    const g = addTemplate(threeLevels(), 'd')
    expect(g.templateIds).toEqual(['a', 'b', 'c', 'd'])
    expect(levelTemplate(g, 4)).toBe('d')
  })

  it('does not mutate the input game', () => {
    const g = threeLevels()
    addTemplate(g, 'd')
    expect(g.templateIds).toEqual(['a', 'b', 'c'])
  })

  it('allows the same template to repeat across levels', () => {
    const g = addTemplate(threeLevels(), 'a')
    expect(g.templateIds).toEqual(['a', 'b', 'c', 'a'])
  })
})

describe('games — reorderTemplate (order IS the level sequence)', () => {
  it('moves a level from one index to another, preserving the rest', () => {
    const g = reorderTemplate(threeLevels(), 0, 2) // a,b,c -> b,c,a
    expect(g.templateIds).toEqual(['b', 'c', 'a'])
  })

  it('moves a later level earlier (drag up)', () => {
    const g = reorderTemplate(threeLevels(), 2, 0) // a,b,c -> c,a,b
    expect(g.templateIds).toEqual(['c', 'a', 'b'])
  })

  it('keeps integrity: same multiset of ids, just reordered', () => {
    const g = reorderTemplate(threeLevels(), 1, 2)
    expect([...g.templateIds].sort()).toEqual(['a', 'b', 'c'])
    expect(g.templateIds).toEqual(['a', 'c', 'b'])
  })

  it('out-of-range or no-op indices return the game unchanged', () => {
    const g = threeLevels()
    expect(reorderTemplate(g, 1, 1).templateIds).toEqual(['a', 'b', 'c'])
    expect(reorderTemplate(g, -1, 2).templateIds).toEqual(['a', 'b', 'c'])
    expect(reorderTemplate(g, 0, 9).templateIds).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input game', () => {
    const g = threeLevels()
    reorderTemplate(g, 0, 2)
    expect(g.templateIds).toEqual(['a', 'b', 'c'])
  })
})

describe('games — removeTemplate (by level index)', () => {
  it('removes the level at the index, shifting the rest up', () => {
    const g = removeTemplate(threeLevels(), 1) // remove b
    expect(g.templateIds).toEqual(['a', 'c'])
    expect(levelTemplate(g, 2)).toBe('c') // c is now level 2
  })

  it('removing only the targeted index keeps the others intact', () => {
    expect(removeTemplate(threeLevels(), 0).templateIds).toEqual(['b', 'c'])
    expect(removeTemplate(threeLevels(), 2).templateIds).toEqual(['a', 'b'])
  })

  it('out-of-range index returns the game unchanged', () => {
    expect(removeTemplate(threeLevels(), 9).templateIds).toEqual(['a', 'b', 'c'])
    expect(removeTemplate(threeLevels(), -1).templateIds).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input game', () => {
    const g = threeLevels()
    removeTemplate(g, 0)
    expect(g.templateIds).toEqual(['a', 'b', 'c'])
  })
})

describe('games — levelTemplate / levelCount (level N → templateIds[N-1])', () => {
  it('maps 1-based level N to the right template id', () => {
    const g = threeLevels()
    expect(levelTemplate(g, 1)).toBe('a')
    expect(levelTemplate(g, 2)).toBe('b')
    expect(levelTemplate(g, 3)).toBe('c')
  })

  it('returns undefined for out-of-range levels (0, negative, past the end)', () => {
    const g = threeLevels()
    expect(levelTemplate(g, 0)).toBeUndefined()
    expect(levelTemplate(g, -1)).toBeUndefined()
    expect(levelTemplate(g, 4)).toBeUndefined()
  })

  it('counts the levels', () => {
    expect(levelCount(threeLevels())).toBe(3)
    expect(levelCount(createGame('Empty'))).toBe(0)
  })
})

describe('games — collection ops (getGame / upsertGame / deleteGame)', () => {
  it('finds a game by id, undefined for a miss', () => {
    const g = threeLevels()
    expect(getGame([g], g.id)).toBe(g)
    expect(getGame([g], 'nope')).toBeUndefined()
  })

  it('upsert appends a new game, preserving list order', () => {
    const a = createGame('A')
    const b = createGame('B')
    const list = upsertGame([a], b)
    expect(list.map(g => g.name)).toEqual(['A', 'B'])
  })

  it('upsert replaces the game with the same id in place', () => {
    const a = createGame('A')
    const b = createGame('B')
    const renamed = renameGame(a, 'A2')
    const list = upsertGame([a, b], renamed)
    expect(list.map(g => g.name)).toEqual(['A2', 'B'])
    expect(list).toHaveLength(2)
  })

  it('upsert does not mutate the input list', () => {
    const a = createGame('A')
    const before = [a]
    upsertGame(before, createGame('B'))
    expect(before).toHaveLength(1)
  })

  it('delete removes by id, leaving the rest', () => {
    const a = createGame('A')
    const b = createGame('B')
    const list = deleteGame([a, b], a.id)
    expect(list.map(g => g.name)).toEqual(['B'])
  })

  it('delete is a no-op for an unknown id', () => {
    const a = createGame('A')
    expect(deleteGame([a], 'nope')).toHaveLength(1)
  })
})

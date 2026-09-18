/**
 * AUTO-NAMING A NEW GAME.
 *
 * So creating a game asks nothing. The name has to be generated, and it has to be generated well
 * enough that a gallery of them stays readable: no collisions, and the numbers keep counting up
 * instead of reusing a gap and producing two "Game 3"s a rename apart.
 */
import { nextGameName, nextLevelName, resolveLevelName } from '@/game/autoNaming'

const named = (...names: string[]) => names.map(name => ({ name }))

describe('nextGameName', () => {
  it('starts at 1 when there are no games', () => {
    expect(nextGameName([])).toBe('Game 1')
  })

  it('counts past the highest existing number', () => {
    expect(nextGameName(named('Game 1', 'Game 2'))).toBe('Game 3')
  })

  it('does not refill a gap, a deleted Game 2 stays deleted', () => {
    expect(nextGameName(named('Game 1', 'Game 3'))).toBe('Game 4')
  })

  it('ignores games the user renamed', () => {
    expect(nextGameName(named('Boss', 'The Caves'))).toBe('Game 1')
  })

  it('counts around renamed games', () => {
    expect(nextGameName(named('Boss', 'Game 7', 'The Caves'))).toBe('Game 8')
  })

  it('is case- and space-tolerant, so "game  2" still blocks "Game 2"', () => {
    expect(nextGameName(named('game  2'))).toBe('Game 3')
  })

  it('never collides with a name already taken', () => {
    const existing = named('Game 1', 'Game 2', 'Game 3')
    expect(existing.some(g => g.name === nextGameName(existing))).toBe(false)
  })

  it('ignores a name that merely contains a number', () => {
    expect(nextGameName(named('Level 9 Game', 'Game of 5'))).toBe('Game 1')
  })
})

describe('nextLevelName uses the editor\'s word for a template', () => {
  it('counts levels, not games', () => {
    expect(nextLevelName(named('Level 1', 'Game 9'))).toBe('Level 2')
  })

  it('starts at 1 in a fresh game', () => {
    expect(nextLevelName([])).toBe('Level 1')
  })

  it('leaves hand-named levels alone', () => {
    expect(nextLevelName(named('village', 'boss-arena'))).toBe('Level 1')
  })
})

// A SAVE IS NEVER BLOCKED FOR WANT OF A NAME. The editor starts on an empty name and the name field only
// rendered outside a game, so Save sat permanently disabled with nothing to click that would fix it.
describe('resolveLevelName', () => {
  it('keeps the name the person typed', () => {
    expect(resolveLevelName('village', named('Level 1'))).toBe('village')
  })

  it('trims it, so spaces are not a name', () => {
    expect(resolveLevelName('  boss arena  ', [])).toBe('boss arena')
  })

  it('generates one when the field is empty, which is what unblocks Save', () => {
    expect(resolveLevelName('', named('Level 1', 'Level 2'))).toBe('Level 3')
  })

  it('generates one when the field holds only whitespace', () => {
    expect(resolveLevelName('   ', [])).toBe('Level 1')
  })

  it('counts around hand-named levels, like the generator it delegates to', () => {
    expect(resolveLevelName('', named('village', 'Level 4'))).toBe('Level 5')
  })
})

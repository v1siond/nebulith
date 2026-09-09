/**
 * AUTO-NAMING A NEW GAME.
 *
 * Alexander: "we implemented an alert with an input to ask for the game name when creating a new
 * one, that's the worst UX ever … just assign a random name or put something generic like 'game X'
 * and redirect user to the editor right away."
 *
 * So creating a game asks nothing. The name has to be generated, and it has to be generated well
 * enough that a gallery of them stays readable: no collisions, and the numbers keep counting up
 * instead of reusing a gap and producing two "Game 3"s a rename apart.
 */
import { nextGameName, nextLevelName } from '@/game/autoNaming'

const named = (...names: string[]) => names.map(name => ({ name }))

describe('nextGameName', () => {
  it('starts at 1 when there are no games', () => {
    expect(nextGameName([])).toBe('Game 1')
  })

  it('counts past the highest existing number', () => {
    expect(nextGameName(named('Game 1', 'Game 2'))).toBe('Game 3')
  })

  it('does not refill a gap — a deleted Game 2 stays deleted', () => {
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

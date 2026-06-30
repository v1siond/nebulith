import {
  playerDisplayName,
  DEFAULT_PLAYER_NAME,
  barFraction,
} from '@/pages/personal-projects/game-engine/templates'
import { entitiesToAssets, entitiesFromAssets } from '@/lib/gridCodec'
import { makePlayer, makeEnemy } from '@/game/entities'

// ───────────────────────────────────────────────────────────────────────────
// PLAYER NAME — an editable, savable name on the player entity, shown the way an
// enemy shows its type/name (over the life bar) + in the inventory header. These
// drive the REAL pure helpers + the persistence codec the editor saves through.
// ───────────────────────────────────────────────────────────────────────────

describe('playerDisplayName — the shown name with a default fallback', () => {
  it('falls back to the default when no name is set', () => {
    expect(playerDisplayName(undefined)).toBe(DEFAULT_PLAYER_NAME)
    expect(playerDisplayName(null)).toBe(DEFAULT_PLAYER_NAME)
    expect(playerDisplayName('')).toBe(DEFAULT_PLAYER_NAME)
  })

  it('falls back to the default for a whitespace-only name', () => {
    expect(playerDisplayName('   ')).toBe(DEFAULT_PLAYER_NAME)
  })

  it('shows a real name, trimmed', () => {
    expect(playerDisplayName('Aragorn')).toBe('Aragorn')
    expect(playerDisplayName('  Bob  ')).toBe('Bob')
  })

  it('default is a non-empty string', () => {
    expect(DEFAULT_PLAYER_NAME.length).toBeGreaterThan(0)
  })
})

describe('barFraction — the life-bar denominator (shared by enemy + player)', () => {
  it('is 0 when max is non-positive', () => {
    expect(barFraction(10, 0)).toBe(0)
    expect(barFraction(10, -5)).toBe(0)
  })

  it('clamps into 0..1', () => {
    expect(barFraction(-3, 100)).toBe(0)
    expect(barFraction(150, 100)).toBe(1)
  })

  it('reports the in-range fraction', () => {
    expect(barFraction(50, 100)).toBeCloseTo(0.5)
    expect(barFraction(25, 100)).toBeCloseTo(0.25)
  })
})

describe('player name persistence — round-trips through the entities codec', () => {
  it('serialize → deserialize preserves the player name', () => {
    const player = makePlayer('p1', 3, 4, 'Aragorn')
    const assets = entitiesToAssets([player])
    const [restored] = entitiesFromAssets(assets)

    expect(restored.kind).toBe('player')
    expect(restored.name).toBe('Aragorn')
    expect(playerDisplayName(restored.name)).toBe('Aragorn')
  })

  it('a renamed player survives the round-trip (set → serialize → deserialize → same name)', () => {
    const player = { ...makePlayer('p1', 1, 1), name: 'Gandalf' }
    const [restored] = entitiesFromAssets(entitiesToAssets([player]))
    expect(restored.name).toBe('Gandalf')
  })

  it('a nameless player round-trips to the default display name', () => {
    const player = makePlayer('p1', 0, 0)
    const [restored] = entitiesFromAssets(entitiesToAssets([player]))
    expect(restored.name).toBeUndefined()
    expect(playerDisplayName(restored.name)).toBe(DEFAULT_PLAYER_NAME)
  })

  it('preserves names across a mixed entity list (player + enemy)', () => {
    const player = makePlayer('p1', 2, 2, 'Hero One')
    const enemy = makeEnemy('e1', 5, 5, 'goblin', { name: 'Snik' })
    const restored = entitiesFromAssets(entitiesToAssets([player, enemy]))
    const rp = restored.find(e => e.kind === 'player')
    const re = restored.find(e => e.kind === 'enemy')
    expect(rp?.name).toBe('Hero One')
    expect(re?.name).toBe('Snik')
  })
})

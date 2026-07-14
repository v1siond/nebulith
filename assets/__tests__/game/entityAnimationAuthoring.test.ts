import '@/__tests__/helpers/installTilesetSeed' // install the DB-equivalent tileset the runtime loads
/**
 * #91 Stage 2 — AUTHORING. The Inspector's AnimationEditor writes `entity.animations`; the engine
 * (Stage 1) plays them. These tests prove the authored DATA an author produces actually plays,
 * that the frame picker is constrained to the entity's own category (characters, not buildings),
 * and that authored animations survive a save→load round-trip. The player IS an entity, so the same
 * authoring path animates the live hero — covered here by authoring onto a `kind: 'player'` entity.
 */
import { activeFrame, type EntityAnimation } from '@/game/runtime/entityAnimation'
import { tilesForStyle } from '@/game/artStyle'
import { entitiesFromAssets, entitiesToAssets } from '@/lib/gridCodec'
import type { Entity, Stats } from '@/game/types'

const STATS: Stats = { strength: 5, intelligence: 5, defense: 5, maxHp: 30 }

/** A PLAYER entity authored (as the editor would produce) with a custom "walk right" animation:
 *  frame 0 = the entity's own tile (empty), frame 1 = a custom 🔥 glyph mirrored to the right. */
function authoredPlayer(): Entity {
  const walkRight: EntityAnimation = {
    id: 'anim-0-custom',
    name: 'walk right (custom)',
    trigger: { on: 'move' },
    direction: 'right',
    frames: [{}, { char: '🔥', flipX: true }],
    durationMs: 300,
    loopDelayMs: 0,
    loop: true,
  }
  return { id: 'p1', kind: 'player', col: 3, row: 4, name: 'Hero', baseStats: STATS, animations: [walkRight] }
}

describe('AC-plays — an authored custom frame actually plays (engine is a dumb player of the data)', () => {
  const player = authoredPlayer()

  test('walking right on the motion beat plays the AUTHORED 🔥 frame, mirrored', () => {
    const f = activeFrame(player.animations, { char: '🧍' }, { moving: true, facing: 'right' }, 150)
    expect(f).toEqual({ char: '🔥', flipX: true })
  })

  test('the empty frame resolves to the entity\'s OWN base tile (frame 0), never mirrored', () => {
    const f = activeFrame(player.animations, { char: '🧍' }, { moving: true, facing: 'right' }, 0)
    expect(f).toEqual({ char: '🧍', flipX: false })
  })

  test('authoring onto the PLAYER entity is what makes the live hero animate (player IS an entity)', () => {
    expect(player.kind).toBe('player')
    expect(player.animations?.[0].trigger.on).toBe('move')
  })
})

describe('AC-picker-constrained — the frame picker draws from the entity CATEGORY (units), not buildings', () => {
  const emoji = tilesForStyle('emoji')

  test('the character picker source (units) is non-empty and contains a person tile', () => {
    expect(emoji.units.length).toBeGreaterThan(0)
    const person = emoji.units.find(t => t.id === 'emoji:person')
    expect(person).toBeDefined()
    // The person tile is now a baked IMAGE (identical on every OS); it still carries its 🧍 source glyph.
    expect(person?.visual).toMatchObject({ char: '🧍' })
  })

  test('buildings is a DIFFERENT, disjoint set — a character never picks a house as a frame', () => {
    expect(emoji.buildings.length).toBeGreaterThan(0)
    const unitIds = new Set(emoji.units.map(t => t.id))
    expect(emoji.buildings.some(t => unitIds.has(t.id))).toBe(false)
    // and the person tile is NOT in the buildings set
    expect(emoji.buildings.some(t => t.id === 'emoji:person')).toBe(false)
  })
})

describe('AC-save — an entity\'s authored animations survive the save→load codec round-trip', () => {
  test('animations are preserved verbatim through entitiesToAssets → entitiesFromAssets', () => {
    const player = authoredPlayer()
    const round = entitiesFromAssets(entitiesToAssets([player]))
    expect(round).toEqual([player])
    expect(round[0].animations).toEqual(player.animations)
  })

  test('an entity with NO animations round-trips too (absent stays absent)', () => {
    const plain: Entity = { id: 'e1', kind: 'enemy', col: 1, row: 1, baseStats: STATS }
    const round = entitiesFromAssets(entitiesToAssets([plain]))
    expect(round).toEqual([plain])
    expect(round[0].animations).toBeUndefined()
  })
})

import { entityArt, entityFootprint, weaponGlyph, SWORD_GLYPH, ENEMY_ART, ENEMY_ART_TYPES, ENEMY_FALLBACK, NPC_ART, entityPalette, ENEMY_PALETTE, CHARACTER_TONES, characterTone, ENEMY_PALETTE_FALLBACK, topRoleColor, TOP_ROLE_COLOR } from '@/engine/entityArt'
import { makeEnemy, makeNpc, makePlayer } from '@/game/entities'
import type { Quest } from '@/game/types'

describe('entityArt — multi-row ASCII for entities', () => {
  it('every enemy type, the fallback, and npc art is non-empty multi-row', () => {
    expect(ENEMY_ART_TYPES.length).toBeGreaterThan(0)
    for (const t of ENEMY_ART_TYPES) {
      const art = ENEMY_ART[t]
      expect(art.length).toBeGreaterThanOrEqual(2) // multi-row
      expect(art.every(r => r.length > 0)).toBe(true)
    }
    expect(ENEMY_FALLBACK.length).toBeGreaterThanOrEqual(2)
    expect(NPC_ART.length).toBeGreaterThanOrEqual(2)
  })

  it('returns typed art for a known enemy and the fallback for an unknown type', () => {
    expect(entityArt(makeEnemy('e1', 0, 0, 'goblin'))).toBe(ENEMY_ART.goblin)
    expect(entityArt(makeEnemy('e2', 1, 1, 'dragon-xyz'))).toBe(ENEMY_FALLBACK)
  })

  it('npc uses the humanoid figure', () => {
    expect(entityArt(makeNpc('n1', 2, 2, { name: 'Bob' }))).toBe(NPC_ART)
  })

  it('entities are at least 2 cells tall (like the player), not 1×1', () => {
    // NPC quest-givers: a humanoid 2 tall, 1 wide — matches the player.
    const npc = entityFootprint(makeNpc('n1', 0, 0, { name: 'Elder' }))
    expect(npc.h).toBeGreaterThanOrEqual(2)
    expect(npc.w).toBe(1)
    // Every monster is at least 2 tall; a wide one spans 2 cells across.
    for (const t of ENEMY_ART_TYPES) {
      const fp = entityFootprint(makeEnemy('e', 0, 0, t))
      expect(fp.h).toBeGreaterThanOrEqual(2)
      expect(fp.w).toBeGreaterThanOrEqual(1)
    }
    expect(entityFootprint(makeEnemy('g', 0, 0, 'goblin')).w).toBe(2) // '(>o<)' is 5 chars → 2 wide
  })
})

describe('weaponGlyph — the held weapon drawn beside the player', () => {
  it('returns nothing when unarmed (no weapon, or the bare-hands kind)', () => {
    expect(weaponGlyph(undefined)).toBe('')
    expect(weaponGlyph(null)).toBe('')
    // bare hands: a weapon exists for combat math but draws NO blade
    expect(weaponGlyph({ kind: 'unarmed', range: 'melee' })).toBe('')
  })

  it('a sword maps to the clean held-blade glyph (the good sword look)', () => {
    expect(weaponGlyph({ kind: 'sword', range: 'melee' })).toBe(SWORD_GLYPH)
    expect(SWORD_GLYPH.length).toBeGreaterThan(0)
  })

  it('a ranged weapon reads as a bow regardless of its kind tag', () => {
    // The catalog's bow is kind:'sword' but range:'ranged' — range wins.
    expect(weaponGlyph({ kind: 'sword', range: 'ranged' })).toBe('}')
  })

  it('a gun reads as a pistol, distinct from the bow', () => {
    const gun = weaponGlyph({ kind: 'gun', range: 'ranged' })
    const bow = weaponGlyph({ kind: 'bow', range: 'ranged' })
    expect(bow).toBe('}')
    expect(gun.length).toBeGreaterThan(0)
    expect(gun).not.toBe(bow) // a gun and a bow don't look the same in hand
  })

  it('melee weapons map to distinct glyphs by kind, and change with the weapon', () => {
    const sword = weaponGlyph({ kind: 'sword', range: 'melee' })
    const axe = weaponGlyph({ kind: 'axe', range: 'melee' })
    const staff = weaponGlyph({ kind: 'staff', range: 'melee' })
    expect(new Set([sword, axe, staff]).size).toBe(3) // each weapon looks different
  })
})

describe('entityPalette — robust fg/bg block colors (the trees\' language)', () => {
  it('gives every enemy type a hex fg + bg pair, distinct hues across the cast', () => {
    for (const t of ENEMY_ART_TYPES) {
      const p = ENEMY_PALETTE[t] ?? ENEMY_PALETTE_FALLBACK
      expect(p.fg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(p.bg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(p.fg).not.toBe(p.bg) // contrast
    }
    const fgs = ENEMY_ART_TYPES.map(t => (ENEMY_PALETTE[t] ?? ENEMY_PALETTE_FALLBACK).fg)
    expect(new Set(fgs).size).toBeGreaterThan(4) // colorful, not one flat enemy color
  })

  it('resolves enemy palette by type, with a fallback for an unknown type', () => {
    expect(entityPalette(makeEnemy('e', 0, 0, 'skeleton'))).toEqual(ENEMY_PALETTE.skeleton)
    expect(entityPalette(makeEnemy('e', 0, 0, 'dragon-xyz'))).toEqual(ENEMY_PALETTE_FALLBACK)
  })

  it('player + npc get a per-id character tone — deterministic by id, varied across ids', () => {
    // every CHARACTER_TONE is a valid bright-on-dark pair
    for (const t of CHARACTER_TONES) {
      expect(t.fg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.bg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t.fg).not.toBe(t.bg)
    }
    // deterministic: the SAME id (regardless of position) always resolves to the same tone
    expect(entityPalette(makeNpc('villager-7', 0, 0))).toEqual(entityPalette(makeNpc('villager-7', 9, 9)))
    expect(entityPalette(makePlayer('hero-1', 0, 0))).toEqual(entityPalette(makePlayer('hero-1', 4, 4)))
    // the tone resolved for an entity is the one characterTone(id) picks
    expect(entityPalette(makeNpc('villager-7', 0, 0))).toEqual(characterTone('villager-7'))
    // varied across a spread of ids (not one flat character color)
    const fgs = Array.from({ length: 16 }, (_, i) => entityPalette(makeNpc(`npc-${i}`, 0, 0)).fg)
    expect(new Set(fgs).size).toBeGreaterThan(2)
  })

  it('the skeleton reads as bone-white on dark + keeps its base/alt dimensions aligned', () => {
    expect(ENEMY_PALETTE.skeleton.fg).toBe('#ece8d2')
    expect(ENEMY_ART.skeleton.length).toBe(5)
  })
})

describe('topRoleColor — top-view > glyph colors by role + quest state', () => {
  const quest = (giverId: string, state: Quest['state']): Quest =>
    ({ giverId, state } as unknown as Quest) // topRoleColor only reads giverId + state

  it('player is yellow, enemy is red', () => {
    expect(topRoleColor(makePlayer('p', 0, 0), [])).toBe(TOP_ROLE_COLOR.player)
    expect(topRoleColor(makeEnemy('e', 0, 0, 'goblin'), [])).toBe(TOP_ROLE_COLOR.enemy)
  })

  it('an NPC is blue by default, green with an available quest, purple with an active one', () => {
    const n = makeNpc('n1', 0, 0)
    expect(topRoleColor(n, [])).toBe(TOP_ROLE_COLOR.npc) // blue
    expect(topRoleColor(n, [quest('n1', 'available')])).toBe(TOP_ROLE_COLOR.questAvailable) // green
    expect(topRoleColor(n, [quest('n1', 'active')])).toBe(TOP_ROLE_COLOR.questActive) // purple
    expect(topRoleColor(n, [quest('other', 'available')])).toBe(TOP_ROLE_COLOR.npc) // not this npc's quest
  })
})

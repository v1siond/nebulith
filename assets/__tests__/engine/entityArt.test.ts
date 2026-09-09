import { clearStyleCatalogs, installStyleTiles } from '@/engine/tileset/styleTiles'
import { entityArt, entityArtFrame, entityFootprint, unitArtLabels, weaponGlyph, weaponEmoji, weaponPose, ASCII_WEAPON_POSE, SWORD_GLYPH, entityPalette, ENEMY_PALETTE, CHARACTER_TONES, characterTone, ENEMY_PALETTE_FALLBACK, topRoleColor, TOP_ROLE_COLOR } from '@/engine/entityArt'
import { makeEnemy, makeNpc, makePlayer } from '@/game/entities'
import type { Quest } from '@/game/types'

// The rows a real backend payload carries — `settings.artFrames`, frame 0 then the movement frame. These
// are the served shapes verbatim (goblin recovered from this repo's own deleted ENEMY_ART, villager from
// NPC_ART), so the reader is exercised against what nebulith actually sends.
const GOBLIN = [
  [' ,-.', '(>o<)', '/|Y|\\', ' d b'],
  [' ,-.', '(>o<)', '\\|Y|/', ' d b'],
]
const VILLAGER = [
  ['  O', ' /|\\', ' / \\'],
  ['  O', ' \\|/', ' / \\'],
]

const installUnitArt = (): void =>
  installStyleTiles('ascii', {
    goblin: { char: 'g', category: 'units', settings: { artFrames: GOBLIN, frameMs: 900 } },
    npc: { char: '@', category: 'units', settings: { artFrames: VILLAGER, frameMs: 900 } },
    player: { char: '@', category: 'units', settings: { artFrames: VILLAGER, frameMs: 900 } },
    // a units tile the backend serves NO figure for — the seeding gap that must read as missing
    mimic: { char: 'm', category: 'units' },
  })

describe('entityArt — the FIGURE comes from the backend, never from this file', () => {
  beforeEach(clearStyleCatalogs)

  it('a unit is a GRID of characters, not one character', () => {
    // THE regression guard. Treating a unit like a terrain slab — one distinct glyph each — is what turned
    // Alexander's whole cast into `♀`/`♂`/`d` (Image #13). A figure has depth AND width.
    installUnitArt()
    for (const entity of [makeEnemy('e', 0, 0, 'goblin'), makeNpc('n', 0, 0), makePlayer('p', 0, 0)]) {
      const art = entityArt(entity)
      expect(art.length).toBeGreaterThanOrEqual(2) // more than one row
      expect(Math.max(...art.map(r => r.length))).toBeGreaterThan(1) // more than one column
    }
  })

  it('reads the SERVED rows for a unit — re-seed the tile and the figure moves', () => {
    installUnitArt()
    expect(entityArt(makeEnemy('e1', 0, 0, 'goblin'))).toEqual(GOBLIN[0])
    expect(entityArt(makeNpc('n1', 2, 2, { name: 'Bob' }))).toEqual(VILLAGER[0])

    // a copied constant could not follow this
    installStyleTiles('ascii', { goblin: { char: 'g', category: 'units', settings: { artFrames: [['xx', 'yy']] } } })
    expect(entityArt(makeEnemy('e1', 0, 0, 'goblin'))).toEqual(['xx', 'yy'])
  })

  it('invents NOTHING for a unit the backend serves no figure for', () => {
    // No substitute goblin: an unserved label has to read as missing, which is a seeding gap to fix in
    // nebulith rather than something the renderer papers over.
    installUnitArt()
    expect(entityArt(makeEnemy('e2', 1, 1, 'mimic'))).toEqual([])
    expect(entityArt(makeEnemy('e3', 1, 1, 'dragon-xyz'))).toEqual([])
  })

  it('resolves nothing at all before the backend answers', () => {
    expect(entityArt(makeNpc('n1', 0, 0))).toEqual([])
    expect(unitArtLabels()).toEqual([])
  })

  it('unitArtLabels asks the CATALOG — a function, so a late load is seen', () => {
    expect(unitArtLabels()).toEqual([]) // read before the load…
    installUnitArt()
    expect(unitArtLabels()).toEqual(['goblin', 'npc', 'player']) // …and again after it
  })
})

describe('entityArtFrame — the movement frames', () => {
  beforeEach(() => { clearStyleCatalogs(); installUnitArt() })

  it('every frame has the SAME dimensions as frame 0, so cycling never jitters the footprint', () => {
    for (const entity of [makeEnemy('e', 0, 0, 'goblin'), makeNpc('n', 0, 0)]) {
      const base = entityArtFrame(entity, 0)
      for (let frame = 1; frame < 4; frame++) {
        const rows = entityArtFrame(entity, frame)
        expect(rows.length).toBe(base.length)
        expect(rows.map(r => r.length)).toEqual(base.map(r => r.length))
      }
    }
  })

  it('wraps at the end of the cycle, forwards and backwards', () => {
    const g = makeEnemy('e', 0, 0, 'goblin')
    expect(entityArtFrame(g, 0)).toEqual(GOBLIN[0])
    expect(entityArtFrame(g, 1)).toEqual(GOBLIN[1])
    expect(entityArtFrame(g, 2)).toEqual(GOBLIN[0]) // wrapped
    expect(entityArtFrame(g, -1)).toEqual(GOBLIN[1]) // a negative index must not read off the end
  })

  it('a unit with no served figure has no frames either', () => {
    expect(entityArtFrame(makeEnemy('e', 0, 0, 'mimic'), 0)).toEqual([])
    expect(entityArtFrame(makeEnemy('e', 0, 0, 'mimic'), 3)).toEqual([])
  })
})

describe('entityFootprint — derived from the SERVED rows', () => {
  beforeEach(() => { clearStyleCatalogs(); installUnitArt() })

  it('entities are at least 2 cells tall (like the player), not 1×1', () => {
    const npc = entityFootprint(makeNpc('n1', 0, 0, { name: 'Elder' }))
    expect(npc.h).toBeGreaterThanOrEqual(2)
    expect(npc.w).toBe(1)
    const goblin = entityFootprint(makeEnemy('g', 0, 0, 'goblin'))
    expect(goblin.h).toBeGreaterThanOrEqual(2)
    expect(goblin.w).toBe(2) // '(>o<)' is 5 chars → 2 cells wide
  })

  it('a unit with no served figure still gets a collision box', () => {
    // The floor is deliberate: collision needs a box for a unit that EXISTS whether or not its picture
    // has loaded. A 0×0 footprint would make it unhittable and un-walkable-around.
    expect(entityFootprint(makeEnemy('e', 0, 0, 'mimic'))).toEqual({ w: 1, h: 2 })
    clearStyleCatalogs()
    expect(entityFootprint(makeNpc('n', 0, 0))).toEqual({ w: 1, h: 2 })
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

  it('weaponEmoji gives a real emoji weapon per kind (for the reskin styles)', () => {
    expect(weaponEmoji({ kind: 'sword' })).toBe('🗡️') // single blade, not ⚔️ (crossed = two swords)
    expect(weaponEmoji({ kind: 'bow' })).toBe('🏹')
    expect(weaponEmoji({ kind: 'staff' })).toBe('🪄')
    expect(weaponEmoji({ kind: 'axe' })).toBe('🪓')
    expect(weaponEmoji({ kind: 'shield' })).toBe('🛡️')
    expect(weaponEmoji({ kind: 'unarmed' })).toBe('') // bare hands draw nothing
    expect(weaponEmoji(null)).toBe('')
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
    for (const p of [...Object.values(ENEMY_PALETTE), ENEMY_PALETTE_FALLBACK]) {
      expect(p.fg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(p.bg).toMatch(/^#[0-9a-f]{6}$/i)
      expect(p.fg).not.toBe(p.bg) // contrast
    }
    const fgs = Object.values(ENEMY_PALETTE).map(p => p.fg)
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

  it('the skeleton reads as bone-white on dark', () => {
    // Its ART dimensions are asserted where the art now lives — nebulith's unit-art guard — and the
    // frame-alignment rule is covered by `entityArtFrame` above.
    expect(ENEMY_PALETTE.skeleton.fg).toBe('#ece8d2')
  })

  it('an editor colour override recolours the fg but keeps the role bg for contrast', () => {
    const e = makeEnemy('e', 0, 0, 'skeleton')
    const base = ENEMY_PALETTE.skeleton
    const colored = entityPalette({ ...e, color: '#ff00aa' })
    expect(colored.fg).toBe('#ff00aa') // the override wins
    expect(colored.bg).toBe(base.bg) // bg unchanged
    expect(entityPalette(e).fg).toBe(base.fg) // no override → role default
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

  it('an editor colour override wins over the role/quest colour', () => {
    const n = makeNpc('n1', 0, 0)
    expect(topRoleColor({ ...n, color: '#123456' }, [])).toBe('#123456')
    expect(topRoleColor({ ...n, color: '#123456' }, [quest('n1', 'active')])).toBe('#123456') // wins over quest state
    expect(topRoleColor(n, [])).toBe(TOP_ROLE_COLOR.npc) // no override → role colour
  })
})

// NOTE: this REPLACES the in-memory emoji tileset (like the backend loader does), so it lives last
// and its own describe — the weaponEmoji tests above rely on the bundled fallback tileset.
describe('weaponPose — the equipped weapon reads its pose from the loaded tileset', () => {
  it('returns the tileset entry pose for emoji, the ascii tileset pose (fallback) for ascii, undefined for unknown', () => {
    installStyleTiles('emoji', { sword: { char: '🗡️', color: '#fff', pose: { rot: 3.14, scale: 1.1 } } } as never)
    expect(weaponPose('sword', 'emoji')).toEqual({ rot: 3.14, scale: 1.1 })
    // ASCII now reads its tileset pose; the bundled ascii tileset carries no per-weapon pose here, so it
    // falls back to the shared ASCII_WEAPON_POSE — the ascii weapon look is data-driven, never regresses.
    expect(weaponPose('sword', 'ascii')).toEqual(ASCII_WEAPON_POSE)
    expect(weaponPose('bow', 'emoji')).toBeUndefined() // not in the tileset → no pose
    expect(weaponPose(undefined, 'emoji')).toBeUndefined()
    expect(weaponPose(undefined, 'ascii')).toBeUndefined()
  })
})

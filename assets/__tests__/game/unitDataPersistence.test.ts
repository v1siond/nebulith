/**
 * UNIT-DATA PERSISTENCE round-trip — proves a unit's LOADOUT (worn gear + bag + specials) and the hero's
 * INVENTORY survive a save→reload EXACTLY, including ORDER, for EVERY unit (player and non-player alike).
 *
 * This is the pure boundary codec (lib/unitDataPersistence.ts) that folds the editor's per-unit loadout
 * map + the hero inventory onto the entities at save and splits them back out on load. The entities then
 * ride the existing `entities` jsonb channel to the nebulith backend, so this round-trip IS the persistence
 * (backend-side proof lives in nebulith/test/.../template_controller_test.exs).
 *
 * Behaviour, not implementation: fixtures are built with the REAL equip / addToBag / unequip mutators
 * (game/loadout.ts) + the REAL inventory mutators (game/inventory.ts), then folded + split — mirroring
 * exactly what the editor does when the user equips, drops, and reorders.
 */
import { foldUnitData, splitUnitData, PLAYER_LOADOUT_KEY, loadoutKeyFor } from '@/lib/unitDataPersistence'
import { createLoadout, equip, unequip, addToBag } from '@/game/loadout'
import { addItem, equipWeapon, removeItem, starterInventory } from '@/game/inventory'
import { makePlayer, makeEnemy, makeNpc } from '@/game/entities'
import type { Entity, Item, Loadout } from '@/game/types'

// ── fixtures ────────────────────────────────────────────────────────
const sword = (id = 'sword'): Item => ({
  id, name: 'Sword', slot: 'weapon',
  weapon: { id, kind: 'sword', name: 'Sword', baseDamage: 10, baseMagic: 0, baseDefense: 0, strengthBonus: 2, intBonus: 0, school: 'physical', range: 'melee', hands: 1, reachCells: 1 },
})
const helm = (id = 'helm'): Item => ({
  id, name: 'Helm', slot: 'armor',
  armor: { id, kind: 'iron', name: 'Helm', defenseBonus: 3, strengthBonus: 1, intBonus: 0, slot: 'helmet' },
})
const potion = (id: string): Item => ({ id, name: id, slot: 'consumable', effect: { hp: 20 } })

const player = () => makePlayer('p1', 5, 5, 'Hero')
const enemy = () => makeEnemy('e1', 9, 9, 'goblin')
const npc = () => makeNpc('n1', 3, 3, { name: 'Merchant' })

/** Round-trip a loadout map + inventory through fold → (serialize as the entities jsonb would) → split. */
function roundTrip(entities: readonly Entity[], loadouts: Record<string, Loadout>, inventory: Parameters<typeof foldUnitData>[2]) {
  const folded = foldUnitData(entities, loadouts, inventory)
  // Simulate the nebulith `entities` jsonb: JSON is the wire format, so prove it survives the encode/decode.
  const wire = JSON.parse(JSON.stringify(folded)) as Entity[]
  return splitUnitData(wire)
}

describe('unitDataPersistence — key mapping', () => {
  it('keys the player loadout under the sentinel, others under the entity id', () => {
    expect(loadoutKeyFor(player())).toBe(PLAYER_LOADOUT_KEY)
    expect(loadoutKeyFor(enemy())).toBe('e1')
    expect(loadoutKeyFor(npc())).toBe('n1')
  })
})

describe('unitDataPersistence — fold is pure + additive', () => {
  it('leaves entities without loadout/inventory untouched (no empty blob)', () => {
    const ents = [enemy()]
    const folded = foldUnitData(ents, {}, null)
    expect(folded[0]).toEqual(ents[0])
    expect(folded[0].loadout).toBeUndefined()
    expect(folded[0].inventory).toBeUndefined()
  })

  it('does not mutate its inputs', () => {
    const ents = [player()]
    const before = JSON.parse(JSON.stringify(ents))
    foldUnitData(ents, { [PLAYER_LOADOUT_KEY]: equip(createLoadout(), sword(), 'weapon1') }, starterInventory())
    expect(ents).toEqual(before)
  })
})

describe('unitDataPersistence — EQUIP survives reload', () => {
  it('an equipped weapon is still equipped after a round-trip', () => {
    const equipped = equip(createLoadout(), sword(), 'weapon1')
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: equipped }, null)
    expect(loadouts[PLAYER_LOADOUT_KEY].equipped.weapon1?.id).toBe('sword')
  })

  it('an equipped armour piece round-trips in its slot', () => {
    const equipped = equip(createLoadout(), helm(), 'helmet')
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: equipped }, null)
    expect(loadouts[PLAYER_LOADOUT_KEY].equipped.helmet?.id).toBe('helm')
  })
})

describe('unitDataPersistence — DROP survives reload', () => {
  it('an item removed from the bag is gone after a round-trip', () => {
    const withTwo = addToBag(addToBag(createLoadout(), potion('a')), potion('b'))
    // "drop" b: unequip is the equip-slot mutator; a bag drop clears the slot — model it as a bag with b removed.
    const dropped: Loadout = { ...withTwo, bag: withTwo.bag.map(s => (s?.id === 'b' ? null : s)) }
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: dropped }, null)
    const ids = loadouts[PLAYER_LOADOUT_KEY].bag.filter(Boolean).map(i => i!.id)
    expect(ids).toContain('a')
    expect(ids).not.toContain('b')
  })

  it('an unequipped weapon is no longer worn after a round-trip', () => {
    const worn = equip(createLoadout(), sword(), 'weapon1')
    const bare = unequip(worn, 'weapon1')
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: bare }, null)
    expect(loadouts[PLAYER_LOADOUT_KEY].equipped.weapon1).toBeUndefined()
  })
})

describe('unitDataPersistence — REORDER survives reload (order is exact)', () => {
  it('bag slot ORDER (including empty gaps) is byte-identical after a round-trip', () => {
    let l = createLoadout()
    l = addToBag(l, potion('first'))
    l = addToBag(l, potion('second'))
    l = addToBag(l, potion('third'))
    // reorder: put 'third' into slot 0, 'first' into slot 2 — a deliberate non-default order with a gap at 1.
    const reordered: Loadout = { ...l, bag: l.bag.map((_, i) => (i === 0 ? potion('third') : i === 1 ? null : i === 2 ? potion('first') : l.bag[i])) }
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: reordered }, null)
    expect(loadouts[PLAYER_LOADOUT_KEY].bag).toEqual(reordered.bag)
    // and specifically the exact positions:
    expect(loadouts[PLAYER_LOADOUT_KEY].bag[0]?.id).toBe('third')
    expect(loadouts[PLAYER_LOADOUT_KEY].bag[1]).toBeNull()
    expect(loadouts[PLAYER_LOADOUT_KEY].bag[2]?.id).toBe('first')
  })

  it('special-slot order + shortcut bindings round-trip exactly', () => {
    const l = createLoadout()
    const withSpecial: Loadout = { ...l, special: [potion('bomb'), null, potion('scroll'), null], shortcuts: ['9', '8', '7', '6'] }
    const { loadouts } = roundTrip([player()], { [PLAYER_LOADOUT_KEY]: withSpecial }, null)
    expect(loadouts[PLAYER_LOADOUT_KEY].special).toEqual(withSpecial.special)
    expect(loadouts[PLAYER_LOADOUT_KEY].shortcuts).toEqual(['9', '8', '7', '6'])
  })
})

describe("unitDataPersistence — a NON-PLAYER unit's loadout persists exactly like the player's", () => {
  it('an enemy carrying an equipped weapon + ordered bag round-trips identically', () => {
    const enemyLoadout = addToBag(equip(createLoadout(), sword('e-blade'), 'weapon1'), potion('e-potion'))
    const { loadouts } = roundTrip([enemy()], { e1: enemyLoadout }, null)
    expect(loadouts.e1).toEqual(enemyLoadout)
    expect(loadouts.e1.equipped.weapon1?.id).toBe('e-blade')
  })

  it('the player, an enemy, and an npc each keep their OWN distinct loadout through one round-trip', () => {
    const pLoad = equip(createLoadout(), sword('p-sword'), 'weapon1')
    const eLoad = equip(createLoadout(), helm('e-helm'), 'helmet')
    const nLoad = addToBag(createLoadout(), potion('n-potion'))
    const { loadouts } = roundTrip(
      [player(), enemy(), npc()],
      { [PLAYER_LOADOUT_KEY]: pLoad, e1: eLoad, n1: nLoad },
      null,
    )
    expect(loadouts[PLAYER_LOADOUT_KEY].equipped.weapon1?.id).toBe('p-sword')
    expect(loadouts.e1.equipped.helmet?.id).toBe('e-helm')
    expect(loadouts.n1.bag.filter(Boolean).map(i => i!.id)).toEqual(['n-potion'])
  })
})

describe("unitDataPersistence — the hero's INVENTORY (bag + vitals) is player-only + persists", () => {
  it('the player inventory round-trips; equip / drop reflected exactly', () => {
    let inv = starterInventory()
    inv = equipWeapon(inv, 'oak-staff') // equip the staff
    inv = removeItem(inv, 'health-potion') // drop the potion
    inv = addItem(inv, potion('looted')) // picked up from the world
    const { playerInventory } = roundTrip([player()], {}, inv)
    expect(playerInventory).toEqual(inv)
    expect(playerInventory?.equippedWeapon?.id).toBe('oak-staff')
    expect(playerInventory?.items.some(i => i.id === 'health-potion')).toBe(false)
    expect(playerInventory?.items.some(i => i.id === 'looted')).toBe(true)
  })

  it('only the PLAYER carries an inventory — a non-player entity never does', () => {
    const folded = foldUnitData([enemy(), npc()], {}, starterInventory())
    expect(folded.every(e => e.inventory === undefined)).toBe(true)
    const { playerInventory } = splitUnitData(folded)
    expect(playerInventory).toBeNull()
  })
})

import { isRanged, weaponReach } from '../../game/weapons'
const w = (o: any) => ({ id: 'x', kind: 'sword', name: 'X', baseDamage: 1, school: 'physical', range: 'melee', hands: 1, reachCells: 1, ...o })
test('one-handed melee reaches 1', () => { expect(weaponReach(w({ hands: 1, range: 'melee' }))).toBe(1) })
test('two-handed melee reaches 2', () => { expect(weaponReach(w({ hands: 2, range: 'melee' }))).toBe(2) })
test('ranged clamps to [6,12]', () => {
  expect(weaponReach(w({ range: 'ranged', reachCells: 3 }))).toBe(6)
  expect(weaponReach(w({ range: 'ranged', reachCells: 20 }))).toBe(12)
  expect(weaponReach(w({ range: 'ranged', reachCells: 8 }))).toBe(8)
})
test('isRanged reflects range field', () => {
  expect(isRanged(w({ range: 'ranged' }))).toBe(true)
  expect(isRanged(w({ range: 'melee' }))).toBe(false)
})

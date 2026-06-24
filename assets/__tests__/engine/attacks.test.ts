import {
  cellDistance,
  offCooldown,
  inReach,
  chooseAttack,
  fire,
  initAttacker,
  COMBO_WINDOW_MS,
  type AttackDef,
  type AttackerState,
} from '@/engine/attacks'

const slash: AttackDef = { id: 'slash', range: 'melee', reach: 1, cooldownMs: 500, power: 5, animKind: 'slash' }
const combo2: AttackDef = { id: 'combo2', range: 'melee', reach: 1, cooldownMs: 300, power: 8, animKind: 'slash', chainTo: 'combo3' }
const bolt: AttackDef = { id: 'bolt', range: 'ranged', reach: 5, cooldownMs: 800, power: 4, animKind: 'shot' }

describe('attacks — reusable for ANY entity (player/enemy/turret share this logic)', () => {
  it('cellDistance is chebyshev (8-neighbour reach)', () => {
    expect(cellDistance({ col: 0, row: 0 }, { col: 0, row: 0 })).toBe(0)
    expect(cellDistance({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(1) // diagonal adjacent
    expect(cellDistance({ col: 0, row: 0 }, { col: 3, row: 1 })).toBe(3)
  })

  it('inReach respects each attack reach (melee 1, ranged 5)', () => {
    const from = { col: 0, row: 0 }
    expect(inReach(slash, from, { col: 1, row: 1 })).toBe(true) // adjacent
    expect(inReach(slash, from, { col: 2, row: 0 })).toBe(false) // too far for melee
    expect(inReach(bolt, from, { col: 5, row: 0 })).toBe(true) // within ranged reach
    expect(inReach(bolt, from, { col: 6, row: 0 })).toBe(false)
  })

  it('offCooldown: first use allowed, then blocked until the cooldown elapses', () => {
    const s = initAttacker()
    expect(offCooldown(slash, s, 1000)).toBe(true) // never fired → allowed
    const fired = fire(slash, s, 1000)
    expect(offCooldown(slash, fired, 1200)).toBe(false) // 200ms < 500ms cd
    expect(offCooldown(slash, fired, 1500)).toBe(true) // exactly at cooldown
  })

  it('fire is pure (new state) and stamps the cooldown', () => {
    const s = initAttacker()
    const after = fire(slash, s, 1000)
    expect(s.lastFiredAt).toEqual({}) // original untouched
    expect(after.lastFiredAt.slash).toBe(1000)
  })

  it('chooseAttack picks the first ready + in-reach attack', () => {
    const s = initAttacker()
    const from = { col: 0, row: 0 }
    const target = { col: 1, row: 0 } // adjacent → melee reaches
    expect(chooseAttack([slash, bolt], s, from, target, 1000)?.id).toBe('slash')
  })

  it('chooseAttack returns null when nothing is ready or in reach', () => {
    const from = { col: 0, row: 0 }
    const far = { col: 9, row: 0 } // out of every reach
    expect(chooseAttack([slash, bolt], initAttacker(), from, far, 1000)).toBeNull()
    const onCd = fire(slash, initAttacker(), 1000)
    expect(chooseAttack([slash], onCd, from, { col: 1, row: 0 }, 1100)).toBeNull() // on cooldown
  })

  it('CHAINING: a combo step is offered first while its window is open, then expires', () => {
    const from = { col: 0, row: 0 }
    const target = { col: 1, row: 0 }
    const combo3: AttackDef = { id: 'combo3', range: 'melee', reach: 1, cooldownMs: 100, power: 12, animKind: 'slash' }
    const attacks = [slash, combo2, combo3]
    // fire combo2 → opens a window for combo3
    const afterCombo2 = fire(combo2, initAttacker(), 1000)
    expect(afterCombo2.combo).toEqual({ next: 'combo3', until: 1000 + COMBO_WINDOW_MS })
    // within the window, combo3 is chosen even though `slash` is also ready + in reach
    expect(chooseAttack(attacks, afterCombo2, from, target, 1100)?.id).toBe('combo3')
    // after the window, it falls back to the first ready attack
    expect(chooseAttack(attacks, afterCombo2, from, target, 1000 + COMBO_WINDOW_MS + 1)?.id).toBe('slash')
  })
})

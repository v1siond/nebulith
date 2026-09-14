/**
 * A PATHWAY IS A STRETCH OF ROAD.
 *
 * The planner counted from the centre out: one path per gate, radiating from a hub. A cross came out as
 * four pathways. A stretch is the unit now, and these tests are the requirements.
 */
import { MAX_EXITS, planRoutes, resolveWays, splitPathways } from '@/engine/pathNetwork'
import { makeRng } from '@/lib/math'

const rand = () => makeRng(11)

describe('the arithmetic of a stretch', () => {
  it('no pathway spends more than two exits, so E <= 2P for every combination offered', () => {
    // The upper bound is the rule and it is absolute: a stretch has one exit or two. The LOWER bound is not
    // a bound at all, because fewer exits than pathways is the cave (see the branch case below).
    for (const pathways of ['1', '2', '3', '4']) {
      for (const exits of ['1', '2', '3', '4']) {
        const w = resolveWays({ pathways, exits }, rand())!
        expect({ pathways, exits, ok: w.exits >= 1 && w.exits <= w.pathways * 2 })
          .toEqual({ pathways, exits, ok: true })
      }
    }
  })

  it('THE CROSS: two pathways with four exits is two roads, not four', () => {
    const w = resolveWays({ pathways: '2', exits: '4' }, rand())!
    expect(w).toEqual({ pathways: 2, exits: 4 })
    expect(splitPathways(w)).toEqual({ through: 2, spurs: 0, branches: 0 }) // both cross; neither is a spoke
  })

  it('splits into through roads, spurs and branches exactly as the rule says', () => {
    expect(splitPathways({ pathways: 2, exits: 3 })).toEqual({ through: 1, spurs: 1, branches: 0 })
    expect(splitPathways({ pathways: 3, exits: 3 })).toEqual({ through: 0, spurs: 3, branches: 0 })
    expect(splitPathways({ pathways: 1, exits: 2 })).toEqual({ through: 1, spurs: 0, branches: 0 })
  })

  it('FEWER exits than pathways is the cave: the extra stretches are galleries that stop', () => {
    // The rule covers a map's roads. A cave has one mouth and two dead-end galleries, which is more
    // stretches than ways out, so those extras are BRANCHES: no exit of their own, and they stop inside.
    expect(splitPathways({ pathways: 3, exits: 1 })).toEqual({ through: 0, spurs: 1, branches: 2 })
  })
})

describe('exits are inferred from pathways when nobody states them', () => {
  it('a stretch crosses the map unless something stops it, so two each', () => {
    expect(resolveWays({ pathways: '1' }, rand())).toEqual({ pathways: 1, exits: 2 })
    expect(resolveWays({ pathways: '2' }, rand())).toEqual({ pathways: 2, exits: 4 })
  })

  it('capped at one gate per side, so more pathways become spurs rather than impossible exits', () => {
    const four = resolveWays({ pathways: '4' }, rand())!
    expect(four.exits).toBe(MAX_EXITS)
    expect(splitPathways(four)).toEqual({ through: 0, spurs: 4, branches: 0 })
  })

  it('and pathways are inferred from exits, the same rule read backwards', () => {
    expect(resolveWays({ exits: '4' }, rand())).toEqual({ pathways: 2, exits: 4 })
    expect(resolveWays({ exits: '1' }, rand())).toEqual({ pathways: 1, exits: 1 })
  })

  it('states neither, plans nothing: a recipe with no opinion keeps the map it always had', () => {
    expect(resolveWays({}, rand())).toBeNull()
    expect(resolveWays(undefined, rand())).toBeNull()
  })
})

describe('what the planner actually builds', () => {
  const plan = (pathways: string, exits?: string) =>
    planRoutes(40, 30, resolveWays(exits ? { pathways, exits } : { pathways }, rand())!, rand())

  it('one gate per exit, no more and no fewer', () => {
    for (const [p, e] of [['1', '2'], ['2', '4'], ['2', '3'], ['3', '4'], ['4', '4']] as const) {
      const ways = resolveWays({ pathways: p, exits: e }, rand())!
      expect({ p, e, gates: plan(p, e).gates.length }).toEqual({ p, e, gates: ways.exits })
    }
  })

  it("a through road's two exits are on OPPOSITE sides, which is what makes a cross a cross", () => {
    const opposite: Record<string, string> = { south: 'north', north: 'south', west: 'east', east: 'west' }
    const gates = plan('2', '4').gates
    // The through roads are laid first, in pairs, so the gates come out paired too.
    for (let i = 0; i < 2; i++) {
      expect(opposite[gates[i * 2].side]).toBe(gates[i * 2 + 1].side)
    }
  })

  it('a stretch that reaches the network has arrived; only a BRANCH stops nowhere', () => {
    // A spur runs from its mouth in to the hub, where it meets the other roads. It has got somewhere, so it
    // needs no stop of its own. A dead end is for a stretch with no way out at either end, which is the cave.
    expect(plan('2', '4').deadEnds).toHaveLength(0) // two through roads
    expect(plan('2', '3').deadEnds).toHaveLength(0) // one through, one spur into the hub
    expect(plan('4', '4').deadEnds).toHaveLength(0) // four spurs, all meeting in the middle
    expect(planRoutes(40, 30, { pathways: 3, exits: 1 }, rand()).deadEnds).toHaveLength(2) // the cave
  })

  it('never puts two mouths on the same side while another side is free', () => {
    const sides = plan('2', '4').gates.map(g => g.side)
    expect(new Set(sides).size).toBe(sides.length)
  })
})

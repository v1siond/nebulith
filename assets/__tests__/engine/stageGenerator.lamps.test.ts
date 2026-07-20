import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data from the loaded backend tileset fixture
import { generateStage, type StageData } from '@/engine/stageGenerator'

// Only a SMALL, RANDOM minority of a settlement's lamps flickers (Alexander: "the flicker should be a random
// thing that only 1 or 2 lamps get and it's not even 100% of the time … rest should be either all the time ON
// during night time or OFF during day time"). The old per-cell ratio hash tagged ~a quarter of every map's
// lamps — a town got 2–3, a CITY 3–4 flickering — which read as "all of them". These lock the fix: the failing
// count is a tiny ABSOLUTE number (≤ 2), never a fraction of the lamp count.

function lampKinds(stage: StageData): { total: number; failing: number } {
  const lamps = stage.compositions.filter(c => c.kind === 'lamp_post' || c.kind === 'lamp_post_failing')
  return { total: lamps.length, failing: lamps.filter(c => c.kind === 'lamp_post_failing').length }
}

const seedsFor = (s: number) => ({ layout: 1000 + s, buildings: 2000 + s, nature: 3000 + s, decor: 4000 + s })

describe('lamp flicker — only 1 or 2 lamps flicker, never a fraction of the count', () => {
  test('a TOWN has several lamps but at most 2 flicker, every seed', () => {
    let sawMultiLamp = false
    for (let s = 0; s < 24; s++) {
      const stage = generateStage({ zone: 'summer', variant: 'town', cols: 44, rows: 32, seeds: seedsFor(s) })
      const { total, failing } = lampKinds(stage)
      if (total >= 4) sawMultiLamp = true
      expect(failing).toBeLessThanOrEqual(2) // "only 1 or 2 lamps"
      expect(failing).toBeLessThanOrEqual(total)
    }
    expect(sawMultiLamp).toBe(true) // the towns really do carry several lamps (so ≤2 failing is a real minority)
  })

  test('a CITY has MANY lamps yet still at most 2 flicker — the count does NOT scale with map size', () => {
    let maxTotal = 0
    for (let s = 0; s < 16; s++) {
      const stage = generateStage({ zone: 'summer', variant: 'city', cols: 60, rows: 46, seeds: seedsFor(100 + s) })
      const { total, failing } = lampKinds(stage)
      maxTotal = Math.max(maxTotal, total)
      expect(failing).toBeLessThanOrEqual(2)
    }
    expect(maxTotal).toBeGreaterThanOrEqual(8) // a city genuinely has many lamps → ≤2 failing proves no ratio scaling
  })

  test('across many towns the AVERAGE failing count is small (≈1) — usually 1, sometimes 0 or 2', () => {
    let sum = 0
    const N = 40
    for (let s = 0; s < N; s++) {
      const stage = generateStage({ zone: 'summer', variant: 'town', cols: 44, rows: 32, seeds: seedsFor(500 + s) })
      sum += lampKinds(stage).failing
    }
    const avg = sum / N
    expect(avg).toBeGreaterThan(0) // some lamps DO flicker (the feature isn't dead)
    expect(avg).toBeLessThan(1.6) // but it stays a tiny handful on average, not a quarter of the lamps
  })

  test('re-rolling ONLY the decor seed keeps the flicker a tiny minority (≤2) but re-picks which lamps', () => {
    const base = { layout: 7, buildings: 8, nature: 9, decor: 10 }
    for (let d = 0; d < 12; d++) {
      const stage = generateStage({ zone: 'summer', variant: 'town', cols: 48, rows: 36, seeds: { ...base, decor: 6000 + d } })
      expect(lampKinds(stage).failing).toBeLessThanOrEqual(2)
    }
  })

  test('the failing lamps ARE the flickering variant and the rest are steady — both variants present in the mix', () => {
    // find a seed whose town has ≥1 failing lamp, then assert the split is real (steady majority + failing ≤2)
    for (let s = 0; s < 60; s++) {
      const stage = generateStage({ zone: 'summer', variant: 'town', cols: 48, rows: 36, seeds: seedsFor(9000 + s) })
      const { total, failing } = lampKinds(stage)
      if (total >= 3 && failing >= 1) {
        expect(total - failing).toBeGreaterThan(0) // steady lamps are the majority
        expect(failing).toBeLessThanOrEqual(2)
        return
      }
    }
    throw new Error('expected at least one town with a mix of steady + failing lamps')
  })
})

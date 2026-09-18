/**
 * Every settlement gets its store AND its hospital. The guarantee used to be best effort: an essential the top
 * street could not fit waited for the general fill, which gave its spot to a house whenever it did not fit, so 7
 * of 300 seeded summer towns came out with a store and fourteen houses and no hospital.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

const town = (seed: number, variant: 'town' | 'city', zone: 'summer' | 'autumn') => {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({ zone, variant })
  } finally {
    Math.random = orig
  }
}

describe('a settlement always has its store and its hospital', () => {
  it.each([['town', 'summer'], ['town', 'autumn'], ['city', 'summer']] as const)('%s in %s, 300 seeds', (variant, zone) => {
    const missing: string[] = []
    for (let seed = 1; seed <= 300; seed++) {
      const types = town(seed, variant, zone).buildings.map(b => b.type)
      if (!types.includes('store') || !types.includes('hospital')) missing.push(`seed ${seed}: ${types.join(',')}`)
    }
    expect(missing).toEqual([])
  })
})

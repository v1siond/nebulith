import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'
const CAT = parseGeneratorCatalog(liveBody)
/**
 * THE BRIDGE YOU PICKED IS THE BRIDGE YOU GET.
 *
 * *"RANDOMLY THE SYSTEM DOESN'T PUT BRIDGES ON THE RIVER, WHICH IS OK ON RANDOM, BUT SHOULDN'T HAPPEN WHEN I
 * HAVE A SPECIFIC BRIDGE SELECTED, FOR EXAMPLE, I SELECTED WOODEN BRIDGE GENERATED 3 MAPS ... AND DIDN'T GOT
 * THE BRIDGE ONCE"*.
 *
 * The cause was a deck built narrower than the thing it carries: three cells across, while a bridge
 * composition is `CROSSING_ROWS` deep (rail, two walking rows, rail). `recordBridgeSpan` refuses a deck that
 * cannot hold one, silently, so you got a flat crossing and no structure. Measured before the fix: wood and
 * stone built a bridge on 6 of 8 seeds, and every miss was `across 3 < 4`.
 *
 * A chosen kind is a promise, so this asks for EVERY kind on EVERY course and expects all of them.
 */
test('bridge asked for, bridge delivered', () => {
  const def = findGenerator(CAT, 'wilderness', 'woodland')!
  for (const bridge of ['wood', 'stone', 'dirt']) {
    const rows: string[] = []
    const missed: string[] = []
    for (const course of ['through', 'divides', 'around']) {
      let got = 0, tried = 0
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const orig = Math.random; Math.random = makeRng(seed)
        const s = (() => { try { return generateStage({ zone: 'summer', variant: 'forest', layout: 'woodland', cols: 40, rows: 40,
          nature: def.config.nature, palette: def.config.palette, formation: def.config.formation, treeMix: def.config.trees,
          crossings: def.config.crossings, pathway: def.config.pathway,
          options: { exits: '2', pathways: '2', river: course, bridge } } as never) } finally { Math.random = orig } })()
        tried++
        const decks = s.decks?.size ?? 0
        const fords = s.fords?.size ?? 0
        const comps = (s.compositions ?? []).filter(c => /bridge/.test(c.kind)).length
        const ok = bridge === 'dirt' ? fords > 0 : comps > 0
        if (ok) got++
        else missed.push(`${bridge}/${course}/seed${seed} (decks=${decks})`)
      }
      rows.push(`${course}:${got}/${tried}`)
    }
    console.log(`bridge=${bridge}  ${rows.join('  ')}`)
    // A kind you PICKED is a promise. Random may decline; a named kind may not.
    expect({ bridge, missed }).toEqual({ bridge, missed: [] })
  }
})

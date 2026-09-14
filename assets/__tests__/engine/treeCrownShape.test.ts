/**
 * A CANOPY IS NOT A CUBE.
 *
 * the new foliage art fixed the texture, not the outline. A crown's silhouette comes
 * from the COMPOSITION, not from the picture: the renderer paints the shaded quad and then overlays the tile
 * image, so transparent pixels reveal the solid block rather than carving it. Rounding is the per-cell setting
 * `shape: circle`, and nine species did not carry it.
 *
 * Seven of those nine are round-crowned and now do. The other two are NOT round: a conifer and a cypress are
 * cones, and `circle` would be wrong in the other direction. The renderer draws `square` and `circle` and
 * nothing else, so those two keep the box until a cone shape exists. That is recorded here rather than left as
 * a silent gap, so this test fails the day someone rounds them off to make a number go up.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { resolveComposition } from '@/engine/tileset/tileset'

const crownShapes = (kind: string): Set<string | undefined> => {
  const comp = resolveComposition(styleCatalog('ascii'), kind)
  if (!comp) throw new Error(`no served composition ${kind}`)
  const crowns = comp.cells.filter(c => c.label === 'leaf_center')
  if (crowns.length === 0) throw new Error(`${kind} has no leaf_center cell`)
  return new Set(crowns.map(c => (c.settings as { shape?: string } | undefined)?.shape))
}

const ROUND = ['tree', 'tree_big', 'tree_small', 'tree_stub', 'tree_tall', 'tree_sapling', 'tree_column',
  'tree_round', 'tree_broadleaf', 'tree_giant', 'tree_gnarled', 'tree_palm',
  // The tropics, added 2026-09-13. The sweep below caught them the moment they were authored, which is what
  // it is for: a species arriving without a crown shape is a leafy box nobody notices until he does.
  'tree_coconut', 'tree_banana', 'tree_mangrove']
const CONES = ['tree_conifer', 'tree_cypress']

describe('tree crowns', () => {
  it.each(ROUND)('%s wears a round crown, not a leafy box', kind => {
    expect(crownShapes(kind)).toEqual(new Set(['circle']))
  })

  it.each(CONES)('%s is a CONE, so it stays square until the renderer can draw one', kind => {
    // Not an oversight. Rounding a conifer is as wrong as boxing an oak.
    expect(crownShapes(kind)).toEqual(new Set([undefined]))
  })

  it('every served tree species is accounted for, so a new one cannot slip in unshaped', () => {
    const served = Object.keys(styleCatalog('ascii').compositions ?? {})
      .filter(k => k.startsWith('tree'))
      .filter(k => (resolveComposition(styleCatalog('ascii'), k)?.cells ?? []).some(c => c.label === 'leaf_center'))
    expect(served.sort()).toEqual([...ROUND, ...CONES].sort())
  })
})

/**
 * A PUDDLE IS NOT A RIVER.
 *
 * Two defects, both data.
 *
 * A pool laid `water_shallow`, which is the RIVER's own wadeable edge, so a puddle and a channel wore one
 * label. And the generator's comment asserted that label was height 0.0 while the database said 1.0 in both
 * styles, so every puddle drew as a one-block cube of water standing on the floor.
 *
 * `water_still` is the puddle: flush at height 0, frameless because standing water has no current. The two
 * river BANDS join `water`'s 0.5, which `seed_water_color` had already worked out for the channel and never
 * applied to them.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import { findGeneratorByKey, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import { styleTile } from '@/engine/tileset/styleTiles'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { applyStageToGrid } from '@/game/editor/applyStage'
import { unitStandLevel } from '@/engine/cellStack'
import { spriteFrame } from '@/engine/render/assetAnimation'
import { ASCII_STYLE } from '@/game/artStyle'
import type { GridAsset } from '@/engine/IsometricGrid'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

function grow(key: string, seed = 3) {
  const g = findGeneratorByKey(CATALOG, key)!
  const c = g.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout: g.layout as 'jungle' | 'woodland' | 'meadow',
      cols: 60, rows: 40, nature: c.nature, palette: c.palette, formation: c.formation,
      treeMix: c.trees, subZones: c.subZones, crossings: c.crossings,
      // …and how the pools are sized, which is what decides whether there is any standing water to film.
      terrain: c.terrain, regionLayout: c.regionLayout,
      options: { river: 'through', crossing: true, bridge: 'wood' },
    })
  } finally { Math.random = orig }
}
const groundCount = (s: ReturnType<typeof grow>, label: string) => s.ground.flat().filter(g => g === label).length

describe('still water is its own tile', () => {
  it('a puddle is a FILM STACKED ON the ground, and the ground is still under it', () => {
    // It used to REPLACE the ground, so its own height had to match whatever floor it landed
    // on and never could.
    const swamp = grow('forest_swamp')
    const film = swamp.props.filter(p => p.label === 'water_still')
    expect(film.length).toBeGreaterThan(0)
    expect(groundCount(swamp, 'water_still')).toBe(0) // it is not a ground tile at all
    for (const p of film.slice(0, 40)) {
      expect({ at: `${p.col},${p.row}`, wet: swamp.ground[p.row][p.col] }).toEqual({ at: `${p.col},${p.row}`, wet: 'meadow' })
    }
  })

  it('YOU DO NOT DROP INTO IT: the level in a puddle is the level beside it', () => {
    // The whole complaint: A unit stands on the cell's GROUND
    // (`unitStandLevel` counts floor assets only), so a film that leaves the floor alone cannot move it.
    const swamp = grow('forest_swamp')
    const grid = new IsometricGrid(swamp.cols, swamp.rows, 32)
    applyStageToGrid(swamp, grid)
    const film = swamp.props.filter(p => p.label === 'water_still')
    expect(film.length).toBeGreaterThan(0)
    let compared = 0
    for (const p of film) {
      const dry = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dc, dr]) => [p.col + dc, p.row + dr] as const)
        .find(([c, r]) => c > 0 && r > 0 && c < swamp.cols - 1 && r < swamp.rows - 1
          && !swamp.props.some(q => q.label === 'water_still' && q.col === c && q.row === r))
      if (!dry) continue
      compared++
      expect({ at: `${p.col},${p.row}`, inPuddle: unitStandLevel(grid, p.col, p.row), onLand: unitStandLevel(grid, dry[0], dry[1]) })
        .toEqual({ at: `${p.col},${p.row}`, inPuddle: unitStandLevel(grid, dry[0], dry[1]), onLand: unitStandLevel(grid, dry[0], dry[1]) })
      if (compared > 60) break
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('it is a THIN layer, not a block of water', () => {
    expect(styleTile('ascii', 'water_still')?.height).toBeLessThan(0.2)
    expect(styleTile('ascii', 'water_still')?.height).toBeGreaterThan(0)
  })

  it('it wears its OWN picture, not the river band with current lines in it', () => {
    const still = styleTile('ascii', 'water_still')?.image
    const band = styleTile('ascii', 'water_shallow')?.image
    expect(still).toBeDefined()
    expect(still).not.toBe(band)
    expect(still).toContain('water_still')
  })

  it('it is FRAMELESS, because standing water has no current', () => {
    // The height moved from 0 to a thin film when the puddle stopped replacing the ground: it is stacked ON
    // the floor now, so 0 would be an invisible sheet rather than a flush one. Thickness is asserted above.
    const still = styleTile('ascii', 'water_still')
    expect(still).toBeDefined()
    expect((still?.settings as { frames?: unknown[] } | undefined)?.frames ?? []).toHaveLength(0)
  })

  it('a PUDDLE does not animate, even though the picture path collapses it to the river', () => {
    // The heart of `assetKind` folds every water-ish label to the
    // kind `water` so the bands can share one image, and that used to hand a puddle the river's four frames.
    // `water_still` declares an EMPTY animations list, which is a statement, not an omission.
    const asset = { art: [''], col: 1, row: 1, type: 'floor', tileKey: 'water_still', heightLevel: 0, occupies: false, placedAt: 0 } as unknown as GridAsset
    expect(spriteFrame(asset, 0, ASCII_STYLE, 'iso', 'day')).toBeNull()
    expect(spriteFrame(asset, 700, ASCII_STYLE, 'iso', 'day')).toBeNull()
  })

  it('a RIVER still flows: the channel keeps its frames through the same path', () => {
    // The other half. A band carries NO animations key at all, so it still inherits the river's.
    const river = { art: [''], col: 1, row: 1, type: 'floor', tileKey: 'water_shallow', heightLevel: 0, occupies: false, placedAt: 0 } as unknown as GridAsset
    expect(spriteFrame(river, 0, ASCII_STYLE, 'iso', 'day')).not.toBeNull()
  })

  it('the channel label keeps its frames', () => {
    // The other half of the requirement. Removing the current everywhere would pass the test above and be wrong.
    const water = styleTile('ascii', 'water')
    expect((water?.settings as { frames?: unknown[] } | undefined)?.frames ?? []).not.toHaveLength(0)
  })

  it('a puddle is still WATER to every consumer, so nothing floods into it', () => {
    // isWaterGround matches any label containing "water". If that ever stops, tall grass, blooms and the
    // terrain pass all start planting inside pools.
    const swamp = grow('forest_swamp')
    const pools = new Set<string>()
    swamp.ground.forEach((r, y) => r.forEach((g, x) => { if (g === 'water_still') pools.add(`${x},${y}`) }))
    const propsInPools = swamp.props.filter(p => pools.has(`${p.col},${p.row}`))
    expect(propsInPools).toHaveLength(0)
  })
})

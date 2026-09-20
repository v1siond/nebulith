import '@/__tests__/helpers/installZoneSeed' // the generator reads every season from the backend catalog
import { generateStage, stageToTemplate } from '@/engine/stageGenerator'
import { deserializeToGrid, type TemplateData } from '@/lib/api'
import { styleTile } from '@/engine/tileset/styleTiles'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed' // stageToTemplate expands tree anchors via the DB compositions

// Reproduces what the LOADED game actually sees: a generated stage saved to a
// template payload and deserialized back into the live IsometricGrid (the path
// the editor now uses on auto-load). The play loop blocks movement via
// grid.isBlocked(col,row), so that grid, not the generator's StageData, must
// agree with the per-label collision rule.
const tileFor = (label: string) => styleTile('ascii', label) ?? styleTile('emoji', label)

/** Does the catalog say this label stands at your feet and lets you walk through it? (`ensure_ground_plants`) */
const isGroundPlant = (label: string): boolean =>
  (tileFor(label)?.settings as { stackAt?: number } | undefined)?.stackAt === 0

/**
 * A kind the catalog knows as a TILE, so its own row answers for it.
 *
 * `bush_round` and its like are COMPOSITIONS: what their anchor occupies is decided by the cells they stamp,
 * not by a row of their own, so they are not this test's business.
 */
const isTile = (label: string): boolean => tileFor(label) !== undefined

describe('forest collision survives stageToTemplate → deserializeToGrid', () => {
  useSeedTileset() // the DB-equivalent tileset carries the tree compositions stageToTemplate expands
  it('blocks every tree anchor that is not a ground plant (forest collision survives save/load)', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 40, rows: 30 })
    const payload = stageToTemplate(stage, 'collision-test')
    const grid = deserializeToGrid(payload as unknown as TemplateData)

    expect(stage.trees.length).toBeGreaterThan(0)

    // EVERY TREE ANCHOR THAT IS NOT A GROUND PLANT blocks in the round-tripped grid.
    //
    // It used to say every anchor, full stop, and passed only because the tileset fixture still carried
    // `blocking: true` for a bush: a value the live catalog had stopped serving. A bush and a shrub are
    // ground plants, they stand at your feet and you walk through them, and the backend has said so on
    // those rows for as long as `ensure_ground_plants` has existed. The fixture was what was wrong, and it
    // made this test agree with it.
    //
    // The ground-plant fact is read from the CATALOG (`stackAt: 0`), never a list kept here, so the day one
    // is added the test moves with it. Composition-backed kinds are left to the cells they stamp.
    const anchors = stage.trees.filter(t => isTile(t.kind) && !isGroundPlant(t.kind))
    expect(anchors.length).toBeGreaterThan(0) // or this run proves nothing about collision at all

    const lost = anchors.filter(t => grid.isBlocked(t.col, t.row) !== true)
    expect({ count: lost.length, sample: lost.slice(0, 5).map(t => `${t.kind}@(${t.col},${t.row})`) })
      .toEqual({ count: 0, sample: [] })
  })
})

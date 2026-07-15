import { generateStage, stageToTemplate } from '@/engine/stageGenerator'
import { deserializeToGrid, type TemplateData } from '@/lib/api'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed' // stageToTemplate expands tree anchors via the DB compositions

// Reproduces what the LOADED game actually sees: a generated stage saved to a
// template payload and deserialized back into the live IsometricGrid (the path
// the editor now uses on auto-load). The play loop blocks movement via
// grid.isBlocked(col,row), so that grid — not the generator's StageData — must
// agree with the per-label collision rule.
describe('forest collision survives stageToTemplate → deserializeToGrid', () => {
  useSeedTileset() // the DB-equivalent tileset carries the tree compositions stageToTemplate expands
  it('blocks every tree anchor cell in the deserialized grid (forest collision survives save/load)', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 40, rows: 30 })
    const payload = stageToTemplate(stage, 'collision-test')
    const grid = deserializeToGrid(payload as unknown as TemplateData)

    expect(stage.trees.length).toBeGreaterThan(0)
    // Trees are stamped as composition cells on save, so every anchor's trunk cell blocks in the round-tripped
    // grid — the forest's collision (and its rich tiles) survive stageToTemplate → deserializeToGrid.
    const offenders = stage.trees.filter(t => grid.isBlocked(t.col, t.row) !== true)
    const sample = offenders.slice(0, 5).map(t => `${t.kind}@(${t.col},${t.row})`)
    expect({ count: offenders.length, sample }).toEqual({ count: 0, sample: [] })
  })
})

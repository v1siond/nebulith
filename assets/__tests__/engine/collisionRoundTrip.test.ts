import { generateStage, stageToTemplate } from '@/engine/stageGenerator'
import { deserializeToGrid, type TemplateData } from '@/lib/api'
import { isWalkable } from '@/engine/cellLabels'

// Reproduces what the LOADED game actually sees: a generated stage saved to a
// template payload and deserialized back into the live IsometricGrid (the path
// the editor now uses on auto-load). The play loop blocks movement via
// grid.isBlocked(col,row), so that grid — not the generator's StageData — must
// agree with the per-label collision rule.
describe('forest collision survives stageToTemplate → deserializeToGrid', () => {
  it('blocks every tree cell EXCEPT tree_leaf_top in the deserialized grid', () => {
    const stage = generateStage({ zone: 'summer', variant: 'forest', cols: 40, rows: 30 })
    const payload = stageToTemplate(stage, 'collision-test')
    const grid = deserializeToGrid(payload as unknown as TemplateData)

    const trees = stage.props.filter(p => p.type === 'tree' && p.label)
    expect(trees.length).toBeGreaterThan(0)

    const offenders = trees.filter(p => grid.isBlocked(p.col, p.row) !== !isWalkable(p.label!))
    const sample = offenders.slice(0, 5).map(p => `${p.label}@(${p.col},${p.row}) blocked=${grid.isBlocked(p.col, p.row)}`)
    expect({ count: offenders.length, sample }).toEqual({ count: 0, sample: [] })
  })
})

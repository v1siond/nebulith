import { deserializeToGrid, serializeGrid } from '@/lib/api'
import { IsometricGrid } from '@/engine/IsometricGrid'

// Minimal TemplateData carrying the given assetsData (other fields are unused by the asset path).
const tmpl = (assetsData: unknown[]): any => ({
  id: 't', name: 'n', cols: 4, rows: 4, cellSize: 32, isoScale: 1.4, spawnCol: 0, spawnRow: 0,
  groundData: Array.from({ length: 4 }, () => Array(4).fill('grass')),
  heightData: Array.from({ length: 4 }, () => Array(4).fill(0)),
  assetsData, connectors: [], entities: [], quests: [],
  thumbnail: null, isPublic: false, tags: [], createdAt: '', updatedAt: '',
})

describe('deserializeToGrid preserves every saved asset field (#72)', () => {
  it('round-trips the town-fountain footprint (was dropped → single-cell circle on load)', () => {
    const grid = deserializeToGrid(tmpl([{ art: ['o'], col: 1, row: 1, type: 'fountain', footprint: 3 }]))
    expect(grid.assets.find(a => a.type === 'fountain')?.footprint).toBe(3)
  })
  it('round-trips authored animations, labels, shadows + building meta', () => {
    const grid = deserializeToGrid(tmpl([{
      art: ['#'], col: 0, row: 0, type: 'building', edge: 'ne', buildingType: 'store',
      baseShadow: true, cellPart: 'roof_top', cellAnim: { id: 'x', frames: [], durationMs: 1000, delayMs: 0, loop: true },
    }]))
    const a = grid.assets[0]
    expect(a.edge).toBe('ne')
    expect(a.buildingType).toBe('store')
    expect(a.baseShadow).toBe(true)
    expect(a.cellPart).toBe('roof_top')
    expect(a.cellAnim?.id).toBe('x')
  })
  it('serializeGrid → deserializeToGrid keeps footprint end to end', () => {
    const g = new IsometricGrid({ cols: 4, rows: 4, cellSize: 32, isoScale: 1.4 })
    g.assets = [{ art: ['o'], col: 2, row: 2, type: 'fountain', footprint: 5 } as never]
    const ser = serializeGrid(g)
    const grid2 = deserializeToGrid(tmpl(ser.assetsData as unknown[]))
    expect(grid2.assets.find(a => a.type === 'fountain')?.footprint).toBe(5)
  })

  // Phase 3: a per-instance tile ANIMATION list + its placedAt anchor must survive save/load exactly like
  // cellAnim — through serializeGrid → the JSON wire (backend store) → deserializeToGrid. placedAt 0 is the
  // fountain default AND the tricky falsy case (must not be dropped/defaulted away).
  it('round-trips per-instance tile animations + placedAt through the JSON wire', () => {
    const anims = [
      { id: 'rise', kind: 'settings', durationMs: 1200, startDelayMs: 0, loopDelayMs: 600, loop: true, ease: 'sine', priority: 1,
        tracks: [{ setting: 'opacity', from: 0, to: 1 }, { setting: 'y', from: 0, to: 3 }] },
      { id: 'fade', kind: 'settings', durationMs: 600, startDelayMs: 1200, loopDelayMs: 1200, loop: true, ease: 'sine', priority: 0,
        tracks: [{ setting: 'opacity', from: 1, to: 0 }] },
    ]
    const g = new IsometricGrid({ cols: 4, rows: 4, cellSize: 32, isoScale: 1.4 })
    g.assets = [{ art: ['~'], col: 1, row: 1, type: 'fountain', label: 'water_c', animations: anims, placedAt: 0 } as never]
    const wire = JSON.parse(JSON.stringify(serializeGrid(g).assetsData)) // backend store + reload
    const a = deserializeToGrid(tmpl(wire)).assets.find(x => x.label === 'water_c')
    expect(a?.animations).toEqual(anims)
    expect(a?.placedAt).toBe(0)
  })
})

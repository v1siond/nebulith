/**
 * A BUILDING IS ENTERABLE — its interior is floor you walk on, not solid rock.
 *
 * Alexander (2026-09-06, Image #5): *"I can't navigate inside the house … looks like the windows are blocking
 * my ability to navigate inside the house"*, and the target he gave is Image #6 (Diablo II) — a real room you
 * move around in.
 *
 * The defect is older than the doorway work: `placeBuildingOnPlot` blanket-blocked the WHOLE footprint rect —
 *   collision[row][col] = !isDoor.has(`${col},${row}`)   // every cell but the door
 * — the old "a building is a solid obstacle with a door you bump into" model. So the hero could stand in the
 * doorway (that cell is walkable) and go nowhere.
 *
 * The rule now: the PERIMETER blocks (walls, windows — you don't walk through a window), the DOORWAY is the way
 * in, and the INTERIOR is walkable floor. Per-cell truth still comes from the composition's own `walkable`
 * flags when it stamps; the generator must not pre-seal what the composition leaves open.
 */
// Building SIZES are BACKEND data now (the composition footprints), so a generator run with nothing loaded
// plants no buildings at all — correctly, since there would be no composition to stamp. Install what
// production loads, exactly as every other generator suite does.
import '@/__tests__/helpers/installTilesetSeed'
import { generateStage } from '@/engine/stageGenerator'
import type { StageData } from '@/engine/stageGenerator'

const stage = (seed: number): StageData =>
  generateStage({
    zone: 'spring',
    variant: 'town',
    cols: 60,
    rows: 60,
    seeds: { layout: seed, buildings: seed + 1, nature: seed + 2, decor: seed + 3 },
  })

/** Every cell of a building's footprint rect, and its interior (the rect minus its outer ring). */
const rectCells = (b: { col: number; row: number; length: number; height: number }) => {
  const c0 = b.col
  const r0 = b.row - b.height + 1 // PlacedBuilding.row is the rect's BOTTOM row
  const c1 = c0 + b.length - 1
  const r1 = b.row
  const all: [number, number][] = []
  const interior: [number, number][] = []
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      all.push([c, r])
      if (c > c0 && c < c1 && r > r0 && r < r1) interior.push([c, r])
    }
  return { all, interior, c0, r0, c1, r1 }
}

describe('a generated building can actually be walked into', () => {
  test('the interior of every building is WALKABLE floor, not blocked', () => {
    const s = stage(11)
    expect(s.buildings.length).toBeGreaterThan(0)

    const sealed = s.buildings
      .map(b => ({ b, cells: rectCells(b) }))
      .filter(({ cells }) => cells.interior.length > 0)
      .filter(({ cells }) => cells.interior.every(([c, r]) => s.collision[r]?.[c]))

    expect(sealed.map(x => `${x.b.kind}@${x.b.col},${x.b.row}`)).toEqual([])
  })

  test('the interior is REACHABLE from a door cell — the doorway leads somewhere', () => {
    const s = stage(11)
    const withInterior = s.buildings.map(b => ({ b, cells: rectCells(b) })).filter(x => x.cells.interior.length > 0)
    expect(withInterior.length).toBeGreaterThan(0)

    const unreachable = withInterior.filter(({ b, cells }) => {
      const start = b.doorCells?.find(d => !s.collision[d.row]?.[d.col])
      if (!start) return true
      const seen = new Set([`${start.col},${start.row}`])
      const queue = [[start.col, start.row]]
      let reached = 0
      while (queue.length) {
        const [c, r] = queue.pop() as [number, number]
        if (c > cells.c0 && c < cells.c1 && r > cells.r0 && r < cells.r1) reached++
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = c + dc
          const nr = r + dr
          const key = `${nc},${nr}`
          if (seen.has(key)) continue
          if (nc < cells.c0 || nc > cells.c1 || nr < cells.r0 || nr > cells.r1) continue // stay in the footprint
          if (s.collision[nr]?.[nc]) continue
          seen.add(key)
          queue.push([nc, nr])
        }
      }
      return reached === 0
    })

    expect(unreachable.map(x => `${x.b.kind}@${x.b.col},${x.b.row}`)).toEqual([])
  })

  test('the building still has WALLS — its perimeter blocks apart from the doorway', () => {
    const s = stage(11)
    const b = s.buildings.find(x => rectCells(x).interior.length > 0)!
    const cells = rectCells(b)
    const doors = new Set((b.doorCells ?? []).map(d => `${d.col},${d.row}`))
    const ring = cells.all.filter(([c, r]) => !(c > cells.c0 && c < cells.c1 && r > cells.r0 && r < cells.r1))
    const open = ring.filter(([c, r]) => !s.collision[r]?.[c] && !doors.has(`${c},${r}`))

    expect(open).toEqual([]) // the only opening in the shell is the doorway
  })
})

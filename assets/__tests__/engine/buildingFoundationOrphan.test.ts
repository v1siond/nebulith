/**
 * BUG #3 (Image #42) — a building FOUNDATION (the brown `path_stone` lot + collision) must NEVER be laid
 * without its building. `placeBuilding` lays the foundation UNCONDITIONALLY at generation; the actual building
 * tiles are stamped later at load. So an orphan lot appears whenever the load-time stamp places 0 cells.
 *
 * ROOT CAUSE (found + fixed): the live load path re-derived the composition kind from `b.length`, but for an
 * EAST/WEST-facing plot `b.length` is the footprint's grid COL-SPAN = the DEPTH, not the facade length. So a
 * hospital (facade 6, depth 4) facing west recorded `length: 4` and the stamp asked for `hospital_4` — a
 * composition that doesn't exist (only `hospital_6` is seeded) → 0 cells → foundation with no building.
 * `big_house_4` and `temple_4` orphan the same way; houses escaped only because `house_4` happens to exist.
 *
 * The fix: stamp by the building's AUTHORITATIVE `PlacedBuilding.kind` (derived from the facade length at plan
 * time — the value the SAVE path `stageToTemplate` already used), via `stampBuildingKind`.
 *
 * These tests generate MANY towns and assert every building's kind stamps > 0 cells (0 orphans) — and prove the
 * check isn't vacuous by showing the OLD `(type, length)` derivation still orphans on the same stages.
 */
import '@/__tests__/helpers/installTilesetSeed' // building compositions come from the loaded backend tileset fixture
import { generateStage } from '@/engine/stageGenerator'
import { stampBuildingKind, stampBuildingComposition } from '@/game/runtime/composition'
import { resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { IsometricGrid } from '@/engine/IsometricGrid'
import type { ZoneId } from '@/engine/zones'

const ZONES: ZoneId[] = ['spring', 'summer', 'autumn', 'winter']
const VARIANTS = ['village', 'town', 'city'] as const
const ITERATIONS = 40 // × 4 zones × 3 variants = 480 towns — enough to hit east/west hospital/big-house/temple

interface Gen { stage: ReturnType<typeof generateStage>; grid: IsometricGrid }
function* manyTowns(): Generator<Gen> {
  for (let i = 0; i < ITERATIONS; i++)
    for (const zone of ZONES)
      for (const variant of VARIANTS) {
        const stage = generateStage({ zone, variant })
        yield { stage, grid: new IsometricGrid({ cols: stage.cols, rows: stage.rows, cellSize: 16 }) }
      }
}

/** The footprint cells of a placed building (col..col+length, top..row) — where the foundation was laid. */
function footprintCells(b: { col: number; row: number; length: number; height: number }) {
  const cells: { col: number; row: number }[] = []
  const top = b.row - (b.height - 1)
  for (let r = top; r <= b.row; r++) for (let c = b.col; c < b.col + b.length; c++) cells.push({ col: c, row: r })
  return cells
}

describe('BUG #3: every generated building foundation gets its building stamped (no orphan foundations)', () => {
  test('the FIXED load path (stamp by b.kind) leaves ZERO orphan foundations across many towns', () => {
    let total = 0, orphans = 0
    const orphanKinds: Record<string, number> = {}
    for (const { stage, grid } of manyTowns()) {
      for (const b of stage.buildings) {
        total++
        // The foundation IS laid for this building (the generator paved its footprint brown path_stone).
        const foundationLaid = footprintCells(b).some(({ col, row }) => stage.ground[row]?.[col] === 'path_stone')
        expect(foundationLaid).toBe(true)
        grid.clearAssets()
        const anchorRow = b.row - (b.height - 1)
        const placed = stampBuildingKind(grid, b.kind, b.col, anchorRow, stage.zone, b.facing)
        if (placed === 0) {
          orphans++
          orphanKinds[b.kind] = (orphanKinds[b.kind] ?? 0) + 1
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`FIXED path: ${orphans} orphan foundations / ${total} buildings  ${JSON.stringify(orphanKinds)}`)
    expect(total).toBeGreaterThan(1000) // we really did generate a lot of buildings
    expect(orphans).toBe(0) // EVERY foundation got its building
  })

  test('every generated building records a kind that RESOLVES to a loaded composition', () => {
    for (const { stage } of manyTowns()) {
      for (const b of stage.buildings) {
        expect(resolveComposition(ASCII_TILESET, b.kind)).not.toBeNull()
      }
    }
  })

  test('NOT VACUOUS — the OLD derivation (from b.type + b.length) still orphans east/west hospital/big-house/temple', () => {
    let oldOrphans = 0
    const kinds = new Set<string>()
    for (const { stage, grid } of manyTowns()) {
      for (const b of stage.buildings) {
        grid.clearAssets()
        const anchorRow = b.row - (b.height - 1)
        const placedOld = stampBuildingComposition(grid, b.type, b.length, b.col, anchorRow, stage.zone, b.facing)
        if (placedOld === 0) {
          oldOrphans++
          kinds.add(`${b.type}_${b.length}`)
          // Every OLD orphan is an EAST/WEST plot whose col-span (b.length) is its depth, not the facade length.
          expect(b.facing === 'east' || b.facing === 'west').toBe(true)
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`OLD path orphans: ${oldOrphans}  kinds=${JSON.stringify([...kinds])}`)
    expect(oldOrphans).toBeGreaterThan(0) // the bug was real — the fix isn't a no-op
  })

  test('mechanism: an east/west building records b.length = its DEPTH but b.kind uses the FACADE length', () => {
    // Find a real generated east/west hospital (facade 6, depth 4) and assert the two disagree — the exact trap.
    let checked = 0
    for (const { stage } of manyTowns()) {
      for (const b of stage.buildings) {
        if ((b.facing === 'east' || b.facing === 'west') && b.type === 'hospital') {
          expect(b.length).toBe(b.depth)            // recorded length = grid col-span = the DEPTH (4)
          expect(b.kind).toBe(`hospital_${b.height}`) // kind uses the facade length = the grid ROW-SPAN (6)
          expect(b.height).not.toBe(b.length)        // facade length ≠ depth → the re-derivation would miss
          expect(resolveComposition(ASCII_TILESET, b.kind)).not.toBeNull()
          expect(resolveComposition(ASCII_TILESET, `hospital_${b.length}`)).toBeNull() // hospital_4 does not exist
          checked++
          if (checked >= 3) return
        }
      }
    }
    expect(checked).toBeGreaterThan(0) // we actually exercised the case
  })
})

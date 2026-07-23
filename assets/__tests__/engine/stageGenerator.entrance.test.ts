import '@/__tests__/helpers/installTilesetSeed' // the opening is READ from the loaded composition — install what production loads
import { generateStage, doorCells, type StageData } from '@/engine/stageGenerator'
import { buildingDoorOffset, facingRotation, rotateFootprintOffset } from '@/engine/buildingCatalog'
import { resolveComposition } from '@/engine/tileset/tileset'
import { ASCII_TILESET, setAsciiTileset } from '@/engine/tileset/asciiTileset'
import { makeRng } from '@/lib/math'

// G7 (REQUIREMENTS-cell-block-tile.md:110): "The walk-in ENTRANCE opening must ALWAYS match the door's
// width." The backend now derives BOTH the facade doors and the entrance apron from one `door_cols/1` list
// (2 doors → a 2-block entrance), so the frontend's walkable opening has to be read from the SAME
// composition — never re-derived. These tests assert the opening equals the STAMPED door cells.

function genSeeded(opts: Parameters<typeof generateStage>[0], seed: number): StageData {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage(opts)
  } finally {
    Math.random = orig
  }
}

/** The grid cells a building's composition really puts its ground-level `door` tiles on — computed with the
 *  SAME rotation the stamp applies (rotateFootprintOffset), so this is the drawn doorway, not a re-derivation. */
function stampedDoorCells(b: StageData['buildings'][number]): Set<string> {
  const comp = resolveComposition(ASCII_TILESET, b.kind)
  if (!comp) throw new Error(`composition ${b.kind} missing from the seeded tileset fixture`)
  const rotation = facingRotation(b.facing)
  const anchorCol = b.col
  const anchorRow = b.row - (b.height - 1) // b.row is the footprint's BOTTOM row
  const { w, h } = comp.footprint
  const cells = new Set<string>()
  for (const c of comp.cells) {
    if ((c.level ?? 0) !== 0 || c.label !== 'door') continue
    const off = rotation ? rotateFootprintOffset(c.dx, c.dy, w, h, rotation) : { dx: c.dx, dy: c.dy }
    cells.add(`${anchorCol + off.dx},${anchorRow + off.dy}`)
  }
  return cells
}

const TOWN_SEEDS = [1, 7, 12345, 777, 42, 3]

describe('G7 — the walkable ENTRANCE opening matches the door width', () => {
  test('the seeded compositions really do carry BOTH 1-door and 2-door facades (the premise)', () => {
    // Odd facade → one centred door column; even facade → the backend's centred 2-wide doorway.
    expect(buildingDoorOffset('house_3')).toEqual({ x: 1, width: 1 })
    expect(buildingDoorOffset('house_5')).toEqual({ x: 2, width: 1 })
    expect(buildingDoorOffset('house_4')).toEqual({ x: 1, width: 2 })
    expect(buildingDoorOffset('hospital_6')).toEqual({ x: 2, width: 2 })
    expect(buildingDoorOffset('temple_8')).toEqual({ x: 3, width: 2 })
  })

  test('doorCells spans the FULL door width on ALL FOUR facings (east/west along rows, like the stamp rotates it)', () => {
    // A south-baked 6×4 facade, door span [2,4) — the rect is the ON-GRID footprint, so east/west swap axes.
    const flat = { col: 10, row: 20, w: 6, h: 4 } // south/north: 6 wide (facade) × 4 deep
    expect(doorCells('south', flat, { x: 2, width: 2 })).toEqual([{ col: 12, row: 23 }, { col: 13, row: 23 }])
    expect(new Set(doorCells('north', flat, { x: 2, width: 2 }).map(c => `${c.col},${c.row}`)))
      .toEqual(new Set(['12,20', '13,20']))
    // east/west: the SAME 6-long facade now runs down the ROWS (rect is 4 wide × 6 tall), so a 2-wide door
    // opens TWO rows on the edge — one cell would leave half the drawn doorway walled off.
    const turned = { col: 10, row: 20, w: 4, h: 6 }
    expect(new Set(doorCells('west', turned, { x: 2, width: 2 }).map(c => `${c.col},${c.row}`)))
      .toEqual(new Set(['10,22', '10,23']))
    expect(new Set(doorCells('east', turned, { x: 2, width: 2 }).map(c => `${c.col},${c.row}`)))
      .toEqual(new Set(['13,22', '13,23']))
  })

  test('a 1-door composition opens 1 cell and a 2-door composition opens 2 — the opening EQUALS the stamped doors', () => {
    let sawSingle = false
    let sawDouble = false
    const seenFacings = new Set<string>()
    for (const settlement of ['town', 'city'] as const) {
      for (const seed of TOWN_SEEDS) {
        const stage = genSeeded({ zone: 'spring', variant: settlement, cols: 48, rows: 48 }, seed)
        expect(stage.buildings.length).toBeGreaterThan(0)
        for (const b of stage.buildings) {
          const span = buildingDoorOffset(b.kind)
          expect(span).not.toBeNull()
          if (!span) continue
          seenFacings.add(b.facing)
          if (span.width === 1) sawSingle = true
          if (span.width === 2) sawDouble = true
          // the opening is exactly as wide as the door…
          expect(b.doorCells).toHaveLength(span.width)
          // …and sits on exactly the cells the composition stamps its door tiles on
          expect(new Set(b.doorCells.map(d => `${d.col},${d.row}`))).toEqual(stampedDoorCells(b))
          // …and every one of them is WALKABLE (you can walk in through EITHER door)
          for (const d of b.doorCells) expect(stage.collision[d.row][d.col]).toBe(false)
        }
      }
    }
    expect(sawSingle).toBe(true) // odd facades (house_3 / house_5 / store_5) exercised
    expect(sawDouble).toBe(true) // even facades (house_4 / hospital_6 / big_house_6) exercised
    expect(seenFacings.size).toBeGreaterThanOrEqual(2) // both axis-aligned and rotated buildings exercised
  })

  test('the footprint blocks EVERYWHERE except the door cells (no extra hole, no sealed door)', () => {
    for (const seed of TOWN_SEEDS) {
      const stage = genSeeded({ zone: 'spring', variant: 'town', cols: 48, rows: 48 }, seed)
      for (const b of stage.buildings) {
        const open: string[] = []
        const top = b.row - (b.height - 1)
        for (let r = top; r <= b.row; r++) {
          for (let c = b.col; c < b.col + b.length; c++) if (!stage.collision[r][c]) open.push(`${c},${r}`)
        }
        expect(new Set(open)).toEqual(new Set(b.doorCells.map(d => `${d.col},${d.row}`)))
      }
    }
  })

  test('DEGRADED path: with no tileset loaded the generator still opens a way in, and WARNS instead of failing silently', () => {
    const loaded = ASCII_TILESET
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      setAsciiTileset({ id: 'ascii', name: 'ASCII', tiles: {}, palettes: {}, terrain: {}, compositions: {} })
      const stage = genSeeded({ zone: 'spring', variant: 'town', cols: 40, rows: 40 }, 1)
      expect(stage.buildings.length).toBeGreaterThan(0)
      for (const b of stage.buildings) {
        expect(b.doorCells.length).toBeGreaterThanOrEqual(1) // never seal the player out
        for (const d of b.doorCells) expect(stage.collision[d.row][d.col]).toBe(false)
      }
      expect(warn).toHaveBeenCalled()
      expect(warn.mock.calls.some(c => String(c[0]).includes(stage.buildings[0].kind))).toBe(true)
    } finally {
      setAsciiTileset(loaded)
      warn.mockRestore()
    }
  })
})

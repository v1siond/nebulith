/**
 * A WATER BORDER SITS ON THE BORDER, never down the middle.
 *
 * His report: *"water is still not correctly drawing the borders. Look how we borders in the center of river
 * instead of in the edges of it"*, and `WATER.md` records the rule in his own words: *"we identify what
 * coordinates are in the border of the circle, then we ensure those use the tiles that have the border
 * colour"*.
 *
 * The piece chooser is pure, so the claim is checkable here rather than from a screenshot: given the cells of
 * a body, every INTERIOR cell must get the centre piece and only cells touching non-water may get an edge.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { waterPieces, waterEdges, waterBodies, classifyBody } from '@/engine/waterBody'
import { generateStage, type StageData } from '@/engine/stageGenerator'
import { isWaterGround } from '@/engine/riverNetwork'
import { findGenerator, parseGeneratorCatalog } from '@/lib/generatorCatalog'
import { makeRng } from '@/lib/math'
import liveBody from '@/__tests__/fixtures/generators.json'

const CATALOG = parseGeneratorCatalog(liveBody)

/** A real generated map, because the arithmetic below was always right and the CELLS were the defect. */
function grow(layout: 'woodland' | 'meadow' | 'jungle', seed: number): StageData {
  const config = findGenerator(CATALOG, 'wilderness', layout)!.config
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage({
      zone: 'summer', variant: 'forest', layout, cols: 60, rows: 40,
      nature: config.nature, palette: config.palette, formation: config.formation,
      treeMix: config.trees, subZones: config.subZones, options: { river: 'through', crossing: false },
    })
  } finally { Math.random = orig }
}

const waterOf = (s: StageData): Set<string> => {
  const cells = new Set<string>()
  for (let row = 0; row < s.rows; row++) {
    for (let col = 0; col < s.cols; col++) if (isWaterGround(s.ground[row][col])) cells.add(`${col},${row}`)
  }
  return cells
}

/**
 * THE CHANNEL: every wet cell that is not a region's own standing water.
 *
 * The two tests below are about the RIVER, one body flowing with a real middle to it, and a map now carries
 * a second kind of water that is neither: a `lakeside`'s lake or a bog's pools, which are separate bodies by
 * definition and would fail the first test for being exactly what they are. The third test is about the
 * BORDER, which is true of any body of water, so it keeps asking about all of it.
 */
const channelOf = (s: StageData): Set<string> => {
  const cells = waterOf(s)
  for (const key of s.standing ?? []) cells.delete(key)
  return cells
}

/** A solid rectangle of water, the simplest body with a real interior. */
const block = (w: number, h: number): Set<string> => {
  const cells = new Set<string>()
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.add(`${c},${r}`)
  return cells
}

const isEdgePiece = (label: string): boolean => !/_c$/.test(label)

describe('a water border sits on the border', () => {
  it('gives every interior cell the CENTRE piece, on a wide body', () => {
    const cells = block(7, 7)
    const pieces = waterPieces(cells)
    const wrong: string[] = []
    for (let r = 1; r <= 5; r++) {
      for (let c = 1; c <= 5; c++) {
        const label = pieces.get(`${c},${r}`)!
        if (isEdgePiece(label)) wrong.push(`${c},${r}=${label}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('gives every outer cell an EDGE piece', () => {
    const cells = block(7, 7)
    const pieces = waterPieces(cells)
    const missed: string[] = []
    for (let i = 0; i < 7; i++) {
      for (const key of [`${i},0`, `${i},6`, `0,${i}`, `6,${i}`]) {
        if (!isEdgePiece(pieces.get(key)!)) missed.push(`${key}=${pieces.get(key)}`)
      }
    }
    expect(missed).toEqual([])
  })

  /**
   * THE CASE HE PHOTOGRAPHED. A river is long and only a few cells wide, so on a 3-wide river the middle
   * lane is the only interior there is. If the centre lane gets edge pieces, the border runs down the middle
   * of the water, which is exactly what the screenshot shows.
   */
  it('a 3-wide river borders its two BANKS and not its middle lane', () => {
    const cells = new Set<string>()
    for (let c = 0; c < 20; c++) for (let r = 4; r <= 6; r++) cells.add(`${c},${r}`)
    const pieces = waterPieces(cells)

    const middle: string[] = []
    for (let c = 2; c < 18; c++) {
      const label = pieces.get(`${c},5`)!
      if (isEdgePiece(label)) middle.push(`${c},5=${label}`)
    }
    expect(middle).toEqual([])

    // and both banks DO carry an edge, or there is no border at all
    expect(isEdgePiece(pieces.get('10,4')!)).toBe(true)
    expect(isEdgePiece(pieces.get('10,6')!)).toBe(true)
  })

  it('a 2-wide river is ALL bank, which is correct and not a bug', () => {
    const cells = new Set<string>()
    for (let c = 0; c < 20; c++) for (let r = 4; r <= 5; r++) cells.add(`${c},${r}`)
    const pieces = waterPieces(cells)
    // nothing is interior, so every cell is legitimately an edge
    expect(isEdgePiece(pieces.get('10,4')!)).toBe(true)
    expect(isEdgePiece(pieces.get('10,5')!)).toBe(true)
  })

  it('a HOLE in the body makes false borders, which is how a mid-river border happens', () => {
    // the failure mode worth pinning: if one cell is missing from the body (a bridge deck, a ford, a label
    // the water test does not recognise), the cells around it become edges and the border appears mid-water.
    const cells = block(7, 7)
    cells.delete('3,3')
    const pieces = waterPieces(cells)
    expect(isEdgePiece(pieces.get('3,2')!)).toBe(true)
    expect(isEdgePiece(pieces.get('2,3')!)).toBe(true)
  })

  it('waterEdges names exactly the cells touching non-water', () => {
    const cells = block(5, 5)
    const edges = waterEdges(cells)
    expect(edges.has('0,0')).toBe(true)
    expect(edges.has('2,0')).toBe(true)
    expect(edges.has('2,2')).toBe(false) // the one true interior cell
    expect(edges.size).toBe(16)
  })
})

/**
 * AND THE CELLS HANDED TO IT ARE A RIVER.
 *
 * Everything above passes on a shape somebody typed out, and it passed while the screenshot showed borders
 * down the middle of the water, so the shape was the defect and not the arithmetic. `carveChannel` paints one
 * horizontal run per row around a meandering centreline, which measures the width ACROSS THE MAP rather than
 * across the current: on a line of slope m the perpendicular half-width of that run is only half/sqrt(1 + m^2),
 * and this centreline swings hard enough to reach about 4 columns per row. A river configured 3.2 wide came
 * out under one cell thick wherever it ran at an angle, which produces the photograph exactly. Every cell
 * touches land, so every cell is honestly a bank, and there is no middle left to be the middle of.
 *
 * The same arithmetic breaks it into pieces, since consecutive runs stop overlapping once the slope passes
 * 2*half. Measured on woodland seeds 1 to 5 before the fix: 11, 9, 11, 3 and 12 separate bodies.
 */
describe('a generated river is one river, and it has a middle', () => {
  const LAYOUTS = ['woodland', 'meadow', 'jungle'] as const
  const SEEDS = [1, 2, 3, 4, 5]

  it('flows as ONE connected body rather than a row of disconnected dashes', () => {
    const broken: string[] = []
    for (const layout of LAYOUTS) {
      for (const seed of SEEDS) {
        const bodies = waterBodies(channelOf(grow(layout, seed)))
        if (bodies.length > 1) broken.push(`${layout} seed ${seed}: ${bodies.length} bodies`)
      }
    }
    expect(broken).toEqual([])
  })

  it('carries real INTERIOR, so its border has banks to sit on', () => {
    const noMiddle: string[] = []
    for (const layout of LAYOUTS) {
      for (const seed of SEEDS) {
        const s = grow(layout, seed)
        const cells = channelOf(s)
        let centre = 0
        for (const key of cells) {
          const [col, row] = key.split(',').map(Number)
          if (/_c$/.test(s.ground[row][col])) centre += 1
        }
        // A third of the water being midstream is a modest bar for a channel three cells across, and it is
        // far above what a river drawn as diagonal dashes can reach: those measured 12 to 20 per cent.
        const share = centre / cells.size
        if (share < 0.33) noMiddle.push(`${layout} seed ${seed}: ${(share * 100).toFixed(0)}% midstream`)
      }
    }
    expect(noMiddle).toEqual([])
  })

  /**
   * UPDATED, not weakened, 2026-09-17. This asked that a cell with water on all four sides never wears a bank,
   * and that was the right question against the old rule. It is the wrong question now: *"water border should
   * show in anything that 'collapses' with it, so a big rock in middle, definitely needs borders"*, and a
   * boulder's own cell is still PAINTED water, so its neighbours do have water on all four sides and must be
   * banked all the same.
   *
   * What it was defending is still wanted, so it asks it against OPEN water: nothing standing in it.
   */
  it('never banks a cell surrounded by OPEN water, with nothing standing in any of it', () => {
    const inland: string[] = []
    for (const layout of LAYOUTS) {
      for (const seed of SEEDS) {
        const s = grow(layout, seed)
        const cells = waterOf(s)
        // the same set the generator's `openWater` builds: the body minus whatever stands in it
        const open = new Set(cells)
        for (const p of s.props) if (p.blocking) open.delete(`${p.col},${p.row}`)
        for (const c of s.compositions) open.delete(`${c.col},${c.row}`)
        for (const tr of s.trees) open.delete(`${tr.col},${tr.row}`)
        for (const key of open) {
          const [col, row] = key.split(',').map(Number)
          const ringed = [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([dc, dr]) => open.has(`${col + dc},${row + dr}`))
          if (ringed && isEdgePiece(s.ground[row][col])) inland.push(`${layout} seed ${seed} at ${key}: ${s.ground[row][col]}`)
        }
      }
    }
    expect(inland.slice(0, 10)).toEqual([])
  })
})

/**
 * AND IT BORDERS WHATEVER IT MEETS, not only the bank.
 *
 * *"water border should show in anything that 'collapses' with it, so a big rock in middle, definitely needs
 * borders"*.
 *
 * `WATER.md` §1 says a boundary cell is one whose orthogonal neighbour is not water, and read literally that
 * makes a boulder standing midstream invisible: its own cell is still painted water, so the water around it
 * is all interior and the rock sits in a flat sheet with no shore. The generator's `openWater` is what
 * separates "water" from "water you can see across", and these pin the arithmetic that consumes it.
 */
describe('water borders whatever stands in it', () => {
  it('a boulder midstream gets a shore on every side', () => {
    const cells = block(9, 9)
    const open = new Set(cells)
    open.delete('4,4') // one boulder, dead centre, the cell still painted water
    const pieces = waterPieces(cells, 'smooth', 'river', open)
    for (const [key, side] of [['4,3', 'above'], ['5,4', 'right'], ['4,5', 'below'], ['3,4', 'left']] as const) {
      expect({ side, edge: isEdgePiece(pieces.get(key)!) }).toEqual({ side, edge: true })
    }
  })

  it('and the water further off is still open', () => {
    const cells = block(9, 9)
    const open = new Set(cells)
    open.delete('4,4')
    const pieces = waterPieces(cells, 'smooth', 'river', open)
    // two cells away from the boulder and two from the bank: nothing to meet, so no shore
    expect(isEdgePiece(pieces.get('2,2')!)).toBe(false)
    expect(isEdgePiece(pieces.get('6,6')!)).toBe(false)
  })

  it('the boulder does not change which cells are PAINTED, only what they wear', () => {
    // the ground under a boulder is water and stays water: `WATER.md` §6, "the ground under every water cell
    // is a real terrain tile, and the map is complete without the water layer"
    const cells = block(9, 9)
    const open = new Set(cells)
    open.delete('4,4')
    expect(waterPieces(cells, 'smooth', 'river', open).size).toBe(waterPieces(cells).size)
    expect(waterPieces(cells, 'smooth', 'river', open).has('4,4')).toBe(true)
  })

  it('open water with nothing in it is unchanged, so a clear river keeps its middle', () => {
    const cells = block(9, 9)
    const withOpen = waterPieces(cells, 'smooth', 'river', new Set(cells))
    const plain = waterPieces(cells)
    for (const [key, label] of plain) expect(withOpen.get(key)).toBe(label)
  })
})

/**
 * A SEA IS A SEA, however deep it is.
 *
 * `classifyBody` decides which rim a body wears, and it used to ask what share of the BODY sat on a map edge.
 * That measure defeats itself: the deeper a sea, the smaller that share, so the first shore ever painted came
 * out classified as a river and wore the river's rim. The question is about the EDGE, not the body.
 */
describe('a body knows what kind of water it is', () => {
  const noFlow = new Map<string, number>()
  /** A band `deep` rows tall along the south edge of a 40x40 map: a sea. */
  const sea = (deep: number): Set<string> => {
    const cells = new Set<string>()
    for (let r = 40 - deep; r < 40; r++) for (let c = 0; c < 40; c++) cells.add(`${c},${r}`)
    return cells
  }

  it.each([2, 6, 12, 20])('a sea %i cells deep is still a BEACH', deep => {
    expect(classifyBody(sea(deep), noFlow, 40, 40)).toBe('beach')
  })

  it('a river crossing the map is not a beach, however long it is', () => {
    const river = new Set<string>()
    for (let r = 0; r < 40; r++) for (let c = 18; c < 22; c++) river.add(`${c},${r}`)
    const flow = new Map([...river].map(k => [k, 1]))
    expect(classifyBody(river, flow, 40, 40)).toBe('river')
  })

  it('still water that touches no edge is a lake', () => {
    const lake = new Set<string>()
    for (let r = 14; r < 26; r++) for (let c = 14; c < 26; c++) lake.add(`${c},${r}`)
    expect(classifyBody(lake, noFlow, 40, 40)).toBe('lake')
  })
})

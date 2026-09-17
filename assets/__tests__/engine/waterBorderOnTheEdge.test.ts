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
import { waterPieces, waterEdges, waterBodies } from '@/engine/waterBody'
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
        const bodies = waterBodies(waterOf(grow(layout, seed)))
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
        const cells = waterOf(s)
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

  it('never banks a cell that has water on all four sides', () => {
    const inland: string[] = []
    for (const layout of LAYOUTS) {
      for (const seed of SEEDS) {
        const s = grow(layout, seed)
        const cells = waterOf(s)
        for (const key of cells) {
          const [col, row] = key.split(',').map(Number)
          const ringed = [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([dc, dr]) => cells.has(`${col + dc},${row + dr}`))
          if (ringed && isEdgePiece(s.ground[row][col])) inland.push(`${layout} seed ${seed} at ${key}: ${s.ground[row][col]}`)
        }
      }
    }
    expect(inland.slice(0, 10)).toEqual([])
  })
})

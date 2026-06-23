import {
  assetFootprint,
  stampAsset,
  multiCellAssetById,
  MULTI_CELL_ASSETS,
  type MultiCellAsset,
  type StampTarget,
} from '@/engine/multiCellAssets'

interface Placed {
  col: number
  row: number
  char: string
  blocking: boolean
  color?: string
  label?: string
}

function mockGrid(cols: number, rows: number) {
  const placed: Placed[] = []
  const grid: StampTarget & { placed: Placed[]; at(c: number, r: number): Placed | undefined } = {
    cols,
    rows,
    placed,
    placeAsset(art, col, row, options) {
      placed.push({ col, row, char: art[0], blocking: !!options?.blocking, color: options?.color, label: options?.label })
    },
    at(c, r) {
      return placed.find(p => p.col === c && p.row === r)
    },
  }
  return grid
}

// 5 wide × 3 tall; a space in the middle row (transparent), a walkable 'D'.
const testAsset: MultiCellAsset = {
  id: 'test',
  name: 'Test',
  category: 'test',
  color: '#abc',
  walkable: ['D'],
  rows: [
    'ABC', //  row 0
    'D E', //  row 1: D(walkable) space(transparent) E
    'FGHIJ', // row 2 (widest = 5)
  ],
}

describe('multiCellAssets — footprint', () => {
  it('footprint is widest row × row count', () => {
    expect(assetFootprint(testAsset)).toEqual({ w: 5, h: 3 })
  })

  it('every library asset has a sane footprint (multi-cell)', () => {
    expect(MULTI_CELL_ASSETS.length).toBeGreaterThanOrEqual(8)
    for (const a of MULTI_CELL_ASSETS) {
      const fp = assetFootprint(a)
      expect(fp.h).toBeGreaterThanOrEqual(2)
      expect(fp.w).toBeGreaterThanOrEqual(2)
      expect(a.rows.length).toBe(fp.h)
    }
  })
})

describe('multiCellAssets — stampAsset maps chars → cells', () => {
  it('writes each non-space char to (anchor + offset), preserving the glyph', () => {
    const g = mockGrid(40, 40)
    stampAsset(g, testAsset, 10, 20)
    expect(g.at(10, 20)?.char).toBe('A')
    expect(g.at(11, 20)?.char).toBe('B')
    expect(g.at(12, 20)?.char).toBe('C')
    expect(g.at(10, 21)?.char).toBe('D')
    expect(g.at(12, 21)?.char).toBe('E')
    expect(g.at(14, 22)?.char).toBe('J') // bottom-right of the 5-wide row
  })

  it('spaces are transparent (no cell written)', () => {
    const g = mockGrid(40, 40)
    stampAsset(g, testAsset, 10, 20)
    expect(g.at(11, 21)).toBeUndefined() // the space in 'D E'
    // exactly 10 cells: 3 + 2 + 5 (the one space skipped)
    expect(g.placed.length).toBe(10)
  })

  it('non-space chars block; walkable chars do not', () => {
    const g = mockGrid(40, 40)
    stampAsset(g, testAsset, 0, 0)
    expect(g.at(0, 0)?.blocking).toBe(true) // 'A' wall → blocks
    expect(g.at(4, 2)?.blocking).toBe(true) // 'J' → blocks
    expect(g.at(0, 1)?.blocking).toBe(false) // 'D' door → walkable
  })

  it('skips out-of-bounds cells', () => {
    const g = mockGrid(12, 22) // anchor at the very edge
    stampAsset(g, testAsset, 11, 21) // most cells fall off the right/bottom
    for (const p of g.placed) {
      expect(p.col).toBeGreaterThanOrEqual(0)
      expect(p.col).toBeLessThan(12)
      expect(p.row).toBeGreaterThanOrEqual(0)
      expect(p.row).toBeLessThan(22)
    }
    expect(g.at(11, 21)?.char).toBe('A') // the only in-bounds cell
  })

  it('tags placed cells with the asset id (label) + color', () => {
    const g = mockGrid(40, 40)
    stampAsset(g, testAsset, 5, 5)
    expect(g.at(5, 5)?.label).toBe('test')
    expect(g.at(5, 5)?.color).toBe('#abc')
  })

  it('a known library asset (well) stamps its footprint of cells', () => {
    const well = multiCellAssetById('well')!
    const fp = assetFootprint(well)
    const g = mockGrid(40, 40)
    stampAsset(g, well, 3, 3)
    // every placed cell sits inside the well's footprint box
    for (const p of g.placed) {
      expect(p.col).toBeGreaterThanOrEqual(3)
      expect(p.col).toBeLessThan(3 + fp.w)
      expect(p.row).toBeGreaterThanOrEqual(3)
      expect(p.row).toBeLessThan(3 + fp.h)
    }
    expect(g.placed.length).toBeGreaterThan(1) // genuinely multi-cell
  })
})

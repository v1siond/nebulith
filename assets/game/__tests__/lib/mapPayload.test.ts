import { IsometricGrid, type GridAsset } from '@/engine/IsometricGrid'
import { applyMapPayload, gridToMapPayload, payloadToTile, tileToPayload } from '@/lib/mapPayload'

/**
 * THE EDITOR'S GRID, THROUGH THE COLUMNS AND BACK.
 *
 * Phase 3 replaced three JSON blobs with rows. This is the translation at that boundary, so what it
 * has to guarantee is the same thing the backend's round-trip gate guarantees: what a person authored
 * is what comes back, setting for setting, with nothing dropped and nothing invented.
 *
 * Two conversions happen here and only here, and both are the kind that goes wrong silently:
 * degrees against radians, and a span counted from the anchor against a span that includes it.
 */

const asset = (over: Partial<GridAsset> = {}): GridAsset =>
  ({ art: [''], col: 1, row: 2, type: 'oak_canopy', label: 'oak_canopy', ...over }) as GridAsset

describe('one tile, out and back', () => {
  it('keeps every setting it was given', () => {
    const original = asset({
      heightLevel: 3,
      height: 2,
      scaleX: 1.5,
      depth: 0.5,
      spanForward: 4,
      spanBack: 2,
      spanPerp: 1,
      spanAxis: 'left-up',
      zOffset: 1.25,
      zDir: 'right-down',
      zIndex: 7,
      color: '#3a7d44',
      sideColor: '#241a10',
      bgColor: '#000000',
      opacity: 0.8,
      brightness: 1.4,
      shape: 'cone',
      thickness: { 'left-up': 0.3, 'right-down': 0.6 },
      pose: { dx: -0.5, dy: 0.25, flip: true, scale: 1.25 },
      settings: { display: 'single', transparent: true, fadeNear: true, cutawayRoof: true, minAlpha: 0.15 },
    })

    const back = payloadToTile(tileToPayload(original), 1, 2)

    expect(back.heightLevel).toBe(3)
    expect(back.scaleX).toBeCloseTo(1.5, 6)
    expect(back.depth).toBeCloseTo(0.5, 6)
    expect(back.spanForward).toBe(4)
    expect(back.spanBack).toBe(2)
    expect(back.spanAxis).toBe('left-up')
    expect(back.zOffset).toBeCloseTo(1.25, 6)
    expect(back.zDir).toBe('right-down')
    expect(back.zIndex).toBe(7)
    expect(back.color).toBe('#3a7d44')
    expect(back.sideColor).toBe('#241a10')
    expect(back.bgColor).toBe('#000000')
    expect(back.opacity).toBeCloseTo(0.8, 6)
    expect(back.brightness).toBeCloseTo(1.4, 6)
    expect(back.shape).toBe('cone')
    expect(back.thickness).toEqual({ 'left-up': 0.3, 'right-down': 0.6 })
    expect(back.pose?.dx).toBeCloseTo(-0.5, 6)
    expect(back.pose?.dy).toBeCloseTo(0.25, 6)
    expect(back.pose?.flip).toBe(true)
    expect(back.pose?.scale).toBeCloseTo(1.25, 6)
    expect(back.settings?.display).toBe('single')
    expect(back.settings?.transparent).toBe(true)
    expect(back.settings?.fadeNear).toBe(true)
    expect(back.settings?.cutawayRoof).toBe(true)
    expect(back.settings?.minAlpha).toBeCloseTo(0.15, 6)
  })

  it('converts rotation to DEGREES on the wire and back to radians, which is the 57x bug', () => {
    const payload = tileToPayload(asset({ pose: { rot: Math.PI / 2 } }))

    expect(Number(payload.rotation)).toBeCloseTo(90, 6)
    expect(payloadToTile(payload, 1, 2).pose?.rot).toBeCloseTo(Math.PI / 2, 9)
  })

  it('counts a span INCLUDING the anchor on the wire, and beyond it in the editor', () => {
    // The editor holds "cells BEYOND the anchor"; the column holds a count. A tile that spans nothing
    // extra is 0 there and 1 here, and confusing the two is off by exactly one cell every time.
    const none = tileToPayload(asset({}))
    expect(none.span_back).toBe(1)
    expect(none.span_perp).toBe(1)
    expect(payloadToTile(none, 1, 2).spanBack).toBeUndefined()

    const two = tileToPayload(asset({ spanBack: 2 }))
    expect(two.span_back).toBe(3)
    expect(payloadToTile(two, 1, 2).spanBack).toBe(2)
  })

  it('folds the block height and the vertical stretch into the ONE height', () => {
    // D6: one height, measured in blocks. The editor multiplies the two to show a single number and
    // the column IS that number, so nothing downstream multiplies it again.
    const payload = tileToPayload(asset({ height: 3, scaleY: 2 }))

    expect(Number(payload.height)).toBeCloseTo(6, 6)
    expect(payloadToTile(payload, 1, 2).height).toBeCloseTo(6, 6)
    expect(payloadToTile(payload, 1, 2).scaleY).toBeUndefined()
  })

  it('states a default rather than leaving it to be invented', () => {
    const payload = tileToPayload(asset({}))

    expect(payload.width).toBe('1')
    expect(payload.depth).toBe('1')
    expect(payload.display).toBe('all_faces')
    expect(payload.shape).toBe('square')
    expect(payload.span_forward).toBe(1)
    expect(payload.act_as_tile).toBe(true)
  })

  it('speaks by LABEL, never by a row id', () => {
    expect(tileToPayload(asset({ label: 'oak_canopy' })).label).toBe('oak_canopy')
    expect(tileToPayload(asset({ label: undefined, tileKey: 'meadow' })).label).toBe('meadow')
    expect(tileToPayload(asset({ label: undefined, tileKey: undefined, type: 'floor' })).label).toBe('floor')
    expect(tileToPayload(asset({})).tile_id).toBeUndefined()
  })

  it('carries the water heading as a compass point, not a quarter turn', () => {
    expect(tileToPayload(asset({ flow: 0 })).water_heading).toBe('e')
    expect(tileToPayload(asset({ flow: 2 })).water_heading).toBe('w')
    expect(payloadToTile({ water_heading: 'w' }, 0, 0).flow).toBe(2)
    expect(tileToPayload(asset({})).water_heading).toBeUndefined()
  })
})

describe('a whole grid, out and back', () => {
  const built = (): IsometricGrid => {
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 24, isoScale: 2.75, slabBlocks: 3 })
    grid.setHeight(1, 1, 4)
    grid.setHeight(2, 2, -2)
    grid.placeAsset([''], 1, 1, { type: 'wall', label: 'wall', heightLevel: 0, color: '#888' })
    grid.placeAsset([''], 1, 1, { type: 'window', label: 'window', heightLevel: 2, color: '#cef' })
    grid.placeAsset([''], 3, 4, { type: 'oak_canopy', label: 'oak_canopy', shape: 'cone', height: 3 })
    return grid
  }

  it("keeps the grid's own numbers, which used to travel nowhere", () => {
    const payload = gridToMapPayload(built())

    expect(payload.grid?.cols).toBe(6)
    expect(payload.grid?.cell_size).toBe(24)
    expect(payload.grid?.iso_scale).toBe('2.75')
    expect(payload.grid?.slab_blocks).toBe(3)
  })

  it('writes a cell wherever the map says anything, and the floor counts', () => {
    // A FLOOR IS A REGULAR TILE, so a fresh grid already says something about every square: it has a
    // floor standing in it. The rule is not "a cell that was edited", it is "a cell the map has
    // something to say about", and a floor is something.
    const grid = new IsometricGrid({ cols: 8, rows: 8, cellSize: 16 })
    grid.placeAsset([''], 2, 3, { type: 'rock', label: 'rock' })

    const payload = gridToMapPayload(grid)
    const rockCell = payload.cells.find(c => c.col === 2 && c.row === 3)!

    expect(payload.cells).toHaveLength(64)
    expect(rockCell.tiles.map(t => t.label)).toContain('rock')
    // and the rock rides ON the floor that was already there, rather than replacing it
    expect(rockCell.tiles.map(t => t.label)).toContain('floor')
  })

  it("keeps each cell's stack in order and its ground height", () => {
    const payload = gridToMapPayload(built())
    const cell = payload.cells.find(c => c.col === 1 && c.row === 1)!

    expect(cell.ground_height).toBe(4)
    // The floor is level 0 and was already there; the wall and window stack above it in order.
    expect(cell.tiles.map(t => t.label)).toEqual(['floor', 'wall', 'window'])
    expect(cell.tiles.map(t => t.stack_level)).toEqual([0, 0, 2])
  })

  it('comes back onto a grid with the same tiles in the same places', () => {
    const payload = gridToMapPayload(built())
    const reopened = new IsometricGrid({ cols: 6, rows: 6, cellSize: 16, isoScale: 2.5, slabBlocks: 1 })

    applyMapPayload(payload, reopened)

    expect(reopened.cellSize).toBe(24)
    expect(reopened.isoScale).toBeCloseTo(2.75, 6)
    expect(reopened.slabBlocks).toBe(3)
    expect(reopened.height[1][1]).toBe(4)
    expect(reopened.height[2][2]).toBe(-2)

    const at = (col: number, row: number) => reopened.assets.filter(a => a.col === col && a.row === row)
    expect(at(1, 1).map(a => a.label)).toEqual(['floor', 'wall', 'window'])

    const oak = at(3, 4).find(a => a.label === 'oak_canopy')!
    expect(oak.shape).toBe('cone')
    expect(oak.height).toBeCloseTo(3, 6)
  })

  it('a second trip changes nothing, so the payload is stable', () => {
    const once = gridToMapPayload(built())
    const grid = new IsometricGrid({ cols: 6, rows: 6, cellSize: 16 })
    applyMapPayload(once, grid)
    const twice = gridToMapPayload(grid)

    expect(twice.cells).toEqual(once.cells)
  })
})

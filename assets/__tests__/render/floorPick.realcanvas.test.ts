/**
 * THE FLOOR IS SELECTABLE LIKE ANY TILE. Alexander: "the selector doesn't select the floor tile at all …
 * all tiles behave the same." A floor is a level-0 GridAsset, so clicking its cell MUST return the floor tile
 * from the SAME inverted picker every other tile uses (pickIsoTilesAt over the recorded silhouettes) — not
 * "nothing" / the bare cell. This reproduces the real pick through the production render() on a real canvas.
 */
import { installRealCanvas, type RealCanvasHarness } from '@/__tests__/helpers/realCanvas'
import { installSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { render, pickIsoTilesAt, isoRecordedGeom, ISO_BLOCK_H_FRAC } from '@/engine/render/iso'
import { tileGeomCentroid } from '@/engine/render'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { EMOJI_STYLE, ASCII_STYLE } from '@/game/artStyle'
import { blockKeyForPick } from '@/game/editor/selection'
import { FLOOR_TYPE } from '@/engine/IsometricGrid'
import type { PlayerState } from '@/game/runtime/player'
import type { Style } from '@/game/artStyle'

installSeedTileset()

let H: RealCanvasHarness
beforeAll(() => { H = installRealCanvas().harness })

const CELL = 100, W = 800, HGT = 600, ISO = 1
const PCOL = 10, PROW = 10, FCOL = 12, FROW = 10 // a plain grass floor cell, offset from the player
const player = (): PlayerState => ({ x: PCOL * CELL, z: PROW * CELL, moving: false } as PlayerState)
const newGrid = (): IsometricGrid => new IsometricGrid({ cols: 30, rows: 30, cellSize: CELL, isoScale: ISO })

const renderIso = (grid: IsometricGrid, style: Style): void => {
  const ctx = H.makeCanvas(W, HGT).getContext('2d') as unknown as CanvasRenderingContext2D
  render({ ctx, w: W, h: HGT, grid, player: player(), time: 0, camOffset: { x: 0, y: 0 }, entities: [], enemyCombat: new Map(), hitMarkers: [], now: 0, zoom: 1, attackAnims: [], connectors: [], quests: [], projectiles: [], dayNight: 'day', attackReach: 1, style, clampCamera: false })
}

describe('clicking a plain grass floor cell picks the FLOOR tile (same picker as every tile)', () => {
  for (const style of [EMOJI_STYLE, ASCII_STYLE]) {
    it(`${style.id}: the floor cell records a silhouette AND the picker returns it at its own centre`, () => {
      const grid = newGrid() // ctor fills every cell with a grass floor
      renderIso(grid, style)

      // The floor drew + recorded its silhouette at level 0 (the same record every tile makes).
      const geom = isoRecordedGeom(FCOL, FROW, 0)
      expect(geom).not.toBeNull()

      // Clicking the floor tile's OWN centre must return the floor tile from the inverted picker.
      const c = tileGeomCentroid(geom!)
      const hits = pickIsoTilesAt(c.x, c.y)
      const floorHit = hits.find(h => h.col === FCOL && h.row === FROW && h.source === 'asset')
      expect(floorHit).toBeDefined()

      // The FULL selection chain the click handler runs must resolve to the floor TILE, not a bare cell:
      // (1) the hit carries a real stack SLOT (≥0), (2) blockKeyForPick makes a 3-part TILE key (not "col,row"),
      // (3) that slot in the cell's stack IS the floor asset the inspector then edits.
      expect(floorHit!.stackIndex).toBeGreaterThanOrEqual(0)
      expect(blockKeyForPick(floorHit!)).toBe(`${FCOL},${FROW},${floorHit!.stackIndex}`)
      expect(grid.getAssetsAtCell(FCOL, FROW)[floorHit!.stackIndex]?.type).toBe(FLOOR_TYPE)
    })
  }
})

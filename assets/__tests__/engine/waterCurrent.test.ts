/**
 * THE CURRENT RUNS THE WAY THE RIVER DOES.
 *
 * Alexander, 2026-09-13, with a drawing: *"all water current animation is in this direction \\, but the river
 * goes around the map, there should be a current direction that goes around with the river and the tiles
 * should show correctly that current"*, and image #9 marking three headings on a river that rings the map.
 *
 * The drift is baked into the pictures, so one picture can never know its cell's heading. There is a frame SET
 * per heading and the cell picks one by the `flow` the generator wrote.
 *
 * FOUR HEADINGS, TWO BAKES. A floor is drawn through `ctx.transform(eA, eB)` (`fillIsoFaceWithTile`), so a
 * shift inside the TEXTURE already lands along an iso axis: the headings are ±x and ±y in texture space.
 * `water_y*` is the x set transposed, and the negatives are the same frames played in reverse. I first tried
 * to do this with an offset track and it cannot work: `animShiftX` moves the tile's draw anchor, so an offset
 * slides the water off its own cell instead of scrolling the waves inside it.
 */
import '@/__tests__/helpers/installTilesetSeed'
import { spriteFrame } from '@/engine/render/assetAnimation'
import { ASCII_STYLE } from '@/game/artStyle'
import { styleTile } from '@/engine/tileset/styleTiles'
import type { GridAsset } from '@/engine/IsometricGrid'

const cell = (flow?: number): GridAsset =>
  ({ art: [''], col: 1, row: 1, type: 'floor', tileKey: 'water', heightLevel: 0, blocking: false, placedAt: 0, flow }) as unknown as GridAsset

/** The label the frame at `t` draws, which is what actually differs between headings. */
const frameAt = (flow: number | undefined, t: number): string | undefined =>
  spriteFrame(cell(flow), t, ASCII_STYLE, 'iso', 'day')?.image?.src?.split('/').pop()?.replace('.png', '')

describe('a cell plays the current of its own heading', () => {
  it('the backend serves one frame set per heading, and the transposed rows exist', () => {
    const anims = (styleTile('ascii', 'water')?.settings as { animations?: Array<{ id: string }> } | undefined)?.animations ?? []
    expect(anims.map(a => a.id).filter(id => id.startsWith('water_flow_')).sort())
      .toEqual(['water_flow_0', 'water_flow_1', 'water_flow_2', 'water_flow_3'])
    for (const label of ['water_y', 'water_y_f1', 'water_y_f2', 'water_y_f3']) {
      expect({ label, served: styleTile('ascii', label) !== undefined }).toEqual({ label, served: true })
    }
  })

  it('a river running along +row draws the TRANSPOSED waves, not the same ones as +col', () => {
    // The heart of it: two cells at the same instant, different headings, different picture.
    const alongCol = frameAt(0, 0)
    const alongRow = frameAt(1, 0)
    expect(alongCol).toBeDefined()
    expect(alongRow).toBeDefined()
    expect(alongRow).not.toBe(alongCol)
    expect(alongRow).toContain('water_y')
    expect(alongCol).not.toContain('water_y')
  })

  it('the reverse headings play the SAME pictures the other way round', () => {
    // 2 is 0 reversed and 3 is 1 reversed, which is how four headings come out of two bakes.
    const t = 0
    expect(frameAt(2, t)).toBe('water_f3')
    expect(frameAt(3, t)).toBe('water_y_f3')
    expect(frameAt(0, t)).toBe('water')
    expect(frameAt(1, t)).toBe('water_y')
  })

  it('a cell with NO heading still flows, exactly as it did before any of this', () => {
    expect(frameAt(undefined, 0)).toBe(frameAt(0, 0))
  })

  it('only ONE current plays per cell, never all four at once', () => {
    // Without the pick, every water cell would run four sprite loops over each other.
    for (const dir of [0, 1, 2, 3]) {
      const drawn = new Set([0, 300, 600, 900].map(t => frameAt(dir, t)))
      expect({ dir, distinct: drawn.size }).toEqual({ dir, distinct: 4 }) // its own four frames, and no more
    }
  })
})

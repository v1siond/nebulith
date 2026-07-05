import {
  groundColorToAssets,
  groundColorFromAssets,
  isGroundColorAsset,
  GROUND_COLOR_ASSET_TYPE,
} from '@/lib/gridCodec'
import type { GridAsset } from '@/engine/IsometricGrid'

describe('groundColor persistence codec — floor colours ride assetsData', () => {
  it('serializes only recoloured cells into one off-grid marker, keyed "col,row"', () => {
    const groundColor = [
      [null, '#ff0000'], // row 0: col 1 = red
      ['#00ff00', null], // row 1: col 0 = green
    ]
    const assets = groundColorToAssets(groundColor)
    expect(assets).toHaveLength(1)
    expect(assets[0].type).toBe(GROUND_COLOR_ASSET_TYPE)
    expect(assets[0].col).toBe(-1) // off-grid → no renderer draws it
    expect(isGroundColorAsset(assets[0])).toBe(true)
    expect(JSON.parse(assets[0].label!)).toEqual({ '1,0': '#ff0000', '0,1': '#00ff00' })
  })

  it('emits no marker when nothing is recoloured', () => {
    expect(groundColorToAssets([[null, null], [null, null]])).toEqual([])
    expect(groundColorToAssets([])).toEqual([])
  })

  it('round-trips through the marker (survives a JSON column)', () => {
    const groundColor = [[null, '#abcdef'], ['#123456', null]]
    const assets = JSON.parse(JSON.stringify(groundColorToAssets(groundColor))) as GridAsset[]
    expect(groundColorFromAssets(assets)).toEqual({ '1,0': '#abcdef', '0,1': '#123456' })
  })

  it('returns {} when there is no marker or the label is malformed', () => {
    expect(groundColorFromAssets([])).toEqual({})
    const bad: GridAsset = { art: [], col: -1, row: -1, type: GROUND_COLOR_ASSET_TYPE, blocking: false, label: 'not json' } as unknown as GridAsset
    expect(groundColorFromAssets([bad])).toEqual({})
  })
})

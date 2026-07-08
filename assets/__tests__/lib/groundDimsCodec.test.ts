/**
 * Per-cell floor DIMS persistence — rides assetsData as ONE off-grid marker, exactly like the
 * groundColor codec (serializeGrid has no groundDims field, so this keeps floor dims out of the
 * schema). Only OVERRIDDEN cells are serialized; an all-default map emits no marker.
 */
import {
  groundDimsToAssets,
  groundDimsFromAssets,
  isGroundDimsAsset,
  GROUND_DIMS_ASSET_TYPE,
} from '@/lib/gridCodec'
import type { GridAsset } from '@/engine/IsometricGrid'
import type { GroundCellDims } from '@/engine/groundDims'

describe('groundDims persistence codec — per-cell floor dims ride assetsData like groundColor', () => {
  test('serializes only OVERRIDDEN cells into one off-grid marker, keyed "col,row"', () => {
    const gd: (GroundCellDims | undefined)[][] = [
      [undefined, { scaleX: 2 }], // row 0, col 1
      [{ pose: { dx: 0.5 } }, undefined], // row 1, col 0
    ]
    const assets = groundDimsToAssets(gd)
    expect(assets).toHaveLength(1)
    expect(assets[0].type).toBe(GROUND_DIMS_ASSET_TYPE)
    expect(assets[0].col).toBe(-1) // off-grid → no renderer draws it
    expect(isGroundDimsAsset(assets[0])).toBe(true)
    expect(JSON.parse(assets[0].label!)).toEqual({ '1,0': { scaleX: 2 }, '0,1': { pose: { dx: 0.5 } } })
  })

  test('emits no marker when nothing is overridden (default / identity only)', () => {
    expect(groundDimsToAssets([[undefined, undefined]])).toEqual([])
    expect(groundDimsToAssets([[{ scaleX: 1, scale: 1 }]])).toEqual([]) // identity → not persisted
    expect(groundDimsToAssets([])).toEqual([])
  })

  test('round-trips through the marker (survives a JSON column)', () => {
    const gd: (GroundCellDims | undefined)[][] = [
      [undefined, { scaleX: 2, scaleZ: 0.5 }],
      [{ pose: { rot: 0.25 } }, undefined],
    ]
    const assets = JSON.parse(JSON.stringify(groundDimsToAssets(gd))) as GridAsset[]
    expect(groundDimsFromAssets(assets)).toEqual({
      '1,0': { scaleX: 2, scaleZ: 0.5 },
      '0,1': { pose: { rot: 0.25 } },
    })
  })

  test('returns {} when there is no marker or the label is malformed', () => {
    expect(groundDimsFromAssets([])).toEqual({})
    const bad = { art: [], col: -1, row: -1, type: GROUND_DIMS_ASSET_TYPE, blocking: false, label: 'not json' } as unknown as GridAsset
    expect(groundDimsFromAssets([bad])).toEqual({})
  })
})

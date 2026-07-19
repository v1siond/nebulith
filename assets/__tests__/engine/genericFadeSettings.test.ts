/**
 * GENERIC proximity fade — NO LONGER building-only. Fade/cutaway are driven by per-tile settings
 * (settings.fadeNear / settings.cutawayRoof) copied onto the placed asset, read by the ONE iso render path.
 * So a TREE-LEAF tile carrying settings.fadeNear fades near the hero exactly like a wall — proving the
 * behavior rides on settings, not on `type:'building'`.
 *
 * The iso render loop eases the asset's opacity via ctx.globalAlpha right before drawing it. Iso only ever
 * drives globalAlpha below ~0.85 through THIS fade path (the ground-flicker floor is ≈1.0), so a recorded
 * globalAlpha of fadeNearAlpha(0) = 0.22 is an unambiguous signal the fade fired.
 */
import '@/__tests__/helpers/installTilesetSeed' // render() paints ground from the loaded backend tileset's terrain — install the captured fixture so it isn't empty
import { render, fadeNearAlpha, cutawayAlpha, BUILDING_FADE_RADIUS, BUILDING_MIN_ALPHA, ROOF_GONE_DIST } from '@/engine/render/iso'
import { IsometricGrid, type AssetSettings } from '@/engine/IsometricGrid'
import type { PlayerState } from '@/game/runtime/player'

// A Proxy ctx that records every value assigned to globalAlpha; every other 2D call is a safe no-op.
function isoRecordingCtx(): { ctx: CanvasRenderingContext2D; alphas: number[] } {
  const alphas: number[] = []
  let alpha = 1
  const target: Record<string, unknown> = {
    fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, lineCap: '', lineJoin: '', filter: 'none', shadowBlur: 0, shadowColor: '',
    globalCompositeOperation: 'source-over',
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => ({}),
    canvas: { width: 1200, height: 1200 },
  }
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop === 'globalAlpha') return alpha
      if (prop in t) return t[prop as string]
      return () => {} // any other 2D method → no-op
    },
    set(t, prop, val) {
      if (prop === 'globalAlpha') { alpha = val as number; alphas.push(alpha) }
      else t[prop as string] = val
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, alphas }
}

// Render a 40×40 iso scene with ONE tree-leaf asset (ANY non-building type) at (col,row), player at (20,20),
// and return every globalAlpha the render assigned.
function renderLeafAlphas(col: number, row: number, settings?: AssetSettings): number[] {
  const grid = new IsometricGrid({ cols: 40, rows: 40, cellSize: 16, isoScale: 1.4 })
  const leaf = grid.placeAsset(['@'], col, row, { type: 'tree', color: '#3a3', heightLevel: 1 })
  leaf.label = 'tree_leaf_top'
  leaf.height = 1
  if (settings) leaf.settings = settings
  const player = { x: 20 * 16, z: 20 * 16 } as PlayerState
  const { ctx, alphas } = isoRecordingCtx()
  render({ ctx, w: 1200, h: 1200, grid, player, time: 0 })
  return alphas
}

describe('generic proximity fade — driven by settings, not by type:building', () => {
  test('a TREE-LEAF tile with settings.fadeNear fades when the hero is on it (globalAlpha eased to 0.22)', () => {
    const alphas = renderLeafAlphas(20, 20, { fadeNear: true }) // dist 0 → fadeNearAlpha(0) = 0.22
    expect(alphas.some(a => a < 0.5)).toBe(true)
    expect(alphas.some(a => Math.abs(a - fadeNearAlpha(0)) < 1e-9)).toBe(true)
  })

  test('the SAME leaf WITHOUT settings stays fully opaque (no fade) — fade is opt-in per tile', () => {
    const alphas = renderLeafAlphas(20, 20) // identical scene, no settings
    expect(alphas.every(a => a >= 0.85)).toBe(true) // never eased below the ground-flicker floor
  })

  test('a fadeNear leaf FAR from the hero stays opaque — the ease is proximity-gated', () => {
    const alphas = renderLeafAlphas(26, 20, { fadeNear: true }) // dist 6 > radius 4.5 → alpha 1
    expect(alphas.every(a => a >= 0.85)).toBe(true)
  })
})

describe('fadeNearAlpha — the fadeNear ease (renamed from buildingWallAlpha, same math)', () => {
  test('fully opaque at/beyond the fade radius', () => {
    expect(fadeNearAlpha(BUILDING_FADE_RADIUS)).toBe(1)
    expect(fadeNearAlpha(BUILDING_FADE_RADIUS + 3)).toBe(1)
  })
  test('eases to BUILDING_MIN_ALPHA when the hero is on top (dist 0)', () => {
    expect(fadeNearAlpha(0)).toBeCloseTo(BUILDING_MIN_ALPHA)
  })
  test('monotonically eases between minAlpha and 1 as distance grows', () => {
    const near = fadeNearAlpha(1)
    const far = fadeNearAlpha(3)
    expect(near).toBeGreaterThan(BUILDING_MIN_ALPHA)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeLessThan(1)
  })
})

describe('cutawayAlpha — the cutawayRoof ease (renamed from buildingRoofAlpha, same math)', () => {
  test('fully opaque at/beyond the fade radius', () => {
    expect(cutawayAlpha(BUILDING_FADE_RADIUS)).toBe(1)
  })
  test('fully gone (0) within ROOF_GONE_DIST — the tile lifts clean off', () => {
    expect(cutawayAlpha(ROOF_GONE_DIST)).toBe(0)
    expect(cutawayAlpha(0)).toBe(0)
  })
  test('eases from 0 up to 1 between ROOF_GONE_DIST and the radius', () => {
    const a = cutawayAlpha((ROOF_GONE_DIST + BUILDING_FADE_RADIUS) / 2)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
  })
})

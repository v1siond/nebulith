/**
 * GENERIC proximity reveal — NO LONGER building-only. Fade/cutaway are driven by per-tile settings
 * (settings.fadeNear / settings.cutawayRoof) copied onto the placed asset, read by the ONE iso render path.
 * So a TREE-LEAF tile carrying settings.fadeNear eases near the hero exactly like a wall — proving the
 * behavior rides on settings, not on `type:'building'`.
 *
 * The iso render loop eases the asset's opacity via ctx.globalAlpha right before drawing it. Iso only ever
 * drives globalAlpha below ~0.85 through THIS path (the ground-flicker floor is ≈1.0), so a recorded
 * globalAlpha of APPROACH_ALPHA is an unambiguous signal the reveal fired.
 *
 * Retargeted 2026-09-08: this suite used to call `fadeNearAlpha` / `cutawayAlpha`, two separate distance
 * eases. `revealAlpha` replaced both — one function, one set of bands, with `inside` selecting the deep
 * interior reveal instead of a second ease. The behaviour under test is unchanged; only the entry point is.
 */
import '@/__tests__/helpers/installTilesetSeed' // render() paints ground from the loaded backend tileset's terrain — install the captured fixture so it isn't empty
import { render } from '@/engine/render/iso'
import {
  revealAlpha,
  APPROACH_RADIUS,
  APPROACH_ALPHA,
  APPROACH_NEAR,
  INTERIOR_SHELL_ALPHA,
} from '@/engine/render/roofReveal'
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

describe('generic proximity reveal — driven by settings, not by type:building', () => {
  test('a TREE-LEAF tile with settings.fadeNear eases when the hero is on it (globalAlpha at APPROACH_ALPHA)', () => {
    const alphas = renderLeafAlphas(20, 20, { fadeNear: true }) // dist 0 → the flat near band
    expect(alphas.some(a => a < 0.5)).toBe(true)
    expect(alphas.some(a => Math.abs(a - APPROACH_ALPHA) < 1e-9)).toBe(true)
  })

  test('the SAME leaf WITHOUT settings stays fully opaque (no reveal) — it is opt-in per tile', () => {
    const alphas = renderLeafAlphas(20, 20) // identical scene, no settings
    expect(alphas.every(a => a >= 0.85)).toBe(true) // never eased below the ground-flicker floor
  })

  test('a fadeNear leaf beyond APPROACH_RADIUS stays opaque — the ease is proximity-gated', () => {
    const alphas = renderLeafAlphas(20 + APPROACH_RADIUS + 1, 20, { fadeNear: true })
    expect(alphas.every(a => a >= 0.85)).toBe(true)
  })
})

describe('revealAlpha — the ONE ease (it superseded fadeNearAlpha AND cutawayAlpha)', () => {
  test('fully opaque at and beyond APPROACH_RADIUS', () => {
    expect(revealAlpha({ dist: APPROACH_RADIUS, inside: false })).toBe(1)
    expect(revealAlpha({ dist: APPROACH_RADIUS + 3, inside: false })).toBe(1)
  })

  test('holds FLAT at APPROACH_ALPHA anywhere inside APPROACH_NEAR', () => {
    // A plateau, not a ramp: standing at the door and standing five cells out read the same, so getting close
    // is an unmistakable change rather than a few percent (Alexander, Image #7).
    expect(revealAlpha({ dist: 0, inside: false })).toBeCloseTo(APPROACH_ALPHA)
    expect(revealAlpha({ dist: APPROACH_NEAR, inside: false })).toBeCloseTo(APPROACH_ALPHA)
  })

  test('climbs back to solid between APPROACH_NEAR and APPROACH_RADIUS', () => {
    const near = revealAlpha({ dist: APPROACH_NEAR + 1, inside: false })
    const far = revealAlpha({ dist: APPROACH_RADIUS - 1, inside: false })
    expect(near).toBeGreaterThan(APPROACH_ALPHA)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeLessThan(1)
  })

  test('a tile with its own minAlpha only ever draws MORE opaque — the door stays readable', () => {
    // minAlpha is a per-tile backend SETTING, which is how the door keeps its edges while the wall around it
    // fades — no tile-name conditional in the renderer.
    expect(revealAlpha({ dist: 0, inside: false, minAlpha: 0.8 })).toBeCloseTo(0.8)
    expect(revealAlpha({ dist: 0, inside: false, minAlpha: 0.1 })).toBeCloseTo(APPROACH_ALPHA)
  })
})

describe('the INSIDE band — standing under the roof', () => {
  test('inside drops the shell to INTERIOR_SHELL_ALPHA so the room reads', () => {
    expect(revealAlpha({ dist: 0, inside: true })).toBeCloseTo(INTERIOR_SHELL_ALPHA)
  })

  test('inside is POSITIONAL, not a distance ease — the same value at every dist', () => {
    // This is the whole reason `cutawayAlpha` went away: it faded things as you merely walked PAST, so walls
    // ghosted from outside while the roof stayed solid (Image #1). You are under a roof or you are not.
    const at = (dist: number): number => revealAlpha({ dist, inside: true })
    expect(at(0)).toBe(at(APPROACH_NEAR))
    expect(at(0)).toBe(at(APPROACH_RADIUS))
    expect(at(0)).toBe(at(APPROACH_RADIUS + 10))
  })

  test('the interior band is more transparent than the approach band', () => {
    expect(INTERIOR_SHELL_ALPHA).toBeLessThan(APPROACH_ALPHA)
  })
})

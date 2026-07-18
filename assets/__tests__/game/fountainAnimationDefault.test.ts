/**
 * The FOUNTAIN + WELL COMPOSITIONS ship their water animated BY DEFAULT — and DESYNCED.
 *
 * The animation is BACKEND DATA: nebulith authors the interior `water_c` (blue water) cells with a default
 * `animations` array — ONE looping YOYO settings animation that grows the water column's HEIGHT 1→4 blocks and
 * back (no `water_jet` drops, no opacity fade). EXACTLY 3 water columns animate in each variant (Alexander:
 * "in all cases only 3 blocks are animated") — all 3 in the small `well`, the CENTRE ROW of 3 in the large 3×3
 * `fountain` (the other 6 are STATIC water). The 3 carry the SAME grow but with DISTINCT durationMs +
 * startDelayMs so they pulse OUT of sync (Alexander: "different duration and delays … realistic fountain
 * water"). It's served per cell (camelCase), carried verbatim onto `CompositionCell.animations` by the loader,
 * and `stampComposition` copies it onto the placed asset (+ sets `placedAt`).
 *
 * This drives the REAL seeded fixture (the captured /api/tilesets response), so it verifies the actual
 * backend default, not a hand-built stand-in.
 */
import { stampComposition } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { SettingsAnimation } from '@/engine/animation/tileAnimation'

describe('fountain composition — water cells ship the height-grow animation as a backend default', () => {
  useSeedTileset() // install the captured backend tileset (fountain water cells carry the grow animation)

  function stampFountain() {
    const grid = new IsometricGrid({ cols: 10, rows: 10, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, 'fountain', 1, 1, 'spring')
    return { grid, placed }
  }

  test('the fountain interior is all water_c (no drops); exactly 3 of the 9 animate, 6 are STATIC, the rim never', () => {
    const comp = ASCII_TILESET.compositions?.['fountain']
    expect(comp).toBeTruthy()
    // the drops are gone — the interior is blue water only
    expect(comp!.cells.some(c => c.label === 'water_jet')).toBe(false)
    const water = comp!.cells.filter(c => c.label === 'water_c')
    expect(water.length).toBe(9) // a 3×3 grid of water
    // EXACTLY 3 animate (the centre line); the other 6 are STATIC water; the rim (fountain_*) never animates
    const withAnims = water.filter(c => c.animations && c.animations.length > 0)
    expect(withAnims.length).toBe(3)
    expect(withAnims.every(c => c.label === 'water_c')).toBe(true)
    expect(water.filter(c => !c.animations || c.animations.length === 0).length).toBe(6)
    expect(comp!.cells.some(c => c.label.startsWith('fountain_') && c.animations && c.animations.length > 0)).toBe(false)
  })

  test('stampComposition copies the animation + placedAt onto the 3 animated water assets; static water + rim untouched', () => {
    const { grid, placed } = stampFountain()
    expect(placed).toBeGreaterThan(0)

    const water = grid.assets.filter(a => a.label === 'water_c')
    const rim = grid.assets.filter(a => a.label?.startsWith('fountain_'))
    expect(water.length).toBe(9)
    expect(rim.length).toBeGreaterThan(0)

    const animated = water.filter(a => a.animations && a.animations.length > 0)
    const staticWater = water.filter(a => !a.animations || a.animations.length === 0)
    expect(animated.length).toBe(3)
    expect(staticWater.length).toBe(6)
    for (const a of animated) {
      expect(a.animations?.length).toBe(1)
      expect(a.placedAt).toBe(0) // render-clock origin → the LOAD loop plays immediately / stays in sync
    }
    // the static water + the rim are untouched — no animation, byte-identical to before
    for (const a of [...staticWater, ...rim]) {
      expect(a.animations).toBeUndefined()
      expect(a.placedAt).toBeUndefined()
    }
  })

  test('each animated grow is the exact yoyo height 1→4 sine spec, and the 3 are DESYNCED (distinct duration + delay)', () => {
    const { grid } = stampFountain()
    const animated = grid.assets.filter(a => a.label === 'water_c' && a.animations && a.animations.length > 0)
    expect(animated.length).toBe(3)

    for (const a of animated) {
      const anims = a.animations as SettingsAnimation[]
      expect(anims.length).toBe(1)
      const grow = anims[0]
      expect(grow.id).toBe('fountain_water_grow')
      expect(grow.kind).toBe('settings')
      expect(grow.loop).toBe(true)
      expect(grow.yoyo).toBe(true) // ping-pong: grow then auto-reverse back, no chaining
      expect(grow.ease).toBe('sine')
      expect(grow.durationMs).toBeGreaterThanOrEqual(1000)
      expect(grow.durationMs).toBeLessThanOrEqual(1800)
      expect(grow.startDelayMs).toBeGreaterThanOrEqual(0)
      expect(grow.startDelayMs).toBeLessThanOrEqual(800)
      // ONE track: the block HEIGHT (scaleY) grows from 1 block to 4 — up from the base, no y-lift, no opacity
      expect(grow.tracks).toEqual([{ setting: 'height', from: 1, to: 4 }])
      expect(grow.tracks.some(t => t.setting === 'opacity')).toBe(false)
      expect(grow.tracks.some(t => t.setting === 'y')).toBe(false)
    }
    // DESYNCED — all-distinct durations AND all-distinct start delays ⇒ no two columns share a phase.
    const durations = animated.map(a => (a.animations as SettingsAnimation[])[0].durationMs)
    const delays = animated.map(a => (a.animations as SettingsAnimation[])[0].startDelayMs)
    expect(new Set(durations).size).toBe(3)
    expect(new Set(delays).size).toBe(3)
  })

  test('the small WELL variant animates by default too — all 3 of its water columns, desynced', () => {
    const grid = new IsometricGrid({ cols: 10, rows: 10, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, 'well', 1, 1, 'spring')
    expect(placed).toBeGreaterThan(0)
    const water = grid.assets.filter(a => a.label === 'water_c')
    expect(water.length).toBe(3)
    const animated = water.filter(a => a.animations && a.animations.length > 0)
    expect(animated.length).toBe(3) // all 3 animate (it's the small variant)
    const durations = animated.map(a => (a.animations as SettingsAnimation[])[0].durationMs)
    const delays = animated.map(a => (a.animations as SettingsAnimation[])[0].startDelayMs)
    expect(new Set(durations).size).toBe(3) // desynced
    expect(new Set(delays).size).toBe(3)
  })
})

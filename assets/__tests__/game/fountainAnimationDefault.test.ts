/**
 * Phase 3 — the FOUNTAIN COMPOSITION ships its water animated BY DEFAULT.
 *
 * The animation is BACKEND DATA: nebulith's fountain composition authors the water cells (water_c +
 * water_jet) with a default `animations` array (two chained looping settings tweens — a "rise" that fades
 * IN + lifts 3 blocks, and a "fade" out at the top). It's served on each composition cell (camelCase),
 * carried verbatim onto `CompositionCell.animations` by the loader, and `stampComposition` copies it onto
 * the placed asset (+ sets `placedAt`). So a generated town's fountain water animates with no per-instance
 * authoring, while every other cell (the rim, other buildings) stays un-animated.
 *
 * This drives the REAL seeded fixture (the captured /api/tilesets response), so it verifies the actual
 * backend default, not a hand-built stand-in.
 */
import { stampComposition } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { SettingsAnimation } from '@/engine/animation/tileAnimation'

const WATER = new Set(['water_c', 'water_jet'])

describe('fountain composition — water cells ship the rise/fade animation as a backend default', () => {
  useSeedTileset() // install the captured backend tileset (fountain water cells carry the 2 animations)

  function stampFountain() {
    const grid = new IsometricGrid({ cols: 10, rows: 10, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, 'fountain', 1, 1, 'spring')
    return { grid, placed }
  }

  test('the seeded fountain composition exists and carries animations on ONLY its water cells', () => {
    const comp = ASCII_TILESET.compositions?.['fountain']
    expect(comp).toBeTruthy()
    const withAnims = comp!.cells.filter(c => c.animations && c.animations.length > 0)
    // every animated cell is water; every rim cell (fountain_*) has none
    expect(withAnims.length).toBeGreaterThan(0)
    expect(withAnims.every(c => WATER.has(c.label))).toBe(true)
    expect(comp!.cells.some(c => c.label.startsWith('fountain_') && c.animations)).toBe(false)
  })

  test('stampComposition copies the water animation + placedAt onto every placed water asset', () => {
    const { grid, placed } = stampFountain()
    expect(placed).toBeGreaterThan(0)

    const water = grid.assets.filter(a => a.label && WATER.has(a.label))
    const rim = grid.assets.filter(a => a.label?.startsWith('fountain_'))
    expect(water.length).toBeGreaterThan(0)
    expect(rim.length).toBeGreaterThan(0)

    for (const a of water) {
      expect(a.animations?.length).toBe(2)
      expect(a.placedAt).toBe(0) // render-clock origin → the LOAD loop plays immediately / stays in sync
    }
    // the rim (and thus a non-water tile) is untouched — no animation, byte-identical to before
    for (const a of rim) {
      expect(a.animations).toBeUndefined()
      expect(a.placedAt).toBeUndefined()
    }
  })

  test('the two chained animations are the exact rise (opacity 0→1, y 0→3) + fade (opacity 1→0) spec', () => {
    const { grid } = stampFountain()
    const water = grid.assets.find(a => a.label === 'water_c')
    const anims = water?.animations as SettingsAnimation[] | undefined
    expect(anims?.length).toBe(2)

    const rise = anims!.find(x => x.id === 'fountain_water_rise')!
    const fade = anims!.find(x => x.id === 'fountain_water_fade')!
    expect(rise.kind).toBe('settings')
    expect(rise.loop).toBe(true)
    expect(rise.durationMs).toBe(1200)
    expect(rise.startDelayMs).toBe(0)
    expect(rise.tracks).toEqual([
      { setting: 'opacity', from: 0, to: 1 },
      { setting: 'y', from: 0, to: 3 },
    ])

    expect(fade.loop).toBe(true)
    expect(fade.durationMs).toBe(600)
    expect(fade.startDelayMs).toBe(1200) // fades AFTER the rise, at the top
    expect(fade.tracks).toEqual([{ setting: 'opacity', from: 1, to: 0 }])

    // shared cycle period so they stay in sync every loop: 1200+600 === 600+1200 === 1800
    expect(rise.durationMs + (rise.loopDelayMs ?? 0)).toBe(fade.durationMs + (fade.loopDelayMs ?? 0))
  })
})

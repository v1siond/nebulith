/**
 * Phase 3 — the FOUNTAIN COMPOSITION ships its water animated BY DEFAULT.
 *
 * The animation is BACKEND DATA: nebulith's fountain composition authors its interior `water_c` (blue water)
 * cells with a default `animations` array — ONE looping YOYO settings animation that grows the water column's
 * HEIGHT 1→4 blocks and back (no more `water_jet` drops, no opacity fade). It's served on each composition
 * cell (camelCase), carried verbatim onto `CompositionCell.animations` by the loader, and `stampComposition`
 * copies it onto the placed asset (+ sets `placedAt`). So a generated town's fountain water animates with no
 * per-instance authoring, while every other cell (the rim, other buildings) stays un-animated.
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

  test('the fountain interior is all water_c (no water_jet drops) and only the water carries animations', () => {
    const comp = ASCII_TILESET.compositions?.['fountain']
    expect(comp).toBeTruthy()
    // the drops are gone — the interior is blue water only
    expect(comp!.cells.some(c => c.label === 'water_jet')).toBe(false)
    expect(comp!.cells.some(c => c.label === 'water_c')).toBe(true)
    // every animated cell is water_c; every rim cell (fountain_*) has none
    const withAnims = comp!.cells.filter(c => c.animations && c.animations.length > 0)
    expect(withAnims.length).toBeGreaterThan(0)
    expect(withAnims.every(c => c.label === 'water_c')).toBe(true)
    expect(comp!.cells.some(c => c.label.startsWith('fountain_') && c.animations)).toBe(false)
  })

  test('stampComposition copies the water animation + placedAt onto every placed water asset', () => {
    const { grid, placed } = stampFountain()
    expect(placed).toBeGreaterThan(0)

    const water = grid.assets.filter(a => a.label === 'water_c')
    const rim = grid.assets.filter(a => a.label?.startsWith('fountain_'))
    expect(water.length).toBeGreaterThan(0)
    expect(rim.length).toBeGreaterThan(0)

    for (const a of water) {
      expect(a.animations?.length).toBe(1)
      expect(a.placedAt).toBe(0) // render-clock origin → the LOAD loop plays immediately / stays in sync
    }
    // the rim (and thus a non-water tile) is untouched — no animation, byte-identical to before
    for (const a of rim) {
      expect(a.animations).toBeUndefined()
      expect(a.placedAt).toBeUndefined()
    }
  })

  test('the single grow animation is the exact yoyo height 1→4 spec (no levitation, no opacity fade)', () => {
    const { grid } = stampFountain()
    const water = grid.assets.find(a => a.label === 'water_c')
    const anims = water?.animations as SettingsAnimation[] | undefined
    expect(anims?.length).toBe(1)

    const grow = anims![0]
    expect(grow.id).toBe('fountain_water_grow')
    expect(grow.kind).toBe('settings')
    expect(grow.loop).toBe(true)
    expect(grow.yoyo).toBe(true) // ping-pong: grow then auto-reverse back, no chaining
    expect(grow.durationMs).toBe(1400)
    expect(grow.startDelayMs).toBe(0)
    expect(grow.ease).toBe('sine')
    // ONE track: the block HEIGHT (scaleY) grows from 1 block to 4 — up from the base, no y-lift, no opacity
    expect(grow.tracks).toEqual([{ setting: 'height', from: 1, to: 4 }])
    expect(grow.tracks.some(t => t.setting === 'opacity')).toBe(false)
    expect(grow.tracks.some(t => t.setting === 'y')).toBe(false)
  })
})

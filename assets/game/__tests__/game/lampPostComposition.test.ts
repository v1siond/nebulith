/**
 * The LAMP_POST composition renders as a REAL post, a tall, THIN pole with a single bulb ON TOP, shaped
 * ENTIRELY by BACKEND per-cell settings. No frontend geometry is hardcoded.
 *
 * The tuning is DATA on the composition cells (served by nebulith, carried verbatim onto CompositionCell):
 *   • POST (level 0), ONE cell drawn as a tall pole: Height `scaleY` 7 at Zoom `scale` 0.3 (thin). Blocks.
 *   • BULB (level 1), a SINGLE-display billboard (one centered bulb, not tiled on the faces), Zoom `scale`
 *     0.6, lifted by `pose.dy` -1.8 so it sits on top of the post. Walkable overhead.
 * The composition STRUCTURE is style-agnostic (one global row) → identical in ascii + emoji; only the art differs.
 *
 * Drives the REAL seeded fixture (the captured /api/tilesets response), so it verifies the actual backend
 * default, and asserts stampComposition applies each setting onto the placed asset (scaleY, scale, settings.display,
 * pose), the "compositions use tuned tile settings for realistic shapes" plumbing.
 */
import { styleCatalog } from '@/engine/tileset/styleTiles'
import { stampComposition } from '@/game/runtime/composition'
import { IsometricGrid } from '@/engine/IsometricGrid'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import { assetIsSolid } from '@/engine/collisionBoxes'

describe('lamp_post composition, a tall thin post + a single bulb, shaped by backend per-cell settings', () => {
  useSeedTileset() // install the captured backend tileset (lamp_post cells carry the tuned settings)

  // Compositions are STYLE-AGNOSTIC: nebulith serves ONE global `lamp_post` row (identical under both the ascii
  // and emoji API entries, verified by the backend test + `curl /api/tilesets`), and the frontend reads it from
  // styleCatalog('ascii') for BOTH render styles (stampComposition → resolveComposition(styleCatalog('ascii'), …)); the active
  // style only swaps which tile ART resolves. So one source carries the tuned shape for both styles.
  test('the composition carries the tuned per-cell settings, a tall thin post + a single bulb on top', () => {
    const comp = styleCatalog('ascii').compositions?.['lamp_post']
    expect(comp).toBeTruthy()
    expect(comp!.footprint).toEqual({ w: 1, h: 1 })

    const post = comp!.cells.find(c => c.label === 'post')!
    const lamp = comp!.cells.find(c => c.label === 'lamp')!

    // POST, a single cell shaped tall (scaleY 7) + thin (scale 0.3) into a real pole.
    expect(post.level).toBe(0)
    expect(post.scale).toBeCloseTo(0.3, 5)
    expect(post.settings?.scaleY).toBeCloseTo(7, 5)

    // BULB, a single centered billboard, scaled down + lifted onto the post's top. The CELL is what the
    // backend authored, so it still spells this as a cell-wide `scale`; the fold onto the three axes
    // happens when it is stamped (see the stamping test below).
    expect(lamp.level).toBe(1)
    expect(lamp.scale).toBeCloseTo(0.6, 5)
    expect(lamp.settings?.display).toBe('single')
    expect(lamp.settings?.pose?.dy).toBeCloseTo(-1.8, 5)
  })

  test('stampComposition applies the settings onto the placed assets, a tall thin POST + a single-display BULB', () => {
    const grid = new IsometricGrid({ cols: 10, rows: 10, cellSize: 32, isoScale: 1.4 })
    const placed = stampComposition(grid, 'lamp_post', 3, 3, 'spring')
    expect(placed).toBe(2)

    const post = grid.assets.find(a => a.label === 'post')!
    const lamp = grid.assets.find(a => a.label === 'lamp')!
    expect(post).toBeTruthy()
    expect(lamp).toBeTruthy()

    // POST: tall and narrow, standing ON the flat ground, blocking. Authored as Height 7 at Zoom 0.3,
    // which folds into the axes as Height 2.1 across a 0.3 footprint: the same pole, expressed in the
    // three axes rather than in four numbers where one multiplied the others.
    // Level 0, not 1: the ground is flat since T-140, so there is no block under the post to climb.
    expect(post.scaleY).toBeCloseTo(7 * 0.3, 5)
    expect(post.scaleX).toBeCloseTo(0.3, 5)
    expect(post.depth).toBeCloseTo(0.3, 5)
    expect(post.heightLevel).toBe(0)
    expect(assetIsSolid(post)).toBe(true) // it occupies its cell, which is the only way a tile says "solid" now

    // BULB, a single centered billboard (settings.display), drawn at 0.6 on both ground axes, lifted onto the post top via pose.dy;
    // walkable overhead, and NOT height-stretched (only the post carries a scaleY).
    expect(lamp.settings?.display).toBe('single')
    expect(lamp.scaleX).toBeCloseTo(0.6, 5)
    expect(lamp.depth).toBeCloseTo(0.6, 5)
    expect(lamp.pose?.dy).toBeCloseTo(-1.8, 5)
    expect(lamp.heightLevel).toBe(1) // one level above the post's, as the composition authors it
    expect(assetIsSolid(lamp)).toBe(false) // the bulb is walked under, and it says so in its boxes
    // The bulb is drawn at 0.6 on EVERY axis, height included, which is what a cell-wide 0.6 meant.
    // It carries no height stretch of its own: only the post does, and its own 7 is separate.
    expect(lamp.scaleY ?? 1).toBeCloseTo(0.6, 5)
  })
})

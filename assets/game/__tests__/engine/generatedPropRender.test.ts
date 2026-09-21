/**
 * The generator's PER-INSTANCE render override for standing props. A scattered FLOWER must render as a single
 * billboard a block tall, `height: 1` + `settings.display: 'single'`, NOT the flat 0.1 the tile carries. This
 * is set by the GENERATOR on the placed asset (no tile-definition change, no migration), so it rides the normal
 * stage save/load exactly like a setting a hand-painter would apply. A prop TYPE with no override carries nothing
 * and keeps the tile-driven flat render.
 *
 * The second test locks the chain end-to-end: generatedPropRender → placeAsset → the GridAsset actually carries
 * the fields (placeAsset used to DROP height/settings, silently defeating the override).
 */
import { generatedPropRender } from '@/engine/stageGenerator'
import { IsometricGrid } from '@/engine/IsometricGrid'

describe('generatedPropRender, per-instance standing-prop render', () => {
  test('a flower, and a scattered ground-decor bloom, renders as a small single transparent billboard', () => {
    // flowers (and the daisy ground-decor that used to render as coloured CUBES) must be
    // single + transparent + slightly smaller (scale < 1), NOT full-cell blocks.
    const bloom = { height: 1, scale: 0.85, settings: { display: 'single', transparent: true } }
    expect(generatedPropRender('flower')).toEqual(bloom)
    expect(generatedPropRender('ground_decor')).toEqual(bloom)
  })

  test('a prop with no override carries nothing (keeps the tile-driven flat render)', () => {
    expect(generatedPropRender('rock')).toEqual({})
    expect(generatedPropRender('tree_small')).toEqual({})
    expect(generatedPropRender('npc')).toEqual({})
  })

  test('placeAsset carries the override onto the GridAsset (the drop that silently defeated it)', () => {
    const grid = new IsometricGrid({ cols: 20, rows: 20, cellSize: 16, isoScale: 1 })
    const flower = grid.placeAsset(['🌷'], 5, 6, { type: 'flower', ...generatedPropRender('flower') })
    expect(flower.height).toBe(1) // resolveTileHeight prefers this over the tile's flat 0.1 → stands a block tall
    expect(flower.settings?.display).toBe('single') // iso render draws ONE centered billboard, not flat faces
    expect(flower.settings?.transparent).toBe(true) // block shell is skipped → just the bloom shows

    const rock = grid.placeAsset(['🪨'], 7, 8, { type: 'rock', ...generatedPropRender('rock') })
    // NO OVERRIDE MEANS THE CATALOGUE'S HEIGHT, SAID OUT LOUD, not silence for a renderer to fill in.
    // The comment here used to read "tile's own block-height drives it", and that stopped being true the
    // moment the renderer stopped consulting the tile: silence became the column's default of one whole
    // block, and every flat prop on the map came up a cube. No catalogue is loaded in this test, so the
    // answer is that same default, which is now stated where it can be seen and saved.
    expect(rock.height).toBe(1)
    expect(rock.settings).toBeUndefined()
  })
})

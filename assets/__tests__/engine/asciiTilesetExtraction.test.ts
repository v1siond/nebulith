/**
 * "Behave the same, load different." The ASCII art is EXTRACTED into a Tileset (data). This proves the
 * extraction is faithful: resolving a tile from the LOADED tileset === the hardcoded cellTile() output,
 * for every zone × every cell label × several canopy variants. If any glyph/colour/role was mis-copied,
 * this fails. (No renderer change yet — this only validates the data + resolver reproduce the behaviour.)
 */
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { resolveTile, resolveGroundTile } from '@/engine/tileset/tileset'
import { cellTile } from '@/engine/cellTileset'
import { CELL_LABELS } from '@/engine/cellLabels'
import { GROUND_COLORS } from '@/levels/village'
import type { ZoneId } from '@/engine/zones'

const ZONES: ZoneId[] = ['spring', 'summer', 'autumn', 'winter', 'desert', 'beach', 'lava']

// The EXACT inline ground selection from drawIsoGroundLayer (the thing the resolver must reproduce).
function inlineGround(tileType: string, col: number, row: number) {
  const colors = GROUND_COLORS[tileType] || GROUND_COLORS.grass
  const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
  const colorIdx = noiseVal > 0 ? 0 : 1
  return { char: colors.char[colorIdx % colors.char.length], fg: colors.fg[colorIdx % colors.fg.length], bg: colors.bg[0] }
}

describe('ASCII tileset extraction — loaded data reproduces hardcoded cellTile() byte-for-byte', () => {
  test('every zone × label × variant resolves identically to cellTile()', () => {
    for (const zone of ZONES) {
      for (const label of CELL_LABELS) {
        for (let variant = 0; variant < 6; variant++) {
          // toMatchObject, not toEqual: resolveTile's glyph + colour stay byte-for-byte identical to
          // cellTile(); it now ALSO carries the tile's orthogonal render-behavior `settings` (fadeNear/
          // cutawayRoof) that cellTile never had — a new dimension, not a change to the visual contract.
          expect(resolveTile(ASCII_TILESET, zone, label, variant)).toMatchObject(cellTile(zone, label, variant))
        }
      }
    }
  })

  test('an unknown label falls back exactly like the hardcoded path (?, #cccccc)', () => {
    expect(resolveTile(ASCII_TILESET, 'summer', 'not_a_real_tile', 0)).toEqual(cellTile('summer', 'not_a_real_tile', 0))
  })

  test('walkability is carried as tile data and matches cellLabels.isWalkable', () => {
    expect(ASCII_TILESET.tiles['tree_leaf_top'].walkable).toBe(true) // walk UNDER the canopy top
    expect(ASCII_TILESET.tiles['roof_top'].walkable).toBe(true) // the one walkable roof apex
    expect(ASCII_TILESET.tiles['wall'].walkable).toBe(false)
    expect(ASCII_TILESET.tiles['door'].walkable).toBe(false)
  })

  test('the swap standard: a tree MASS carries all sides + corners as its position', () => {
    const pos = (label: string) => ASCII_TILESET.tiles[label].position
    expect(pos('tree_top_left')).toBe('top_left')
    expect(pos('tree_top')).toBe('top')
    expect(pos('tree_top_right')).toBe('top_right')
    expect(pos('tree_edge_left')).toBe('left')
    expect(pos('tree_interior')).toBe('center')
    expect(pos('tree_edge_right')).toBe('right')
    expect(pos('tree_bottom_left')).toBe('bottom_left')
    expect(pos('tree_bottom')).toBe('bottom')
    expect(pos('tree_bottom_right')).toBe('bottom_right')
    expect(pos('wall')).toBe('single') // whole-tile element until buildings become per-cell tiled
  })

  test('color is NOT in the label — the same label reskins by zone via the stored palette', () => {
    // one label, different zones → different colour, SAME glyph (no X_green / X_pink labels).
    const summer = resolveTile(ASCII_TILESET, 'summer', 'wall', 0)
    const lava = resolveTile(ASCII_TILESET, 'lava', 'wall', 0)
    expect(summer.char).toBe(lava.char) // glyph is structural, shared
    expect(summer.color).not.toBe(lava.color) // colour comes from the zone palette property
  })

  test('the tileset is JSON-serialisable (real DATA — ready to seed the DB / load from an API)', () => {
    const round = JSON.parse(JSON.stringify(ASCII_TILESET))
    expect(resolveTile(round, 'autumn', 'tree_interior', 2)).toMatchObject(cellTile('autumn', 'tree_interior', 2))
  })
})

describe('terrain extraction — resolveGroundTile reproduces the inline GROUND_COLORS selection', () => {
  const SAMPLES: [number, number][] = [
    [0, 0], [1, 0], [0, 1], [3, 7], [12, 5], [7, 3], [40, 22], [13, 13], [2, 9], [9, 2],
  ]

  test('every ground type × sample cell resolves char/fg/base-bg identically to the render inline', () => {
    for (const tileType of Object.keys(GROUND_COLORS)) {
      for (const [col, row] of SAMPLES) {
        expect(resolveGroundTile(ASCII_TILESET, tileType, col, row)).toEqual(inlineGround(tileType, col, row))
      }
    }
  })

  test('an unknown ground type falls back to grass, exactly like the render', () => {
    for (const [col, row] of SAMPLES) {
      expect(resolveGroundTile(ASCII_TILESET, 'not_a_ground', col, row)).toEqual(inlineGround('not_a_ground', col, row))
    }
  })

  test('the noise variant flips glyph within a type (proves per-cell selection, not a constant)', () => {
    // grass has two distinct glyphs (';' , ',') — the resolver must pick per cell, not always index 0.
    const chars = new Set(SAMPLES.map(([c, r]) => resolveGroundTile(ASCII_TILESET, 'grass', c, r).char))
    expect(chars.size).toBeGreaterThan(1)
  })
})

import { cellTile, cellGlyph, treeCanopyShade, TREE_CANOPY_SHADES, type CellTile } from '@/engine/cellTileset'
import { CELL_LABELS, type CellLabel } from '@/engine/cellLabels'
import type { ZoneId } from '@/engine/zones'

const ZONES: ZoneId[] = ['spring', 'summer', 'autumn', 'winter']
const isHex = (color: string): boolean => /^#[0-9a-fA-F]{3,8}$/.test(color)

describe('cellTileset — robustness (every label resolves for every zone)', () => {
  it('gives every label a non-empty glyph and a valid hex color in every zone', () => {
    for (const zone of ZONES) {
      for (const label of CELL_LABELS) {
        const tile: CellTile = cellTile(zone, label)
        expect(tile.char.length).toBeGreaterThan(0)
        expect(isHex(tile.color)).toBe(true)
      }
    }
  })

  it('falls back to a safe tile for an unknown label (never throws, never blank)', () => {
    for (const zone of ZONES) {
      const tile = cellTile(zone, 'totally_unknown_label')
      expect(tile.char).toBe('?')
      expect(isHex(tile.color)).toBe(true)
    }
  })
})

describe('cellTileset — the autotile CORNER/edge/interior glyphs', () => {
  // The 9-piece mass must render as box-drawing corners so a forest reads connected.
  const cornerGlyphs: Record<CellLabel, string> = {
    tree_top_left: '╔',
    tree_top: '╦',
    tree_top_right: '╗',
    tree_edge_left: '╠',
    tree_interior: '@',
    tree_edge_right: '╣',
    tree_bottom_left: '╚',
    tree_bottom: '╩',
    tree_bottom_right: '╝',
  } as Record<CellLabel, string>

  it('maps each of the 9 mass pieces to its box-drawing glyph', () => {
    for (const [label, glyph] of Object.entries(cornerGlyphs)) {
      expect(cellGlyph(label)).toBe(glyph)
    }
  })

  it('keeps corner glyphs structural (zone-independent) so the mass stays connected', () => {
    expect(cellTile('autumn', 'tree_top_left').char).toBe(cellTile('winter', 'tree_top_left').char)
    expect(cellTile('summer', 'tree_bottom_right').char).toBe(cellTile('autumn', 'tree_bottom_right').char)
  })

  it('distinguishes the walkable canopy top from solid leaves', () => {
    expect(cellGlyph('tree_leaf_top')).not.toBe(cellGlyph('tree_leaf'))
  })
})

describe('cellTileset — zone tinting (lava charred, frozen frosty, verdant green)', () => {
  it('tints a tree canopy label differently in each zone', () => {
    const verdant = cellTile('summer', 'tree_interior').color
    const frozen = cellTile('winter', 'tree_interior').color
    const lava = cellTile('autumn', 'tree_interior').color
    expect(new Set([verdant, frozen, lava]).size).toBe(3)
  })

  it('paints trunk labels with the trunk color and leaf labels with the canopy color', () => {
    const trunk = cellTile('summer', 'tree_stem').color
    const canopy = cellTile('summer', 'tree_leaf').color
    expect(trunk).not.toBe(canopy)
    // stem_bottom shares the trunk color; the whole canopy stack shares the canopy color
    expect(cellTile('summer', 'tree_stem_bottom').color).toBe(trunk)
    expect(cellTile('summer', 'tree_top_left').color).toBe(canopy)
  })
})

describe('cellTileset — tonal variation (tree canopy shades, contrast not one tone)', () => {
  it('offers multiple distinct canopy shades per zone', () => {
    for (const zone of ZONES) {
      const shades = TREE_CANOPY_SHADES[zone]
      expect(shades.length).toBeGreaterThanOrEqual(3)
      expect(new Set(shades).size).toBe(shades.length) // all distinct → real contrast
      shades.forEach(s => expect(isHex(s)).toBe(true))
    }
  })

  it('cycles treeCanopyShade through the palette, wrapping safely on any index', () => {
    for (const zone of ZONES) {
      const shades = TREE_CANOPY_SHADES[zone]
      expect(treeCanopyShade(zone, 0)).toBe(shades[0])
      expect(treeCanopyShade(zone, shades.length)).toBe(shades[0]) // wraps positive
      expect(treeCanopyShade(zone, -1)).toBe(shades[shades.length - 1]) // negative-safe
    }
  })

  it('applies the variant shade to canopy labels, but never to the trunk', () => {
    expect(cellTile('summer', 'tree_interior', 0).color).not.toBe(cellTile('summer', 'tree_interior', 1).color)
    // a stem is bark, not foliage — variant must not change it
    expect(cellTile('summer', 'tree_stem', 0).color).toBe(cellTile('summer', 'tree_stem', 1).color)
  })
})

describe('cellTileset — bare / dead trees (snag)', () => {
  it('gives the dead-tree snag its own glyph (a known label, not the fallback)', () => {
    expect(cellGlyph('tree_snag')).not.toBe('?')
  })

  it('colors the snag as dead wood — the trunk color, unaffected by variant', () => {
    expect(cellTile('autumn', 'tree_snag', 0).color).toBe(cellTile('autumn', 'tree_stem', 0).color)
    expect(cellTile('winter', 'tree_snag', 3).color).toBe(cellTile('winter', 'tree_stem', 0).color)
  })
})

describe('cellTileset — building parts', () => {
  it('shares the roof color between the roof apex and roof body', () => {
    expect(cellTile('summer', 'roof_top').color).toBe(cellTile('summer', 'roof').color)
  })

  it('gives door and window their own colors, distinct from walls', () => {
    const wall = cellTile('autumn', 'wall').color
    const door = cellTile('autumn', 'door').color
    const window = cellTile('autumn', 'window').color
    expect(new Set([wall, door, window]).size).toBe(3)
  })
})

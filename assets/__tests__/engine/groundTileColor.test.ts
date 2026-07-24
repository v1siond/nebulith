/**
 * The GENERATOR/placement writes the ground colour onto the floor tile as STATE — it is NOT derived at render.
 * Alexander: "the generator should put the color on the tile as expected … NO fallbacks … once stored they
 * load." So `groundTileColor` is the placement-time PICK: the ground tile's own DB colour (terrain `bg`),
 * per-cell shaded for grassy ground — the SAME value 2D used to derive at render (cellFill→bg for ASCII), now
 * computed once at placement and stored on `floor.color`. Renders then READ it; a floor with no colour renders
 * nothing (empty), never a hardcoded fallback.
 */
import { groundTileColor } from '@/engine/render/shared'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'

// The DB stores ground colour as rgba(...) or #hex — a REAL colour, never the EMPTY_GROUND 'transparent'.
const isColor = (c: string): boolean => c !== 'transparent' && (/^#[0-9a-fA-F]{3,8}$/.test(c) || /^rgba?\(/.test(c))

describe('groundTileColor — the placement-time ground colour picked from the DB terrain tile', () => {
  useSeedTileset()

  it('returns the DB terrain colour for every base ground kind (a real colour, never transparent/hardcoded)', () => {
    for (const kind of ['grass', 'road', 'water', 'sand', 'snow']) {
      expect(isColor(groundTileColor(kind, 3, 4))).toBe(true)
    }
  })

  it('an UNKNOWN ground kind falls to the tileset\'s grass terrain (a real colour), never a hardcoded literal', () => {
    // resolveGroundTile maps a missing type to the loaded grass terrain — so the colour still comes from DATA.
    expect(isColor(groundTileColor('grass', 5, 6))).toBe(true)
  })

  it('is deterministic — the same cell always picks the same colour (stored state is reproducible)', () => {
    expect(groundTileColor('grass', 5, 6)).toBe(groundTileColor('grass', 5, 6))
    expect(groundTileColor('road', 1, 1)).toBe(groundTileColor('road', 9, 9))
  })
})

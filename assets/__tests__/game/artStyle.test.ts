import {
  ASCII_STYLE,
  EMOJI_STYLE,
  ASCII_PASSTHROUGH,
  BUILT_IN_STYLES,
  styleById,
  resolveVisual,
  groundKind,
  assetKind,
  entityKind,
  tilesForStyle,
  visualForTileId,
  TILE_CATALOG,
  type GlyphVisual,
} from '@/game/artStyle'

describe('resolveVisual — the one style decision point', () => {
  it('ASCII style + no override → the passthrough sentinel for every kind (byte-identical gate)', () => {
    for (const kind of ['grass', 'water', 'tree', 'wall', 'enemy', 'player'] as const) {
      expect(resolveVisual(kind, ASCII_STYLE)).toEqual(ASCII_PASSTHROUGH)
      expect(resolveVisual(kind, ASCII_STYLE).kind).toBe('ascii')
    }
  })

  it('a mapped kind on the Emoji style → its glyph', () => {
    expect(resolveVisual('tree', EMOJI_STYLE)).toEqual({ kind: 'glyph', char: '🌲' })
    expect(resolveVisual('water', EMOJI_STYLE)).toEqual({ kind: 'glyph', char: '🟦' })
    expect(resolveVisual('grass', EMOJI_STYLE)).toEqual({ kind: 'glyph', char: '🟩' })
    expect(resolveVisual('enemy', EMOJI_STYLE)).toEqual({ kind: 'glyph', char: '👾' })
    expect(resolveVisual('player', EMOJI_STYLE)).toEqual({ kind: 'glyph', char: '🧍' })
  })

  it('an unmapped kind on a non-ASCII style still passes through to ASCII (never blank)', () => {
    // 'ground' (unrecognized terrain) is intentionally NOT in the emoji map.
    expect(resolveVisual('ground', EMOJI_STYLE)).toEqual(ASCII_PASSTHROUGH)
  })

  it('a per-element override WINS over the active style — even ASCII', () => {
    // override an ASCII tree with the emoji water tile → the override tile draws
    const v = resolveVisual('tree', ASCII_STYLE, 'emoji:water') as GlyphVisual
    expect(v).toEqual({ kind: 'glyph', char: '🟦' })
  })

  it('a per-element override WINS over a non-ASCII style too', () => {
    // pin an ASCII tree glyph while the world is Emoji
    const v = resolveVisual('tree', EMOJI_STYLE, 'ascii:tree') as GlyphVisual
    expect(v.kind).toBe('glyph')
    expect(v.char).toBe('♣')
  })

  it('an unknown override id falls through to the style (does not throw / blank)', () => {
    expect(resolveVisual('tree', EMOJI_STYLE, 'nope:missing')).toEqual({ kind: 'glyph', char: '🌲' })
    expect(resolveVisual('tree', ASCII_STYLE, 'nope:missing')).toEqual(ASCII_PASSTHROUGH)
  })
})

describe('kind classifiers', () => {
  it('groundKind maps the ground vocabulary to terrain kinds', () => {
    expect(groundKind('grass')).toBe('grass')
    expect(groundKind('grass_tall')).toBe('grass')
    expect(groundKind('water')).toBe('water')
    expect(groundKind('water_deep')).toBe('water')
    expect(groundKind('oasis')).toBe('water')
    expect(groundKind('path_stone')).toBe('path')
    expect(groundKind('road')).toBe('path')
    expect(groundKind('bridge')).toBe('path')
    expect(groundKind('plaza')).toBe('plaza')
    expect(groundKind('sand')).toBe('sand')
    expect(groundKind('sand_dune')).toBe('sand')
    // exotic terrain not in the reskin set → 'ground' (passes through)
    expect(groundKind('lava')).toBe('ground')
    expect(groundKind('crystal')).toBe('ground')
  })

  it('assetKind classifies placed assets and labeled cells', () => {
    expect(assetKind({ type: 'tree' })).toBe('tree')
    expect(assetKind({ type: 'x', label: 'tree_top_left' })).toBe('tree')
    expect(assetKind({ type: 'x', label: 'roof' })).toBe('roof')
    expect(assetKind({ type: 'x', label: 'roof_top' })).toBe('roof')
    expect(assetKind({ type: 'x', label: 'door' })).toBe('door')
    expect(assetKind({ type: 'x', label: 'window' })).toBe('window')
    expect(assetKind({ type: 'x', label: 'peak' })).toBe('mountain')
    expect(assetKind({ type: 'flower' })).toBe('flower')
    expect(assetKind({ type: 'lantern' })).toBe('lamp')
    expect(assetKind({ type: 'building' })).toBe('wall')
    expect(assetKind({ type: 'fountain' })).toBe('water')
    expect(assetKind({ type: 'totally-unknown' })).toBe('ground')
  })

  it('entityKind maps roles', () => {
    expect(entityKind('player')).toBe('player')
    expect(entityKind('npc')).toBe('npc')
    expect(entityKind('enemy')).toBe('enemy')
    expect(entityKind('goblin')).toBe('enemy') // any non-player/npc → enemy
  })
})

describe('style registry + tile library', () => {
  it('styleById resolves built-ins and defaults to ASCII for anything else', () => {
    expect(styleById('ascii')).toBe(ASCII_STYLE)
    expect(styleById('emoji')).toBe(EMOJI_STYLE)
    expect(styleById('does-not-exist')).toBe(ASCII_STYLE)
    expect(styleById(null)).toBe(ASCII_STYLE)
  })

  it('ASCII is the first offered style (the default)', () => {
    expect(BUILT_IN_STYLES[0]).toBe(ASCII_STYLE)
  })

  it('tilesForStyle groups tiles into the four categories with content', () => {
    const emoji = tilesForStyle('emoji')
    expect(emoji.terrain.length).toBeGreaterThan(0)
    expect(emoji.buildings.length).toBeGreaterThan(0)
    expect(emoji.units.length).toBeGreaterThan(0)
    expect(emoji.nature.length).toBeGreaterThan(0)
    // the ASCII style also has library content (explicit glyph tiles)
    const ascii = tilesForStyle('ascii')
    expect(ascii.nature.length).toBeGreaterThan(0)
  })

  it('every catalog tile id resolves back to its visual', () => {
    for (const t of TILE_CATALOG) {
      expect(visualForTileId(t.id)).toEqual(t.visual)
    }
    expect(visualForTileId('unknown:id')).toBeNull()
  })
})

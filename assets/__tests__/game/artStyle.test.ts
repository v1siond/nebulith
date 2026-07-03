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
  enemyTileId,
  tilesForStyle,
  visualForTileId,
  TILE_CATALOG,
  type GlyphVisual,
  type ImageVisual,
} from '@/game/artStyle'
import { resolveDraw } from '@/engine/render/shared'

describe('resolveVisual — the one style decision point', () => {
  it('ASCII style + no override → the passthrough sentinel for every kind (byte-identical gate)', () => {
    for (const kind of ['grass', 'water', 'tree', 'wall', 'enemy', 'player'] as const) {
      expect(resolveVisual(kind, ASCII_STYLE)).toEqual(ASCII_PASSTHROUGH)
      expect(resolveVisual(kind, ASCII_STYLE).kind).toBe('ascii')
    }
  })

  it('a mapped kind on the Emoji style → its glyph', () => {
    expect(resolveVisual('tree', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '🌲' })
    expect(resolveVisual('water', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '🌊' })
    expect(resolveVisual('grass', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '🍀' })
    expect(resolveVisual('enemy', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '👾' })
    expect(resolveVisual('player', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '🧍' })
    // a fountain is its OWN kind now (⛲), not folded onto plain water 🌊 — "fountain translated wrong"
    expect(resolveVisual('fountain', EMOJI_STYLE)).toMatchObject({ kind: 'glyph', char: '⛲' })
    expect(assetKind({ type: 'fountain' })).toBe('fountain')
  })

  it('enemyTileId maps enemyType → a distinct emoji tile under a reskin (not the generic 👾)', () => {
    // the per-type override resolves to the right catalog glyph
    expect(resolveVisual('enemy', EMOJI_STYLE, enemyTileId('goblin', EMOJI_STYLE))).toMatchObject({ char: '👺' })
    expect(resolveVisual('enemy', EMOJI_STYLE, enemyTileId('wolf', EMOJI_STYLE))).toMatchObject({ char: '🐺' })
    expect(resolveVisual('enemy', EMOJI_STYLE, enemyTileId('skeleton', EMOJI_STYLE))).toMatchObject({ char: '💀' })
    // ASCII keeps its own enemy art (no override), and an unmapped/blank type falls back to base 👾
    expect(enemyTileId('goblin', ASCII_STYLE)).toBeUndefined()
    expect(enemyTileId('nonesuch', EMOJI_STYLE)).toBeUndefined()
    expect(enemyTileId(undefined, EMOJI_STYLE)).toBeUndefined()
  })

  it('every Emoji tile carries a fill COLOUR — the tint the geometry-preserving renderers fill each unit with', () => {
    // Without a colour there is nothing to fill the iso diamond / building cube with, and the
    // renderer falls back to stamping a flat upright emoji square (the StageD bug). Assert the
    // whole map carries one, terrain + buildings especially (those fill geometry).
    for (const kind of Object.keys(EMOJI_STYLE.map) as (keyof typeof EMOJI_STYLE.map)[]) {
      const v = EMOJI_STYLE.map[kind] as GlyphVisual | ImageVisual
      expect(['glyph', 'image']).toContain(v.kind) // an image tile (Noto png) carries the backing tint too
      expect(typeof v.color).toBe('string')
      expect(v.color).toMatch(/^#[0-9a-f]{3,8}$/i)
    }
  })

  it('an unmapped kind on a non-ASCII style still passes through to ASCII (never blank)', () => {
    // 'ground' (unrecognized terrain) is intentionally NOT in the emoji map.
    expect(resolveVisual('ground', EMOJI_STYLE)).toEqual(ASCII_PASSTHROUGH)
  })

  it('a per-element override WINS over the active style — even ASCII', () => {
    // override an ASCII tree with the emoji water tile → the override tile (glyph + tint) draws
    const v = resolveVisual('tree', ASCII_STYLE, 'emoji:water') as GlyphVisual
    expect(v).toMatchObject({ kind: 'glyph', char: '🌊' })
    expect(v.color).toMatch(/^#/)
  })

  it('a per-element override WINS over a non-ASCII style too', () => {
    // pin an ASCII tree glyph while the world is Emoji
    const v = resolveVisual('tree', EMOJI_STYLE, 'ascii:tree') as GlyphVisual
    expect(v.kind).toBe('glyph')
    expect(v.char).toBe('♣')
  })

  it('an unknown override id falls through to the style (does not throw / blank)', () => {
    expect(resolveVisual('tree', EMOJI_STYLE, 'nope:missing')).toMatchObject({ kind: 'glyph', char: '🌲' })
    expect(resolveVisual('tree', ASCII_STYLE, 'nope:missing')).toEqual(ASCII_PASSTHROUGH)
  })
})

describe('resolveDraw — surfaces the tint the geometry sites fill with', () => {
  it('ASCII passthrough returns the caller default char+color and NO tint (byte-identical gate)', () => {
    const d = resolveDraw('grass', ASCII_STYLE, undefined, ';', '#9ac454')
    expect(d).toEqual({ char: ';', color: '#9ac454' })
    expect(d.tint).toBeUndefined()
  })

  it('a styled glyph surfaces its emoji AND a tint (the diamond/cube fill colour)', () => {
    const d = resolveDraw('grass', EMOJI_STYLE, undefined, ';', '#9ac454')
    expect(d.char).toBe('🍀')
    expect(d.tint).toMatch(/^#/) // present → the caller fills geometry, never a flat square
    expect(d.color).toBe(d.tint) // glyph fill == the tile hue
  })

  it('a per-element override surfaces the override tile tint over the active style', () => {
    const d = resolveDraw('grass', ASCII_STYLE, 'emoji:water', ';', '#9ac454')
    expect(d.char).toBe('🌊')
    expect(d.tint).toMatch(/^#/)
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
    expect(assetKind({ type: 'fountain' })).toBe('fountain')
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

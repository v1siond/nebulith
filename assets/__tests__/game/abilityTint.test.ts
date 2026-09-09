/**
 * AN ABILITY'S COLOUR COMES FROM ITS TILE (§3.14b #2).
 *
 * `ABILITY_TINT` was a 9-row hex table in `game/abilities.ts` — and every one of those hexes is already
 * served on the matching FX tile row. Verified against the live backend: `fire-slash #ff7a2a`,
 * `nova #c08cff`, `lightning #7ad7ff` … identical in both styles, and identical across all 7 ASCII zones.
 * A second copy in the frontend is exactly the class of thing being migrated out.
 *
 * The doc's tier called this a "pure deletion", which it is NOT — seven UI sites colour ability names by it
 * (`panels.tsx`, `modals.tsx`). So it becomes a RESOLVER against the loaded tileset, and these tests pin the
 * property that makes it a real migration rather than a moved constant: change the served tile, and the UI
 * colour changes with it. A copied table cannot pass that.
 *
 * Every case installs its rows through `installStyleTiles` — the ONE store's own entry point. An earlier
 * version of this file hand-built a catalog object and translated the old per-style row shape into it, which
 * is how a test file ends up asserting against a shape production no longer has.
 */
import { abilityTint } from '@/game/abilityArt'
import { ABILITY_ANIMATIONS } from '@/game/abilities'
import { clearStyleCatalogs, installStyleTiles } from '@/engine/tileset/styleTiles'

/** The FX rows, each carrying ONE flat colour — the simplest shape the backend serves. */
const withFlatColors = (colors: Record<string, string>): void =>
  installStyleTiles('ascii', Object.fromEntries(
    Object.entries(colors).map(([label, color]) => [label, { char: '*', settings: { color } }]),
  ))

beforeEach(clearStyleCatalogs)

describe('the tint is READ from the tile, not held in the frontend', () => {
  it('returns the colour the tileset serves for that animation', () => {
    withFlatColors({ 'fire-slash': '#ff7a2a' })
    expect(abilityTint('fire-slash')).toBe('#ff7a2a')
  })

  it('FOLLOWS the served value — re-seed the tile a different colour and the tint moves', () => {
    withFlatColors({ 'fire-slash': '#ff7a2a' })
    expect(abilityTint('fire-slash')).toBe('#ff7a2a')
    withFlatColors({ 'fire-slash': '#00ff00' })
    expect(abilityTint('fire-slash')).toBe('#00ff00') // a copied constant would still say #ff7a2a
  })

  it('reads a per-zone colour map too — the shape ASCII rows actually use', () => {
    installStyleTiles('ascii', {
      nova: { char: '*', settings: { colors: { spring: '#c08cff', winter: '#c08cff' } } },
    })
    expect(abilityTint('nova')).toBe('#c08cff')
  })

  it('invents nothing when the tileset has no such tile', () => {
    withFlatColors({})
    expect(abilityTint('cleave')).toBeUndefined()
  })

  it('invents nothing when NO tileset has loaded at all', () => {
    // The empty store is the pre-load state the real app boots in. A tint of `undefined` is what lets the UI
    // say "not loaded" instead of flashing a frontend-authored colour.
    expect(abilityTint('nova')).toBeUndefined()
  })
})

describe('the animation LIST is type data, not a by-product of the colour table', () => {
  it('names every animation the engine ships', () => {
    expect([...ABILITY_ANIMATIONS].sort()).toEqual([
      'bolt', 'cleave', 'fire-slash', 'guard-flash', 'heal-glow',
      'ice-slash', 'lightning', 'nova', 'piercing-shot',
    ])
  })

  it('has no duplicates', () => {
    expect(new Set(ABILITY_ANIMATIONS).size).toBe(ABILITY_ANIMATIONS.length)
  })

  it('every one resolves a tint when the tileset serves its tile', () => {
    withFlatColors(Object.fromEntries(ABILITY_ANIMATIONS.map(a => [a, '#123456'])))
    for (const animation of ABILITY_ANIMATIONS) expect(abilityTint(animation)).toBe('#123456')
  })
})

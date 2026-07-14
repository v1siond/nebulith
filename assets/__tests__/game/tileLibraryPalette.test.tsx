/**
 * Tile Library palette must render the SAME art the MAP renders, from the same tileset — the palette is
 * NOT allowed to keep its own parallel copy that drifts (TILE-VOCABULARY-CONTRACT: one source generates
 * the rest). Two bugs from Alexander's :3000 review this guards:
 *
 *   G3 — EMOJI (Image #15): image-visual tiles (the baked-PNG catalog tiles) rendered a literal '🖼'
 *        placeholder box instead of the tile art. The map draws image tiles as their PNG
 *        (render/shared.ts drawFromVisual → `image: v`); the palette must draw the same image.
 *
 *   G4 — ASCII (Image #16): the palette's ASCII glyph for a kind must equal the glyph the MAP draws for
 *        that kind (from the engine/DB tileset), not a separate hand-maintained `ASCII_TILE_GLYPHS` copy.
 */
import { render, screen } from '@testing-library/react'
import { TilePalette } from '@/components/game/editorChrome'
import { tilesForStyle } from '@/game/artStyle'

describe('emoji Tile Library palette (G3)', () => {
  it('renders image tiles as their baked art, never a placeholder box', () => {
    const all = Object.values(tilesForStyle('emoji')).flat()
    const imageTile = all.find(t => t.visual.kind === 'image')
    expect(imageTile).toBeDefined() // the emoji catalog bakes PNGs — there ARE image tiles to draw

    render(<TilePalette styleId="emoji" styleName="Emoji" armedId={null} onArm={() => {}} />)

    // BUG G3: image tiles printed a literal '🖼' placeholder box instead of the tile art.
    expect(screen.queryAllByText('🖼')).toHaveLength(0)

    // the image tile draws an <img> pointing at the SAME src the map loads (palette == map, one source).
    const btn = screen.getByTitle(`${imageTile!.label} (${imageTile!.id})`)
    const img = btn.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe((imageTile!.visual as { src: string }).src)
  })
})

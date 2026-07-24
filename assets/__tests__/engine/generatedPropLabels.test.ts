/**
 * SCATTERED NATURE PROPS ARE BAKED-IMAGE TILES, NOT GLYPHS. Alexander: "ascii is still screwed … the emoji
 * tileset got ahead of the ascii side, so we must analyze what we have and are using there, then replicate it
 * on ascii art."
 *
 * ROOT CAUSE this pins: ascii resolves a KIND to nothing (`ASCII_STYLE.map` is empty by design → passthrough),
 * so the ONLY way an ascii tile paints a baked IMAGE is the label→image path (render/shared.labelTileImage,
 * iso.ts:2082). The generator's scattered nature props (flower / mushroom / crystal / rock) carried NO label,
 * so under ascii they fell through to the legacy glyph drawers (`+`, `O`, `♠`, `◆`, or `?`). Every one of these
 * labels ALREADY exists as a baked tile in BOTH the ascii and emoji DB tilesets — the generator just wasn't
 * emitting it. This test asserts each scattered prop now carries its baked backend label, so it resolves to the
 * baked image (in EVERY style) instead of a glyph — "everything is a baked image resolved by label."
 */
import { generateStage, type StageProp } from '@/engine/stageGenerator'
import { labelTileImage } from '@/engine/render/shared'
import { ASCII_STYLE, EMOJI_STYLE } from '@/game/artStyle'
import { useSeedTileset } from '@/__tests__/helpers/tilesetSeed'
import type { ZoneId, VariantId } from '@/engine/zones'

/** Collect every prop across a spread of zone×variant generations so the per-type assertions are not vacuous:
 *  summer town/forest guarantee flowers; caves across seasons produce rock (walls) + crystal + mushroom. */
function gatherProps(): StageProp[] {
  const combos: Array<{ zone: ZoneId; variant: VariantId }> = [
    { zone: 'summer', variant: 'town' },
    { zone: 'summer', variant: 'forest' },
    { zone: 'spring', variant: 'forest' },
    { zone: 'spring', variant: 'cave' },
    { zone: 'summer', variant: 'cave' },
    { zone: 'autumn', variant: 'cave' },
    { zone: 'winter', variant: 'boss-stage' },
  ]
  return combos.flatMap(c => generateStage({ ...c, cols: 40, rows: 30 }).props)
}

/** The scattered nature prop TYPE → the baked backend LABEL it must carry (verified baked in ascii AND emoji). */
const TYPE_LABEL: Record<string, string> = {
  flower: 'flower',
  mushroom: 'mushroom',
  crystal: 'crystal',
  rock: 'rock',
}

describe('generated scattered nature props carry a baked backend label (no glyph fallback)', () => {
  const props = gatherProps()

  it('produces the props under test (guard against a vacuous pass)', () => {
    const byType = new Set(props.map(p => p.type))
    expect(byType.has('flower')).toBe(true)
    expect(byType.has('rock')).toBe(true)
  })

  for (const [type, label] of Object.entries(TYPE_LABEL)) {
    it(`every '${type}' prop carries label '${label}'`, () => {
      const of = props.filter(p => p.type === type)
      for (const p of of) expect(p.label).toBe(label)
    })
  }
})

describe('every scattered nature prop label resolves to a baked IMAGE in both styles (never a glyph)', () => {
  useSeedTileset()
  const props = gatherProps()

  for (const style of [ASCII_STYLE, EMOJI_STYLE]) {
    it(`resolves to a baked ${style.id} image via labelTileImage`, () => {
      const nature = props.filter(p => TYPE_LABEL[p.type])
      expect(nature.length).toBeGreaterThan(0)
      for (const p of nature) {
        expect(p.label).toBeTruthy()
        const img = labelTileImage(p.label as string, style)
        expect(img?.kind).toBe('image')
      }
    })
  }
})

import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The Appearance panel showed "Faces: All" for a rock the backend serves as `display: 'single'`, and the
 * map drew it as one face. Nothing was wrong with the data or the drawing: the panel asked a narrower
 * question than the renderer and then `??`-ed a literal over the empty answer.
 *
 * The renderer resolves through `assetSetting`, which is per-instance FIRST and then the served tile's own
 * settings. Any panel row for one of those settings has to resolve the same way or it reports fiction.
 *
 * This reads the source because the rows are built inline where the inspector props are assembled, and the
 * thing worth defending is that nobody reintroduces the narrow read, in any row, later.
 */
const EDITOR = readFileSync(join(process.cwd(), 'game/routes/templates.tsx'), 'utf8')

/** Settings the renderer resolves through `assetSetting` (per-instance, then the served tile). */
const RESOLVED_THROUGH_THE_TILE = ['display', 'transparent', 'actAsTile']

describe('the inspector resolves a setting the way the renderer does', () => {
  test.each(RESOLVED_THROUGH_THE_TILE)(
    'no narrow `settings?.%s` read survives in the editor',
    setting => {
      const narrow = new RegExp(`\\?\\.settings\\?\\.${setting}\\b`, 'g')
      const hits = EDITOR.match(narrow) ?? []
      expect(hits).toHaveLength(0)
    },
  )

  test.each(RESOLVED_THROUGH_THE_TILE)('the panel row for %s goes through assetSetting', setting => {
    const resolved = new RegExp(`assetSetting<[^>]+>\\(a, '${setting}'\\)`)
    expect(EDITOR).toMatch(resolved)
  })

  test('and the editor actually imports that resolver, rather than defining its own', () => {
    expect(EDITOR).toMatch(/import \{[^}]*\bassetSetting\b[^}]*\} from '@\/engine\/cellStack'/)
  })

  test('the panel invents no literal for any of them', () => {
    // The law: a generator (or the tile row) STATES the value; the engine and the panel read it. A
    // `?? 'all-faces'` here is the panel deciding what the data failed to say, which is how it came to
    // report "All" for a rock served as 'single'. Every tile states these now, so nothing needs a guess.
    for (const setting of RESOLVED_THROUGH_THE_TILE) {
      const invented = new RegExp(`assetSetting<[^>]+>\\(a, '${setting}'\\)\\s*\\?\\?`)
      expect(EDITOR).not.toMatch(invented)
    }
  })

  test('shape falls back to the tile too, but only after the per-instance field', () => {
    // The renderer reads `asset.shape` off the instance; the tile now states one as well, so the panel
    // reads the instance FIRST and the served value second. Same order, no literal.
    expect(EDITOR).toMatch(/a\?\.shape \?\? \(a \? assetSetting<TileShape>\(a, 'shape'\) : undefined\)/)
  })
})

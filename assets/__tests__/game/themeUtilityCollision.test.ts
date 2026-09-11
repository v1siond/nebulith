/**
 * THE THEME MUST NOT CLAIM A UTILITY CLASS NAME.
 *
 * `.neb .grid` in the editor theme was the tile palette's auto-fill layout. It also outranks Tailwind's own
 * `.grid-cols-N` (0,2,0 against 0,1,0), so every `className="grid grid-cols-2"` inside the editor was
 * silently laid out as `repeat(auto-fill, minmax(84px, 1fr))` instead. Measured on the unit stat block: five
 * stats came out four-across in 35px slivers rather than the two columns the markup asked for, and 16 grids
 * across the editor were affected with nothing reporting it.
 *
 * A collision like this is invisible — the class is present, the rule that wins is somewhere else — so the
 * guard is on the NAME. A theme rule may not be keyed on a bare Tailwind layout utility.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const THEME = resolve(process.cwd(), 'src/styles/themes/nebulith-editor.css')

/** Tailwind layout utilities whose bare name a component rule must never take. */
const UTILITY_NAMES = ['grid', 'flex', 'block', 'hidden', 'table', 'container', 'inline', 'fixed', 'absolute', 'relative', 'static', 'sticky']

describe('the editor theme never keys a rule on a bare Tailwind utility class', () => {
  const raw = readFileSync(THEME, 'utf8')
  // Comments are not rules, and the comment on the palette rule NAMES the collision it exists to warn about.
  // Scanning the raw file would fail on its own documentation.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

  it.each(UTILITY_NAMES)('has no `.neb .%s` rule to outrank the utility of the same name', name => {
    // A selector ENDING at that class — `.neb .grid{` or `.neb .grid.objgrid{`. A longer name that merely
    // starts the same (`.neb .gridwrap`) is a different class and is fine.
    const claimed = new RegExp(`\\.neb\\s+\\.${name}(?![\\w-])`).test(css)
    expect({ name, claimed }).toEqual({ name, claimed: false })
  })

  it('the palette still HAS its layout, under a name of its own', () => {
    expect(raw).toContain('.neb .palgrid{')
    expect(raw).toMatch(/\.neb \.palgrid\{[^}]*repeat\(auto-fill,minmax\(84px,1fr\)\)/s)
  })
})

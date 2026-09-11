/**
 * A height-capped grid has to scroll, or what spills past the cap paints over the next section and takes its
 * clicks. Found through the Character window: the figure grid covered "+ Add a dialog", so the click picked a
 * figure instead.
 */
import { readFileSync } from 'fs'
import { join } from 'path'

const css = readFileSync(join(process.cwd(), 'src/styles/themes/nebulith-editor.css'), 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector}{`)
  expect(at).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('the figure swatch grid', () => {
  it('is capped in height and scrolls inside the cap', () => {
    const swapg = rule('.neb .swapg')
    expect(swapg).toMatch(/max-height:\s*190px/)
    expect(swapg).toMatch(/overflow(-y)?:\s*auto/)
  })
})

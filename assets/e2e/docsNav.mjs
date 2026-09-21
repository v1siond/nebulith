/**
 * THE DOCUMENTATION SITE, DRIVEN THE WAY A PERSON DRIVES IT.
 *
 * The Elixir suite proves every heading carries the id its rail entry links to. That is markup, and markup
 * being right is not the same as the page moving when you click. This clicks the real links in a real
 * browser and asserts the document actually scrolled to the section.
 *
 * Measured before the fix: Earmark emitted a bare `<h2>`, so all 73 rail links pointed at nothing and
 * clicking one did nothing at all.
 *
 *   bin/e2e docsNav            (via bin/e2e)
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'

const failures = []

function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } })

// The documentation root IS the spec, not a list of links to it.
await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const railCount = await page.locator('nav a[href^="#"]').count()
check(railCount > 20, 'the contents rail is populated', `${railCount} entries`)

const dangling = await page.evaluate(() =>
  [...document.querySelectorAll('nav a[href^="#"]')]
    .map((a) => a.getAttribute('href').slice(1))
    .filter((id) => !document.getElementById(id)),
)
check(dangling.length === 0, 'every rail link points at a heading that exists', dangling.slice(0, 3).join(', '))

// Click through several sections, spread across the document, and assert each one lands.
for (const label of ['The laws', 'The schema', 'The implementation plan', 'The setting ledger']) {
  const link = page.locator('nav a', { hasText: label }).first()
  if ((await link.count()) === 0) {
    check(false, `rail has an entry for "${label}"`)
    continue
  }
  await link.click()
  await page.waitForTimeout(700)
  const landed = await page.evaluate(() => {
    const target = document.getElementById(location.hash.slice(1))
    if (!target) return { ok: false, reason: 'no element for ' + location.hash }
    const top = target.getBoundingClientRect().top
    // The heading sits at the top of the viewport, allowing for its scroll margin.
    return { ok: top >= -4 && top < 120, top: Math.round(top), text: target.textContent.trim().slice(0, 40) }
  })
  check(landed.ok, `clicking "${label}" scrolls to it`, `top=${landed.top} "${landed.text ?? landed.reason}"`)
}

// Diagrams draw as you reach them, rather than all at once on load.
await page.evaluate(() => document.querySelector('.nebulith-diagram')?.scrollIntoView({ block: 'center' }))
await page.waitForTimeout(3000)
const diagrams = await page.evaluate(() => ({
  plates: document.querySelectorAll('.nebulith-diagram').length,
  drawn: document.querySelectorAll('.nebulith-diagram svg').length,
  broken: document.querySelectorAll('.nebulith-diagram.is-broken').length,
}))
check(diagrams.plates > 0, 'the document has diagrams', `${diagrams.plates} plates`)
check(diagrams.drawn > 0, 'a diagram draws when you scroll to it', `${diagrams.drawn} drawn`)
check(diagrams.broken === 0, 'no diagram failed to parse', `${diagrams.broken} broken`)

// The page never scrolls sideways; a wide table or diagram scrolls inside its own box.
const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
check(!sideways, 'the page does not scroll sideways')

await browser.close()

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)

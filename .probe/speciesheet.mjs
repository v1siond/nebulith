// THE SPECIES SHEET: every tree composition, stamped by KIND , so each silhouette is
// judgeable on its own. The family rule in FRAMEWORKS.md: a change across a family is evidenced across ALL
// of it, and a sheet you cannot read is not evidence.
//
// Stamps through `__placeComposition` (the kind, directly) rather than clicking palette swatches: the
// palette re-renders when the map changes and half the swatches were simply not on the page when a click
// went looking for them, which made the sheet lie about which species exist.
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
const KINDS = (process.env.KINDS || 'tree,tree_tall,tree_big,tree_small,tree_stub,tree_round,tree_column,tree_giant,tree_conifer,tree_cypress,tree_broadleaf,tree_gnarled,tree_oak,tree_willow,tree_cherry,tree_encina,tree_palm,tree_coconut,tree_banana,tree_mangrove,tree_sapling,bush,bush_round').split(',')
const PER = Number(process.env.PER || 8), GAP = Number(process.env.GAP || 4), ROW = 8, C0 = 3
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1800, height: 1000 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3200)
await p.getByRole('button', { name: /^Meadow/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(3200)
await p.locator('button', { hasText: /^✕$/ }).first().click().catch(() => {})
await p.waitForTimeout(500)

const rows = Math.ceil(KINDS.length / PER)
const out = await p.evaluate(({ kinds, per, gap, row0, c0, rows }) => {
  // NOT cleared: __clearRegion strips the floor to nothing and the band renders as black void, which makes
  // the sheet unreadable. The generated meadow's own grass is a fine, even backdrop to judge against.
  const placed = []
  kinds.forEach((kind, i) => {
    const col = c0 + (i % per) * 2
    const row = row0 + Math.floor(i / per) * gap
    globalThis.__placeComposition(kind, col, row)
    placed.push(kind)
  })
  return placed.length
}, { kinds: KINDS, per: PER, gap: GAP, row0: ROW, c0: C0, rows })
await p.waitForTimeout(1200)

// COUNT WHAT ACTUALLY LANDED, per kind, so the sheet cannot claim a species it failed to stamp.
const got = await p.evaluate(() => globalThis.__treeKinds?.())
const seen = new Set((got || []).map(k => k.kind))
const missing = KINDS.filter(k => !seen.has(k) && k !== 'bush' && k !== 'bush_round')
console.log(`stamped ${out}, distinct tree kinds on the map: ${seen.size}`)
if (missing.length) console.log('MISSING (no trunk found):', missing.join(', '))

await p.evaluate(() => { for (const el of document.querySelectorAll('button')) if (/«Tools/.test((el.textContent || '').trim())) { el.click(); return } })
await p.waitForTimeout(500)
await p.evaluate(([c, r]) => globalThis.__setHero?.(c, r), [C0 + PER, ROW + Math.floor(rows / 2) * GAP])
await p.waitForTimeout(900)
const bx = await p.locator('canvas').first().boundingBox()
await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2)
for (let i = 0; i < Number(process.env.ZOOM || 0); i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(150) }
await p.waitForTimeout(800)
const png = await p.evaluate(() => [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0].toDataURL('image/png'))
writeFileSync(process.env.OUT || '/home/visiond/.claude/jobs/beedf1c6/tmp/speciesheet.png', Buffer.from(png.split(',')[1], 'base64'))
console.log('saved')
await b.close()

/** Rasterise the authored path pieces and compose a stretch of path on grass, to hold against the reference. */
import { chromium } from 'playwright'
import fs from 'fs'
const svgs = JSON.parse(fs.readFileSync('/home/visiond/.claude/jobs/beedf1c6/tmp/path_svgs.json', 'utf8'))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 1 })
fs.mkdirSync('/home/visiond/.claude/jobs/beedf1c6/tmp/pieces', { recursive: true })
for (const [label, svg] of Object.entries(svgs)) {
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:128px;height:128px">${svg}</div></body>`)
  const el = await p.locator('div').first()
  await el.screenshot({ path: `/home/visiond/.claude/jobs/beedf1c6/tmp/pieces/${label}.png`, omitBackground: true })
}
console.log('rasterised', Object.keys(svgs).length)
await b.close()

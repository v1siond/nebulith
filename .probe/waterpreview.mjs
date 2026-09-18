// Contact sheet for the two water sets, tinted EXACTLY the way the renderer does it: collapse the sprite
// to its own luminance, then multiply by the tile colour. Anything that looks flat here looks flat on the
// map, so this is the check that the art has a tonal spread at all.
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const tiles = JSON.parse(readFileSync('/home/visiond/.claude/jobs/beedf1c6/tmp/crown_tiles.json', 'utf8')).filter(t => t.style === 'ascii')
const byLabel = Object.fromEntries(tiles.map(t => [t.label, t.svg]))
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 620, height: 470 } })
await p.setContent('<body style="margin:0;background:#6f7f4a"><canvas id="cv" width="620" height="470"></canvas></body>')
await p.evaluate(async ({ byLabel }) => {
  const S = 108
  const cv = document.getElementById('cv'), ctx = cv.getContext('2d')
  ctx.fillStyle = '#6f7f4a'; ctx.fillRect(0, 0, cv.width, cv.height)
  const load = svg => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/svg+xml;base64,' + btoa(svg) })
  const tint = (img, colour) => {
    const off = document.createElement('canvas'); off.width = off.height = 128
    const o = off.getContext('2d')
    o.drawImage(img, 0, 0, 128, 128)
    o.globalCompositeOperation = 'saturation'; o.fillStyle = 'hsl(0, 0%, 50%)'; o.fillRect(0, 0, 128, 128)
    o.globalCompositeOperation = 'multiply'; o.fillStyle = colour; o.fillRect(0, 0, 128, 128)
    o.globalCompositeOperation = 'destination-in'; o.drawImage(img, 0, 0, 128, 128)
    return off
  }
  let oy = 24
  for (const [set, colour] of [['water_smooth_river', '#4f93b3'], ['water_smooth_lake', '#3f7fa0'], ['water_smooth_beach', '#2aa8c0'], ['water_lined_river', '#4f93b3'], ['water_lined_lake', '#3f7fa0'], ['water_lined_beach', '#2aa8c0']]) {
    ctx.fillStyle = '#fff'; ctx.font = '13px monospace'
    ctx.fillText(`${set}  tint ${colour}`, 12, oy - 6)
    for (let f = 0; f < 2; f++) {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const img = await load(byLabel[`${set}_${layout[r][c]}${f ? '_f' + f : ''}`])
        ctx.drawImage(tint(img, colour), 12 + f * (S * 3 + 20) + c * S, oy + r * S, S, S)
      }
    }
    oy += S * 3 + 42
  }

}, { byLabel })
await p.waitForTimeout(400)
await p.locator('#cv').screenshot({ path: '/home/visiond/.claude/jobs/beedf1c6/tmp/water_preview.png' })
await b.close()
console.log('wrote water_preview.png')

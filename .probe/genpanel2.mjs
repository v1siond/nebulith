/** The New world panel + the Preview window at a short viewport, before and after scrolling. */
import { chromium } from 'playwright'
const NAME = process.env.NAME || 'after'
const H = Number(process.env.H || 800)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: H }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)

const look = async (tag) => {
  const r = await p.evaluate(() => {
    const panel = document.querySelector('.z-panel')
    const pr = panel.getBoundingClientRect()
    const seen = (el) => { const b = el.getBoundingClientRect(); return b.top >= pr.top - 1 && b.bottom <= pr.bottom + 1 }
    const find = (rx) => [...panel.querySelectorAll('button')].find(x => rx.test(x.textContent))
    const box = (el) => el ? { top: Math.round(el.getBoundingClientRect().top), bottom: Math.round(el.getBoundingClientRect().bottom) } : null
    const build = find(/Build this world/i), apply = find(/Apply to this map/i)
    const cols = panel.querySelector('[aria-label="Map columns"]')
    const cards = panel.querySelector('.pgrid')
    const win = [...document.querySelectorAll('div')].find(d => /preview/i.test(d.getAttribute('aria-label') || ''))
    const subs = (root) => [...root.querySelectorAll('.sub')].map(x => x.textContent.trim())
    return {
      scrollTop: Math.round(panel.scrollTop), scrollHeight: Math.round(panel.scrollHeight), clientHeight: Math.round(panel.clientHeight),
      build: box(build), buildSeen: build ? seen(build) : null,
      apply: box(apply), applySeen: apply ? seen(apply) : null,
      sizeControlInPanel: !!cols, sizeBox: box(cols), cardsBox: box(cards),
      sizeAboveCards: cols && cards ? cols.getBoundingClientRect().top < cards.getBoundingClientRect().top : null,
      panelText: panel.textContent.replace(/\s+/g, ' ').slice(0, 260),
      panelSubHeadings: subs(panel),
      panelRandomizeButtons: [...panel.querySelectorAll('button')].filter(x => /randomize/i.test(x.textContent)).map(x => x.textContent.trim()),
      previewText: win ? win.textContent.replace(/\s+/g, ' ').slice(0, 900) : null,
      previewSubHeadings: win ? subs(win) : null,
      previewRandomizeButtons: win ? [...win.querySelectorAll('button')].filter(x => /randomize/i.test(x.textContent)).map(x => x.textContent.trim()) : null,
      previewHasSizeInputs: win ? !!win.querySelector('[aria-label="Map columns"]') : null,
    }
  })
  console.log('==', tag, JSON.stringify(r, null, 2))
  await p.locator('.z-panel').first().screenshot({ path: `.probe/shots/sidebar/${NAME}-${tag}.png` }).catch(e => console.log('shot', e.message))
  return r
}

await look('fresh')
const open = p.locator('button', { hasText: /Preview window/ }).first()
if (await open.count()) { await open.click(); await p.waitForTimeout(1500) }
await p.evaluate(() => { document.querySelector('.z-panel').scrollTop = 0 })
await p.waitForTimeout(300)
await look('previewopen-top')
await p.evaluate(() => { const el = document.querySelector('.z-panel'); el.scrollTop = el.scrollHeight })
await p.waitForTimeout(400)
await look('previewopen-bottom')
await p.screenshot({ path: `.probe/shots/sidebar/${NAME}-full.png` })
await b.close()

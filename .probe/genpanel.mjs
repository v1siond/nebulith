/**
 * The New world panel at a SHORT viewport: is the build button reachable without scrolling,
 * is the size control above the preset cards, and is the randomize section gone from the preview.
 */
import { chromium } from 'playwright'
const NAME = process.env.NAME || 'genpanel'
const H = Number(process.env.H || 800)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: H }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)

// The options live in the Preview WINDOW, so open it before looking for them.
const openPreview = p.locator('button', { hasText: /Preview window/ }).first()
if (await openPreview.count()) { await openPreview.click(); await p.waitForTimeout(1200) }

const report = await p.evaluate(() => {
  const panel = document.querySelector('.z-panel')
  if (!panel) return { error: 'no .z-panel' }
  const pr = panel.getBoundingClientRect()
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 && r.height > 0
  }
  const build = [...panel.querySelectorAll('button')].find(x => /Build this world/i.test(x.textContent))
  const apply = [...panel.querySelectorAll('button')].find(x => /Apply to this map/i.test(x.textContent))
  const cols = panel.querySelector('[aria-label="Map columns"]')
  const cards = panel.querySelector('.pgrid')
  const rect = (el) => el ? (({ top, bottom, height }) => ({ top: Math.round(top), bottom: Math.round(bottom), height: Math.round(height) }))(el.getBoundingClientRect()) : null
  const win = [...document.querySelectorAll('div')].find(d => /worldPreview|Preview/i.test(d.getAttribute('aria-label') || ''))
  const winText = win ? win.textContent.slice(0, 400) : null
  const randomizeInPanel = [...panel.querySelectorAll('div')].filter(d => d.className === 'sub' && /randomize/i.test(d.textContent)).length
  const randomizeAnywhere = [...document.querySelectorAll('div')].filter(d => d.className === 'sub' && /randomize/i.test(d.textContent)).length
  const rollBtn = [...document.querySelectorAll('button')].filter(x => /Randomize .*selected tile|Randomize the selection/i.test(x.textContent)).length
  return {
    panelRect: rect(panel),
    panelScrollHeight: Math.round(panel.scrollHeight),
    panelClientHeight: Math.round(panel.clientHeight),
    build: rect(build), buildVisible: build ? visible(build) : null,
    apply: rect(apply), applyVisible: apply ? visible(apply) : null,
    colsField: rect(cols), cardGrid: rect(cards),
    sizeBeforeCards: cols && cards ? cols.getBoundingClientRect().top < cards.getBoundingClientRect().top : null,
    randomizeSubHeadingsInPanel: randomizeInPanel,
    randomizeSubHeadingsAnywhere: randomizeAnywhere,
    rollSelectionButtons: rollBtn,
    previewWindowText: winText,
  }
})
console.log(JSON.stringify(report, null, 2))
const panel = p.locator('.z-panel').first()
await panel.screenshot({ path: `.probe/shots/sidebar/${NAME}-panel.png` }).catch(e => console.log('panelshot', e.message))
await p.screenshot({ path: `.probe/shots/sidebar/${NAME}-full.png` })
await b.close()

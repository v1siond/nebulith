/** The New world panel: no reopen button, click-to-preview, sticky actions, content-height modals. */
import { chromium } from 'playwright'
const H = Number(process.env.H || 800)
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: H }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(4500)

const win = () => p.locator('[role="dialog"][aria-label="Preview"]')
const state = async (tag) => {
  const r = await p.evaluate(() => {
    const panel = document.querySelector('.z-panel')
    const pr = panel.getBoundingClientRect()
    const btn = (rx) => [...panel.querySelectorAll('button')].find(x => rx.test(x.textContent))
    const seen = (el) => { const r2 = el.getBoundingClientRect(); return r2.top >= pr.top - 1 && r2.bottom <= pr.bottom + 1 }
    const build = btn(/Build this world/i)
    const w = document.querySelector('[role="dialog"][aria-label="Preview"]')
    const body = w?.querySelector('.body')
    return {
      reopenButtons: [...document.querySelectorAll('button')].filter(x => /preview window/i.test(x.textContent)).map(x => x.textContent.trim()),
      previewOpen: !!w,
      previewRect: w ? { top: Math.round(w.getBoundingClientRect().top), h: Math.round(w.getBoundingClientRect().height) } : null,
      previewCap: w ? w.style.getPropertyValue('--mw-cap') : null,
      previewInlineHeight: w ? (w.style.height || '(none)') : null,
      bodyScrolls: body ? body.scrollHeight > body.clientHeight + 1 : null,
      bodyContent: body ? Math.round(body.scrollHeight) : null,
      bodyBox: body ? Math.round(body.clientHeight) : null,
      buildSeen: build ? seen(build) : null,
      panelScrollTop: Math.round(panel.scrollTop),
    }
  })
  console.log('==', tag, JSON.stringify(r))
  return r
}

await state('on load')
// scroll the sidebar to the very bottom, then pick the LAST preset card from down there
await p.evaluate(() => { const el = document.querySelector('.z-panel'); el.scrollTop = el.scrollHeight })
await p.waitForTimeout(300)
const cards = p.locator('.pcard')
const last = cards.nth(await cards.count() - 1)
await last.click()
await p.waitForTimeout(1500)
await state('after clicking the last card from the bottom of the scroll')
await p.locator('.z-panel').first().screenshot({ path: '.probe/shots/sidebar/click-open-panel.png' })
await p.screenshot({ path: '.probe/shots/sidebar/click-open-full.png' })

// close it, then click the SAME card again
await win().locator('button[aria-label="Close"]').click()
await p.waitForTimeout(600)
await state('after closing')
await last.click()
await p.waitForTimeout(1200)
await state('after clicking the SAME card again')
await p.screenshot({ path: '.probe/shots/sidebar/reopen-full.png' })
await b.close()

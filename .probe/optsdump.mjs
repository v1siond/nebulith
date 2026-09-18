import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3200)
await p.getByRole('button', { name: /^Woodland/ }).first().click(); await p.waitForTimeout(800)
const o = await p.evaluate(() => ({
  checkboxes: [...document.querySelectorAll('input[type=checkbox]')].map(e => ((e.closest('label')||e.parentElement)?.textContent||'').trim().slice(0,40)),
  selects: [...document.querySelectorAll('select')].map(s => ({ label: (s.closest('label')||s.parentElement)?.textContent?.trim().slice(0,40), opts: [...s.options].map(x=>x.text).slice(0,8) })),
  buttons: [...document.querySelectorAll('button')].map(x=>(x.textContent||'').trim()).filter(x=>/river|water|liquid|lake|stream/i.test(x)),
}))
console.log(JSON.stringify(o, null, 1))
await b.close()

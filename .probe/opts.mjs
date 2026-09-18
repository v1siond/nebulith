import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1920, height: 1400 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3500)
for (const preset of ['Woodland', 'Jungle', 'Meadow']) {
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click()
  await p.waitForTimeout(500)
  const sels = await p.evaluate(() => [...document.querySelectorAll('select')].map(s => ({
    label: (s.closest('label')?.innerText || s.previousElementSibling?.textContent || '').trim().split('\n')[0],
    value: s.value,
    options: [...s.options].map(o => o.text),
  })))
  console.log(preset, JSON.stringify(sels, null, 1))
}
await b.close()

import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
for (const preset of (process.env.PRESETS || 'Woodland,Jungle,Beach').split(',')) {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  await p.getByRole('button', { name: new RegExp('^' + preset) }).first().click(); await p.waitForTimeout(500)
  // turn on anything that mentions a river, whatever control it is
  const opts = await p.evaluate(() => {
    const hits = []
    for (const el of document.querySelectorAll('input[type=checkbox]')) {
      const lbl = (el.closest('label')?.textContent || el.parentElement?.textContent || '')
      if (/river|water|liquid/i.test(lbl)) { if (!el.checked) el.click(); hits.push(lbl.trim().slice(0, 30)) }
    }
    return hits
  })
  await p.waitForTimeout(400)
  await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(4200)
  const rows = await p.evaluate(() => (globalThis.__tileTones?.(1) || []).filter(r => /water|lava|shore|bank/.test(r.label)).map(r => `${r.label}x${r.total}`))
  console.log(`${preset.padEnd(9)} opts=${JSON.stringify(opts)} :: ${rows.join('  ') || 'NO WATER'}`)
}
await b.close()

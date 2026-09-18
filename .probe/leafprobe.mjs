import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
p.on('console', m => { const s = m.text(); if (s.includes('LEAFPROBE')) console.log(s) })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(3000)
await p.getByRole('button', { name: /^Jungle/ }).first().click(); await p.waitForTimeout(500)
await p.getByRole('button', { name: /Build this world/ }).click(); await p.waitForTimeout(4000)
await b.close()

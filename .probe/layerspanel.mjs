/** The re-roll panel, built from whatever the backend serves. Adds a layer through the API mid-flight and
 *  reloads to prove the panel follows the backend rather than a list in this repo. */
import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
const buttons = async () => {
  await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
  await p.waitForTimeout(3000)
  return p.evaluate(() => {
    const heads = [...document.querySelectorAll('div')].filter(d => d.textContent?.trim() === 'Layers')
    const group = heads.map(h => h.nextElementSibling).find(e => e?.getAttribute('role') === 'group')
    return group ? [...group.querySelectorAll('button')].map(x => x.textContent?.trim()) : null
  })
}
console.log('panel now:', await buttons())
await fetch('http://localhost:6328/api/generation_layers', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ layer: { key: 'fog', label: 'Fog', hint: 'a fog pass over the finished map', position: 35, seedable: true } }),
})
console.log('panel after adding a fog layer in the BACKEND:', await buttons())
await fetch('http://localhost:6328/api/generation_layers/fog', { method: 'DELETE' })
console.log('panel after deleting it again:', await buttons())
await b.close()

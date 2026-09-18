import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1200, height: 800 } })
await p.goto('http://localhost:6328/templates', { waitUntil: 'networkidle' })
await p.waitForTimeout(5000)
console.log(JSON.stringify(await p.evaluate(() => {
  const t = globalThis.__nebulithTilesets
  const shape = Array.isArray(t) ? 'array' : typeof t
  const style = Array.isArray(t) ? t[0] : t
  const tiles = style?.tiles
  const keys = tiles ? (Array.isArray(tiles) ? 'array' : Object.keys(tiles).slice(0, 4)) : null
  const one = tiles ? (Array.isArray(tiles) ? tiles[0] : tiles['leaf_center'] ?? tiles[Object.keys(tiles)[0]]) : null
  return { shape, styleKeys: style ? Object.keys(style).slice(0, 10) : null, tileKeys: keys, sample: one }
}), null, 1))
await b.close()

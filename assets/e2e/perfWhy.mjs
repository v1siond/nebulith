/**
 * WHERE THE FRAME GOES, BY SURFACE AND BY CAUSE.
 *
 *     bin/e2e perfWhy            (via bin/e2e)
 *
 * A total frame time tells you the frame is slow. It does not tell you WHICH surface is drawing, and
 * this editor has more than one: the map canvas, the minimap that repaints on its own timer, and the
 * preview pane that renders its subject over and over. A number that adds all three together sends you
 * optimising the map when the map was never the problem.
 *
 * It also counts the things that should not be happening at all while a hero walks:
 *
 *   NETWORK. Nothing should be fetched during play. A request per frame, or a poll, is work the canvas
 *   pays for twice: once for the request and once for whatever state change it triggers.
 *
 *   REACT. The canvas is drawn by a rAF loop, not by React, so a re-render is pure overhead. A tree
 *   that re-renders every frame also re-runs every effect guard and re-allocates every prop.
 *
 *   CANVAS RESIZES. Setting width or height clears the backing store and forces a reallocation. Doing
 *   it in a loop is invisible in a profile and enormous in practice.
 */
import { chromium } from 'playwright'
import { BASE } from './base.mjs'
import { logIn } from './logIn.mjs'
import { openScratchMap, dropScratchMap } from './scratchMap.mjs'

const SECONDS = Number(process.argv[2] ?? 6)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

await page.addInitScript(() => {
  const w = window
  w.__p = { frames: 0, fetches: [], resizes: 0, ops: {} }

  const raf = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = cb => raf(t => { w.__p.frames++; return cb(t) })

  const fetch0 = w.fetch
  w.fetch = function (...a) {
    w.__p.fetches.push(String(a[0]).replace(location.origin, '').split('?')[0])
    return fetch0.apply(this, a)
  }

  // WHICH SURFACE. A canvas is named by its class, which is how this app tells its surfaces apart.
  const nameOf = c => (c && c.canvas && (c.canvas.className || c.canvas.id)) || '(offscreen)'
  for (const op of ['drawImage', 'fill', 'stroke', 'save', 'fillRect']) {
    const orig = CanvasRenderingContext2D.prototype[op]
    CanvasRenderingContext2D.prototype[op] = function (...a) {
      const key = `${nameOf(this)}|${op}`
      w.__p.ops[key] = (w.__p.ops[key] ?? 0) + 1
      return orig.apply(this, a)
    }
  }

  // A RESIZE CLEARS THE BACKING STORE. In a loop it is invisible in a profile and huge on screen.
  for (const dim of ['width', 'height']) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, dim)
    Object.defineProperty(HTMLCanvasElement.prototype, dim, {
      get() { return d.get.call(this) },
      set(v) { if (d.get.call(this) !== v) w.__p.resizes++; return d.set.call(this, v) },
    })
  }
})

await logIn(page, BASE)
const scratchId = await openScratchMap(page, BASE, { cols: 100, rows: 60, name: 'e2e perf why' })

await page.selectOption('select', 'city').catch(() => {})
await page.waitForTimeout(600)
const generator = page.getByRole('button', { name: /^Woodland/ }).first()
await generator.waitFor({ state: 'visible', timeout: 30000 })
await generator.click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /Build this world/ }).click()
await page.waitForTimeout(9000)

const built = await page.evaluate(() => window.__nebulithGrid?.assets?.length ?? 0)
if (built < 500) throw new Error(`refusing to measure an empty scene: ${built} tiles`)

// COUNT REACT, from inside. The dev build exposes the hook; without it the count is simply absent
// rather than guessed at.
await page.evaluate(() => {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
  window.__p.renders = hook ? 0 : null
  if (!hook) return
  const commit = hook.onCommitFiberRoot
  hook.onCommitFiberRoot = function (...a) { window.__p.renders++; return commit?.apply(this, a) }
})

await page.evaluate(() => {
  const p = window.__p
  p.frames = 0
  p.fetches = []
  p.resizes = 0
  p.ops = {}
  if (p.renders !== null) p.renders = 0
})

await page.keyboard.down('w')
await page.keyboard.down('d')
const t0 = Date.now()
await page.waitForTimeout(SECONDS * 1000)
const elapsed = (Date.now() - t0) / 1000
await page.keyboard.up('w')
await page.keyboard.up('d')

const out = await page.evaluate(() => window.__p)
const fps = out.frames / elapsed

console.log(`\n${built} tiles, ${fps.toFixed(1)} fps over ${elapsed.toFixed(1)}s\n`)

console.log('PER SURFACE, per frame:')
const bySurface = {}
for (const [key, n] of Object.entries(out.ops)) {
  const [surface, op] = key.split('|')
  bySurface[surface] ??= {}
  bySurface[surface][op] = n
}
for (const [surface, ops] of Object.entries(bySurface)) {
  const total = Object.values(ops).reduce((a, b) => a + b, 0)
  const each = Object.entries(ops).map(([o, n]) => `${o} ${(n / out.frames).toFixed(0)}`).join('  ')
  console.log(`  ${(surface || '(unnamed)').padEnd(28)} ${(total / out.frames).toFixed(0).padStart(6)} ops/frame   ${each}`)
}

console.log('\nWHAT SHOULD NOT BE HAPPENING AT ALL:')
console.log(`  network requests during play  ${out.fetches.length}`)
const byUrl = {}
for (const u of out.fetches) byUrl[u] = (byUrl[u] ?? 0) + 1
for (const [u, n] of Object.entries(byUrl).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`      ${String(n).padStart(4)} x ${u}`)
}
console.log(`  react commits                 ${out.renders ?? '(devtools hook absent, not counted)'}`)
if (typeof out.renders === 'number') console.log(`      ${(out.renders / out.frames).toFixed(2)} per frame`)
console.log(`  canvas backing-store resizes  ${out.resizes}`)

await dropScratchMap(page, scratchId)
await browser.close()

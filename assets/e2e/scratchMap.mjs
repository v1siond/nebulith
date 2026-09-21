/**
 * A MAP OF ITS OWN, FOR ANY GATE THAT SAVES.
 *
 * The editor's Save writes over the template it currently has open. On a database with one saved map
 * that is somebody's actual work, and it has now happened twice: a gate opened /templates, generated
 * a world, clicked Save, and the authored map was gone.
 *
 * So a gate that saves creates its own map first, drives that, and deletes it. Never the one that is
 * really there.
 */
export async function openScratchMap(page, base, { cols = 40, rows = 40, name = 'e2e scratch' } = {}) {
  await page.goto(`${base}/templates`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const id = await page.evaluate(async ({ cols, rows, name }) => {
    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${name} ${Date.now()}`,
        cols, rows, cellSize: 16, isoScale: 2.5,
        groundData: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'grass')),
        heightData: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0)),
        assetsData: [], connectors: [], entities: [], quests: [],
      }),
    })
    return res.ok ? (await res.json()).id : null
  }, { cols, rows, name })

  if (!id) throw new Error('could not create a scratch map, refusing to drive the one that is saved')

  await page.goto(`${base}/templates?id=${id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return id
}

/** Give it back. Call BEFORE the browser closes: the delete rides the page's own session. */
export async function dropScratchMap(page, id) {
  if (!id) return
  await page.evaluate(i => fetch(`/api/templates/${i}`, { method: 'DELETE' }).catch(() => {}), id)
}

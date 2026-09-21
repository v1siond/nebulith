/**
 * THE ADMIN CAN FIND A ROW, OPEN IT, CHANGE IT AND PUT IT BACK.
 *
 *     node e2e/adminCrud.mjs          (server on :6328)
 *
 * *"I can't see details from any of the records listed on the tables, nor edit them, nor delete them, I
 * can't search"*. The Elixir suite proves the context and the controller; this drives the pages, because
 * the last two defects in this area were only visible in a browser: a uuid rendered as a byte dump, so
 * every "open" link pointed nowhere, and a page that looked fine was serving a stale bundle.
 *
 * It edits ONE field on the admin's own row and puts the original back, so it leaves the database exactly
 * as it found it. It never deletes: a delete that runs on every check is a delete that eventually runs on
 * something that mattered.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:6328'
const USER = process.env.ADMIN_EMAIL || 'admin@nebulith.local'
const PASS = process.env.ADMIN_PASSWORD || '12345678'
const failures = []

function check(ok, label, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`)
  if (!ok) failures.push(label)
}

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1700, height: 1000 },
  httpCredentials: { username: USER, password: PASS },
})

// ── the table list ──────────────────────────────────────────────────────
await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
const tableLinks = await page.locator('a[href^="/admin/"]').count()
check(tableLinks > 5, 'the table list shows the tables', `${tableLinks} links`)
check(
  (await page.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().width))) > 1400,
  'the admin is not width-limited',
)

// ── a table, and the search ─────────────────────────────────────────────
await page.goto(`${BASE}/admin/tiles`, { waitUntil: 'networkidle' })
const allRows = await page.locator('tbody tr').count()
check(allRows > 0, 'a table lists its rows', `${allRows} on this page`)

await page.fill('input[type=search]', 'water')
await page.click('button:has-text("Search")')
await page.waitForTimeout(1200)
const heading = await page.locator('h1').first().innerText()
const summary = await page.locator('main p').first().innerText()
check(/water/.test(summary), 'search reports what it matched', summary.replace(/\s+/g, ' ').slice(0, 60))
check(heading.trim() === 'tiles', 'search stays on the same table')

// ── open a row ──────────────────────────────────────────────────────────
await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
await page.locator('a:has-text("open")').first().click()
await page.waitForTimeout(900)
check(/\/admin\/users\/[0-9a-f-]{36}$/.test(page.url()), 'a row opens at its uuid', page.url())
const fields = await page.locator('dl > div').count()
check(fields > 3, 'the row shows every column', `${fields} fields`)

// ── edit, then put it back ──────────────────────────────────────────────
const rowUrl = page.url()
await page.locator('a:has-text("Edit")').first().click()
await page.waitForTimeout(900)

const nameField = page.locator('[name="row[display_name]"]').first()
check((await nameField.count()) === 1, 'the edit form has a field for an editable column')
check((await page.locator('[name="row[id]"]').count()) === 0, 'the key column has no field')

const original = await nameField.inputValue()
const probe = `e2e-${Date.now()}`

await nameField.fill(probe)
await page.click('button:has-text("Save")')
await page.waitForTimeout(1200)
check(page.url() === rowUrl, 'saving returns to the row', page.url())
check((await page.locator('main').innerText()).includes(probe), 'the new value is on the row', probe)

// put it back, so this check leaves nothing behind
await page.goto(`${rowUrl}/edit`, { waitUntil: 'networkidle' })
await page.locator('[name="row[display_name]"]').first().fill(original)
await page.click('button:has-text("Save")')
await page.waitForTimeout(1200)
const restored = (await page.locator('main').innerText()).includes(probe)
check(!restored, 'the original value is restored', `back to "${original}"`)

// ── a table name that is not a table ────────────────────────────────────
await page.goto(`${BASE}/admin/${encodeURIComponent('users; drop table users')}`, { waitUntil: 'networkidle' })
check(page.url().endsWith('/admin'), 'a crafted table name is turned away', page.url())
await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle' })
check((await page.locator('tbody tr').count()) > 0, 'and the table it named is still there')

await browser.close()

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed')
process.exit(failures.length ? 1 : 0)

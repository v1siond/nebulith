/**
 * THE DOOR, DRIVEN THE WAY A PERSON DRIVES IT.
 *
 * The Elixir suite proves the plugs redirect and the rows are written. That is the server's side of it.
 * This is the other side: a real browser asking for a page it may not have, typing into the real form,
 * and then actually being inside the application.
 *
 * Measured before the gate existed: /games rendered the engine to anybody who asked for it.
 *
 *   node e2e/login.mjs              (server on :6328)
 */
import { chromium } from 'playwright'
import { logIn } from './logIn.mjs'

const BASE = process.env.BASE || 'http://localhost:6328'
const EMAIL = process.env.ADMIN_EMAIL || 'admin@nebulith.local'

const browser = await chromium.launch()
const page = await browser.newPage()

const fail = async (message) => {
  await browser.close()
  console.error(`FAIL  ${message}`)
  process.exit(1)
}

// 1. A stranger asking for the engine is sent to the form, and gets no engine on the way.
await page.goto(`${BASE}/games`, { waitUntil: 'networkidle' })

if (!page.url().endsWith('/login')) {
  await fail(`/games served without a session, landed on ${page.url()}`)
}
if (await page.locator('#game').count()) {
  await fail('the engine shell was rendered to a stranger')
}

// 2. A wrong password is refused, and the page does not say which half was wrong.
await page.fill('#user_email', EMAIL)
await page.fill('#user_password', 'definitely-not-the-password')
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),
  page.click('button[type="submit"]'),
])

// Its own id, because the app layout's flash toasts are role="alert" too.
const refusal = await page.locator('#login-error').innerText()
if (!refusal.includes('Wrong email or password')) {
  await fail(`a wrong password said: ${refusal}`)
}
if (await page.locator('#game').count()) {
  await fail('a wrong password still rendered the engine')
}

// 3. The right password opens the page that was asked for in the first place.
await logIn(page, BASE)

if (!page.url().endsWith('/games')) {
  await fail(`logging in landed on ${page.url()}, not the page that was asked for`)
}
await page.waitForSelector('#game', { timeout: 15000 })

// 4. The header says who is signed in.
const header = await page.locator('body').innerText()
if (!header.includes(EMAIL)) {
  await fail('the page never says who is signed in')
}

// 5. Logging out ends it, and the engine is shut again.
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }),
  page.click('button:has-text("Log out")'),
])

if (!page.url().endsWith('/login')) {
  await fail(`logging out landed on ${page.url()}`)
}

await page.goto(`${BASE}/games`, { waitUntil: 'networkidle' })
if (!page.url().endsWith('/login')) {
  await fail('the engine was still open after logging out')
}

// 6. The documentation is not behind any of this.
await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' })
if (!page.url().endsWith('/docs')) {
  await fail('/docs asked for a login')
}

await browser.close()
console.log('PASS  login: the engine is shut to strangers, opens on the real form, and shuts again on log out')

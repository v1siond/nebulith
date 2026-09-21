/**
 * LOGGING IN, for the gates that need to be somebody.
 *
 * The engine pages are behind a session now, so a gate that drives the editor has to walk through the
 * real form first. It fills the real inputs and submits, rather than posting to the endpoint or forging
 * a cookie: a gate that skips the form stops covering the form.
 */
const EMAIL = process.env.ADMIN_EMAIL || 'admin@nebulith.local'
const PASSWORD = process.env.ADMIN_PASSWORD || '12345678'

export async function logIn(page, base, { email = EMAIL, password = PASSWORD } = {}) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' })
  await page.fill('#user_email', email)
  await page.fill('#user_password', password)
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('button[type="submit"]')])

  if (page.url().includes('/login')) {
    throw new Error(`login as ${email} did not leave the form, still at ${page.url()}`)
  }
}

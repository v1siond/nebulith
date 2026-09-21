/**
 * WHERE THE GATES ARE ALLOWED TO POINT.
 *
 * They drive a real server over real HTTP, so they cannot join the Ecto sandbox the way `mix test`
 * does, and several of them author maps and click Save. Pointed at the dev server that means writing
 * over real work, and it did: a gate generated a woodland over an authored village.
 *
 * So the address is not a default any more, it is a requirement, and the dev port is refused outright.
 * `bin/e2e` builds nebulith_e2e, serves it on its own port and sets this.
 */
const DEV_PORT = '6328'

export const BASE = (() => {
  const url = process.env.BASE

  if (!url) {
    throw new Error(
      'BASE is not set. Run the gates through bin/e2e, which gives them their own database and port.',
    )
  }

  if (url.includes(`:${DEV_PORT}`)) {
    throw new Error(
      `BASE is ${url}, which is the dev server and the dev database. These gates author maps and ` +
        'click Save. Run them through bin/e2e.',
    )
  }

  return url
})()

/**
 * Where the engine's own pages live, in one place, because the engine is its own deployment now and
 * the paths got shorter. Phoenix redirects the old `/personal-projects/game-engine/*` shapes, so old
 * links and the probe harness still resolve, but nothing in this tree builds one.
 */
export const ROUTES = {
  games: '/games',
  game: (id: string | number) => `/games/${id}`,
  templates: '/templates',
  spriteGenerator: '/sprite-generator',
  spritesTest: '/sprites-test',
} as const

/**
 * The CV site, which is a separate deployment. Phoenix renders it onto the mount node, so it is
 * runtime configuration rather than a value baked into the bundle at build time.
 *
 * Read through a function on purpose: a module-level const evaluates when this module first loads
 * and would freeze whatever was there, which is the same trap as reading a served catalog at module
 * scope.
 *
 * No fallback. This used to default to the CV's dev server, and a deployed build then offered every
 * visitor a link to their own machine on port 3000. The server knows whether a CV exists in this
 * environment and says so by rendering the attribute or leaving it off; null means draw no link.
 */
export const cvUrl = (): string | null =>
  document.getElementById('game')?.dataset.cvUrl || null

/**
 * Who is signed in, as Phoenix rendered it onto the mount node, or null. Same contract as `cvUrl`: the
 * server knows and says so, the bundle never guesses. The engine pages are behind a login, so in
 * practice this is set whenever the app is running at all.
 */
export const userEmail = (): string | null =>
  document.getElementById('game')?.dataset.userEmail || null

/**
 * The CSRF token for posting back to Phoenix, which the Log out form needs. Read at call time, because
 * the session is renewed on login and the token with it.
 */
export const csrfToken = (): string | null =>
  document.getElementById('game')?.dataset.csrfToken || null

export type RouteName = 'games' | 'game' | 'templates' | 'spriteGenerator' | 'spritesTest'

/**
 * Which page a path is, and what the path itself carries. `/games/42` yields `{ id: '42' }`, which
 * `useRouter` folds into `query` so the game page reads `router.query.id` exactly as it did when a
 * `[id].tsx` filename produced it.
 *
 * Anything unrecognised is the gallery, which is also what the old server-side redirect did.
 */
export const matchRoute = (pathname: string): { name: RouteName; params: Record<string, string> } => {
  const path = pathname.replace(/\/+$/, '')
  if (path === ROUTES.templates) return { name: 'templates', params: {} }
  if (path === ROUTES.spriteGenerator) return { name: 'spriteGenerator', params: {} }
  if (path === ROUTES.spritesTest) return { name: 'spritesTest', params: {} }
  const game = /^\/games\/([^/]+)$/.exec(path)
  if (game) return { name: 'game', params: { id: game[1] } }
  return { name: 'games', params: {} }
}

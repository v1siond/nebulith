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
 * scope. The fallback is the CV's dev server, so a checkout with nothing configured still links.
 */
export const cvUrl = (): string =>
  document.getElementById('game')?.dataset.cvUrl ?? 'http://localhost:3000'

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

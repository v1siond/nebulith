import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { loadTileSchema } from '@/lib/tileDefaults'
import { loadEngineLists } from '@/lib/engineLists'
import { ToastProvider } from '@/components/Toast'
import { useRouter } from '@/lib/router'
import { matchRoute } from '@/lib/routes'
import GamesPage from '@/routes/games'
import GameShowPage from '@/routes/games/[id]'
import TemplateEditorPage from '@/routes/templates'

/**
 * The engine's entry point. Phoenix serves the same shell for every engine path and this decides
 * which page that path is, so a direct load of /games/42 renders the same thing a click does.
 *
 * ToastProvider is here because it used to live in the Next _app that wrapped every page; the
 * editor and the game page both call useToast and neither mounts its own provider.
 *
 * The sprite tools load on demand. They are a separate authoring job from building a map, most
 * sessions never open them, and one of them pulls in JSZip; esbuild is configured with --splitting
 * so a dynamic import here is a chunk nobody downloads until they ask for it.
 */
const SpriteGeneratorPage = lazy(() => import('@/routes/spriteGenerator'))
const SpritesTestPage = lazy(() => import('@/routes/spritesTest'))

function App() {
  const { pathname } = useRouter()
  const { name } = matchRoute(pathname)

  if (name === 'templates') return <TemplateEditorPage />
  if (name === 'game') return <GameShowPage />
  if (name === 'spriteGenerator') return <Loading><SpriteGeneratorPage /></Loading>
  if (name === 'spritesTest') return <Loading><SpritesTestPage /></Loading>
  return <GamesPage />
}

function Loading({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="p-8 font-mono text-gray-400">Loading…</p>}>{children}</Suspense>
}

/**
 * NOTHING RENDERS BEFORE THE SCHEMA LANDS, and this is the one place that can promise it.
 *
 * `/api/maps/schema` carries what every setting is when nobody said, from the column that states it.
 * Anything that builds a placement needs it, and a grid builds placements the moment it is constructed,
 * which happens inside a React effect on a cold mount.
 *
 * The editor used to gate itself, and that was one page gating one of its effects: the page threw
 * before it drew, because a grid fills its ground on construction and a floor asks how tall its tile
 * is. Gating each caller is a list that falls behind, so the wait happens once, here, above every page.
 *
 * The alternative is a number for a renderer to use meanwhile, which is the hardcoded fallback this
 * whole phase exists to delete. A failure to load is shown as a failure, not papered over: a map drawn
 * from invented values is worse than a map not drawn.
 */
const mount = document.getElementById('game')

if (mount) {
  const root = createRoot(mount)

  // THE LISTS COME WITH THE SCHEMA, for the same reason and in the same breath. A picker whose list has
  // not arrived offers nothing, and a component that loads its own would be choosing when to know.
  Promise.all([loadTileSchema(), loadEngineLists()])
    .then(() => root.render(<ToastProvider><App /></ToastProvider>))
    .catch((err: unknown) => {
      root.render(
        <div className="p-8 font-mono text-sm text-red-300">
          <p className="mb-2 font-bold">The editor could not load what a tile setting means.</p>
          <p className="mb-2 text-gray-400">
            /api/maps/schema or /api/enums did not answer, so every setting would have to be guessed at
            and every picker would be empty. Reload once they are back.
          </p>
          <p className="text-gray-500">{String(err)}</p>
        </div>,
      )
    })
}

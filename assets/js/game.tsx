import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
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

const mount = document.getElementById('game')
if (mount) {
  createRoot(mount).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )
}

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
 */
function App() {
  const { pathname } = useRouter()
  const { name } = matchRoute(pathname)

  if (name === 'templates') return <TemplateEditorPage />
  if (name === 'game') return <GameShowPage />
  return <GamesPage />
}

const mount = document.getElementById('game')
if (mount) {
  createRoot(mount).render(
    <ToastProvider>
      <App />
    </ToastProvider>,
  )
}

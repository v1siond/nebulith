import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useToast } from '@/components/Toast'
import { getGame, type Game } from '@/lib/api'
import TemplateEditor, { type EditorGameContext } from '../templates'

/** The standalone builder route — the "default builder" we fall back to when a game can't be opened. */
const DEFAULT_BUILDER_ROUTE = '/personal-projects/game-engine/templates'

/**
 * GAME show — the same editor as before, scoped to a game. We load the game, then render the editor
 * with its context so it opens the last-watched template (or the first) and remembers switches.
 * `?play=1` deep-links straight into play mode (from the games gallery ▶ Play).
 *
 * If the game data can't be loaded (backend down, bad id) we don't dead-end — we notify with a toast and
 * fall back to the default builder (the standalone /templates route), so the view degrades gracefully
 * instead of trapping the user on an error screen. We redirect there rather than rendering the editor on
 * this URL, because the [id] segment is the GAME id (not a template) and the editor would misread it.
 */
export default function GameShowPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [ctx, setCtx] = useState<EditorGameContext | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    const gameId = router.query.id
    if (typeof gameId !== 'string') return
    const play = router.query.play === '1'
    getGame(gameId)
      .then((g: Game) =>
        setCtx({
          gameId: g.id,
          templateIds: g.templateIds,
          startTemplateId: g.lastTemplateId || g.templateIds[0] || null,
          play,
        }),
      )
      .catch(() => {
        toast("Couldn't load the game — showing the default builder.", 'error')
        void router.replace(DEFAULT_BUILDER_ROUTE)
      })
  }, [router.isReady, router.query.id, router.query.play, toast, router])

  if (!ctx) {
    return (
      <div className="min-h-screen bg-gray-900 text-white font-mono flex items-center justify-center">
        <span className="animate-pulse">Loading game…</span>
      </div>
    )
  }
  return <TemplateEditor gameContext={ctx} />
}

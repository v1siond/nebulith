import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { getGame, type Game } from '@/lib/api'
import TemplateEditor, { type EditorGameContext } from '../templates'

/**
 * GAME show — the same editor as before, scoped to a game. We load the game, then render the editor
 * with its context so it opens the last-watched template (or the first) and remembers switches.
 * `?play=1` deep-links straight into play mode (from the games gallery ▶ Play).
 */
export default function GameShowPage() {
  const router = useRouter()
  const [ctx, setCtx] = useState<EditorGameContext | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      .catch(() => setError('Game not found'))
  }, [router.isReady, router.query.id, router.query.play])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white font-mono flex flex-col items-center justify-center gap-4">
        <p className="text-xl">{error}</p>
        <button
          onClick={() => router.push('/personal-projects/game-engine/games')}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Back to games
        </button>
      </div>
    )
  }
  if (!ctx) {
    return (
      <div className="min-h-screen bg-gray-900 text-white font-mono flex items-center justify-center">
        <span className="animate-pulse">Loading game…</span>
      </div>
    )
  }
  return <TemplateEditor gameContext={ctx} />
}

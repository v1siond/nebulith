import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GameEngineLayout } from '@/components/game/GameEngineLayout'
import { listGames, createGame, deleteGame, type Game } from '@/lib/api'

/**
 * GAMES gallery — the app is scoped to games now (templates are a reusable resource). Games are PERSISTED
 * in the Elixir backend (a game = a named flow of templates). Open loads the game's editor at its
 * last-watched template; ▶ Play enters that level in play mode. Same nebulith layout as before.
 */
export default function GamesPage() {
  const router = useRouter()
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    listGames()
      .then((g) => { setGames(g); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // The /games/[id] route resolves the start template (last-watched, else first) itself — just pass the id.
  const openGame = (g: Game) => router.push(`/personal-projects/game-engine/games/${g.id}`)
  const playGame = (g: Game) => router.push(`/personal-projects/game-engine/games/${g.id}?play=1`)
  const handleNew = async () => {
    const name = window.prompt('New game name?')?.trim()
    if (!name) return
    const g = await createGame({ name })
    router.push(`/personal-projects/game-engine/games/${g.id}`)
  }
  const handleDelete = async (g: Game) => {
    if (!window.confirm(`Delete game "${g.name}"? (its templates are kept)`)) return
    await deleteGame(g.id)
    load()
  }

  return (
    <GameEngineLayout active="games">
      <div className="bg-gray-800 rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-sm">Games:</span>
          <span className="ml-2 text-xl font-bold">{games.length}</span>
        </div>
        <button
          onClick={handleNew}
          className="px-6 py-3 rounded-lg font-bold text-lg bg-green-600 hover:bg-green-500 hover:scale-105 transition-all"
        >
          + New Game
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-4 animate-pulse">...</div>
          <p className="text-gray-400">Loading games…</p>
        </div>
      ) : games.length === 0 ? (
        <div className="text-center py-16 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700">
          <div className="text-6xl mb-4">🎮</div>
          <h2 className="text-xl font-bold mb-2">No games yet</h2>
          <p className="text-gray-400 mb-6">A game is a flow of connected templates. Create one, then connect templates to it.</p>
          <button onClick={handleNew} className="px-8 py-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg">
            Create Game
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {games.map((g) => (
            <div key={g.id} className="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-yellow-400/50 transition-all">
              <div className="h-32 bg-gray-700 flex items-center justify-center">
                <div className="text-4xl opacity-30">🎮</div>
              </div>
              <div className="p-4">
                <h3 className="font-bold text-lg mb-1 truncate">{g.name}</h3>
                <p className="text-gray-400 text-sm mb-3">
                  {g.templateIds.length} {g.templateIds.length === 1 ? 'template' : 'templates'}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => playGame(g)}
                    disabled={g.templateIds.length === 0}
                    className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-center text-sm font-bold disabled:bg-gray-700 disabled:text-gray-500"
                  >
                    ▶ Play
                  </button>
                  <button onClick={() => openGame(g)} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold">
                    Open
                  </button>
                  <button onClick={() => handleDelete(g)} className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded text-sm" title="Delete game">
                    🗑️
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </GameEngineLayout>
  )
}

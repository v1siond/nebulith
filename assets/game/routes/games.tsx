import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GameEngineLayout } from '@/components/game/GameEngineLayout'
import { GameEditor } from '@/components/game/games'
import { listTemplates, type TemplateListItem } from '@/lib/api'
import { loadGames, saveGames } from '@/game/gamesStore'
import { type Game, createGame, deleteGame as deleteGameFromList, levelCount, levelTemplate, upsertGame } from '@/game/games'

/**
 * GAMES / FLOWS gallery (docs/games-flows.md). Uses the SAME nebulith layout + nav as the templates
 * gallery — only the content differs: a grid of games (a game = a flow of connected templates, played
 * level 1, 2, 3 …). ▶ Play drops into the first level's play view; Edit opens the inline GameEditor.
 * Games live in localStorage; templates (to add as levels) come from the Elixir backend.
 */
export default function GamesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    listTemplates({ limit: 100 }).then((r) => { if (live) setTemplates(r.templates) }).catch(() => {})
    return () => { live = false }
  }, [])
  useEffect(() => { setGames(loadGames()) }, [])

  const persist = (next: Game[]) => { setGames(next); saveGames(next) }
  const editing = editingId ? games.find((g) => g.id === editingId) ?? null : null
  const nameOf = (id: string) => templates.find((t) => t.id === id)?.name ?? '(missing template)'
  const playLevel = (templateId: string) => router.push(`/personal-projects/game-engine/templates?id=${templateId}&play=1`)
  const handleNew = () => { const g = createGame('New game'); persist(upsertGame(games, g)); setEditingId(g.id) }
  const handleDelete = (id: string) => { persist(deleteGameFromList(games, id)); if (editingId === id) setEditingId(null) }

  return (
    <GameEngineLayout active="games">
      {editing ? (
        <div className="bg-gray-800 rounded-lg p-4">
          <GameEditor
            game={editing}
            savedTemplates={templates}
            onChange={(g) => persist(upsertGame(games, g))}
            onPlayLevel={playLevel}
            onBack={() => setEditingId(null)}
          />
        </div>
      ) : (
        <>
          {/* Stats bar — mirrors the templates gallery */}
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

          {games.length === 0 ? (
            <div className="text-center py-16 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700">
              <div className="text-6xl mb-4">🎮</div>
              <h2 className="text-xl font-bold mb-2">No games yet</h2>
              <p className="text-gray-400 mb-6">A game is a flow of connected templates — level 1, 2, 3 …</p>
              <button onClick={handleNew} className="px-8 py-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg">
                Create Game
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {games.map((g) => {
                const first = levelTemplate(g, 1)
                const count = levelCount(g)
                return (
                  <div
                    key={g.id}
                    className="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-yellow-400/50 transition-all group"
                  >
                    <div className="h-32 bg-gray-700 flex items-center justify-center">
                      <div className="text-4xl opacity-30">🎮</div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-lg mb-1 truncate">{g.name}</h3>
                      <p className="text-gray-400 text-sm mb-3">
                        {count} {count === 1 ? 'level' : 'levels'}
                        {first ? ` • starts at ${nameOf(first)}` : ''}
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => first && playLevel(first)}
                          disabled={!first}
                          className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-center text-sm font-bold disabled:bg-gray-700 disabled:text-gray-500"
                        >
                          ▶ Play
                        </button>
                        <button
                          onClick={() => setEditingId(g.id)}
                          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(g.id)}
                          className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded text-sm"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </GameEngineLayout>
  )
}

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GameEngineLayout } from '@/components/game/GameEngineLayout'
import { listTemplates, type TemplateListItem } from '@/lib/api'
import { deriveFlows } from '@/game/deriveFlows'

/**
 * GAMES / FLOWS gallery (docs/games-flows.md). A GAME is a set of CONNECTED templates — so games are
 * DERIVED from the template connector graph (each connected cluster of ≥2 templates = one game), not
 * hand-built. Same nebulith layout + nav as the templates gallery; only the content differs. ▶ Play
 * enters the flow at its entry template (level 1); connectors drive walking between levels in-play.
 */
export default function GamesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    listTemplates({ limit: 100 })
      .then((r) => { if (live) { setTemplates(r.templates); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const games = deriveFlows(templates)
  const nameOf = (id: string) => templates.find((t) => t.id === id)?.name ?? '(missing template)'
  const playFlow = (entryId: string) => router.push(`/personal-projects/game-engine/templates?id=${entryId}&play=1`)
  const openFlow = (entryId: string) => router.push(`/personal-projects/game-engine/templates?id=${entryId}`)

  return (
    <GameEngineLayout active="games">
      <div className="bg-gray-800 rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-sm">Games:</span>
          <span className="ml-2 text-xl font-bold">{games.length}</span>
          <span className="ml-2 text-gray-500 text-sm">· a game is a flow of connected templates</span>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-4 animate-pulse">...</div>
          <p className="text-gray-400">Loading…</p>
        </div>
      ) : games.length === 0 ? (
        <div className="text-center py-16 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700">
          <div className="text-6xl mb-4">🎮</div>
          <h2 className="text-xl font-bold mb-2">No games yet</h2>
          <p className="text-gray-400 mb-6">Connect two or more templates (with connectors, in the editor) and they become a game.</p>
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
                <p className="text-gray-400 text-sm mb-2">
                  {g.templateIds.length} connected {g.templateIds.length === 1 ? 'template' : 'templates'}
                </p>
                <div className="mb-3 flex flex-wrap gap-1">
                  {g.templateIds.map((id, i) => (
                    <span key={id} className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-gray-300">
                      {i + 1}. {nameOf(id)}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => playFlow(g.entryId)}
                    className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-center text-sm font-bold"
                  >
                    ▶ Play
                  </button>
                  <button
                    onClick={() => openFlow(g.entryId)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-bold"
                  >
                    Open
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

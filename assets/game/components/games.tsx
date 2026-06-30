// Games view: list/edit saved games (ordered template levels) + the flow-view
// graph overlay. Moved out of the page (stage 4). Pure ops live in @/game/games;
// persistence (localStorage) in @/game/gamesStore.
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Game, addTemplate as addGameTemplate, createGame, deleteGame as deleteGameFromList, levelCount, levelTemplate, removeTemplate as removeGameTemplate, renameGame, reorderTemplate as reorderGameTemplate, upsertGame } from '@/game/games'
import { loadGames, saveGames } from '@/game/gamesStore'
import { type Connector, type TemplateListItem } from '@/lib/api'

// ── GAMES VIEW ───────────────────────────────────────────────────────────────
// A Game is an ORDERED list of templates presented as levels (see docs/games-flows.md):
// index 0 = level 1. This overlay lists saved games and, per game, an editor to set the
// level sequence — add templates in order, reorder (up/down), remove, jump into any level.
// Pure ops live in @/game/games; persistence (localStorage v1) in @/game/gamesStore.

/** One level row in the game editor: "Level N: <template name>" + reorder / remove / play. */
export function GameLevelRow({
  level, name, isFirst, isLast, onUp, onDown, onRemove, onPlay,
}: {
  level: number
  name: string
  isFirst: boolean
  isLast: boolean
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onPlay: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-gray-800 px-2 py-1.5 text-xs">
      <span className="shrink-0 rounded bg-indigo-700 px-2 py-0.5 font-bold text-white">Level {level}</span>
      <span className="flex-1 truncate text-gray-200">{name}</span>
      <button onClick={onPlay} aria-label={`Go to level ${level}`} title="Go to this level" className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 font-bold text-white hover:bg-emerald-600">▶</button>
      <button onClick={onUp} disabled={isFirst} aria-label={`Move level ${level} up`} className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600 disabled:opacity-30">▲</button>
      <button onClick={onDown} disabled={isLast} aria-label={`Move level ${level} down`} className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600 disabled:opacity-30">▼</button>
      <button onClick={onRemove} aria-label={`Remove level ${level}`} className="shrink-0 rounded px-1.5 py-0.5 text-red-400 hover:text-red-300">✕</button>
    </div>
  )
}

/** Editor for ONE game: rename, add templates (in order), reorder, remove, go-to-level-N. */
export function GameEditor({
  game, savedTemplates, onChange, onPlayLevel, onBack,
}: {
  game: Game
  savedTemplates: TemplateListItem[]
  onChange: (game: Game) => void
  onPlayLevel: (templateId: string) => void
  onBack: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const nameOf = (id: string) => savedTemplates.find(t => t.id === id)?.name ?? '(missing template)'
  const levels = game.templateIds

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">← Games</button>
        <input
          value={game.name}
          onChange={e => onChange(renameGame(game, e.target.value))}
          aria-label="Game name"
          placeholder="Game name…"
          className="flex-1 rounded bg-gray-800 px-3 py-1.5 text-sm text-white"
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-300">Levels ({levels.length})</h4>
          <div className="relative">
            <button onClick={() => setPickerOpen(v => !v)} aria-expanded={pickerOpen} className="rounded bg-indigo-700 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-600">＋ Add template</button>
            {pickerOpen && (
              <div className="absolute right-0 z-10 mt-1 max-h-64 w-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl">
                {savedTemplates.length === 0 && <p className="text-[10px] text-gray-500">No saved templates to add.</p>}
                {savedTemplates.map(t => (
                  <button key={t.id} onClick={() => { onChange(addGameTemplate(game, t.id)); setPickerOpen(false) }} className="block w-full truncate rounded bg-gray-800 px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-700">{t.name}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {levels.length === 0 && (
          <p className="rounded border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">No levels yet — add templates in the order you want to play them.</p>
        )}

        <div className="space-y-1.5">
          {levels.map((id, i) => (
            <GameLevelRow
              key={`${id}-${i}`}
              level={i + 1}
              name={nameOf(id)}
              isFirst={i === 0}
              isLast={i === levels.length - 1}
              onUp={() => onChange(reorderGameTemplate(game, i, i - 1))}
              onDown={() => onChange(reorderGameTemplate(game, i, i + 1))}
              onRemove={() => onChange(removeGameTemplate(game, i))}
              onPlay={() => onPlayLevel(id)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/** The Games view: a list of saved games (▶ Play = level 1) + an inline game editor. */
export function GamesViewOverlay({
  savedTemplates, onPlayLevel, onClose,
}: {
  savedTemplates: TemplateListItem[]
  onPlayLevel: (templateId: string) => void
  onClose: () => void
}) {
  const [games, setGames] = useState<Game[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  // Load once on open; persist (state + localStorage) on every change so it round-trips.
  useEffect(() => { setGames(loadGames()) }, [])
  const persist = useCallback((next: Game[]) => { setGames(next); saveGames(next) }, [])

  const editing = editingId ? games.find(g => g.id === editingId) ?? null : null
  const updateGame = (g: Game) => persist(upsertGame(games, g))
  const nameOf = (id: string) => savedTemplates.find(t => t.id === id)?.name ?? '(missing template)'

  const handleNew = () => {
    const g = createGame('New game')
    persist(upsertGame(games, g))
    setEditingId(g.id)
  }
  const handleDelete = (id: string) => {
    persist(deleteGameFromList(games, id))
    if (editingId === id) setEditingId(null)
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0a0a12]/95 font-mono text-white backdrop-blur-sm">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold uppercase tracking-widest text-indigo-300">{editing ? 'Game Editor' : 'Games'}</h2>
          <button onClick={onClose} aria-label="Exit games" className="rounded bg-red-700 px-3 py-1.5 text-xs font-bold hover:bg-red-600">⨯ Exit</button>
        </header>

        {editing ? (
          <GameEditor
            game={editing}
            savedTemplates={savedTemplates}
            onChange={updateGame}
            onPlayLevel={onPlayLevel}
            onBack={() => setEditingId(null)}
          />
        ) : (
          <div className="space-y-3">
            <button onClick={handleNew} className="w-full rounded-lg border border-dashed border-indigo-500/40 bg-indigo-900/20 px-4 py-3 text-sm font-bold text-indigo-200 hover:bg-indigo-900/40">＋ New Game</button>

            {games.length === 0 && (
              <p className="rounded-lg border border-white/10 bg-black/40 px-4 py-10 text-center text-sm text-gray-400">No games yet. Create one to group templates into a playable, ordered flow (level 1, 2, 3 …).</p>
            )}

            {games.map(g => {
              const first = levelTemplate(g, 1)
              const count = levelCount(g)
              return (
                <div key={g.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{g.name}</p>
                    <p className="truncate text-xs text-gray-400">{count} {count === 1 ? 'level' : 'levels'}{first ? ` · starts at ${nameOf(first)}` : ''}</p>
                  </div>
                  <button
                    onClick={() => first && onPlayLevel(first)}
                    disabled={!first}
                    aria-label={`Play ${g.name}`}
                    className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500"
                  >
                    ▶ Play
                  </button>
                  <button onClick={() => setEditingId(g.id)} aria-label={`Edit ${g.name}`} className="shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">Edit</button>
                  <button onClick={() => handleDelete(g.id)} aria-label={`Delete ${g.name}`} className="shrink-0 rounded px-2 py-1.5 text-red-400 hover:text-red-300">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export const NODE_WIDTH = 160
export const NODE_HEIGHT = 80

// Flow View Overlay Component - shows current template's connections
export function FlowViewOverlay({
  currentTemplate,
  connectors,
  allTemplates,
  onSelectTemplate,
}: {
  currentTemplate: { id: string; name: string } | null
  connectors: Connector[]
  allTemplates: TemplateListItem[]
  onSelectTemplate: (id: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Lay EVERY saved template (+ the current one) out in a circle — the full level
  // graph, not just the current room's neighbours. x/y are node centres; each node
  // carries its own connectors (the current room's come from the live `connectors`
  // prop, since it may have unsaved edits). Shared by render + click hit-testing.
  const layoutNodes = useCallback(
    (w: number, h: number) => {
      const base = allTemplates.map(t => ({ id: t.id, name: t.name, connectors: (t.connectors as Connector[]) || [] }))
      if (currentTemplate && !base.some(t => t.id === currentTemplate.id)) {
        base.push({ id: currentTemplate.id, name: currentTemplate.name, connectors })
      }
      const radius = Math.min(w, h) * 0.32
      const single = base.length <= 1
      return base.map((t, i) => {
        const angle = (i / Math.max(1, base.length)) * Math.PI * 2 - Math.PI / 2
        return {
          id: t.id,
          name: t.name,
          connectors: t.id === currentTemplate?.id ? connectors : t.connectors,
          x: single ? w / 2 : w / 2 + Math.cos(angle) * radius,
          y: single ? h / 2 : h / 2 + Math.sin(angle) * radius,
        }
      })
    },
    [currentTemplate, connectors, allTemplates],
  )

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    // Clear with dark space background
    ctx.fillStyle = '#0a0a12'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Subtle star field
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    for (let i = 0; i < 50; i++) {
      const x = (Math.sin(i * 123.456) * 0.5 + 0.5) * canvas.width
      const y = (Math.cos(i * 78.9) * 0.5 + 0.5) * canvas.height
      ctx.beginPath()
      ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // The FULL level graph: every template is a node, every connector an edge.
    const nodes = layoutNodes(canvas.width, canvas.height)
    const nodeOf = (id: string) => nodes.find(n => n.id === id)

    // Edges — one arrowed, labelled link per connector, between its two nodes.
    for (const node of nodes) {
      for (const connector of node.connectors) {
        const target = nodeOf(connector.targetTemplateId)
        if (!target) continue
        const color = connector.interaction === 'walk' ? '#aa66ff' : connector.interaction === 'interact' ? '#66aaff' : '#ffaa66'
        const gradient = ctx.createLinearGradient(node.x, node.y, target.x, target.y)
        gradient.addColorStop(0, color)
        gradient.addColorStop(1, color + '88')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(node.x, node.y)
        ctx.lineTo(target.x, target.y)
        ctx.stroke()

        const angle = Math.atan2(target.y - node.y, target.x - node.x)
        const arrowDist = Math.hypot(target.x - node.x, target.y - node.y) - NODE_WIDTH / 2 - 8
        const arrowX = node.x + Math.cos(angle) * arrowDist
        const arrowY = node.y + Math.sin(angle) * arrowDist
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(arrowX + Math.cos(angle) * 12, arrowY + Math.sin(angle) * 12)
        ctx.lineTo(arrowX + Math.cos(angle - 0.4) * -8, arrowY + Math.sin(angle - 0.4) * -8)
        ctx.lineTo(arrowX + Math.cos(angle + 0.4) * -8, arrowY + Math.sin(angle + 0.4) * -8)
        ctx.closePath()
        ctx.fill()

        ctx.font = 'bold 11px monospace'
        ctx.fillStyle = '#fff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(connector.interaction, (node.x + target.x) / 2, (node.y + target.y) / 2 - 10)
      }
    }

    // Nodes — the current room glows gold; the rest are blue boxes.
    for (const node of nodes) {
      const isCurrent = node.id === currentTemplate.id
      ctx.fillStyle = isCurrent ? '#2a1a3a' : '#16213a'
      ctx.beginPath()
      ctx.roundRect(node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT, 10)
      ctx.fill()
      if (isCurrent) {
        ctx.shadowColor = '#ffaa00'
        ctx.shadowBlur = 20
      }
      ctx.strokeStyle = isCurrent ? '#ffaa00' : '#5a7fd0'
      ctx.lineWidth = isCurrent ? 3 : 2
      ctx.stroke()
      ctx.shadowBlur = 0

      ctx.fillStyle = isCurrent ? '#ffdd00' : '#ffffff'
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.name.length > 13 ? node.name.slice(0, 12) + '…' : node.name, node.x, node.y - 4)
      ctx.fillStyle = '#888'
      ctx.font = '10px monospace'
      ctx.fillText(`${node.connectors.length} link${node.connectors.length === 1 ? '' : 's'}`, node.x, node.y + 13)
    }

    // Legend
    ctx.fillStyle = '#666'
    ctx.font = '11px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Click a room to open it · arrows = connectors', 20, canvas.height - 20)

    if (nodes.length <= 1) {
      ctx.fillStyle = '#666'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Save more templates + add connectors to see the graph', centerX, centerY + NODE_HEIGHT)
    }
  }, [currentTemplate, layoutNodes])

  useEffect(() => {
    render()
    window.addEventListener('resize', render)
    return () => window.removeEventListener('resize', render)
  }, [render])

  const handleClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Hit-test against the same full-graph layout the render uses. Clicking any room
    // (other than the current one) opens it.
    for (const node of layoutNodes(canvas.width, canvas.height)) {
      if (node.id === currentTemplate.id) continue
      if (x >= node.x - NODE_WIDTH / 2 && x <= node.x + NODE_WIDTH / 2 && y >= node.y - NODE_HEIGHT / 2 && y <= node.y + NODE_HEIGHT / 2) {
        onSelectTemplate(node.id)
        return
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 cursor-pointer"
      onClick={handleClick}
    />
  )
}

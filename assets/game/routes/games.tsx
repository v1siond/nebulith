import { useEffect, useState } from 'react'
import { useRouter } from '@/lib/router'
import { ROUTES } from '@/lib/routes'
import { GameEngineLayout } from '@/components/GameEngineLayout'
import { listGames, createGame, deleteGame, listArtStyles, type ArtStyle, type Game } from '@/lib/api'
import { nextGameName } from '@/game/autoNaming'
import { useConfirm } from '@/components/useConfirm'
import { Modal } from '@/components/modals'

/**
 * GAMES gallery, the app is scoped to games now (templates are a reusable resource). Games are PERSISTED
 * in the Elixir backend (a game = a named flow of templates). Open loads the game's editor at its
 * last-watched template; ▶ Play enters that level in play mode. Same nebulith layout as before.
 */
export default function GamesPage() {
  const router = useRouter()
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const { confirm, dialog: confirmDialog } = useConfirm()
  // THE ART STYLES, from the backend. A style is a `tilesets` row, so the picker is served rather than
  // written here: a list of two names in this file would be wrong the day a third style is added.
  const [styles, setStyles] = useState<ArtStyle[]>([])
  const [picking, setPicking] = useState(false)

  const load = () => {
    listGames()
      .then((g) => { setGames(g); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { listArtStyles().then(setStyles).catch(() => setStyles([])) }, [])

  // The /games/[id] route resolves the start template (last-watched, else first) itself, just pass the id.
  const openGame = (g: Game) => router.push(ROUTES.game(g.id))
  const playGame = (g: Game) => router.push(`${ROUTES.game(g.id)}?play=1`)
  // CREATING A GAME ASKS ONE THING: which art style it is made in.
  //
  // `docs/SPEC.md` phase 1 REWIRE: *"Creating a game asks for its name and its art style."* The NAME is
  // not asked, deliberately and on his instruction: *"that's the worst UX ever … just assign a random
  // name … and redirect user to the editor right away"* (see `components/useConfirm.tsx`). That was about
  // the name. The style is the other half and it is a real choice, because it is what the whole game is
  // drawn in, and a map may still override it later.
  //
  // With one style served there is nothing to choose, so it does not ask: a dialogue with one button is
  // a worse version of no dialogue.
  const handleNew = async () => {
    if (styles.length < 2) return createWith(styles[0]?.id)
    setPicking(true)
  }

  const createWith = async (defaultTilesetId?: number) => {
    setPicking(false)
    const g = await createGame({ name: nextGameName(games), defaultTilesetId })
    router.push(ROUTES.game(g.id))
  }
  const handleDelete = async (g: Game) => {
    const ok = await confirm({
      title: 'Delete game',
      body: `Delete "${g.name}"? Its levels are kept, only the game that groups them goes.`,
      confirmLabel: 'Delete game',
    })
    if (!ok) return
    await deleteGame(g.id)
    load()
  }

  return (
    <GameEngineLayout active="games">
      {confirmDialog}
      {picking && (
        <Modal title="What is this game drawn in?" accent="cyan" onClose={() => setPicking(false)}>
          <div className="grid grid-cols-2 gap-2">
            {styles.map(style => (
              <button
                key={style.id}
                onClick={() => createWith(style.id)}
                aria-label={`Art style ${style.key}`}
                data-art-style={style.key}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-3 text-left font-bold hover:bg-gray-700 hover:ring-2 hover:ring-green-500"
              >
                <span aria-hidden className="text-2xl">{style.icon}</span>
                <span>{style.name}</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">
            Every map in the game starts in this style. A map can be switched to another one at any time.
          </p>
        </Modal>
      )}
      <div className="bg-gray-800 rounded-lg p-4 mb-6 flex items-center justify-between">
        <div>
          <span className="text-gray-400 text-sm">Games:</span>
          <span className="ml-2 text-xl font-bold">{games.length}</span>
        </div>
        {/* ONE create button on the page, never two, while the gallery is empty the call to action
            IS the empty state below, so this one stands down. */}
        {games.length > 0 && (
          <button
            onClick={handleNew}
            className="px-6 py-3 rounded-lg font-bold text-lg bg-green-600 hover:bg-green-500 hover:scale-105 transition-all"
          >
            + New Game
          </button>
        )}
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

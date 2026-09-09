/**
 * THE GAMES OVERLAY READS THE BACKEND (§3.1 — a P0).
 *
 * Before: the route read `/api/games` while this overlay read localStorage, so opening ⋯ More → Games
 * from *inside* a backend game announced "No games yet". Two Game types, two id schemes, one menu label.
 *
 * The overlay now has exactly one source. These tests drive the real component against a stubbed API and
 * assert the behaviour that P0 was made of: what it lists, that edits reach the server, and that a server
 * it cannot reach is SAID rather than rendered as an empty gallery — the failure that made the old bug
 * invisible.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { GamesViewOverlay } from '@/components/game/games'
import type { Game } from '@/lib/api'

jest.mock('@/lib/api', () => ({
  listGames: jest.fn(),
  createGame: jest.fn(),
  updateGame: jest.fn(),
  deleteGame: jest.fn(),
}))

import { createGame, deleteGame, listGames, updateGame } from '@/lib/api'

const asMock = <T,>(fn: T) => fn as unknown as jest.Mock

const game = (over: Partial<Game> = {}): Game => ({
  id: 'uuid-1',
  name: 'Boss',
  description: null,
  lastTemplateId: null,
  templateIds: ['t1', 't2'],
  ...over,
})

const TEMPLATES = [
  { id: 't1', name: 'village' },
  { id: 't2', name: 'cave' },
] as unknown as Parameters<typeof GamesViewOverlay>[0]['savedTemplates']

const openOverlay = () =>
  render(<GamesViewOverlay savedTemplates={TEMPLATES} onPlayLevel={jest.fn()} onClose={jest.fn()} />)

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  asMock(listGames).mockResolvedValue([])
  asMock(createGame).mockImplementation(async (input: { name: string }) => game({ id: 'new-uuid', name: input.name, templateIds: [] }))
  asMock(updateGame).mockResolvedValue(game())
  asMock(deleteGame).mockResolvedValue(undefined)
})

describe('the overlay lists the backend\'s games', () => {
  it('shows a game the server returns, with its level count', async () => {
    asMock(listGames).mockResolvedValue([game()])
    openOverlay()
    expect(await screen.findByText('Boss')).toBeInTheDocument()
    expect(screen.getByText(/2 levels/)).toBeInTheDocument()
  })

  it('says the gallery is empty only when the SERVER says so', async () => {
    openOverlay()
    expect(await screen.findByText(/No games yet/)).toBeInTheDocument()
  })

  it('reports an unreachable server instead of an empty gallery — the P0 was invisible for exactly this reason', async () => {
    asMock(listGames).mockRejectedValue(new Error('offline'))
    openOverlay()
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    expect(screen.queryByText(/No games yet/)).not.toBeInTheDocument()
  })
})

describe('edits go to the backend', () => {
  it('creates a game with a generated name and opens its editor', async () => {
    openOverlay()
    await screen.findByText(/No games yet/)
    fireEvent.click(screen.getByRole('button', { name: /New Game/ }))
    await waitFor(() => expect(createGame).toHaveBeenCalledWith({ name: 'Game 1' }))
    expect(await screen.findByText('Game Editor')).toBeInTheDocument()
  })

  it('deletes through the API and drops the row', async () => {
    asMock(listGames).mockResolvedValue([game()])
    openOverlay()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Boss' }))
    await waitFor(() => expect(deleteGame).toHaveBeenCalledWith('uuid-1'))
    await waitFor(() => expect(screen.queryByText('Boss')).not.toBeInTheDocument())
  })

  it('PUTs a reordered level list', async () => {
    asMock(listGames).mockResolvedValue([game()])
    openOverlay()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Boss' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Move level 2 up' }))
    await waitFor(() =>
      expect(updateGame).toHaveBeenCalledWith('uuid-1', expect.objectContaining({ templateIds: ['t2', 't1'] })),
    )
  })

  it('PUTs a renamed game', async () => {
    asMock(listGames).mockResolvedValue([game()])
    openOverlay()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Boss' }))
    fireEvent.change(screen.getByLabelText('Game name'), { target: { value: 'Boss Rush' } })
    await waitFor(() =>
      expect(updateGame).toHaveBeenCalledWith('uuid-1', expect.objectContaining({ name: 'Boss Rush' })),
    )
  })
})

describe('the retired localStorage games are carried across, not dropped', () => {
  // jest.setup.ts replaces window.localStorage with a stub whose setItem stores NOTHING, so the stored
  // payload has to be driven through getItem directly — writing a key here would silently read back empty
  // and the test would pass without ever exercising the import.
  const storedRaw = (raw: string | null) => asMock(window.localStorage.getItem).mockReturnValue(raw)

  it('imports what the browser still holds, then clears the key', async () => {
    storedRaw(JSON.stringify([{ id: 'game_old', name: 'Legacy', templateIds: ['t1'] }]))
    openOverlay()
    await waitFor(() => expect(createGame).toHaveBeenCalledWith({ name: 'Legacy', templateIds: ['t1'] }))
    await waitFor(() => expect(window.localStorage.removeItem).toHaveBeenCalledWith('nebulith:games'))
  })

  it('imports nothing, and clears nothing, when the browser holds no key', async () => {
    storedRaw(null)
    openOverlay()
    await screen.findByText(/No games yet/)
    expect(createGame).not.toHaveBeenCalled()
    expect(window.localStorage.removeItem).not.toHaveBeenCalled()
  })

  it('KEEPS the key when the import cannot reach the server — a half-import must not destroy the source', async () => {
    storedRaw(JSON.stringify([{ id: 'g', name: 'Legacy', templateIds: [] }]))
    asMock(createGame).mockRejectedValue(new Error('offline'))
    asMock(listGames).mockResolvedValue([game()])
    openOverlay()
    expect(await screen.findByText('Boss')).toBeInTheDocument() // the real games still render
    expect(window.localStorage.removeItem).not.toHaveBeenCalled()
  })
})

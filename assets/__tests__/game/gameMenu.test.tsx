/**
 * THE 🎮 GAME MENU (§4.4) — the game's identity, and the ways out of it.
 *
 * §3.2 measured that inside `/games/[id]` "the only identity shown anywhere is the template name" — you
 * could not tell which GAME you were editing. The stepper fixed "which level"; this fixes "which game", and
 * gathers the actions that are about the whole product rather than the map in front of you.
 *
 * §4.4 also asks for one guarantee with teeth: **"← All games confirms before leaving with unsaved
 * changes"** — §3.15 lists silently losing an unsaved map as one of its inconsistencies.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GameMenu } from '@/components/game/gameMenu'

const setup = (over: Partial<Parameters<typeof GameMenu>[0]> = {}) => {
  const props = {
    gameName: 'Boss',
    wouldLoseWork: false,
    confirmLeave: jest.fn().mockResolvedValue(true),
    onRename: jest.fn(),
    onManageLevels: jest.fn(),
    onFlow: jest.fn(),
    onExport: jest.fn(),
    onAllGames: jest.fn(),
    ...over,
  }
  render(<GameMenu {...props} />)
  return props
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /game menu/i }))

describe('it says which GAME you are in', () => {
  it('shows the game name in the bar', () => {
    setup()
    expect(screen.getByRole('button', { name: /game menu/i })).toHaveTextContent('Boss')
  })

  it('renders nothing when the editor is not inside a game — /templates has no game to name', () => {
    const { container } = render(
      <GameMenu gameName={null} wouldLoseWork={false} confirmLeave={jest.fn()}
        onRename={jest.fn()} onManageLevels={jest.fn()} onFlow={jest.fn()} onExport={jest.fn()} onAllGames={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the menu items §4.4 draws', () => {
  it.each([
    [/rename game/i, 'onRename'],
    [/manage levels/i, 'onManageLevels'],
    [/level graph/i, 'onFlow'],
    [/export this level/i, 'onExport'],
  ] as const)('%s calls its handler', async (label, handler) => {
    const props = setup()
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(props[handler]).toHaveBeenCalled()
  })

  it('closes after picking an item', async () => {
    setup()
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: /rename game/i }))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

describe('← All games never silently loses a map (§4.4, §3.15)', () => {
  it('leaves straight away when there is nothing unsaved', async () => {
    const props = setup({ wouldLoseWork: false })
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: /all games/i }))
    await waitFor(() => expect(props.onAllGames).toHaveBeenCalled())
    expect(props.confirmLeave).not.toHaveBeenCalled()
  })

  it('ASKS when the map has unsaved changes, and leaves once accepted', async () => {
    const confirmLeave = jest.fn().mockResolvedValue(true)
    const props = setup({ wouldLoseWork: true, confirmLeave })
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: /all games/i }))
    await waitFor(() => expect(confirmLeave).toHaveBeenCalled())
    await waitFor(() => expect(props.onAllGames).toHaveBeenCalled())
  })

  it('STAYS when the user declines', async () => {
    const confirmLeave = jest.fn().mockResolvedValue(false)
    const props = setup({ wouldLoseWork: true, confirmLeave })
    open()
    fireEvent.click(await screen.findByRole('menuitem', { name: /all games/i }))
    await waitFor(() => expect(confirmLeave).toHaveBeenCalled())
    expect(props.onAllGames).not.toHaveBeenCalled()
  })
})

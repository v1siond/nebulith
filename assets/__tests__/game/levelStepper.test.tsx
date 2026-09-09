/**
 * THE LEVEL STEPPER — §3.2, the last of the four P0s (§4.4, Week 3).
 *
 * Measured in the inventory: inside `/games/[id]` there is **no game name anywhere**, no list of the game's
 * levels, no "level 2 of 5", and **Load (n) lists every saved template rather than this game's**. The
 * `templateIds` are loaded and held in state — and then used only to append to on save. They are never
 * rendered. A player-facing product whose levels are invisible from inside the level editor.
 *
 * §4.4 draws the fix: `◀ Level 3 of 5 · village ▾ ▶`. §5.3 rates it medium risk for one reason — stepping
 * away from unsaved edits would lose them — so the stepper is wired to the dirty-tracker and ASKS first.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LevelStepper } from '@/components/game/levelStepper'

const LEVELS = [
  { id: 't1', name: 'forest-entrance' },
  { id: 't2', name: 'cave' },
  { id: 't3', name: 'village' },
]

const setup = (over: Partial<Parameters<typeof LevelStepper>[0]> = {}) => {
  const onGo = jest.fn().mockResolvedValue(undefined)
  const props = {
    levels: LEVELS,
    currentId: 't2',
    wouldLoseWork: false,
    onGo,
    confirmLeave: jest.fn().mockResolvedValue(true),
    ...over,
  }
  render(<LevelStepper {...props} />)
  return { onGo, ...props }
}

describe('it says where you are — the thing the editor never told you', () => {
  it('names the level and its position in the game', () => {
    setup()
    expect(screen.getByText(/Level 2 of 3/)).toBeInTheDocument()
    expect(screen.getByText(/cave/)).toBeInTheDocument()
  })

  it('renders nothing at all when the game has no levels — an empty stepper is noise', () => {
    const { container } = render(
      <LevelStepper levels={[]} currentId={null} wouldLoseWork={false} onGo={jest.fn()} confirmLeave={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('handles a template that is open but not part of this game', () => {
    setup({ currentId: 'stranger' })
    expect(screen.getByText(/Not in this game/)).toBeInTheDocument()
  })
})

describe('stepping', () => {
  it('goes to the previous level', async () => {
    const { onGo } = setup()
    fireEvent.click(screen.getByRole('button', { name: /previous level/i }))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('t1'))
  })

  it('goes to the next level', async () => {
    const { onGo } = setup()
    fireEvent.click(screen.getByRole('button', { name: /next level/i }))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('t3'))
  })

  it('does not wrap around at the ends — the arrows disable instead', () => {
    setup({ currentId: 't1' })
    expect(screen.getByRole('button', { name: /previous level/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next level/i })).toBeEnabled()
  })

  it('disables the forward arrow on the last level', () => {
    setup({ currentId: 't3' })
    expect(screen.getByRole('button', { name: /next level/i })).toBeDisabled()
  })
})

describe('it never throws away unsaved work (§5.3 — the reason this needed a dirty-tracker)', () => {
  it('asks before leaving a dirty map, and goes when the user accepts', async () => {
    const confirmLeave = jest.fn().mockResolvedValue(true)
    const { onGo } = setup({ wouldLoseWork: true, confirmLeave })
    fireEvent.click(screen.getByRole('button', { name: /next level/i }))
    await waitFor(() => expect(confirmLeave).toHaveBeenCalled())
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('t3'))
  })

  it('STAYS PUT when the user declines', async () => {
    const confirmLeave = jest.fn().mockResolvedValue(false)
    const { onGo } = setup({ wouldLoseWork: true, confirmLeave })
    fireEvent.click(screen.getByRole('button', { name: /next level/i }))
    await waitFor(() => expect(confirmLeave).toHaveBeenCalled())
    expect(onGo).not.toHaveBeenCalled()
  })

  it('does NOT ask when the map is clean — a prompt with nothing at stake trains people to click through', async () => {
    const confirmLeave = jest.fn()
    const { onGo } = setup({ wouldLoseWork: false, confirmLeave })
    fireEvent.click(screen.getByRole('button', { name: /next level/i }))
    await waitFor(() => expect(onGo).toHaveBeenCalled())
    expect(confirmLeave).not.toHaveBeenCalled()
  })
})

describe('the level list', () => {
  it('lists this game\'s levels in order, numbered', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /choose a level/i }))
    const list = await screen.findByRole('listbox', { name: /levels/i })
    expect(list).toHaveTextContent('1')
    expect(list).toHaveTextContent('forest-entrance')
    expect(list).toHaveTextContent('3')
    expect(list).toHaveTextContent('village')
  })

  it('jumps to a picked level', async () => {
    const { onGo } = setup()
    fireEvent.click(screen.getByRole('button', { name: /choose a level/i }))
    fireEvent.click(await screen.findByRole('option', { name: /village/i }))
    await waitFor(() => expect(onGo).toHaveBeenCalledWith('t3'))
  })

  it('marks the level you are on', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /choose a level/i }))
    expect(await screen.findByRole('option', { name: /cave/i })).toHaveAttribute('aria-selected', 'true')
  })
})

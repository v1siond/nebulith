/**
 * THE ⚑ RULES PANEL (§4.8, Week 6) — the component.
 *
 * The model tests pin the phrasing; these pin the two behaviours §4.8 asks for that a list alone does not
 * give you:
 *
 *   1. the connector PLACING MODE is stated on screen with a way out (§3.9 — it used to be invisible, and
 *      the instruction that did exist told you to switch to Top view, which had stopped being true), and
 *   2. an unavailable add-action shows its REASON rather than vanishing (§3.8's silent dead end).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { RulesWorkspace, type RulesWorkspaceProps } from '@/components/game/rulesWorkspace'

const base: RulesWorkspaceProps = {
  tab: 'triggers',
  onTab: jest.fn(),
  triggers: [
    { id: 't1', subject: 'Cell', where: '(12, 8)', when: 'when entered', does: 'show "message"' },
    { id: 't2', subject: 'Guard', where: '(24, 9)', when: 'when defeated', does: 'give key' },
  ],
  triggerBlockedReason: null,
  onAddTrigger: jest.fn(),
  onOpenTrigger: jest.fn(),
  connections: [{ id: 'c1', where: '(5,5) +3 cells', target: 'cave', how: 'walk onto it' }],
  placingConnection: false,
  onStopPlacing: jest.fn(),
  onNewConnection: jest.fn(),
  onOpenConnection: jest.fn(),
  quests: [
    { id: 'q1', title: 'Cull the goblins', giver: 'Elder', state: 'active', progress: '2/5' },
    { id: 'q2', title: 'Find the healer', giver: null, state: 'available', progress: null },
  ],
  questBlockedReason: null,
  onNewQuest: jest.fn(),
  onOpenQuest: jest.fn(),
}

const setup = (over: Partial<RulesWorkspaceProps> = {}) => {
  const props = { ...base, ...over }
  render(<RulesWorkspace {...props} />)
  return props
}

describe('three tabs, one workspace (§4.8)', () => {
  it('offers Triggers, Connections and Quests', () => {
    setup()
    for (const name of ['Triggers', 'Connections', 'Quests']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('marks the open tab', () => {
    setup({ tab: 'quests' })
    expect(screen.getByRole('tab', { name: 'Quests' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Triggers' })).toHaveAttribute('aria-selected', 'false')
  })

  it('reports a tab change instead of owning it — the caller persists which tab you were on', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('tab', { name: 'Connections' }))
    expect(props.onTab).toHaveBeenCalledWith('connections')
  })

  it('shows only the open tab\'s content', () => {
    setup({ tab: 'triggers' })
    expect(screen.getByText(/when entered/)).toBeInTheDocument()
    expect(screen.queryByText('cave')).not.toBeInTheDocument()
  })
})

describe('TRIGGERS — the rules a level already has', () => {
  it('lists cell rules and character rules together', () => {
    setup()
    expect(screen.getByText('Cell')).toBeInTheDocument()
    expect(screen.getByText('Guard')).toBeInTheDocument()
    expect(screen.getByText('when defeated')).toBeInTheDocument()
  })

  it('opens the one you click', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /Cell \(12, 8\)/ }))
    expect(props.onOpenTrigger).toHaveBeenCalledWith('t1')
  })

  it('explains an empty level rather than showing a blank list', () => {
    setup({ triggers: [] })
    expect(screen.getByText(/nothing happens on this level yet/i)).toBeInTheDocument()
  })

  it('states WHY a trigger cannot be added, and disables the action (§3.8)', () => {
    setup({ triggerBlockedReason: 'Select a cell or a character first.' })
    expect(screen.getByText(/select a cell or a character first/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add a trigger/ })).toBeDisabled()
  })

  it('adds when there IS a selection', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /Add a trigger/ }))
    expect(props.onAddTrigger).toHaveBeenCalled()
  })
})

describe('CONNECTIONS — the placing mode is STATED (§3.9)', () => {
  it('says nothing about placing while the mode is off', () => {
    setup({ tab: 'connections' })
    expect(screen.queryByText(/placing mode on/i)).not.toBeInTheDocument()
  })

  it('announces the mode and how to leave it while it is on', () => {
    const props = setup({ tab: 'connections', placingConnection: true })
    expect(screen.getByText(/placing mode on/i)).toBeInTheDocument()
    expect(screen.getByText(/click a cell on the map/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(props.onStopPlacing).toHaveBeenCalled()
  })

  it('carries NO instruction to switch view — the stale "Top view" text is gone', () => {
    setup({ tab: 'connections', placingConnection: true })
    expect(screen.queryByText(/top view/i)).not.toBeInTheDocument()
  })

  it('lists each door with where it is, where it goes and how it is used', () => {
    setup({ tab: 'connections' })
    expect(screen.getByText('(5,5) +3 cells')).toBeInTheDocument()
    expect(screen.getByText('cave')).toBeInTheDocument()
    expect(screen.getByText('walk onto it')).toBeInTheDocument()
  })

  it('starts a new connection', () => {
    const props = setup({ tab: 'connections' })
    fireEvent.click(screen.getByRole('button', { name: /New connection/ }))
    expect(props.onNewConnection).toHaveBeenCalled()
  })
})

describe('QUESTS — first class, with its prerequisite said out loud (§3.8)', () => {
  it('lists giver, state and progress', () => {
    setup({ tab: 'quests' })
    expect(screen.getByText('Cull the goblins')).toBeInTheDocument()
    expect(screen.getByText(/giver: Elder/)).toBeInTheDocument()
    expect(screen.getByText('2/5')).toBeInTheDocument()
  })

  it('WARNS about a quest with no giver instead of leaving it blank', () => {
    setup({ tab: 'quests' })
    expect(screen.getByText(/no giver assigned/i)).toBeInTheDocument()
  })

  it('says a quest needs an NPC, rather than hiding the button (the silent dead end)', () => {
    setup({ tab: 'quests', questBlockedReason: 'A quest needs an NPC on this level to give it.' })
    expect(screen.getByRole('button', { name: /New quest/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New quest/ })).toBeDisabled()
    expect(screen.getByText(/needs an NPC on this level/i)).toBeInTheDocument()
  })

  it('creates one when the level has an NPC', () => {
    const props = setup({ tab: 'quests' })
    fireEvent.click(screen.getByRole('button', { name: /New quest/ }))
    expect(props.onNewQuest).toHaveBeenCalled()
  })
})

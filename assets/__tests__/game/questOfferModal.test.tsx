import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { acceptQuest } from '@/game/quests'
import type { Quest } from '@/game/types'
import { QuestGiveBody, QuestLogPanel } from '@/pages/personal-projects/game-engine/templates'
import { questAnchorScreenPos } from '@/game/runtime/quest'

// ───────────────────────────────────────────────────────────────────────────
// Quest UI (React DOM) — the offer modal body + the quest log panel.
//
// Mirrors the build-and-play style: we drive the REAL components and the REAL
// quest engine (acceptQuest), not mocks. The offer modal must show the quest
// title + a reward; Reject must leave the quest `available` (so it's re-askable);
// Accept must run the engine and flip it to `active`.
// ───────────────────────────────────────────────────────────────────────────

const makeQuest = (over: Partial<Quest> = {}): Quest => ({
  id: 'q-cull',
  giverId: 'elder',
  title: 'Cull the goblins',
  description: 'Slay 3 goblins across the dungeon.',
  objectives: [{ kind: 'kill', target: 'goblin', required: 3, current: 0, done: false, label: 'Slay goblin' }],
  rewards: [{ kind: 'xp', amount: 50 }],
  state: 'available',
  ...over,
})

// Wires the body exactly like the page does: Accept folds acceptQuest (→ active)
// and closes; Reject only closes, leaving the quest untouched (re-askable).
function OfferHarness() {
  const [quest, setQuest] = useState<Quest>(makeQuest)
  const [open, setOpen] = useState(true)
  return (
    <div>
      <span data-testid="state">{quest.state}</span>
      {open && (
        <QuestGiveBody
          quest={quest}
          onAccept={() => { setQuest(q => acceptQuest(q)); setOpen(false) }}
          onReject={() => setOpen(false)}
        />
      )}
    </div>
  )
}

describe('Quest offer modal (QuestGiveBody)', () => {
  it('shows the quest title and a reward', () => {
    render(<QuestGiveBody quest={makeQuest()} onAccept={() => {}} onReject={() => {}} />)
    expect(screen.getByText('Cull the goblins')).toBeInTheDocument()
    expect(screen.getByText(/\+50 xp/)).toBeInTheDocument()
  })

  it('Reject leaves the quest available (re-askable)', async () => {
    const user = userEvent.setup()
    render(<OfferHarness />)
    expect(screen.getByTestId('state')).toHaveTextContent('available')
    await user.click(screen.getByRole('button', { name: /reject/i }))
    expect(screen.getByTestId('state')).toHaveTextContent('available')
  })

  it('Accept transitions the quest to active', async () => {
    const user = userEvent.setup()
    render(<OfferHarness />)
    expect(screen.getByTestId('state')).toHaveTextContent('available')
    await user.click(screen.getByRole('button', { name: /accept/i }))
    expect(screen.getByTestId('state')).toHaveTextContent('active')
  })
})

describe('Quest log panel (QuestLogPanel)', () => {
  it('groups quests by state and lists their titles', () => {
    const quests: Quest[] = [
      makeQuest({ id: 'a', title: 'Open errand', state: 'available' }),
      makeQuest({ id: 'b', title: 'Live hunt', state: 'active' }),
      makeQuest({ id: 'c', title: 'Done deed', state: 'completed' }),
    ]
    render(<QuestLogPanel quests={quests} onClose={() => {}} />)
    expect(screen.getByText('Open errand')).toBeInTheDocument()
    expect(screen.getByText('Live hunt')).toBeInTheDocument()
    expect(screen.getByText('Done deed')).toBeInTheDocument()
    // grouped headings
    expect(screen.getByText(/available/i)).toBeInTheDocument()
    expect(screen.getByText(/active/i)).toBeInTheDocument()
    expect(screen.getByText(/completed/i)).toBeInTheDocument()
  })

  it('closes from the ✕ button', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    render(<QuestLogPanel quests={[makeQuest()]} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: /close quest log/i }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Quest modal anchor (questAnchorScreenPos)', () => {
  // The player stands at the centre of cell (5,5); cellSize 32, isoScale 1, no pan.
  const cam = {
    view: 'isometric' as const,
    cellSize: 32,
    isoScale: 1,
    player: { x: 5.5 * 32, z: 5.5 * 32 },
    camOffset: { x: 0, y: 0 },
    isoZoom: 1,
    topZoom: 1,
    w: 1200,
    h: 800,
  }

  it('anchors a giver on the player cell horizontally centred on screen', () => {
    const pos = questAnchorScreenPos(cam, 5, 5)
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeCloseTo(600) // w/2
  })

  it('falls back to centered (null) when the giver is far off-screen', () => {
    expect(questAnchorScreenPos(cam, 5000, 5000)).toBeNull()
  })
})

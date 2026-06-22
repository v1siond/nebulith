import {
  acceptQuest,
  isComplete,
  objectiveProgress,
  progress,
  recordEvent,
  turnIn,
  type QuestEvent,
} from '@/game/quests'
import type { Objective, ObjectiveKind, Quest, QuestState, Reward } from '@/game/types'

// ── factories ───────────────────────────────────────────────────────

function mkObjective(over: Partial<Objective> = {}): Objective {
  return {
    kind: 'kill',
    target: 'goblin',
    required: 1,
    current: 0,
    done: false,
    label: 'Slay goblins',
    ...over,
  }
}

function mkQuest(over: Partial<Quest> = {}): Quest {
  return {
    id: 'q1',
    giverId: 'npc-elder',
    title: 'Cull the Horde',
    description: 'The village is overrun.',
    objectives: [mkObjective()],
    rewards: [{ kind: 'xp', amount: 100 }],
    state: 'available',
    ...over,
  }
}

const KILL = (enemyType: string): QuestEvent => ({ kind: 'kill', enemyType })
const TRAVEL = (place: string): QuestEvent => ({ kind: 'travel', place })
const FIND = (npcId: string): QuestEvent => ({ kind: 'find', npcId })

describe('acceptQuest — available → active, guarded', () => {
  it('moves an available quest to active', () => {
    const quest = acceptQuest(mkQuest({ state: 'available' }))
    expect(quest.state).toBe('active')
  })

  it('does not mutate the input quest (immutability)', () => {
    const original = mkQuest({ state: 'available' })
    const accepted = acceptQuest(original)
    expect(original.state).toBe('available')
    expect(accepted).not.toBe(original)
  })

  it.each<QuestState>(['active', 'completed', 'turned_in'])(
    'is a no-op when the quest is %s (only available can be accepted)',
    (state) => {
      const quest = mkQuest({ state })
      const result = acceptQuest(quest)
      expect(result.state).toBe(state)
    },
  )
})

describe('recordEvent — kill objectives', () => {
  it('increments only the matching enemyType', () => {
    const quest = mkQuest({
      state: 'active',
      objectives: [
        mkObjective({ target: 'goblin', required: 3 }),
        mkObjective({ target: 'orc', required: 2, label: 'Slay orcs' }),
      ],
    })

    const after = recordEvent(quest, KILL('goblin'))

    expect(after.objectives[0].current).toBe(1)
    expect(after.objectives[1].current).toBe(0) // orc untouched
  })

  it('does not increment on a non-matching enemyType', () => {
    const quest = mkQuest({ state: 'active', objectives: [mkObjective({ required: 3 })] })
    const after = recordEvent(quest, KILL('dragon'))
    expect(after.objectives[0].current).toBe(0)
  })

  it('clamps current at required (over-killing never exceeds the goal)', () => {
    let quest = mkQuest({ state: 'active', objectives: [mkObjective({ required: 2 })] })
    quest = recordEvent(quest, KILL('goblin'))
    quest = recordEvent(quest, KILL('goblin'))
    quest = recordEvent(quest, KILL('goblin')) // one too many
    expect(quest.objectives[0].current).toBe(2)
  })

  it('marks the objective done when current reaches required', () => {
    let quest = mkQuest({ state: 'active', objectives: [mkObjective({ required: 2 })] })
    quest = recordEvent(quest, KILL('goblin'))
    expect(quest.objectives[0].done).toBe(false)
    quest = recordEvent(quest, KILL('goblin'))
    expect(quest.objectives[0].done).toBe(true)
  })

  it('does not mutate the input quest or its objectives', () => {
    const quest = mkQuest({ state: 'active', objectives: [mkObjective({ required: 3 })] })
    const after = recordEvent(quest, KILL('goblin'))
    expect(quest.objectives[0].current).toBe(0)
    expect(after).not.toBe(quest)
    expect(after.objectives[0]).not.toBe(quest.objectives[0])
  })

  it('ignores events when the quest is not active', () => {
    const quest = mkQuest({ state: 'available', objectives: [mkObjective({ required: 3 })] })
    const after = recordEvent(quest, KILL('goblin'))
    expect(after.objectives[0].current).toBe(0)
    expect(after.state).toBe('available')
  })
})

describe('recordEvent — travel and find objective kinds', () => {
  it('advances a travel objective on reaching the place', () => {
    const quest = mkQuest({
      state: 'active',
      objectives: [
        mkObjective({ kind: 'travel', target: 'temple', required: 1, label: 'Reach the temple' }),
      ],
    })
    const after = recordEvent(quest, TRAVEL('temple'))
    expect(after.objectives[0].current).toBe(1)
    expect(after.objectives[0].done).toBe(true)
  })

  it('does not advance travel on the wrong place', () => {
    const quest = mkQuest({
      state: 'active',
      objectives: [mkObjective({ kind: 'travel', target: 'temple', required: 1 })],
    })
    const after = recordEvent(quest, TRAVEL('forest'))
    expect(after.objectives[0].current).toBe(0)
  })

  it('advances a find objective on locating the npc', () => {
    const quest = mkQuest({
      state: 'active',
      objectives: [
        mkObjective({ kind: 'find', target: 'lost-mage', required: 1, label: 'Find the mage' }),
      ],
    })
    const after = recordEvent(quest, FIND('lost-mage'))
    expect(after.objectives[0].done).toBe(true)
  })

  it('does not cross-advance: a kill event never advances a travel objective', () => {
    const quest = mkQuest({
      state: 'active',
      // same target string, different kind — must not match
      objectives: [mkObjective({ kind: 'travel', target: 'goblin', required: 1 })],
    })
    const after = recordEvent(quest, KILL('goblin'))
    expect(after.objectives[0].current).toBe(0)
  })

  it('dispatches every ObjectiveKind through a single matcher table', () => {
    const cases: Array<{ kind: ObjectiveKind; event: QuestEvent }> = [
      { kind: 'kill', event: KILL('goblin') },
      { kind: 'travel', event: TRAVEL('temple') },
      { kind: 'find', event: FIND('mage') },
    ]
    const targetFor: Record<ObjectiveKind, string> = {
      kill: 'goblin',
      travel: 'temple',
      find: 'mage',
    }
    for (const { kind, event } of cases) {
      const quest = mkQuest({
        state: 'active',
        objectives: [mkObjective({ kind, target: targetFor[kind], required: 1 })],
      })
      const after = recordEvent(quest, event)
      expect(after.objectives[0].done).toBe(true)
    }
  })
})

describe('recordEvent — quest completion', () => {
  it('flips state to completed when ALL objectives are done', () => {
    let quest = mkQuest({
      state: 'active',
      objectives: [
        mkObjective({ target: 'goblin', required: 1 }),
        mkObjective({ kind: 'travel', target: 'temple', required: 1 }),
      ],
    })

    quest = recordEvent(quest, KILL('goblin'))
    expect(quest.state).toBe('active') // one objective still open

    quest = recordEvent(quest, TRAVEL('temple'))
    expect(quest.state).toBe('completed')
  })

  it('stays active while any objective is unfinished', () => {
    const quest = recordEvent(
      mkQuest({
        state: 'active',
        objectives: [
          mkObjective({ target: 'goblin', required: 2 }),
          mkObjective({ target: 'orc', required: 1 }),
        ],
      }),
      KILL('goblin'),
    )
    expect(quest.state).toBe('active')
  })
})

describe('isComplete', () => {
  it('is true only when every objective is done', () => {
    const done = mkQuest({
      objectives: [mkObjective({ done: true }), mkObjective({ target: 'orc', done: true })],
    })
    const mixed = mkQuest({
      objectives: [mkObjective({ done: true }), mkObjective({ target: 'orc', done: false })],
    })
    expect(isComplete(done)).toBe(true)
    expect(isComplete(mixed)).toBe(false)
  })

  it('is false for a quest with no objectives (nothing to complete)', () => {
    expect(isComplete(mkQuest({ objectives: [] }))).toBe(false)
  })
})

describe('objectiveProgress', () => {
  it('surfaces current / required / done for one objective', () => {
    const obj = mkObjective({ current: 2, required: 5, done: false })
    expect(objectiveProgress(obj)).toEqual({ current: 2, required: 5, done: false })
  })
})

describe('progress — completed/total/ratio for auto display', () => {
  it('reports the right counts and ratio ("3/5")', () => {
    const objectives: Objective[] = [
      mkObjective({ done: true }),
      mkObjective({ done: true }),
      mkObjective({ done: true }),
      mkObjective({ done: false }),
      mkObjective({ done: false }),
    ]
    expect(progress(mkQuest({ objectives }))).toEqual({
      completed: 3,
      total: 5,
      ratio: 3 / 5,
    })
  })

  it('returns ratio 0 (not NaN) when there are no objectives', () => {
    expect(progress(mkQuest({ objectives: [] }))).toEqual({ completed: 0, total: 0, ratio: 0 })
  })

  it('is full (ratio 1) when all objectives are done', () => {
    const objectives = [mkObjective({ done: true }), mkObjective({ done: true })]
    expect(progress(mkQuest({ objectives })).ratio).toBe(1)
  })
})

describe('turnIn — guarded to completed, yields rewards', () => {
  const rewards: Reward[] = [
    { kind: 'xp', amount: 250 },
    { kind: 'item', amount: 1, itemId: 'sword-of-dawn' },
  ]

  it('turns in a completed quest and returns its rewards', () => {
    const result = turnIn(mkQuest({ state: 'completed', rewards }))
    expect(result).not.toBeNull()
    expect(result?.quest.state).toBe('turned_in')
    expect(result?.rewards).toEqual(rewards)
  })

  it.each<QuestState>(['available', 'active', 'turned_in'])(
    'refuses to turn in a %s quest (returns null, no double-grant)',
    (state) => {
      expect(turnIn(mkQuest({ state, rewards }))).toBeNull()
    },
  )

  it('does not mutate the input quest', () => {
    const quest = mkQuest({ state: 'completed', rewards })
    turnIn(quest)
    expect(quest.state).toBe('completed')
  })
})

describe('full flow — accept → kill → complete → turn in', () => {
  it('runs the headline quest loop end to end', () => {
    let quest = mkQuest({
      state: 'available',
      objectives: [mkObjective({ target: 'goblin', required: 3, label: 'Slay 3 goblins' })],
      rewards: [{ kind: 'xp', amount: 500 }],
    })

    quest = acceptQuest(quest)
    expect(quest.state).toBe('active')

    quest = recordEvent(quest, KILL('goblin'))
    quest = recordEvent(quest, KILL('goblin'))
    expect(progress(quest)).toEqual({ completed: 0, total: 1, ratio: 0 })
    expect(quest.state).toBe('active')

    quest = recordEvent(quest, KILL('goblin'))
    expect(quest.state).toBe('completed')
    expect(progress(quest).ratio).toBe(1)

    const result = turnIn(quest)
    expect(result?.quest.state).toBe('turned_in')
    expect(result?.rewards).toEqual([{ kind: 'xp', amount: 500 }])
  })
})

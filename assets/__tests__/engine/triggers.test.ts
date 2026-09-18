import {
  findTrigger,
  resolveAction,
  type Action,
  type Trigger,
  type TriggerEvent,
} from '@/engine/triggers'

/** Build a Trigger with sensible defaults; override what the test cares about. */
function makeTrigger(over: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trigger-1',
    col: 5,
    row: 5,
    event: 'enter',
    action: { type: 'goto_region', col: 0, row: 0 },
    ...over,
  }
}

describe('findTrigger', () => {
  it('fires the trigger when the player cell and event both match', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'enter' })
    expect(findTrigger(3, 4, [t], 'enter')).toBe(t)
  })

  it('fires an interact trigger only on the interact event', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'interact' })
    expect(findTrigger(3, 4, [t], 'interact')).toBe(t)
  })

  it('fires an attack trigger only on the attack event', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'attack' })
    expect(findTrigger(3, 4, [t], 'attack')).toBe(t)
  })

  it('fires a touch trigger only on the touch event', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'touch' })
    expect(findTrigger(3, 4, [t], 'touch')).toBe(t)
  })

  it('does NOT fire when the cell matches but the event differs', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'enter' })
    expect(findTrigger(3, 4, [t], 'interact')).toBeNull()
  })

  it('does NOT fire when the event matches but the cell differs', () => {
    const t = makeTrigger({ col: 3, row: 4, event: 'enter' })
    expect(findTrigger(0, 0, [t], 'enter')).toBeNull()
  })

  it('returns null for an empty trigger list', () => {
    expect(findTrigger(3, 4, [], 'enter')).toBeNull()
  })

  it('picks the trigger matching cell + event out of several', () => {
    const a = makeTrigger({ id: 'a', col: 1, row: 1, event: 'enter' })
    const b = makeTrigger({ id: 'b', col: 8, row: 9, event: 'enter' })
    const c = makeTrigger({ id: 'c', col: 8, row: 9, event: 'interact' })
    expect(findTrigger(8, 9, [a, b, c], 'enter')).toBe(b)
  })

  it('returns the first match when several triggers share cell + event', () => {
    const first = makeTrigger({ id: 'first', col: 2, row: 2, event: 'touch' })
    const second = makeTrigger({ id: 'second', col: 2, row: 2, event: 'touch' })
    expect(findTrigger(2, 2, [first, second], 'touch')).toBe(first)
  })
})

describe('resolveAction', () => {
  it('classifies goto_level into a teleport effect carrying templateId and spawn', () => {
    const action: Action = {
      type: 'goto_level',
      templateId: 'world-2',
      spawn: { col: 4, row: 7 },
    }
    expect(resolveAction(action)).toEqual({
      kind: 'teleport',
      templateId: 'world-2',
      spawn: { col: 4, row: 7 },
    })
  })

  it('classifies goto_level without a spawn (spawn is optional)', () => {
    const action: Action = { type: 'goto_level', templateId: 'world-2' }
    expect(resolveAction(action)).toEqual({
      kind: 'teleport',
      templateId: 'world-2',
      spawn: undefined,
    })
  })

  it('classifies goto_region into a move effect carrying the target cell', () => {
    const action: Action = { type: 'goto_region', col: 11, row: 13 }
    expect(resolveAction(action)).toEqual({ kind: 'move', col: 11, row: 13 })
  })

  it('classifies content into a reveal effect carrying the sectionId', () => {
    const action: Action = { type: 'content', sectionId: 'experience' }
    expect(resolveAction(action)).toEqual({ kind: 'reveal', sectionId: 'experience' })
  })

  it('classifies collect into a grant effect carrying the itemId and qty', () => {
    const action: Action = { type: 'collect', itemId: 'gold-coin', qty: 3 }
    expect(resolveAction(action)).toEqual({ kind: 'grant', itemId: 'gold-coin', qty: 3 })
  })

  it('returns a noop effect for an unknown action type (defensive guard)', () => {
    // Simulate malformed data crossing the boundary (e.g. an action type added
    // server-side that this build does not know yet). Must not throw.
    const rogue = { type: 'self_destruct' } as unknown as Action
    expect(resolveAction(rogue)).toEqual({ kind: 'noop' })
  })
})

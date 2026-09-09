/**
 * THE RULES WORKSPACE MODEL (§4.8, Week 6).
 *
 * §4.8 gathers triggers, connections and quests into one panel that lists what a level ALREADY has. The
 * value is in the phrasing — "Cell (12, 8) · when entered → show message" — because the whole point is that
 * you can read a level's rules without opening each one. That phrasing is what these tests pin.
 *
 * Two of them guard §3.8's actual defect: the reason an action is unavailable must be RETURNED, not
 * implied. A `＋ New quest` button that silently does not exist is what made quest authoring "a silent dead
 * end" when a level had no NPC.
 */
import {
  RULES_TABS,
  connectionRows,
  describeTriggerAction,
  describeTriggerEvent,
  questBlockedReason,
  questRows,
  triggerBlockedReason,
  triggerRows,
} from '@/game/editor/rulesWorkspace'
import type { Trigger } from '@/game/runtime/trigger'
import type { Connector } from '@/lib/api'
import type { Quest } from '@/game/types'

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: 't1',
  event: 'enter',
  action: 'message',
  params: { text: 'hello' },
  ...over,
} as Trigger)

describe('the three tabs §4.8 draws', () => {
  it('carries them in the design\'s order', () => {
    expect(RULES_TABS.map(t => t.id)).toEqual(['triggers', 'connections', 'quests'])
  })

  it('heads each with what it IS, in plain words', () => {
    expect(RULES_TABS[0].heading).toMatch(/things that happen/i)
    expect(RULES_TABS[1].heading).toMatch(/doors between levels/i)
    expect(RULES_TABS[2].heading).toMatch(/things to do/i)
  })
})

describe('a trigger reads as a sentence', () => {
  it.each([
    ['enter', /when entered/i],
    ['interact', /when used/i],
    ['defeat', /when defeated/i],
  ] as const)('%s → %s', (event, expected) => {
    expect(describeTriggerEvent(event)).toMatch(expected)
  })

  // §4.8 draws exactly these: "when entered → show message", "when defeated → spawn units ×3",
  // "when entered → win".
  it('describes every action verb the editor can store', () => {
    expect(describeTriggerAction({ action: 'message', params: { text: 'hi' } })).toMatch(/show message/i)
    expect(describeTriggerAction({ action: 'spawn', params: { enemyType: 'goblin', count: 3 } })).toMatch(/spawn goblin ×3/)
    expect(describeTriggerAction({ action: 'spawn', params: { enemyType: 'goblin', count: 1 } })).toBe('spawn goblin')
    expect(describeTriggerAction({ action: 'give', params: { itemId: 'key' } })).toMatch(/give key/)
    expect(describeTriggerAction({ action: 'win', params: {} })).toBe('win')
    expect(describeTriggerAction({ action: 'lose', params: {} })).toBe('lose')
    expect(describeTriggerAction({ action: 'goto', params: { templateId: 'cave' } })).toMatch(/go to another level/i)
  })

  it('says a trigger with no action does nothing YET — never invents an effect', () => {
    expect(describeTriggerAction(undefined)).toMatch(/nothing yet/i)
  })
})

describe('the TRIGGERS tab lists cells AND characters together (§4.8)', () => {
  const sources = {
    cells: [{ col: 12, row: 8, triggers: [trigger()] }],
    units: [{ id: 'u1', name: 'Guard', col: 24, row: 9, triggers: [trigger({ id: 't2', event: 'defeat', action: 'give', params: { itemId: 'key' } })] }],
  }

  it('names the subject that carries each rule', () => {
    const rows = triggerRows(sources)
    expect(rows.map(r => r.subject)).toEqual(['Cell', 'Guard'])
    expect(rows.map(r => r.where)).toEqual(['(12, 8)', '(24, 9)'])
  })

  it('lists cells first, then characters — a stable reading order', () => {
    expect(triggerRows(sources)[0].subject).toBe('Cell')
  })

  it('falls back to "Character" for an unnamed unit rather than an empty subject', () => {
    const rows = triggerRows({ cells: [], units: [{ id: 'u', name: '', col: 1, row: 1, triggers: [trigger()] }] })
    expect(rows[0].subject).toBe('Character')
  })

  it('gives every row a distinct key, even for two triggers on one cell', () => {
    const rows = triggerRows({
      cells: [{ col: 3, row: 3, triggers: [trigger({ id: 'a' }), trigger({ id: 'b' })] }],
      units: [],
    })
    expect(new Set(rows.map(r => r.id)).size).toBe(2)
  })

  it('is empty for a level with no rules', () => {
    expect(triggerRows({ cells: [], units: [] })).toEqual([])
  })
})

describe('the CONNECTIONS tab', () => {
  const connector = (over: Partial<Connector> = {}): Connector => ({
    cells: [{ col: 5, row: 5 }],
    targetTemplateId: 'cave-id',
    targetTemplateName: 'cave',
    interaction: 'walk',
    spawnCol: 25,
    spawnRow: 25,
    ...over,
  })

  it('says where it is, where it goes and how you use it', () => {
    const [row] = connectionRows([connector()])
    expect(row.where).toBe('(5,5)')
    expect(row.target).toBe('cave')
    expect(row.how).toMatch(/walk onto it/i)
  })

  it('counts the extra cells of a multi-cell door (§4.8: "(5,5) +3 cells")', () => {
    const [row] = connectionRows([connector({ cells: [{ col: 5, row: 5 }, { col: 6, row: 5 }, { col: 7, row: 5 }] })])
    expect(row.where).toBe('(5,5) +2 cells')
  })

  it('reads "press E" for an interact door', () => {
    expect(connectionRows([connector({ interaction: 'interact' })])[0].how).toMatch(/press E/i)
  })

  it('SAYS when a connection has no level chosen instead of showing a blank', () => {
    const [row] = connectionRows([connector({ targetTemplateName: undefined, targetTemplateId: '' })])
    expect(row.target).toMatch(/no level chosen/i)
  })
})

describe('the QUESTS tab', () => {
  const quest = (over: Partial<Quest> = {}): Quest => ({
    id: 'q1',
    giverId: 'npc-1',
    title: 'Cull the goblins',
    description: '',
    objectives: [{ kind: 'kill', target: 'goblin', required: 5, current: 2, done: false, label: '' }],
    rewards: [],
    state: 'active',
    ...over,
  })

  const npcs = [{ id: 'npc-1', name: 'Elder' }]

  it('names the giver and totals the progress (§4.8: "giver: Elder · active 2/5")', () => {
    const [row] = questRows([quest()], npcs)
    expect(row).toMatchObject({ title: 'Cull the goblins', giver: 'Elder', state: 'active', progress: '2/5' })
  })

  it('reports NO giver when the quest points at an npc that is not on this level', () => {
    expect(questRows([quest({ giverId: 'gone' })], npcs)[0].giver).toBeNull()
  })

  it('has no progress to show for a quest with no objectives yet', () => {
    expect(questRows([quest({ objectives: [] })], npcs)[0].progress).toBeNull()
  })

  it('never reports more progress than required', () => {
    const over = quest({ objectives: [{ kind: 'kill', target: 'g', required: 3, current: 9, done: true, label: '' }] })
    expect(questRows([over], npcs)[0].progress).toBe('3/3')
  })

  it('titles an untitled quest rather than rendering an empty row', () => {
    expect(questRows([quest({ title: '' })], npcs)[0].title).toMatch(/untitled/i)
  })
})

describe('an unavailable action states WHY (§3.8 — the silent dead end)', () => {
  it('explains that a quest needs an NPC', () => {
    expect(questBlockedReason([])).toMatch(/needs an NPC/i)
  })

  it('is available once the level has one', () => {
    expect(questBlockedReason([{ id: 'npc-1' }])).toBeNull()
  })

  it('explains that a trigger needs a selection', () => {
    expect(triggerBlockedReason(false)).toMatch(/select a cell or a character/i)
    expect(triggerBlockedReason(true)).toBeNull()
  })
})

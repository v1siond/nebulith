/**
 * THE DIALOG SYSTEM.
 */
import { dialogApplies, pickDialog, reachableSpeaker, newDialog, type DialogWorld } from '@/game/runtime/dialog'
import type { Entity, Quest, UnitDialog } from '@/game/types'

const world = (patch: Partial<DialogWorld> = {}): DialogWorld => ({ quests: [], dayNight: 'day', weather: 'clear', ...patch })
const quest = (id: string, state: Quest['state']): Quest => ({ id, giverId: 'npc1', title: id, description: '', objectives: [], rewards: [], state })
const unit = (id: string, col: number, row: number, dialogs: UnitDialog[], kind: Entity['kind'] = 'npc') =>
  ({ id, kind, col, row, name: id, dialogs, baseStats: {} } as unknown as Entity)

const hello: UnitDialog = { id: 'd1', kind: 'static', lines: ['Hello there.'] }
const atNight: UnitDialog = { id: 'd2', kind: 'situational', situation: 'night', lines: ['Late to be out.'] }
const inRain: UnitDialog = { id: 'd3', kind: 'situational', situation: 'rain', lines: ['Wet, isn\'t it.'] }
const catActive: UnitDialog = { id: 'd4', kind: 'quest', questId: 'cat', questState: 'active', lines: ['Found my cat yet?'] }

describe('when a dialog applies', () => {
  it('a static one any time', () => {
    expect(dialogApplies(hello, world())).toBe(true)
    expect(dialogApplies(hello, world({ dayNight: 'night', weather: 'rain' }))).toBe(true)
  })

  it('a situational one only while its situation holds', () => {
    expect(dialogApplies(atNight, world({ dayNight: 'night' }))).toBe(true)
    expect(dialogApplies(atNight, world({ dayNight: 'day' }))).toBe(false)
    expect(dialogApplies(inRain, world({ weather: 'rain' }))).toBe(true)
    expect(dialogApplies(inRain, world({ weather: 'clear' }))).toBe(false)
  })

  it('a quest one only while its quest is in that state', () => {
    expect(dialogApplies(catActive, world({ quests: [quest('cat', 'active')] }))).toBe(true)
    expect(dialogApplies(catActive, world({ quests: [quest('cat', 'available')] }))).toBe(false)
    expect(dialogApplies(catActive, world({ quests: [] }))).toBe(false)
  })

  it('a dialog with nothing written says nothing', () => {
    expect(dialogApplies({ id: 'e', kind: 'static', lines: ['', '  '] }, world())).toBe(false)
  })
})

describe('which one a unit says', () => {
  const npc = unit('Mara', 5, 5, [hello, atNight, catActive])

  it('the most specific that applies: quest, then situation, then any time', () => {
    const quests = [quest('cat', 'active')]
    expect(pickDialog(npc, world({ quests, dayNight: 'night' }))?.id).toBe('d4')
    expect(pickDialog(npc, world({ dayNight: 'night' }))?.id).toBe('d2')
    expect(pickDialog(npc, world())?.id).toBe('d1')
  })

  it('nothing when nothing applies', () => {
    expect(pickDialog(unit('Quiet', 0, 0, [atNight]), world({ dayNight: 'day' }))).toBeNull()
    expect(pickDialog(unit('Mute', 0, 0, []), world())).toBeNull()
  })
})

describe('who the player can talk to', () => {
  it('a unit beside the player, with what it says', () => {
    const talk = reachableSpeaker([unit('Mara', 6, 5, [hello])], 5, 5, world())
    expect(talk?.unit.id).toBe('Mara')
    expect(talk?.dialog.lines).toEqual(['Hello there.'])
  })

  it('not one two cells away, and never the player itself', () => {
    expect(reachableSpeaker([unit('Far', 8, 5, [hello])], 5, 5, world())).toBeNull()
    expect(reachableSpeaker([unit('Hero', 5, 5, [hello], 'player')], 5, 5, world())).toBeNull()
  })

  it('skips a neighbour with nothing to say for one that has something', () => {
    const talk = reachableSpeaker([unit('Quiet', 5, 4, [atNight]), unit('Mara', 5, 6, [hello])], 5, 5, world())
    expect(talk?.unit.id).toBe('Mara')
  })
})

describe('a new dialog', () => {
  it('starts empty and waits for what its kind needs', () => {
    expect(newDialog('static', 'a')).toEqual({ id: 'a', kind: 'static', lines: [] })
    expect(newDialog('quest', 'b')).toMatchObject({ kind: 'quest', questState: 'available' })
    expect(newDialog('situational', 'c')).toMatchObject({ kind: 'situational', situation: 'night' })
  })
})

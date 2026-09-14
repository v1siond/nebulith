/**
 * THE DIALOG SYSTEM: which of a unit's dialogs it says right now.
 *
 * A unit carries many dialogs (types.ts `UnitDialog`). When the player talks to it, the most SPECIFIC one that
 * applies wins: a quest dialog (it knows where you are in a quest), then a situational one (it knows it's night, or
 * raining), then a static one (it always has something to say). Within a kind, the first in the unit's list.
 *
 * The situations are a table, so a new one is a row: each names a label for the editor and the world state it reads.
 * Today they are the states the engine tracks, day or night and the weather.
 */
import type { DayNight } from '@/engine/render'
import type { WeatherId } from '@/engine/render/weather'
import { entityAt } from '@/game/entities'
import type { DialogKind, DialogSituation, Entity, Quest, QuestState, UnitDialog } from '@/game/types'
import { QUEST_REACH_DELTAS } from './quest'

/** The world a dialog can depend on. */
export interface DialogWorld {
  quests: readonly Quest[]
  dayNight: DayNight
  weather: WeatherId
}

export const DIALOG_SITUATIONS: Readonly<Record<DialogSituation, { label: string; holds: (world: DialogWorld) => boolean }>> = {
  day: { label: 'In daylight', holds: w => w.dayNight === 'day' },
  night: { label: 'At night', holds: w => w.dayNight === 'night' },
  rain: { label: 'While it rains', holds: w => w.weather === 'rain' },
  clear: { label: 'In clear weather', holds: w => w.weather === 'clear' },
}

/** What each quest state reads as in the editor, when a dialog waits for it. */
export const QUEST_STATE_LABEL: Readonly<Record<QuestState, string>> = {
  available: 'Before it is taken',
  active: 'While it is underway',
  completed: 'When it is done',
  turned_in: 'After it is handed in',
}

export const DIALOG_KIND_LABEL: Readonly<Record<DialogKind, string>> = {
  static: 'Any time',
  quest: 'About a quest',
  situational: 'In a situation',
}

/** Does this dialog apply now, by kind. One row per kind (Open/Closed). */
const APPLIES: Readonly<Record<DialogKind, (dialog: UnitDialog, world: DialogWorld) => boolean>> = {
  static: () => true,
  quest: (d, w) => !!d.questId && w.quests.find(q => q.id === d.questId)?.state === (d.questState ?? 'available'),
  situational: (d, w) => !!d.situation && DIALOG_SITUATIONS[d.situation].holds(w),
}

/** Most specific first: a quest dialog outranks a situational one, which outranks a static one. */
const PRIORITY: readonly DialogKind[] = ['quest', 'situational', 'static']

export function dialogApplies(dialog: UnitDialog, world: DialogWorld): boolean {
  return dialog.lines.some(line => line.trim() !== '') && APPLIES[dialog.kind](dialog, world)
}

/** The dialog this unit says right now, or null when it has nothing that applies. */
export function pickDialog(unit: Entity, world: DialogWorld): UnitDialog | null {
  const dialogs = unit.dialogs ?? []
  for (const kind of PRIORITY) {
    const hit = dialogs.find(d => d.kind === kind && dialogApplies(d, world))
    if (hit) return hit
  }
  return null
}

/** The unit within talking reach (the player's cell, then the 8 around it, like quest talk) that has something to
 *  say right now, with what it says. Null when nobody near does. */
export function reachableSpeaker(entities: readonly Entity[], pCol: number, pRow: number, world: DialogWorld): { unit: Entity; dialog: UnitDialog } | null {
  for (const [dCol, dRow] of QUEST_REACH_DELTAS) {
    const unit = entityAt(entities, pCol + dCol, pRow + dRow)
    if (!unit || unit.kind === 'player') continue
    const dialog = pickDialog(unit, world)
    if (dialog) return { unit, dialog }
  }
  return null
}

/** A fresh dialog of a kind, for the editor's Add button. */
export function newDialog(kind: DialogKind, id: string): UnitDialog {
  if (kind === 'quest') return { id, kind, lines: [], questState: 'available' }
  if (kind === 'situational') return { id, kind, lines: [], situation: 'night' }
  return { id, kind, lines: [] }
}

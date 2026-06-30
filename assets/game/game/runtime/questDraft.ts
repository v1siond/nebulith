// Pure quest-draft authoring: the editor form's draft shape + the builders that
// mint a Quest from it. Moved out of the game-engine page (stage 4) so the quest
// authoring card (components/game) and the editor page share one home. Pure —
// every input is passed in, nothing read from the DOM.
import type { Objective, ObjectiveKind, Quest, Reward } from '@/game/types'

/** Reward types the simple authoring UI can grant (subset of Reward kinds). */
export type SimpleRewardKind = 'xp' | 'item'

/** The fields the Quests card collects before minting a Quest. */
export interface QuestDraft {
  giverId: string
  title: string
  /** objective type: slay enemies / travel to a cell / find an NPC. */
  objectiveKind: ObjectiveKind
  /** the objective TARGET: enemyType (kill), "col,row" cell (travel), or npc id (find). */
  target: string
  count: number
  rewardKind: SimpleRewardKind
  /** xp amount (rewardKind 'xp') — ignored for items. */
  rewardXp: number
  /** itemId to grant (rewardKind 'item') — ignored for xp. */
  rewardItemId: string
}

/** A fresh, empty draft for the authoring form (no giver picked yet). */
export function emptyQuestDraft(): QuestDraft {
  return { giverId: '', title: '', objectiveKind: 'kill', target: 'goblin', count: 3, rewardKind: 'xp', rewardXp: 50, rewardItemId: '' }
}

/** A short, unique-enough id for a quest minted in the editor session. */
export function mintQuestId(): string {
  return `quest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Build the objective from the draft (dispatch by kind; required clamped ≥1).
 *  travel/find are single-step; kill uses the draft count. */
export const OBJECTIVE_BUILDERS: Record<ObjectiveKind, (draft: QuestDraft) => Objective> = {
  kill: (d) => {
    const target = d.target.trim() || 'enemy'
    return { kind: 'kill', target, required: Math.max(1, Math.floor(d.count)), current: 0, done: false, label: `Slay ${target}` }
  },
  travel: (d) => {
    const target = d.target.trim() || '0,0'
    return { kind: 'travel', target, required: 1, current: 0, done: false, label: `Travel to ${target}` }
  },
  find: (d) => {
    const target = d.target.trim()
    return { kind: 'find', target, required: 1, current: 0, done: false, label: `Find ${target}` }
  },
}

export function objectiveFrom(draft: QuestDraft): Objective {
  return OBJECTIVE_BUILDERS[draft.objectiveKind](draft)
}

/** A short human description of the drafted objective for the quest text. */
export function objectiveSummary(draft: QuestDraft): string {
  if (draft.objectiveKind === 'kill') return `Defeat ${draft.count} ${draft.target.trim() || 'enemy'}`
  if (draft.objectiveKind === 'travel') return `Travel to ${draft.target.trim() || 'the marked cell'}`
  return `Find ${draft.target.trim() || 'the person'}`
}

/** Build the reward from the draft (dispatch by kind, not a branch chain). */
export const REWARD_BUILDERS: Record<SimpleRewardKind, (draft: QuestDraft) => Reward> = {
  xp: (draft) => ({ kind: 'xp', amount: Math.max(0, Math.floor(draft.rewardXp)) }),
  item: (draft) => ({ kind: 'item', amount: 1, itemId: draft.rewardItemId.trim() || 'reward-item' }),
}

/**
 * Mint an `available` Quest from a validated draft. Pure: the caller links the
 * giver's `questId` and stores the quest. Returns null if the draft is unusable
 * (no giver / blank title) so the caller can surface a toast instead of saving junk.
 */
export function questFromDraft(draft: QuestDraft): Quest | null {
  if (!draft.giverId) return null
  const title = draft.title.trim()
  if (!title) return null
  return {
    id: mintQuestId(),
    giverId: draft.giverId,
    title,
    description: `${objectiveSummary(draft)} for ${title}.`,
    objectives: [objectiveFrom(draft)],
    rewards: [REWARD_BUILDERS[draft.rewardKind](draft)],
    state: 'available',
  }
}

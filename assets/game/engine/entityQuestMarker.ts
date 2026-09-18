import type { Entity, Quest } from '../game/types'

export type QuestMarker = 'giver' | 'target' | null

/**
 * Above-entity quest indicator.
 * 'giver'  → NPC offering a quest that exists (show "!")
 * 'target' → enemy whose enemyType matches an ACTIVE quest's kill objective (show a link marker)
 */
export function entityQuestMarker(entity: Entity, quests: readonly Quest[]): QuestMarker {
  if (entity.kind === 'npc' && entity.questId) {
    if (quests.some(q => q.id === entity.questId)) return 'giver'
  }
  if (entity.kind === 'enemy' && entity.enemyType) {
    const linked = quests.some(q => q.state === 'active'
      && q.objectives.some(o => o.kind === 'kill' && o.target === entity.enemyType))
    if (linked) return 'target'
  }
  return null
}

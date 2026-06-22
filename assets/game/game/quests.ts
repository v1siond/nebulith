/**
 * Nebulith quest / mission system — pure, immutable domain logic.
 *
 * Implements the lifecycle from COMBAT-AND-SYSTEMS-SPEC.md §10:
 *   available → (accept) → active → (events advance objectives) → completed → (turn in) → turned_in
 *
 * Every function is pure: it returns a NEW {@link Quest} (or derived value) and never mutates
 * its inputs. The caller owns side effects (granting rewards, persisting state). Objective-kind
 * dispatch is table-driven (Open/Closed) so adding a kind never edits the advancer.
 *
 * Contract types (Quest/Objective/Reward/QuestState/ObjectiveKind) live in @/game/types and are
 * shared across combat, inventory and entities — treat them as read-only here.
 */

import type { Objective, ObjectiveKind, Quest, Reward } from '@/game/types'

// ── domain events ───────────────────────────────────────────────────
// What the world reports to the quest system. Discriminated on `kind` so each
// matcher in MATCHERS narrows to exactly the event shape it cares about.

export type QuestEvent =
  | { kind: 'kill'; enemyType: string }
  | { kind: 'travel'; place: string }
  | { kind: 'find'; npcId: string }

// ── progress shape ──────────────────────────────────────────────────

export interface QuestProgress {
  completed: number // objectives marked done
  total: number // total objectives
  ratio: number // completed / total, 0 when there are no objectives
}

// ── turn-in result ──────────────────────────────────────────────────
// turnIn hands back the turned-in quest plus the rewards for the CALLER to grant —
// the module stays pure and never touches inventory/stats itself.

export interface TurnInResult {
  quest: Quest
  rewards: Reward[]
}

// ── objective-kind dispatch (Open/Closed) ───────────────────────────
// One matcher per ObjectiveKind decides whether an incoming event advances a given
// objective. Adding a kind means adding a row here — no advancer edits.

type EventOfKind<K extends ObjectiveKind> = Extract<QuestEvent, { kind: K }>

type ObjectiveMatcher<K extends ObjectiveKind> = (
  objective: Objective,
  event: EventOfKind<K>,
) => boolean

type MatcherMap = { [K in ObjectiveKind]: ObjectiveMatcher<K> }

const MATCHERS: MatcherMap = {
  kill: (objective, event) => objective.target === event.enemyType,
  travel: (objective, event) => objective.target === event.place,
  find: (objective, event) => objective.target === event.npcId,
}

/** True when this event is the right kind for the objective AND its target matches. */
function eventAdvances(objective: Objective, event: QuestEvent): boolean {
  if (objective.kind !== event.kind) return false
  // kinds are equal here, so the matcher's event type is satisfied.
  const matcher = MATCHERS[objective.kind] as ObjectiveMatcher<ObjectiveKind>
  return matcher(objective, event)
}

// ── small pure helpers ──────────────────────────────────────────────

/** Apply one matching tick to an objective: bump `current` (clamped) and recompute `done`. */
function advanceObjective(objective: Objective): Objective {
  const current = Math.min(objective.current + 1, objective.required)
  return { ...objective, current, done: current >= objective.required }
}

/** Return the objective advanced if the event matches it, otherwise the same objective. */
function applyEvent(objective: Objective, event: QuestEvent): Objective {
  if (!eventAdvances(objective, event)) return objective
  if (objective.done) return objective // already finished — clamp, don't over-count
  return advanceObjective(objective)
}

/** Single source of truth for "every objective is done". Empty objective list = not complete. */
export function isComplete(quest: Quest): boolean {
  if (quest.objectives.length === 0) return false
  return quest.objectives.every((objective) => objective.done)
}

/** Read one objective's progress as {current, required, done} (already on the type, surfaced for UI). */
export function objectiveProgress(objective: Objective): {
  current: number
  required: number
  done: boolean
} {
  return { current: objective.current, required: objective.required, done: objective.done }
}

// ── lifecycle ───────────────────────────────────────────────────────

/** available → active. Guard: only an available quest can be accepted; otherwise returned unchanged. */
export function acceptQuest(quest: Quest): Quest {
  if (quest.state !== 'available') return quest
  return { ...quest, state: 'active' }
}

/**
 * Feed a world event to an active quest. Advances every matching objective (clamped to
 * `required`), marks objectives done, and flips the quest to 'completed' once all are done.
 * No-ops (returns the same quest) for quests that are not active.
 */
export function recordEvent(quest: Quest, event: QuestEvent): Quest {
  if (quest.state !== 'active') return quest

  const objectives = quest.objectives.map((objective) => applyEvent(objective, event))
  const next: Quest = { ...quest, objectives }

  if (!isComplete(next)) return next
  return { ...next, state: 'completed' }
}

/** Derived progress for auto-display ("3/5"): completed objectives over total. */
export function progress(quest: Quest): QuestProgress {
  const total = quest.objectives.length
  const completed = quest.objectives.filter((objective) => objective.done).length
  const ratio = total === 0 ? 0 : completed / total
  return { completed, total, ratio }
}

/**
 * completed → turned_in. Guard: only a completed quest can be turned in (returns null otherwise),
 * so the caller can't double-grant. Returns the turned-in quest plus its rewards to grant.
 */
export function turnIn(quest: Quest): TurnInResult | null {
  if (quest.state !== 'completed') return null
  return { quest: { ...quest, state: 'turned_in' }, rewards: quest.rewards }
}

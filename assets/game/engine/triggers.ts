/**
 * Generalized action-trigger logic for Nebulith templates.
 *
 * A Trigger is an activation condition (a cell + an event) bound to a typed
 * Action. When the player does the right thing on the trigger's cell, the game
 * loop performs the action's side effect. This module owns only the PURE parts
 * so they can be unit-tested in isolation:
 *
 *   - `findTrigger`   — the activation rule (which trigger fires for cell+event)
 *   - `resolveAction` — a classifier mapping an Action to a ResolvedEffect that
 *                       describes what the loop should do (no side effects here)
 *
 * The game loop owns the stateful parts (detecting cell changes, reading keys)
 * and the real side effects (teleport, reveal a section, grant an item).
 *
 * Generalizes the original `findTriggeredConnector` (engine/connectors.ts): a
 * connector was a trigger whose only action was "go to a place".
 * See nebulith/docs/TRIGGERS-SPEC.md for the design.
 */

/** A point on the grid the loop can spawn or move the player to. */
export interface Cell {
  col: number
  row: number
}

/**
 * How a trigger fires:
 * - 'enter'    — the player moved onto the cell (edge-triggered by the loop)
 * - 'interact' — the player pressed the interact key on the cell
 * - 'attack'   — the player attacked on the cell
 * - 'touch'    — something touched the cell (e.g. a projectile/contact)
 */
export type TriggerEvent = 'enter' | 'interact' | 'attack' | 'touch'

/**
 * What a trigger does — a discriminated union on `type`. Open/Closed: adding a
 * new action is a new member here + one row in the dispatch map below, never an
 * edit to the existing members.
 * - goto_level   teleport to another template (the old connector)
 * - goto_region  move within the current stage
 * - content      reveal a CV section (the game-CV payoff)
 * - collect      add an item to the inventory
 */
export type Action =
  | { type: 'goto_level'; templateId: string; spawn?: Cell }
  | { type: 'goto_region'; col: number; row: number }
  | { type: 'content'; sectionId: string }
  | { type: 'collect'; itemId: string; qty: number }

/** A single-cell trigger: where it fires, how it fires, and what it does. */
export interface Trigger {
  id: string
  col: number
  row: number
  event: TriggerEvent
  action: Action
}

/**
 * A description of the side effect the loop should perform — the pure output of
 * `resolveAction`. Each effect mirrors one Action variant, plus a `noop` for
 * defensively-handled unknown action types. The loop dispatches on `kind`.
 */
export type ResolvedEffect =
  | { kind: 'teleport'; templateId: string; spawn?: Cell }
  | { kind: 'move'; col: number; row: number }
  | { kind: 'reveal'; sectionId: string }
  | { kind: 'grant'; itemId: string; qty: number }
  | { kind: 'noop' }

/**
 * Return the trigger that should fire for the player's current cell + event, or
 * null if none applies. A trigger fires when both its cell and its event match.
 * When several triggers match, the first in list order wins (stable, like
 * `findTriggeredConnector`). Mirrors the connector activation rule, generalized
 * to the full TriggerEvent set.
 */
export function findTrigger(
  playerCol: number,
  playerRow: number,
  triggers: readonly Trigger[],
  event: TriggerEvent,
): Trigger | null {
  for (const trigger of triggers) {
    if (fires(trigger, playerCol, playerRow, event)) return trigger
  }
  return null
}

/** A trigger fires when its cell and event both match the player's input. */
function fires(
  trigger: Trigger,
  playerCol: number,
  playerRow: number,
  event: TriggerEvent,
): boolean {
  if (trigger.col !== playerCol) return false
  if (trigger.row !== playerRow) return false
  return trigger.event === event
}

/**
 * Per-action-type handlers. Keyed by `action.type` so adding an action is one
 * new row (Open/Closed) — no branching. The mapped type binds each key to the
 * exact action variant it handles (via `Extract`), so every handler body is
 * fully typed with no casts.
 */
const EFFECT_RESOLVERS: {
  [K in Action['type']]: (action: Extract<Action, { type: K }>) => ResolvedEffect
} = {
  goto_level: ({ templateId, spawn }) => ({ kind: 'teleport', templateId, spawn }),
  goto_region: ({ col, row }) => ({ kind: 'move', col, row }),
  content: ({ sectionId }) => ({ kind: 'reveal', sectionId }),
  collect: ({ itemId, qty }) => ({ kind: 'grant', itemId, qty }),
}

/**
 * Classify an Action into the ResolvedEffect the loop should perform. Pure: it
 * decides *what* should happen, never *does* it. Dispatches through the handler
 * map keyed by `action.type`; an unknown type (malformed data crossing the
 * boundary) degrades to a `noop` instead of throwing.
 */
export function resolveAction(action: Action): ResolvedEffect {
  const resolver = EFFECT_RESOLVERS[action.type]
  if (!resolver) return { kind: 'noop' }
  // Safe: `resolver` was selected by `action.type`, so it accepts this action.
  return (resolver as (action: Action) => ResolvedEffect)(action)
}

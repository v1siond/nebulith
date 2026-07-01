/**
 * Unified TRIGGER model — the thing that turns a map into a playable game.
 *
 * A Trigger reads as one sentence: **"When `[event]` → do `[action]`."** It is
 * attached to a CELL (on enter / on interact) or to an ENTITY (on defeat). The
 * play loop owns the stateful parts (detecting cell changes, reading keys, tracking
 * deaths) and applies the side effects; THIS module is PURE so the rules stay
 * unit-testable:
 *
 *   - `fireTriggers(event, triggers, ctx)` — given the triggers on the thing the
 *     event happened to, return the ordered list of EFFECTS the loop should apply.
 *     No side effects: it decides *what* should happen, never *does* it.
 *
 * Generalizes the old connector (`engine/connectors.ts`) and the connector-only
 * `engine/triggers.ts`: a connector is just an `on enter`/`on interact` trigger
 * whose action is `goto` (go to level). See docs/editor-ui-design.md
 * "Triggers — unified — absorbs connectors".
 */

// ── the vocabulary ───────────────────────────────────────────────────
/**
 * How a trigger fires:
 * - 'enter'    — the player stepped onto the cell (edge-triggered by the loop)
 * - 'interact' — the player pressed E while on the cell
 * - 'defeat'   — the entity this trigger is attached to was killed
 */
export type TriggerEvent = 'enter' | 'interact' | 'defeat'

/** The verbs a trigger can do. Adding one is a new member here + one row in the
 *  dispatch map below (Open/Closed), never an edit to the existing members. */
export type TriggerActionType = 'goto' | 'spawn' | 'give' | 'message' | 'win' | 'lose'

/** The payload each action carries — one shape per action type. */
export interface TriggerParams {
  /** go to level = today's connector: teleport to another template, land on spawn. */
  goto: { templateId: string; spawnCol?: number; spawnRow?: number }
  /** spawn N enemies of a type near the trigger's cell (or an explicit at-cell). */
  spawn: { enemyType: string; count: number; atCol?: number; atRow?: number }
  /** give the player an item (dropped into the bag). */
  give: { itemId: string }
  /** show a small dismissible message popup. */
  message: { text: string }
  /** win the game (end-state overlay). */
  win: Record<string, never>
  /** lose the game (end-state overlay). */
  lose: Record<string, never>
}

/**
 * A single trigger: `{ id, event, action, params }`. A discriminated union on
 * `action` so `params` is exactly the payload that action needs — no untyped bag.
 */
export type Trigger = {
  [K in TriggerActionType]: {
    id: string
    event: TriggerEvent
    action: K
    params: TriggerParams[K]
  }
}[TriggerActionType]

// ── effects (the pure output the loop applies) ───────────────────────
/** A description of the side effect the loop should perform. The loop dispatches
 *  on `kind`. `spawn`'s at-cell is fully resolved here (explicit at, else ctx). */
export type TriggerEffect =
  | { kind: 'goto'; templateId: string; spawnCol?: number; spawnRow?: number }
  | { kind: 'spawn'; enemyType: string; count: number; col: number; row: number }
  | { kind: 'give'; itemId: string }
  | { kind: 'message'; text: string }
  | { kind: 'win' }
  | { kind: 'lose' }

/** Context the loop passes in: WHERE the event happened (the entered/interacted
 *  cell, or the defeated entity's cell) — the default anchor for a spawn. */
export interface FireContext {
  at?: { col: number; row: number }
}

/**
 * Per-action resolver: map one trigger's params → the effect to apply. Keyed by
 * `action` so adding an action is one row (Open/Closed). Each handler is fully
 * typed to its own action variant — no casts inside the bodies.
 */
const EFFECT_RESOLVERS: {
  [K in TriggerActionType]: (params: TriggerParams[K], ctx: FireContext) => TriggerEffect
} = {
  goto: (p) => ({ kind: 'goto', templateId: p.templateId, spawnCol: p.spawnCol, spawnRow: p.spawnRow }),
  spawn: (p, ctx) => ({
    kind: 'spawn',
    enemyType: p.enemyType,
    count: Math.max(1, Math.floor(p.count)),
    col: p.atCol ?? ctx.at?.col ?? 0,
    row: p.atRow ?? ctx.at?.row ?? 0,
  }),
  give: (p) => ({ kind: 'give', itemId: p.itemId }),
  message: (p) => ({ kind: 'message', text: p.text }),
  win: () => ({ kind: 'win' }),
  lose: () => ({ kind: 'lose' }),
}

/**
 * The effects to apply for `event`, given the triggers on the thing it happened
 * to. Pure: filters the triggers whose `event` matches (in list order, so authoring
 * order is play order), then resolves each to its effect. Unknown/malformed action
 * types are skipped defensively rather than throwing.
 */
export function fireTriggers(
  event: TriggerEvent,
  triggers: readonly Trigger[],
  ctx: FireContext = {},
): TriggerEffect[] {
  const effects: TriggerEffect[] = []
  for (const trigger of triggers) {
    if (trigger.event !== event) continue
    const resolver = EFFECT_RESOLVERS[trigger.action]
    if (!resolver) continue // defensive: data added by a newer build
    // Safe: `resolver` was selected by `trigger.action`, so it accepts these params.
    effects.push((resolver as (p: TriggerParams[TriggerActionType], c: FireContext) => TriggerEffect)(trigger.params, ctx))
  }
  return effects
}

// ── authoring helpers (used by the inspector editor) ─────────────────
/** A short, unique-enough id for a trigger minted in the editor session. */
export function mintTriggerId(): string {
  return `trg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Fresh default params for an action, so switching the action in the UI yields a
 *  usable trigger immediately (dispatch map, not a branch chain). */
export const DEFAULT_ACTION_PARAMS: { [K in TriggerActionType]: () => TriggerParams[K] } = {
  goto: () => ({ templateId: '', spawnCol: 0, spawnRow: 0 }),
  spawn: () => ({ enemyType: 'goblin', count: 2 }),
  give: () => ({ itemId: 'reward' }),
  message: () => ({ text: '' }),
  win: () => ({}),
  lose: () => ({}),
}

/** Build a new trigger for the given event + action with sensible default params. */
export function makeTrigger<K extends TriggerActionType>(event: TriggerEvent, action: K): Trigger {
  return { id: mintTriggerId(), event, action, params: DEFAULT_ACTION_PARAMS[action]() } as Trigger
}

/** A one-line human summary of a trigger for the editor list ("when enter → win"). */
export function describeTrigger(trigger: Trigger): string {
  return `when ${trigger.event} → ${describeAction(trigger)}`
}

/** A short summary of just the action + its key param. */
function describeAction(trigger: Trigger): string {
  switch (trigger.action) {
    case 'goto': return trigger.params.templateId ? 'go to level' : 'go to level (pick one)'
    case 'spawn': return `spawn ${trigger.params.count} ${trigger.params.enemyType}`
    case 'give': return `give ${trigger.params.itemId || 'item'}`
    case 'message': return `show "${trigger.params.text || '…'}"`
    case 'win': return 'win'
    case 'lose': return 'lose'
  }
}

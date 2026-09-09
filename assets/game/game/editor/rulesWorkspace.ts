/**
 * THE RULES WORKSPACE (§4.8) — one place for everything that makes the map DO something.
 *
 * §3.8 and §3.9 are the two problems this answers. Quest authoring was reachable only by switching to
 * Select, clicking an NPC, and scrolling its card to a `❒ Quests…` button — so a level with no NPC offered
 * no way to write a quest and said nothing about why (§3.8's "silent dead end"). Connectors were a hidden
 * canvas mode whose on-screen instruction still told you to switch to Top view, which stopped being true
 * (§3.9). Triggers, meanwhile, existed only per-selection: there was no way to see the rules a level
 * already had.
 *
 * §4.8's answer is a three-tab panel — Triggers / Connections / Quests — listing what EXISTS, with the
 * add-action and its prerequisite stated rather than implied.
 *
 * This module is the pure part: turning the stored records into the lines the panel shows. It renders
 * nothing and knows nothing about React, so the phrasing is unit-testable and the component stays a map.
 */
import type { Trigger, TriggerActionType, TriggerEvent } from '@/game/runtime/trigger'
import type { Connector } from '@/lib/api'
import type { Quest } from '@/game/types'

export type RulesTabId = 'triggers' | 'connections' | 'quests'

export interface RulesTabDef {
  id: RulesTabId
  label: string
  /** The tab's own one-line answer to "what is this?", shown as its heading (§4.8). */
  heading: string
}

/** In §4.8's order. The panel renders this table; adding a tab is a row, never a branch. */
export const RULES_TABS: readonly RulesTabDef[] = [
  { id: 'triggers', label: 'Triggers', heading: 'Triggers — things that happen' },
  { id: 'connections', label: 'Connections', heading: 'Connections — doors between levels' },
  { id: 'quests', label: 'Quests', heading: 'Quests — things to do' },
]

// ── plain language ────────────────────────────────────────────────────────────
/**
 * WHEN a trigger fires, in the words §4.8 uses ("when entered", "when defeated").
 *
 * A dispatch map rather than a switch, so an event added to `TriggerEvent` shows up here as a missing row
 * instead of silently falling through to a default that reads like a real answer.
 */
const WHEN: Record<TriggerEvent, string> = {
  enter: 'when entered',
  interact: 'when used',
  defeat: 'when defeated',
}

export function describeTriggerEvent(event: TriggerEvent): string {
  return WHEN[event] ?? `when ${event}`
}

/**
 * WHAT a trigger does, in one phrase — the right-hand side of §4.8's "when defeated → spawn units ×3".
 *
 * A dispatch map keyed by the Trigger union's discriminant, typed so each row only sees ITS payload. Add a
 * verb to `TriggerActionType` and this stops compiling until the row exists, which is the point: an
 * unhandled action must never quietly print a phrase that reads like a real answer.
 */
type ActionDescribers = { [K in TriggerActionType]: (params: Extract<Trigger, { action: K }>['params']) => string }

const DOES: ActionDescribers = {
  goto: p => `go to another level`,
  spawn: p => `spawn ${p.enemyType}${p.count > 1 ? ` ×${p.count}` : ''}`,
  give: p => `give ${p.itemId}`,
  message: p => `show message`,
  win: () => 'win',
  lose: () => 'lose',
}

export function describeTriggerAction(trigger: Pick<Trigger, 'action' | 'params'> | undefined): string {
  if (!trigger) return 'do nothing yet'
  const describe = DOES[trigger.action] as ((p: unknown) => string) | undefined
  return describe ? describe(trigger.params) : 'do nothing yet'
}

// ── the rows the panel lists ──────────────────────────────────────────────────
/**
 * One line in the TRIGGERS tab. `subject` is what carries the rule — a cell or a character — because
 * §4.8 lists both together ("Cell (12, 8)", "Guard (24, 9)"): a person thinks in rules, not in which
 * store the rule happens to live in.
 */
export interface TriggerRow {
  id: string
  subject: string
  where: string
  when: string
  does: string
}

export interface TriggerSources {
  /** Triggers attached to CELLS, grouped by cell. */
  cells: readonly { col: number; row: number; triggers: readonly Trigger[] }[]
  /** Triggers attached to placed characters. */
  units: readonly { id: string; name: string; col: number; row: number; triggers: readonly Trigger[] }[]
}

/** Every rule on the level, cells first then characters, each in its own stored order. */
export function triggerRows({ cells, units }: TriggerSources): TriggerRow[] {
  const rows: TriggerRow[] = []
  for (const cell of cells) {
    for (const trigger of cell.triggers) {
      rows.push({
        id: `cell-${cell.col}-${cell.row}-${trigger.id}`,
        subject: 'Cell',
        where: `(${cell.col}, ${cell.row})`,
        when: describeTriggerEvent(trigger.event),
        does: describeTriggerAction(trigger),
      })
    }
  }
  for (const unit of units) {
    for (const trigger of unit.triggers) {
      rows.push({
        id: `unit-${unit.id}-${trigger.id}`,
        subject: unit.name || 'Character',
        where: `(${unit.col}, ${unit.row})`,
        when: describeTriggerEvent(trigger.event),
        does: describeTriggerAction(trigger),
      })
    }
  }
  return rows
}

/** One line in the CONNECTIONS tab. */
export interface ConnectionRow {
  id: string
  where: string
  target: string
  how: string
}

/** How the player uses a connection, in §4.8's words ("walk onto it", "press E"). */
const HOW: Record<Connector['interaction'], string> = {
  walk: 'walk onto it',
  interact: 'press E',
  auto: 'automatically',
}

export function connectionRows(connectors: readonly Connector[]): ConnectionRow[] {
  return connectors.map((c, i) => {
    const first = c.cells[0]
    const extra = c.cells.length - 1
    return {
      id: `${c.targetTemplateId}-${first?.col ?? '?'}-${first?.row ?? '?'}-${i}`,
      where: first ? `(${first.col},${first.row})${extra > 0 ? ` +${extra} cells` : ''}` : 'nowhere yet',
      // An unnamed target is SAID, not blanked — a connection pointing at a deleted level is a real
      // authoring mistake and the panel is where you would notice it.
      target: c.targetTemplateName || c.targetTemplateId || 'no level chosen',
      how: HOW[c.interaction] ?? c.interaction,
    }
  })
}

/** One line in the QUESTS tab. */
export interface QuestRow {
  id: string
  title: string
  /** The NPC who gives it, or null when nothing valid is assigned — §4.8 draws that as a warning. */
  giver: string | null
  state: string
  /** "2/5" across all objectives, or null for a quest with no objectives yet. */
  progress: string | null
}

export function questRows(
  quests: readonly Quest[],
  npcs: readonly { id: string; name?: string }[],
): QuestRow[] {
  // An unnamed NPC still IS the giver, so it gets a stand-in label rather than reading as "no giver" —
  // those are different problems and the panel warns about only one of them.
  const nameById = new Map(npcs.map(n => [n.id, n.name || 'Unnamed NPC']))
  return quests.map(q => {
    const required = q.objectives.reduce((sum, o) => sum + o.required, 0)
    const current = q.objectives.reduce((sum, o) => sum + Math.min(o.current, o.required), 0)
    return {
      id: q.id,
      title: q.title || 'Untitled quest',
      giver: nameById.get(q.giverId) ?? null,
      state: q.state,
      progress: required > 0 ? `${current}/${required}` : null,
    }
  })
}

/**
 * Why "＋ New quest" is unavailable, or null when it is available.
 *
 * §3.8's defect was that the entry point simply did not exist when there was no NPC, so nothing explained
 * the prerequisite. Returning the REASON lets the panel state it (§4.8: *"ⓘ needs an NPC on this level"*)
 * instead of showing a disabled button with no explanation.
 */
export function questBlockedReason(npcs: readonly unknown[]): string | null {
  return npcs.length === 0 ? 'A quest needs an NPC on this level to give it.' : null
}

/**
 * Why "＋ Add a trigger to the selection" is unavailable, or null.
 *
 * A trigger hangs off something, so there has to be a something selected (§4.8: *"ⓘ Select a cell or a
 * character first."*).
 */
export function triggerBlockedReason(hasSelection: boolean): string | null {
  return hasSelection ? null : 'Select a cell or a character first.'
}

// Pure quest-anchor projection: where the offer modal floats over a giver cell,
// mirroring each view's cell->screen math. Moved out of the game-engine page
// (stage 2). Pure — every input is passed in, nothing read from the DOM.
// Stage 5a also moved the quest ORCHESTRATION helpers here (find a giver's quest,
// upsert/active, feed kill events): module-level + pure so the rules stay testable.
import { entityAt } from '@/game/entities'
import { type QuestEvent, recordEvent } from '@/game/quests'
import type { Entity, Quest, Reward } from '@/game/types'

/** Camera snapshot the quest-offer modal needs to project a giver cell to screen px. */
export interface QuestAnchorCamera {
  view: 'isometric' | '2d' | 'top'
  cellSize: number
  isoScale: number
  player: { x: number; z: number }
  camOffset: { x: number; y: number }
  isoZoom: number
  topZoom: number
  w: number
  h: number
}

// Keep-out margins (px) for the anchored panel: enough side room and headroom above
// the giver for the modal, else we hand back null and the caller centers instead.
const QUEST_ANCHOR_SIDE = 40
const QUEST_ANCHOR_TOP = 160
const QUEST_ANCHOR_BOTTOM = 20

/**
 * Screen-space point (px) of a giver cell for the offer modal, mirroring each view's
 * own `toScreen` so the modal floats above the right entity. Returns null when the
 * point is off-screen or too close to an edge to fit the panel — the caller then
 * centers the modal. Pure: every input is passed in, nothing is read from the DOM.
 */
export function questAnchorScreenPos(cam: QuestAnchorCamera, col: number, row: number): { x: number; y: number } | null {
  const { x, y } = projectCell(cam, col, row)
  const onScreen =
    x >= QUEST_ANCHOR_SIDE && x <= cam.w - QUEST_ANCHOR_SIDE &&
    y >= QUEST_ANCHOR_TOP && y <= cam.h - QUEST_ANCHOR_BOTTOM
  return onScreen ? { x, y } : null
}

/** Per-view cell→screen projection matching the render loop's entity placement. */
function projectCell(cam: QuestAnchorCamera, col: number, row: number): { x: number; y: number } {
  if (cam.view === 'top') {
    const tileSize = 16 * cam.topZoom
    const offsetX = cam.w / 2 - (cam.player.x / cam.cellSize) * tileSize + cam.camOffset.x
    const offsetY = cam.h / 2 - (cam.player.z / cam.cellSize) * tileSize + cam.camOffset.y
    return { x: offsetX + (col + 0.5) * tileSize, y: offsetY + (row + 0.5) * tileSize }
  }
  if (cam.view === '2d') {
    const tile = 24 * cam.topZoom
    const camCol = cam.player.x / cam.cellSize - cam.camOffset.x / tile
    const camRow = cam.player.z / cam.cellSize - cam.camOffset.y / tile
    return { x: cam.w / 2 + (col + 0.5 - camCol) * tile, y: cam.h / 2 + (row + 0.5 - camRow) * tile }
  }
  // isometric — iso entities are drawn at toScreen(col,row) (integer cell)
  const isoScale = cam.isoScale * cam.isoZoom
  const wx = col * cam.cellSize - (cam.player.x - cam.camOffset.x)
  const wz = row * cam.cellSize - (cam.player.z - cam.camOffset.y)
  return { x: cam.w / 2 + (wx - wz) * isoScale * 0.71, y: cam.h / 2 + (wx + wz) * isoScale * 0.36 }
}

/** One-line reward summary for toasts, e.g. "+50 xp" or "item: sword". */
export function rewardSummary(reward: Reward): string {
  if (reward.kind === 'xp') return `+${reward.amount} xp`
  if (reward.kind === 'item') return `item: ${reward.itemId ?? 'reward'}`
  return `+${reward.amount} ${reward.stat ?? 'stat'}`
}

// ── quest orchestration (editor ↔ pure quest module) ─────────────────
// All lifecycle/progress math lives in src/game/quests.ts; this is orchestration
// only: finding a giver's quest, the active quest, immutable upsert, and feeding
// kill events to active quests. Pure + module-level so the rules stay testable.

/** The quest a giver NPC offers (matched by the NPC's linked questId), or null. */
export function questForGiver(quests: readonly Quest[], giver: Entity): Quest | null {
  if (!giver.questId) return null
  return quests.find((q) => q.id === giver.questId) ?? null
}

/**
 * The quest-giver NPC the player can interact with from (pCol,pRow): an NPC with
 * a linked quest on or adjacent (incl. diagonally) to the player's cell. Returns
 * the closest match (the player's own cell first), or null when none is in reach.
 */
export function reachableQuestGiver(entities: readonly Entity[], pCol: number, pRow: number): Entity | null {
  for (const [dCol, dRow] of QUEST_REACH_DELTAS) {
    const giver = questGiverAt(entities, pCol + dCol, pRow + dRow)
    if (giver) return giver
  }
  return null
}

/** Player's own cell first (talk while standing on it), then the 8 neighbours. */
const QUEST_REACH_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, 1], [-1, 1], [1, -1],
]

/** A quest-giving NPC (has a linked questId) occupying (col,row), or null. */
function questGiverAt(entities: readonly Entity[], col: number, row: number): Entity | null {
  const here = entityAt(entities, col, row)
  if (!here || here.kind !== 'npc' || !here.questId) return null
  return here
}

/** The single quest currently `active` (the editor tracks one at a time for the HUD). */
export function activeQuest(quests: readonly Quest[]): Quest | null {
  return quests.find((q) => q.state === 'active') ?? null
}

/** Immutably replace a quest by id in the list (no-op append if it's new). */
export function upsertQuest(quests: readonly Quest[], quest: Quest): Quest[] {
  const exists = quests.some((q) => q.id === quest.id)
  if (!exists) return [...quests, quest]
  return quests.map((q) => (q.id === quest.id ? quest : q))
}

/** Feed one world event (kill / travel / find) to every active quest. Returns the
 *  SAME reference when nothing advanced, so callers can skip a state update. */
export function applyQuestEvent(quests: readonly Quest[], event: QuestEvent): Quest[] {
  let changed = false
  const next = quests.map((q) => {
    if (q.state !== 'active') return q
    const advanced = recordEvent(q, event)
    if (advanced !== q) changed = true
    return advanced
  })
  return changed ? next : (quests as Quest[])
}

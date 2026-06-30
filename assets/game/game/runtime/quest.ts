// Pure quest-anchor projection: where the offer modal floats over a giver cell,
// mirroring each view's cell->screen math. Moved out of the game-engine page
// (stage 2). Pure — every input is passed in, nothing read from the DOM.
import type { Reward } from '@/game/types'

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

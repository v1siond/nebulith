/**
 * Connector trigger logic for Nebulith templates.
 *
 * A Connector links the current template to a target template. When the player
 * does the right thing on the connector's cell, the game teleports them to the
 * target (and the caller spawns them at the connector's spawnCol/spawnRow).
 *
 * This module holds the PURE trigger rule so it can be unit-tested in isolation;
 * the game loop owns the stateful parts (detecting cell changes, reading keys).
 */
import type { Connector } from '@/lib/api'

/**
 * What just happened on this frame:
 * - 'enter'    — the player moved onto a new cell (edge-triggered by the loop)
 * - 'interact' — the player pressed the interact key
 */
export type ConnectorEvent = 'enter' | 'interact'

/**
 * Return the connector that should fire for the player's current cell + event,
 * or null if none applies.
 *
 * Rule: 'walk' and 'auto' connectors fire on 'enter'; 'interact' connectors fire
 * only on 'interact'.
 */
export function findTriggeredConnector(
  playerCol: number,
  playerRow: number,
  connectors: Connector[],
  event: ConnectorEvent,
): Connector | null {
  for (const c of connectors) {
    if (c.col !== playerCol || c.row !== playerRow) continue
    const firesOnEnter = c.interaction === 'walk' || c.interaction === 'auto'
    if (event === 'enter' && firesOnEnter) return c
    if (event === 'interact' && c.interaction === 'interact') return c
  }
  return null
}

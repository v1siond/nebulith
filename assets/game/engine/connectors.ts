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

/** The legacy single-cell connector shape, still present in older saved templates. */
type LegacyConnector = Omit<Connector, 'cells'> & { col: number; row: number }

/**
 * Migrate a raw connector to the normalized multi-cell shape. A legacy
 * `{ col, row, ... }` becomes `{ cells: [{ col, row }], ... }`; a connector that
 * already carries `cells` passes through unchanged. Centralize this so every read
 * path (load, render, trigger) sees the same `cells` shape.
 */
export function normalizeConnector(raw: unknown): Connector {
  const r = raw as Partial<Connector> & Partial<LegacyConnector>
  if (Array.isArray(r.cells)) return r as Connector
  const { col, row, ...rest } = r as LegacyConnector
  return { ...rest, cells: [{ col, row }] } as Connector
}

/**
 * Return the connector that should fire for the player's current cell + event,
 * or undefined if none applies.
 *
 * Rule: 'walk' and 'auto' connectors fire on 'enter'; 'interact' connectors fire
 * only on 'interact'. A connector matches when (col,row) is one of its cells.
 */
export function findTriggeredConnector(
  playerCol: number,
  playerRow: number,
  connectors: Connector[],
  event: ConnectorEvent,
): Connector | undefined {
  for (const c of connectors) {
    if (!c.cells.some(cell => cell.col === playerCol && cell.row === playerRow)) continue
    const firesOnEnter = c.interaction === 'walk' || c.interaction === 'auto'
    if (event === 'enter' && firesOnEnter) return c
    if (event === 'interact' && c.interaction === 'interact') return c
  }
  return undefined
}

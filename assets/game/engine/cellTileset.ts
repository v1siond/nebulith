/**
 * Cell TILESET — the single source of truth for how each cell LABEL looks: its
 * ASCII glyph and its zone-tinted color. This is the ASCII→tileset swap point:
 * today a label resolves to an ASCII glyph; later the same (zone, label) pair
 * selects a real tile from an art atlas — only this module changes.
 *
 * SOLID separation from cellLabels.ts:
 *   - cellLabels.ts owns SEMANTICS — which labels exist, per-label collision
 *     (isWalkable), and autotile TOPOLOGY (which corner/edge label a mass cell
 *     gets from its neighbourhood).
 *   - cellTileset.ts (here) owns PRESENTATION — the glyph + color each label
 *     renders as, per zone (charred lava, frosty frozen, green verdant).
 *
 * Open/Closed: add a zone → add a row to ZONE_VISUALS; add a label → add a glyph
 * (+ a part mapping if it isn't a tree-canopy cell). No call sites change.
 */

import type { CellLabel } from './cellLabels'
import type { ZoneId } from './zones'

export interface CellTile {
  /** The ASCII glyph this cell renders as (box-drawing corners for tree masses). */
  char: string
  /** The zone-tinted color this cell renders in. */
  color: string
}

// ── glyphs (structural: keyed by label, NOT zone) ───────────────────────
// The 9-piece mass uses box-drawing corners/edges so a forest reads as one
// connected canopy; the walkable canopy top (♣) reads differently from solid
// leaves (@) so the "walk-under" cell is visible. Corners stay zone-independent
// on purpose — only the COLOR carries the zone (see keepsCornersStructural test).
const CELL_GLYPHS: Readonly<Record<CellLabel, string>> = {
  tree_stem_bottom: '╨',
  tree_stem: '│',
  tree_leaf: '@',
  tree_crown: '♣', // solid foliage cap of a standalone tree (blocks)
  tree_leaf_top: '♣', // reserved walk-under canopy (not generated currently)
  tree_snag: 'Ψ', // bare dead trunk top — branchy, no leaves (burnt / frozen)
  tree_top_left: '╔',
  tree_top: '╦',
  tree_top_right: '╗',
  tree_edge_left: '╠',
  tree_interior: '@',
  tree_edge_right: '╣',
  tree_bottom_left: '╚',
  tree_bottom: '╩',
  tree_bottom_right: '╝',
  roof_top: '▔',
  roof: '▀',
  wall: '█',
  door: '╫',
  window: '▒',
  mountain: '▲', // mountain slope
  peak: '▲', // mountain crown / volcano crater (zone color carries the meaning)
  spill: '‖', // lava flow / waterfall feeding the lake
}

// ── per-zone color palette ──────────────────────────────────────────────
// A tree's canopy uses a PALETTE of tonal shades (not one flat tone) so a forest
// reads with contrast instead of a single-color mess; the generator gives each
// tree/cluster a variant index into this palette. The trunk + building parts are
// single per-zone colors. shade[0] is the zone's signature canopy tone.
export const TREE_CANOPY_SHADES: Readonly<Record<ZoneId, string[]>> = {
  spring: ['#7cc46a', '#9ed87f', '#5fae4f', '#e79ec8'], // fresh new growth + a blossom pink
  summer: ['#2e8b2e', '#1f6b1f', '#3fb53f', '#246b24'], // deep, lush greens
  autumn: ['#d2691e', '#c0531a', '#e0a020', '#9c4a1e'], // orange / red / gold turning leaves
  winter: ['#cfe0ea', '#aac4d8', '#e8f2fa', '#9fbccb'], // frosted / snow-laden pale blues
  desert: ['#9a8f5a', '#b3a86b', '#7d7448', '#c7bd80'], // dry olive / khaki scrub
  beach: ['#4fae6a', '#6fc888', '#3c8f54', '#86d49e'], // bright palm greens
  lava: ['#3e3942', '#4a4350', '#2e2b33', '#544754'], // charred, near-black canopies
}

/** A canopy shade for a tree variant; wraps the palette safely for any integer. */
export function treeCanopyShade(zone: ZoneId, variant: number): string {
  const shades = TREE_CANOPY_SHADES[zone]
  return shades[((variant % shades.length) + shades.length) % shades.length]
}

// Per-SEASON trunk (bark), building parts, and biome feature colors. The feature's
// peak is a snow-cap and the spill is a blue waterfall (icier in winter).
interface ZoneVisuals {
  trunk: string
  building: { roof: string; wall: string; door: string; window: string }
  feature: { mountain: string; peak: string; spill: string }
}

const ZONE_VISUALS: Readonly<Record<ZoneId, ZoneVisuals>> = {
  spring: {
    trunk: '#7a5a3a', // light spring bark
    building: { roof: '#8a4a30', wall: '#c8b486', door: '#5a3a1a', window: '#a8d0e8' },
    feature: { mountain: '#8a8a8a', peak: '#eef4f8', spill: '#5bbcff' },
  },
  summer: {
    trunk: '#6b4a2b', // brown bark
    building: { roof: '#8a4a30', wall: '#b89a6a', door: '#5a3a1a', window: '#a8d0e8' },
    feature: { mountain: '#7d7d7d', peak: '#e6edf2', spill: '#5bbcff' },
  },
  autumn: {
    trunk: '#5a3a20', // dark autumn bark
    building: { roof: '#7a3a20', wall: '#b08a5a', door: '#4a2a12', window: '#e8c060' },
    feature: { mountain: '#8a7a6a', peak: '#e6dcc8', spill: '#5bbcff' },
  },
  winter: {
    trunk: '#8fa3b5', // pale frost bark
    building: { roof: '#4a6a8a', wall: '#aac4d8', door: '#2a3a4a', window: '#dff0ff' },
    feature: { mountain: '#8fa6b8', peak: '#eef6ff', spill: '#bfe8f5' }, // icy peak, frozen waterfall
  },
  desert: {
    trunk: '#a98a4f', // dry tan wood
    building: { roof: '#c2914a', wall: '#d8c089', door: '#7a5a2a', window: '#a8d0e8' },
    feature: { mountain: '#c2a35a', peak: '#e8d49a', spill: '#5bbcff' }, // dune massif, oasis water
  },
  beach: {
    trunk: '#8a6a3a', // palm bark
    building: { roof: '#c98a52', wall: '#e0cf9a', door: '#6a4a24', window: '#bfe8f5' },
    feature: { mountain: '#b8a070', peak: '#efe4c2', spill: '#5bbcff' }, // headland + surf
  },
  lava: {
    trunk: '#2b2420', // charred charcoal bark
    building: { roof: '#5a2a20', wall: '#4a4038', door: '#1a1410', window: '#ff8050' },
    feature: { mountain: '#3a2a25', peak: '#ff5a1f', spill: '#ff8a30' }, // basalt cone, ember crater, lava flow
  },
}

// ── label → color resolution (dispatch maps, not if/else chains) ─────────
// Building labels paint their own part; the roof apex shares the roof color.
const BUILDING_PART_BY_LABEL: Readonly<Record<string, keyof ZoneVisuals['building']>> = {
  roof_top: 'roof',
  roof: 'roof',
  wall: 'wall',
  door: 'door',
  window: 'window',
}

// Biome feature labels (mountain/peak/spill) paint their own per-zone part color.
const FEATURE_PART_BY_LABEL: Readonly<Record<string, keyof ZoneVisuals['feature']>> = {
  mountain: 'mountain',
  peak: 'peak',
  spill: 'spill',
}

// Trunk + dead-wood cells paint the trunk color; every other tree label (leaves
// + the whole autotiled mass) paints a canopy shade. Membership lookup, not a
// branch. `tree_snag` is dead wood → trunk-colored.
const TRUNK_LABELS: ReadonlySet<string> = new Set<CellLabel>(['tree_stem_bottom', 'tree_stem', 'tree_snag'])

function colorFor(zone: ZoneId, label: CellLabel, variant: number): string {
  const visuals = ZONE_VISUALS[zone]
  const buildingPart = BUILDING_PART_BY_LABEL[label]
  if (buildingPart) return visuals.building[buildingPart]
  const featurePart = FEATURE_PART_BY_LABEL[label]
  if (featurePart) return visuals.feature[featurePart]
  if (TRUNK_LABELS.has(label)) return visuals.trunk
  return treeCanopyShade(zone, variant) // canopy (leaves + mass) → tonal shade
}

// A label we don't know about still renders something visible and neutral so an
// unmapped cell can never be blank or throw (fail-safe, matches isWalkable).
const FALLBACK_TILE: CellTile = { char: '?', color: '#cccccc' }

/**
 * The tile (glyph + zone color) for a labeled cell. `variant` picks a canopy
 * tonal shade for tree foliage (ignored by trunk/building). Unknown labels fall
 * back to a safe '?' tile. This is the ONE place that decides a label's look.
 */
export function cellTile(zone: ZoneId, label: string, variant = 0): CellTile {
  const char = CELL_GLYPHS[label as CellLabel]
  if (char === undefined) return FALLBACK_TILE
  return { char, color: colorFor(zone, label as CellLabel, variant) }
}

/** The zone-independent glyph for a label (the structural ASCII char). */
export function cellGlyph(label: string): string {
  return CELL_GLYPHS[label as CellLabel] ?? FALLBACK_TILE.char
}

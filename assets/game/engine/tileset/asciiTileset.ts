/**
 * The current working ASCII art, EXTRACTED into tileset data — "behave the same, load different."
 *
 * Nothing about the look changes: this reproduces `cellTileset.cellTile()` byte-for-byte (proven in
 * asciiTilesetExtraction.test.ts). The ONLY change is shape: the glyph + colour + walkability + swap
 * position are now DATA on a Tileset, not logic hardcoded in the renderer. This object is
 * JSON-serialisable — it is the "loaded" tileset today, and the seed for the Ecto `tiles` rows later.
 */
import { CELL_LABELS, isWalkable, type CellLabel } from '../cellLabels'
import { CELL_GLYPHS, ZONE_VISUALS, TREE_CANOPY_SHADES } from '../cellTileset'
import { GROUND_COLORS } from '@/levels/village'
import type { ZoneId } from '../zones'
import type { Tileset, TilesetTile, TilePosition, ZonePalette } from './tileset'

// label → colour ROLE — the data form of cellTileset.colorFor()'s branching. Trunk/dead-wood → trunk;
// building parts → their part; biome features → their part; everything else (leaves + the autotiled
// mass) → canopy. Kept as an explicit table so the extraction is auditable against colorFor().
const COLOR_ROLE_BY_LABEL: Readonly<Record<CellLabel, string>> = {
  tree_stem_bottom: 'trunk',
  tree_stem: 'trunk',
  tree_snag: 'trunk',
  tree_leaf: 'canopy',
  tree_crown: 'canopy',
  tree_leaf_top: 'canopy',
  tree_top_left: 'canopy',
  tree_top: 'canopy',
  tree_top_right: 'canopy',
  tree_edge_left: 'canopy',
  tree_interior: 'canopy',
  tree_edge_right: 'canopy',
  tree_bottom_left: 'canopy',
  tree_bottom: 'canopy',
  tree_bottom_right: 'canopy',
  roof_top: 'building.roof',
  roof: 'building.roof',
  wall: 'building.wall',
  door: 'building.door',
  window: 'building.window',
  mountain: 'feature.mountain',
  peak: 'feature.peak',
  spill: 'feature.spill',
}

// label → 9-piece POSITION (the swap standard: all sides + corners). Only the tree-MASS labels
// autotile today, so they carry real positions; every other label is 'single' (a whole-tile element).
// Buildings/terrain gain full sides+corners when they become per-cell tiled — the "more specific later".
const POSITION_BY_LABEL: Partial<Readonly<Record<CellLabel, TilePosition>>> = {
  tree_top_left: 'top_left',
  tree_top: 'top',
  tree_top_right: 'top_right',
  tree_edge_left: 'left',
  tree_interior: 'center',
  tree_edge_right: 'right',
  tree_bottom_left: 'bottom_left',
  tree_bottom: 'bottom',
  tree_bottom_right: 'bottom_right',
}

function buildTiles(): Record<string, TilesetTile> {
  const tiles: Record<string, TilesetTile> = {}
  for (const label of CELL_LABELS) {
    tiles[label] = {
      label,
      glyph: CELL_GLYPHS[label],
      position: POSITION_BY_LABEL[label] ?? 'single',
      walkable: isWalkable(label),
      colorRole: COLOR_ROLE_BY_LABEL[label],
    }
  }
  return tiles
}

function buildPalettes(): Record<string, ZonePalette> {
  const palettes: Record<string, ZonePalette> = {}
  for (const zone of Object.keys(ZONE_VISUALS) as ZoneId[]) {
    palettes[zone] = {
      trunk: ZONE_VISUALS[zone].trunk,
      canopy: TREE_CANOPY_SHADES[zone],
      building: ZONE_VISUALS[zone].building,
      feature: ZONE_VISUALS[zone].feature,
    }
  }
  return palettes
}

/** The ACTIVE ASCII tileset. Starts as the bundled default (built from the current art); the backend
 *  loader (tilesetLoader) can REPLACE it with the DB-served tileset — same shape, so render + generation
 *  (which read this LIVE binding) switch to the loaded data with no other change. */
export let ASCII_TILESET: Tileset = {
  id: 'ascii',
  name: 'ASCII',
  tiles: buildTiles(),
  palettes: buildPalettes(),
  terrain: GROUND_COLORS,
}

/** Swap the active ASCII tileset — used to install the one loaded from the nebulith API. */
export function setAsciiTileset(tileset: Tileset): void {
  ASCII_TILESET = tileset
}

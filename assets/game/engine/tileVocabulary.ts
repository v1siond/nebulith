/**
 * TILE VOCABULARY - Standardized character set for ASCII map generation
 *
 * Each character has ONE meaning. No conflicts.
 * Grouped by layer for rendering order.
 */

export interface TileType {
  char: string
  name: string
  layer: 'sky' | 'background' | 'structure' | 'vegetation' | 'ground' | 'entity'
  blocking: boolean
  animated: boolean
  description: string
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 0: SKY (rendered first, never blocks)
// ═══════════════════════════════════════════════════════════════════════════
export const SKY_TILES: TileType[] = [
  { char: 'C', name: 'cloud_dense', layer: 'sky', blocking: false, animated: true, description: 'Dense cloud' },
  { char: 'c', name: 'cloud_light', layer: 'sky', blocking: false, animated: true, description: 'Light cloud' },
  { char: '*', name: 'star', layer: 'sky', blocking: false, animated: true, description: 'Twinkling star' },
  { char: '~', name: 'mist', layer: 'sky', blocking: false, animated: true, description: 'Atmospheric mist' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1: BACKGROUND (mountains, distant scenery)
// ═══════════════════════════════════════════════════════════════════════════
export const BACKGROUND_TILES: TileType[] = [
  { char: 'M', name: 'mountain_left', layer: 'background', blocking: false, animated: false, description: 'Mountain slope left (/)' },
  { char: 'N', name: 'mountain_right', layer: 'background', blocking: false, animated: false, description: 'Mountain slope right (\\)' },
  { char: 'A', name: 'mountain_peak', layer: 'background', blocking: false, animated: false, description: 'Mountain peak (^)' },
  { char: 'S', name: 'snow', layer: 'background', blocking: false, animated: false, description: 'Snow on mountains' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2: STRUCTURE (buildings, castle, platforms)
// ═══════════════════════════════════════════════════════════════════════════
export const STRUCTURE_TILES: TileType[] = [
  // Castle exterior
  { char: '#', name: 'wall_solid', layer: 'structure', blocking: true, animated: false, description: 'Solid wall (blocking)' },
  { char: 'H', name: 'wall_vertical', layer: 'structure', blocking: true, animated: false, description: 'Vertical wall segment' },

  // Castle roof
  { char: 'R', name: 'roof_left', layer: 'structure', blocking: false, animated: false, description: 'Roof slope left' },
  { char: 'r', name: 'roof_right', layer: 'structure', blocking: false, animated: false, description: 'Roof slope right' },
  { char: 'T', name: 'roof_top', layer: 'structure', blocking: false, animated: false, description: 'Roof peak' },

  // Interior elements
  { char: 'P', name: 'pillar', layer: 'structure', blocking: true, animated: false, description: 'Support pillar' },
  { char: 'D', name: 'door', layer: 'structure', blocking: false, animated: false, description: 'Doorway (passable)' },
  { char: 'W', name: 'window', layer: 'structure', blocking: false, animated: false, description: 'Window' },

  // Platforms & stairs
  { char: '=', name: 'platform', layer: 'structure', blocking: false, animated: false, description: 'Platform (jumpable, 1 tile high)' },
  { char: '_', name: 'stairs', layer: 'structure', blocking: false, animated: false, description: 'Stairs (walkable)' },
  { char: '-', name: 'floor', layer: 'structure', blocking: false, animated: false, description: 'Floor decoration' },

  // Lanterns & lights
  { char: 'O', name: 'lantern_large', layer: 'structure', blocking: true, animated: true, description: 'Large lantern (on post)' },
  { char: 'o', name: 'lantern_small', layer: 'structure', blocking: false, animated: true, description: 'Small hanging lantern' },
  { char: 'L', name: 'lantern_post', layer: 'structure', blocking: true, animated: false, description: 'Lantern post (vertical)' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3: VEGETATION (trees, bushes, grass)
// ═══════════════════════════════════════════════════════════════════════════
export const VEGETATION_TILES: TileType[] = [
  // Trees
  { char: 'Y', name: 'tree_crown_top', layer: 'vegetation', blocking: false, animated: true, description: 'Tree crown top' },
  { char: 'y', name: 'tree_crown_mid', layer: 'vegetation', blocking: false, animated: true, description: 'Tree crown middle' },
  { char: 'V', name: 'tree_crown_bottom', layer: 'vegetation', blocking: false, animated: true, description: 'Tree crown bottom' },
  { char: 'I', name: 'tree_trunk', layer: 'vegetation', blocking: true, animated: false, description: 'Tree trunk (blocking)' },

  // Bushes (arbustos)
  { char: 'B', name: 'bush_top', layer: 'vegetation', blocking: true, animated: true, description: 'Bush top' },
  { char: 'b', name: 'bush_body', layer: 'vegetation', blocking: true, animated: true, description: 'Bush body' },

  // Grass & ground cover
  { char: ',', name: 'grass_short', layer: 'vegetation', blocking: false, animated: true, description: 'Short grass' },
  { char: ';', name: 'grass_tall', layer: 'vegetation', blocking: false, animated: true, description: 'Tall grass' },
  { char: 'g', name: 'grass_flower_yellow', layer: 'vegetation', blocking: false, animated: true, description: 'Grass with yellow flowers' },
  { char: ':', name: 'grass_flower_red', layer: 'vegetation', blocking: false, animated: true, description: 'Grass with red flowers' },
  { char: '.', name: 'ground_dot', layer: 'vegetation', blocking: false, animated: false, description: 'Ground decoration' },
  { char: '^', name: 'flower', layer: 'vegetation', blocking: false, animated: true, description: 'Single flower' },
]

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 4: GROUND (floor, boundaries)
// ═══════════════════════════════════════════════════════════════════════════
export const GROUND_TILES: TileType[] = [
  { char: '|', name: 'ground_wall', layer: 'ground', blocking: true, animated: false, description: 'Ground level wall (main boundary)' },
  { char: ' ', name: 'empty', layer: 'ground', blocking: false, animated: false, description: 'Empty/walkable space' },
]

// ═══════════════════════════════════════════════════════════════════════════
// ALL TILES COMBINED
// ═══════════════════════════════════════════════════════════════════════════
export const ALL_TILES: TileType[] = [
  ...SKY_TILES,
  ...BACKGROUND_TILES,
  ...STRUCTURE_TILES,
  ...VEGETATION_TILES,
  ...GROUND_TILES,
]

// Quick lookup by character
export const TILE_BY_CHAR: Record<string, TileType> = ALL_TILES.reduce((acc, tile) => {
  acc[tile.char] = tile
  return acc
}, {} as Record<string, TileType>)

// Check if character blocks
export const isBlocking = (char: string): boolean => {
  return TILE_BY_CHAR[char]?.blocking ?? false
}

// Get layer for z-ordering
export const getLayer = (char: string): string => {
  return TILE_BY_CHAR[char]?.layer ?? 'ground'
}

/**
 * MIGRATION MAPPING
 * Maps old characters to new standardized characters
 */
export const LEGACY_TO_NEW: Record<string, string> = {
  // Clouds (was 8)
  '8': 'C',

  // Mountains (was /\)
  // Context-dependent - mountains use M/N, castle roof uses R/r
  // This requires position-aware mapping

  // Trees (was (&@) and 0W)
  // '(&)': 'Y',      // tree top - needs multi-char handling
  // '(@&@)': 'yYy',  // tree crown
  // '0W0': 'IOI',    // tree trunk with lantern
  // 'W0W': 'LOL',    // lantern post

  // Bushes (was @@ (&&) (@@))
  // ' @@ ': ' BB ',
  // '(&&)': 'bBBb',
  // '(@@)': 'bBBb',

  // These stay the same
  ',': ',',
  ';': ';',
  'g': 'g',
  ':': ':',
  '.': '.',
  '^': '^',
  '=': '=',
  '_': '_',
  '-': '-',
  '*': '*',
  '~': '~',
  ' ': ' ',
}

/**
 * For complex multi-character patterns, we need pattern matching
 */
export const LEGACY_PATTERNS = [
  // Tree crowns (need to identify by shape)
  { pattern: /\((&@)+\)/g, replacement: (match: string) => 'Y'.repeat(match.length) },
  { pattern: /\((@&)+\)/g, replacement: (match: string) => 'y'.repeat(match.length) },

  // Tree trunks
  { pattern: /[0W]{3}/g, replacement: 'IOI' },

  // Bushes at ground level
  { pattern: / @@ /g, replacement: ' BB ' },
  { pattern: /\(&&\)/g, replacement: 'bBBb' },
  { pattern: /\(@@\)/g, replacement: 'bBBb' },

  // Mountains vs Roof (context: row < 20 = mountain, else = roof)
  // This needs row-aware processing
]

/**
 * TILESET SYSTEM
 * Individual tile parts that combine to form complex assets
 *
 * Philosophy:
 * - Tiles are atomic building blocks (trunk, leaf, wall, roof piece)
 * - Assets are combinations of tiles with positions and heights
 * - Common assets are pre-defined combinations (tree, house, tower)
 */

// ═══════════════════════════════════════════════════════════════════
// TILE DEFINITIONS - Atomic building blocks
// ═══════════════════════════════════════════════════════════════════

export interface TileDef {
  char: string
  name: string
  category: 'nature' | 'building' | 'decoration' | 'ground'
  fg: string
  bg: string
  blocking?: boolean
  description?: string
}

export const TILES: Record<string, TileDef> = {
  // ─── NATURE PARTS ─────────────────────────────────────────────────

  // Tree/plant parts
  trunk: {
    char: '│',
    name: 'Trunk',
    category: 'nature',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: true,
    description: 'Vertical wood piece - tree trunks, poles'
  },
  trunk_thick: {
    char: '║',
    name: 'Thick Trunk',
    category: 'nature',
    fg: '#6B3510',
    bg: '#2d1808',
    blocking: true,
    description: 'Wide trunk for large trees'
  },
  branch_left: {
    char: '╱',
    name: 'Branch Left',
    category: 'nature',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: false,
    description: 'Diagonal branch going left-up'
  },
  branch_right: {
    char: '╲',
    name: 'Branch Right',
    category: 'nature',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: false,
    description: 'Diagonal branch going right-up'
  },
  foliage: {
    char: '@',
    name: 'Foliage',
    category: 'nature',
    fg: '#33cc33',
    bg: '#0a3310',
    blocking: true,
    description: 'Dense leaves - tree tops, bushes'
  },
  foliage_light: {
    char: '*',
    name: 'Light Foliage',
    category: 'nature',
    fg: '#55dd55',
    bg: '#0a2a0a',
    blocking: false,
    description: 'Sparse leaves - bush edges, small plants'
  },
  foliage_dark: {
    char: '&',
    name: 'Dark Foliage',
    category: 'nature',
    fg: '#228822',
    bg: '#051505',
    blocking: true,
    description: 'Shadow/inner foliage'
  },
  roots: {
    char: '~',
    name: 'Roots',
    category: 'nature',
    fg: '#5a3a1a',
    bg: '#2a1a0a',
    blocking: false,
    description: 'Tree roots at ground level'
  },
  stump: {
    char: 'o',
    name: 'Stump',
    category: 'nature',
    fg: '#6B4423',
    bg: '#3d2010',
    blocking: true,
    description: 'Cut tree stump'
  },

  // ─── BUILDING PARTS ───────────────────────────────────────────────

  // Walls
  wall: {
    char: '█',
    name: 'Wall',
    category: 'building',
    fg: '#aa7755',
    bg: '#442211',
    blocking: true,
    description: 'Solid wall block'
  },
  wall_stone: {
    char: '▓',
    name: 'Stone Wall',
    category: 'building',
    fg: '#888888',
    bg: '#333333',
    blocking: true,
    description: 'Stone/brick wall'
  },
  wall_light: {
    char: '░',
    name: 'Light Wall',
    category: 'building',
    fg: '#ccaa88',
    bg: '#665533',
    blocking: true,
    description: 'Lighter interior wall'
  },

  // Openings
  window: {
    char: '▒',
    name: 'Window',
    category: 'building',
    fg: '#88ccff',
    bg: '#334455',
    blocking: true,
    description: 'Wall with window'
  },
  door: {
    char: '▌',
    name: 'Door',
    category: 'building',
    fg: '#664422',
    bg: '#221100',
    blocking: false,
    description: 'Doorway (walkable)'
  },
  door_closed: {
    char: '▐',
    name: 'Closed Door',
    category: 'building',
    fg: '#553311',
    bg: '#221100',
    blocking: true,
    description: 'Closed door (blocking)'
  },

  // Roof pieces
  roof_flat: {
    char: '▀',
    name: 'Flat Roof',
    category: 'building',
    fg: '#dd7755',
    bg: '#552211',
    blocking: true,
    description: 'Flat roof top'
  },
  roof_left: {
    char: '◢',
    name: 'Roof Left',
    category: 'building',
    fg: '#cc6644',
    bg: '#441100',
    blocking: true,
    description: 'Sloped roof (left side)'
  },
  roof_right: {
    char: '◣',
    name: 'Roof Right',
    category: 'building',
    fg: '#cc6644',
    bg: '#441100',
    blocking: true,
    description: 'Sloped roof (right side)'
  },
  roof_peak: {
    char: '▲',
    name: 'Roof Peak',
    category: 'building',
    fg: '#bb5533',
    bg: '#330000',
    blocking: true,
    description: 'Roof peak/tip'
  },

  // Structural
  column: {
    char: '┃',
    name: 'Column',
    category: 'building',
    fg: '#aaaaaa',
    bg: '#444444',
    blocking: true,
    description: 'Vertical support column'
  },
  beam_h: {
    char: '━',
    name: 'Beam (H)',
    category: 'building',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: true,
    description: 'Horizontal beam'
  },
  beam_v: {
    char: '┃',
    name: 'Beam (V)',
    category: 'building',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: true,
    description: 'Vertical beam'
  },
  floor: {
    char: '▪',
    name: 'Floor',
    category: 'building',
    fg: '#aa9977',
    bg: '#554433',
    blocking: false,
    description: 'Indoor floor tile'
  },

  // ─── DECORATION PARTS ─────────────────────────────────────────────

  lamp: {
    char: '!',
    name: 'Lamp',
    category: 'decoration',
    fg: '#ffff44',
    bg: '#333300',
    blocking: true,
    description: 'Light source'
  },
  lamp_post: {
    char: '╻',
    name: 'Lamp Post',
    category: 'decoration',
    fg: '#444444',
    bg: '#222222',
    blocking: true,
    description: 'Lamp post base'
  },
  crate: {
    char: '$',
    name: 'Crate',
    category: 'decoration',
    fg: '#ddaa55',
    bg: '#332211',
    blocking: true,
    description: 'Wooden crate'
  },
  barrel: {
    char: 'O',
    name: 'Barrel',
    category: 'decoration',
    fg: '#8b6914',
    bg: '#3d2e0a',
    blocking: true,
    description: 'Wooden barrel'
  },
  flower: {
    char: '+',
    name: 'Flower',
    category: 'decoration',
    fg: '#ff88cc',
    bg: '#220a11',
    blocking: false,
    description: 'Small flower'
  },
  flower_yellow: {
    char: '+',
    name: 'Yellow Flower',
    category: 'decoration',
    fg: '#ffaa44',
    bg: '#221100',
    blocking: false,
    description: 'Yellow flower'
  },
  rock: {
    char: '●',
    name: 'Rock',
    category: 'decoration',
    fg: '#777777',
    bg: '#333333',
    blocking: true,
    description: 'Boulder/rock'
  },
  rock_small: {
    char: '·',
    name: 'Pebble',
    category: 'decoration',
    fg: '#666666',
    bg: '#222222',
    blocking: false,
    description: 'Small rock/pebble'
  },
  fence_h: {
    char: '─',
    name: 'Fence (H)',
    category: 'decoration',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: true,
    description: 'Horizontal fence'
  },
  fence_v: {
    char: '│',
    name: 'Fence (V)',
    category: 'decoration',
    fg: '#8B4513',
    bg: '#3d2010',
    blocking: true,
    description: 'Vertical fence'
  },
  fence_corner: {
    char: '┼',
    name: 'Fence Post',
    category: 'decoration',
    fg: '#6B3510',
    bg: '#2d1808',
    blocking: true,
    description: 'Fence corner/post'
  },
  sign: {
    char: '¶',
    name: 'Sign',
    category: 'decoration',
    fg: '#ddaa55',
    bg: '#332211',
    blocking: true,
    description: 'Signpost'
  },
  well_edge: {
    char: '◯',
    name: 'Well Edge',
    category: 'decoration',
    fg: '#888888',
    bg: '#333333',
    blocking: true,
    description: 'Stone well rim'
  },

  // ─── CHARACTERS ───────────────────────────────────────────────────

  npc: {
    char: '☺',
    name: 'NPC',
    category: 'decoration',
    fg: '#ffdd00',
    bg: '#333311',
    blocking: true,
    description: 'Non-player character'
  },
  npc_alt: {
    char: '☻',
    name: 'NPC (Dark)',
    category: 'decoration',
    fg: '#ddbb00',
    bg: '#222211',
    blocking: true,
    description: 'Alternative NPC style'
  },

  // ─── TERRAIN / ELEVATION ──────────────────────────────────────────

  cliff_top: {
    char: '▀',
    name: 'Cliff Top',
    category: 'ground',
    fg: '#8b6914',
    bg: '#5a4510',
    blocking: true,
    description: 'Top edge of cliff'
  },
  cliff_face: {
    char: '█',
    name: 'Cliff Face',
    category: 'ground',
    fg: '#6b4914',
    bg: '#3a2508',
    blocking: true,
    description: 'Cliff wall face'
  },
  cliff_shadow: {
    char: '▄',
    name: 'Cliff Shadow',
    category: 'ground',
    fg: '#3a2508',
    bg: '#1a1204',
    blocking: true,
    description: 'Shadow at cliff base'
  },
  stairs_up: {
    char: '≡',
    name: 'Stairs Up',
    category: 'ground',
    fg: '#998866',
    bg: '#554433',
    blocking: false,
    description: 'Stairs going up elevation'
  },
  stairs_down: {
    char: '≡',
    name: 'Stairs Down',
    category: 'ground',
    fg: '#776644',
    bg: '#443322',
    blocking: false,
    description: 'Stairs going down elevation'
  },

  // ─── WATER ────────────────────────────────────────────────────────

  water_deep: {
    char: '≈',
    name: 'Deep Water',
    category: 'ground',
    fg: '#1144aa',
    bg: '#0a2255',
    blocking: true,
    description: 'Deep water (impassable)'
  },
  water_shallow: {
    char: '~',
    name: 'Shallow Water',
    category: 'ground',
    fg: '#4488dd',
    bg: '#2266aa',
    blocking: false,
    description: 'Shallow water (walkable)'
  },
  water_edge: {
    char: '▒',
    name: 'Water Edge',
    category: 'ground',
    fg: '#88aacc',
    bg: '#446688',
    blocking: false,
    description: 'Shore/water edge'
  },

  // ─── PATHS ────────────────────────────────────────────────────────

  path_stone: {
    char: '░',
    name: 'Stone Path',
    category: 'ground',
    fg: '#ccbbaa',
    bg: '#998877',
    blocking: false,
    description: 'Cobblestone path'
  },
  path_dirt: {
    char: '·',
    name: 'Dirt Path',
    category: 'ground',
    fg: '#aa9977',
    bg: '#776655',
    blocking: false,
    description: 'Dirt/sand path'
  },
  grass_tall: {
    char: '"',
    name: 'Tall Grass',
    category: 'ground',
    fg: '#55aa44',
    bg: '#338833',
    blocking: false,
    description: 'Tall grass'
  },
}

// ═══════════════════════════════════════════════════════════════════
// COMPOSITE ASSETS - Pre-defined tile combinations
// ═══════════════════════════════════════════════════════════════════

export interface TilePlacement {
  tile: keyof typeof TILES
  dx: number      // X offset from asset origin
  dy: number      // Y offset from asset origin
  height: number  // Height level (0 = ground)
  colorOverride?: string  // Optional color override
}

export interface CompositeAsset {
  name: string
  description: string
  category: 'nature' | 'building' | 'decoration'
  width: number
  depth: number
  tiles: TilePlacement[]
}

export const COMPOSITE_ASSETS: Record<string, CompositeAsset> = {
  // ═══════════════════════════════════════════════════════════════════
  // TREES - Zelda-style round bushy trees
  // ═══════════════════════════════════════════════════════════════════

  tree_round: {
    name: 'Round Tree',
    description: 'Classic Zelda-style round bushy tree (2x2)',
    category: 'nature',
    width: 2,
    depth: 2,
    tiles: [
      // Trunk at center bottom
      { tile: 'trunk', dx: 0, dy: 1, height: 0 },
      { tile: 'trunk', dx: 1, dy: 1, height: 0 },
      // Canopy layer 1 (shadow/base)
      { tile: 'foliage_dark', dx: 0, dy: 0, height: 1 },
      { tile: 'foliage_dark', dx: 1, dy: 0, height: 1 },
      { tile: 'foliage_dark', dx: 0, dy: 1, height: 1 },
      { tile: 'foliage_dark', dx: 1, dy: 1, height: 1 },
      // Canopy layer 2 (main)
      { tile: 'foliage', dx: 0, dy: 0, height: 2 },
      { tile: 'foliage', dx: 1, dy: 0, height: 2 },
      { tile: 'foliage', dx: 0, dy: 1, height: 2 },
      { tile: 'foliage', dx: 1, dy: 1, height: 2 },
      // Top highlight
      { tile: 'foliage_light', dx: 0, dy: 0, height: 3 },
      { tile: 'foliage_light', dx: 1, dy: 0, height: 3 },
    ]
  },

  tree_large: {
    name: 'Large Tree',
    description: 'Big round tree (3x3)',
    category: 'nature',
    width: 3,
    depth: 3,
    tiles: [
      // Central trunk
      { tile: 'trunk_thick', dx: 1, dy: 2, height: 0 },
      { tile: 'trunk_thick', dx: 1, dy: 2, height: 1 },
      // Canopy layer 1 (shadow ring)
      { tile: 'foliage_dark', dx: 0, dy: 1, height: 2 },
      { tile: 'foliage_dark', dx: 1, dy: 0, height: 2 },
      { tile: 'foliage_dark', dx: 2, dy: 1, height: 2 },
      { tile: 'foliage_dark', dx: 1, dy: 2, height: 2 },
      { tile: 'foliage_dark', dx: 1, dy: 1, height: 2 },
      // Canopy layer 2 (full)
      { tile: 'foliage', dx: 0, dy: 0, height: 3 },
      { tile: 'foliage', dx: 1, dy: 0, height: 3 },
      { tile: 'foliage', dx: 2, dy: 0, height: 3 },
      { tile: 'foliage', dx: 0, dy: 1, height: 3 },
      { tile: 'foliage', dx: 1, dy: 1, height: 3 },
      { tile: 'foliage', dx: 2, dy: 1, height: 3 },
      { tile: 'foliage', dx: 0, dy: 2, height: 3 },
      { tile: 'foliage', dx: 1, dy: 2, height: 3 },
      { tile: 'foliage', dx: 2, dy: 2, height: 3 },
      // Top highlight
      { tile: 'foliage_light', dx: 1, dy: 0, height: 4 },
      { tile: 'foliage_light', dx: 0, dy: 1, height: 4 },
      { tile: 'foliage_light', dx: 1, dy: 1, height: 4 },
      { tile: 'foliage_light', dx: 2, dy: 1, height: 4 },
    ]
  },

  tree_cherry: {
    name: 'Cherry Tree',
    description: 'Pink blossom tree (2x2)',
    category: 'nature',
    width: 2,
    depth: 2,
    tiles: [
      { tile: 'trunk', dx: 0, dy: 1, height: 0 },
      { tile: 'trunk', dx: 1, dy: 1, height: 0 },
      { tile: 'foliage_dark', dx: 0, dy: 0, height: 1, colorOverride: '#aa5577' },
      { tile: 'foliage_dark', dx: 1, dy: 0, height: 1, colorOverride: '#aa5577' },
      { tile: 'foliage_dark', dx: 0, dy: 1, height: 1, colorOverride: '#aa5577' },
      { tile: 'foliage_dark', dx: 1, dy: 1, height: 1, colorOverride: '#aa5577' },
      { tile: 'foliage', dx: 0, dy: 0, height: 2, colorOverride: '#ffaacc' },
      { tile: 'foliage', dx: 1, dy: 0, height: 2, colorOverride: '#ffaacc' },
      { tile: 'foliage', dx: 0, dy: 1, height: 2, colorOverride: '#ffaacc' },
      { tile: 'foliage', dx: 1, dy: 1, height: 2, colorOverride: '#ffaacc' },
      { tile: 'foliage_light', dx: 0, dy: 0, height: 3, colorOverride: '#ffccdd' },
      { tile: 'foliage_light', dx: 1, dy: 0, height: 3, colorOverride: '#ffccdd' },
    ]
  },

  bush: {
    name: 'Bush',
    description: 'Low hedge/shrub',
    category: 'nature',
    width: 1,
    depth: 1,
    tiles: [
      { tile: 'foliage', dx: 0, dy: 0, height: 0 },
      { tile: 'foliage_light', dx: 0, dy: 0, height: 1 },
    ]
  },

  hedge_row: {
    name: 'Hedge Row',
    description: 'Horizontal hedge (3 wide)',
    category: 'nature',
    width: 3,
    depth: 1,
    tiles: [
      { tile: 'foliage', dx: 0, dy: 0, height: 0 },
      { tile: 'foliage', dx: 1, dy: 0, height: 0 },
      { tile: 'foliage', dx: 2, dy: 0, height: 0 },
      { tile: 'foliage_light', dx: 0, dy: 0, height: 1 },
      { tile: 'foliage_light', dx: 1, dy: 0, height: 1 },
      { tile: 'foliage_light', dx: 2, dy: 0, height: 1 },
    ]
  },

  // ═══════════════════════════════════════════════════════════════════
  // BUILDINGS - Zelda-style houses (5x3 minimum)
  // 2 rows roof, 3 rows walls, center door
  // ═══════════════════════════════════════════════════════════════════

  house_village: {
    name: 'Village House',
    description: 'Standard Zelda-style house (5x3)',
    category: 'building',
    width: 5,
    depth: 3,
    tiles: [
      // === WALL ROWS (3 rows high) ===
      // Row 0 (back wall)
      { tile: 'wall', dx: 0, dy: 0, height: 0 },
      { tile: 'wall', dx: 1, dy: 0, height: 0 },
      { tile: 'wall', dx: 2, dy: 0, height: 0 },
      { tile: 'wall', dx: 3, dy: 0, height: 0 },
      { tile: 'wall', dx: 4, dy: 0, height: 0 },
      // Row 1 (side walls + interior)
      { tile: 'wall', dx: 0, dy: 1, height: 0 },
      { tile: 'floor', dx: 1, dy: 1, height: 0 },
      { tile: 'floor', dx: 2, dy: 1, height: 0 },
      { tile: 'floor', dx: 3, dy: 1, height: 0 },
      { tile: 'wall', dx: 4, dy: 1, height: 0 },
      // Row 2 (front wall with door)
      { tile: 'wall', dx: 0, dy: 2, height: 0 },
      { tile: 'wall', dx: 1, dy: 2, height: 0 },
      { tile: 'door', dx: 2, dy: 2, height: 0 },
      { tile: 'wall', dx: 3, dy: 2, height: 0 },
      { tile: 'wall', dx: 4, dy: 2, height: 0 },
      // Second level walls with windows
      { tile: 'wall', dx: 0, dy: 0, height: 1 },
      { tile: 'window', dx: 1, dy: 0, height: 1 },
      { tile: 'wall', dx: 2, dy: 0, height: 1 },
      { tile: 'window', dx: 3, dy: 0, height: 1 },
      { tile: 'wall', dx: 4, dy: 0, height: 1 },
      { tile: 'wall', dx: 0, dy: 1, height: 1 },
      { tile: 'floor', dx: 1, dy: 1, height: 1 },
      { tile: 'floor', dx: 2, dy: 1, height: 1 },
      { tile: 'floor', dx: 3, dy: 1, height: 1 },
      { tile: 'wall', dx: 4, dy: 1, height: 1 },
      { tile: 'wall', dx: 0, dy: 2, height: 1 },
      { tile: 'window', dx: 1, dy: 2, height: 1 },
      { tile: 'wall', dx: 2, dy: 2, height: 1 },
      { tile: 'window', dx: 3, dy: 2, height: 1 },
      { tile: 'wall', dx: 4, dy: 2, height: 1 },
      // Third level walls
      { tile: 'wall', dx: 0, dy: 0, height: 2 },
      { tile: 'wall', dx: 1, dy: 0, height: 2 },
      { tile: 'wall', dx: 2, dy: 0, height: 2 },
      { tile: 'wall', dx: 3, dy: 0, height: 2 },
      { tile: 'wall', dx: 4, dy: 0, height: 2 },
      { tile: 'wall', dx: 0, dy: 1, height: 2 },
      { tile: 'floor', dx: 1, dy: 1, height: 2 },
      { tile: 'floor', dx: 2, dy: 1, height: 2 },
      { tile: 'floor', dx: 3, dy: 1, height: 2 },
      { tile: 'wall', dx: 4, dy: 1, height: 2 },
      { tile: 'wall', dx: 0, dy: 2, height: 2 },
      { tile: 'wall', dx: 1, dy: 2, height: 2 },
      { tile: 'wall', dx: 2, dy: 2, height: 2 },
      { tile: 'wall', dx: 3, dy: 2, height: 2 },
      { tile: 'wall', dx: 4, dy: 2, height: 2 },
      // === ROOF (2 rows) ===
      // Roof row 1 (eaves)
      { tile: 'roof_left', dx: 0, dy: 0, height: 3 },
      { tile: 'roof_flat', dx: 1, dy: 0, height: 3 },
      { tile: 'roof_peak', dx: 2, dy: 0, height: 3 },
      { tile: 'roof_flat', dx: 3, dy: 0, height: 3 },
      { tile: 'roof_right', dx: 4, dy: 0, height: 3 },
      { tile: 'roof_flat', dx: 0, dy: 1, height: 3 },
      { tile: 'roof_flat', dx: 1, dy: 1, height: 3 },
      { tile: 'roof_flat', dx: 2, dy: 1, height: 3 },
      { tile: 'roof_flat', dx: 3, dy: 1, height: 3 },
      { tile: 'roof_flat', dx: 4, dy: 1, height: 3 },
      { tile: 'roof_left', dx: 0, dy: 2, height: 3 },
      { tile: 'roof_flat', dx: 1, dy: 2, height: 3 },
      { tile: 'roof_peak', dx: 2, dy: 2, height: 3 },
      { tile: 'roof_flat', dx: 3, dy: 2, height: 3 },
      { tile: 'roof_right', dx: 4, dy: 2, height: 3 },
      // Roof row 2 (ridge)
      { tile: 'roof_peak', dx: 1, dy: 0, height: 4 },
      { tile: 'roof_peak', dx: 2, dy: 0, height: 4 },
      { tile: 'roof_peak', dx: 3, dy: 0, height: 4 },
      { tile: 'roof_peak', dx: 1, dy: 1, height: 4 },
      { tile: 'roof_peak', dx: 2, dy: 1, height: 4 },
      { tile: 'roof_peak', dx: 3, dy: 1, height: 4 },
      { tile: 'roof_peak', dx: 1, dy: 2, height: 4 },
      { tile: 'roof_peak', dx: 2, dy: 2, height: 4 },
      { tile: 'roof_peak', dx: 3, dy: 2, height: 4 },
    ]
  },

  house_large: {
    name: 'Large House',
    description: 'Wide village house (7x4)',
    category: 'building',
    width: 7,
    depth: 4,
    tiles: [
      // Simplified: just walls + roof pattern
      // Ground floor walls
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'wall' as keyof typeof TILES, dx: x, dy: 0, height: 0 })),
      { tile: 'wall', dx: 0, dy: 1, height: 0 }, { tile: 'floor', dx: 1, dy: 1, height: 0 }, { tile: 'floor', dx: 2, dy: 1, height: 0 }, { tile: 'floor', dx: 3, dy: 1, height: 0 }, { tile: 'floor', dx: 4, dy: 1, height: 0 }, { tile: 'floor', dx: 5, dy: 1, height: 0 }, { tile: 'wall', dx: 6, dy: 1, height: 0 },
      { tile: 'wall', dx: 0, dy: 2, height: 0 }, { tile: 'floor', dx: 1, dy: 2, height: 0 }, { tile: 'floor', dx: 2, dy: 2, height: 0 }, { tile: 'floor', dx: 3, dy: 2, height: 0 }, { tile: 'floor', dx: 4, dy: 2, height: 0 }, { tile: 'floor', dx: 5, dy: 2, height: 0 }, { tile: 'wall', dx: 6, dy: 2, height: 0 },
      { tile: 'wall', dx: 0, dy: 3, height: 0 }, { tile: 'wall', dx: 1, dy: 3, height: 0 }, { tile: 'wall', dx: 2, dy: 3, height: 0 }, { tile: 'door', dx: 3, dy: 3, height: 0 }, { tile: 'wall', dx: 4, dy: 3, height: 0 }, { tile: 'wall', dx: 5, dy: 3, height: 0 }, { tile: 'wall', dx: 6, dy: 3, height: 0 },
      // Level 1 with windows
      ...Array.from({ length: 7 }, (_, x) => ({ tile: (x % 2 === 1 ? 'window' : 'wall') as keyof typeof TILES, dx: x, dy: 0, height: 1 })),
      { tile: 'wall', dx: 0, dy: 1, height: 1 }, { tile: 'floor', dx: 1, dy: 1, height: 1 }, { tile: 'floor', dx: 2, dy: 1, height: 1 }, { tile: 'floor', dx: 3, dy: 1, height: 1 }, { tile: 'floor', dx: 4, dy: 1, height: 1 }, { tile: 'floor', dx: 5, dy: 1, height: 1 }, { tile: 'wall', dx: 6, dy: 1, height: 1 },
      { tile: 'wall', dx: 0, dy: 2, height: 1 }, { tile: 'floor', dx: 1, dy: 2, height: 1 }, { tile: 'floor', dx: 2, dy: 2, height: 1 }, { tile: 'floor', dx: 3, dy: 2, height: 1 }, { tile: 'floor', dx: 4, dy: 2, height: 1 }, { tile: 'floor', dx: 5, dy: 2, height: 1 }, { tile: 'wall', dx: 6, dy: 2, height: 1 },
      ...Array.from({ length: 7 }, (_, x) => ({ tile: (x % 2 === 1 ? 'window' : 'wall') as keyof typeof TILES, dx: x, dy: 3, height: 1 })),
      // Level 2 walls
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'wall' as keyof typeof TILES, dx: x, dy: 0, height: 2 })),
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'wall' as keyof typeof TILES, dx: x, dy: 3, height: 2 })),
      { tile: 'wall', dx: 0, dy: 1, height: 2 }, { tile: 'floor', dx: 1, dy: 1, height: 2 }, { tile: 'floor', dx: 2, dy: 1, height: 2 }, { tile: 'floor', dx: 3, dy: 1, height: 2 }, { tile: 'floor', dx: 4, dy: 1, height: 2 }, { tile: 'floor', dx: 5, dy: 1, height: 2 }, { tile: 'wall', dx: 6, dy: 1, height: 2 },
      { tile: 'wall', dx: 0, dy: 2, height: 2 }, { tile: 'floor', dx: 1, dy: 2, height: 2 }, { tile: 'floor', dx: 2, dy: 2, height: 2 }, { tile: 'floor', dx: 3, dy: 2, height: 2 }, { tile: 'floor', dx: 4, dy: 2, height: 2 }, { tile: 'floor', dx: 5, dy: 2, height: 2 }, { tile: 'wall', dx: 6, dy: 2, height: 2 },
      // Roof
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'roof_flat' as keyof typeof TILES, dx: x, dy: 0, height: 3 })),
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'roof_flat' as keyof typeof TILES, dx: x, dy: 1, height: 3 })),
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'roof_flat' as keyof typeof TILES, dx: x, dy: 2, height: 3 })),
      ...Array.from({ length: 7 }, (_, x) => ({ tile: 'roof_flat' as keyof typeof TILES, dx: x, dy: 3, height: 3 })),
      // Roof ridge
      ...Array.from({ length: 5 }, (_, x) => ({ tile: 'roof_peak' as keyof typeof TILES, dx: x + 1, dy: 1, height: 4 })),
      ...Array.from({ length: 5 }, (_, x) => ({ tile: 'roof_peak' as keyof typeof TILES, dx: x + 1, dy: 2, height: 4 })),
    ]
  },

  house_small: {
    name: 'Small House',
    description: 'Compact cottage (4x3)',
    category: 'building',
    width: 4,
    depth: 3,
    tiles: [
      // Ground floor
      { tile: 'wall', dx: 0, dy: 0, height: 0 }, { tile: 'wall', dx: 1, dy: 0, height: 0 }, { tile: 'wall', dx: 2, dy: 0, height: 0 }, { tile: 'wall', dx: 3, dy: 0, height: 0 },
      { tile: 'wall', dx: 0, dy: 1, height: 0 }, { tile: 'floor', dx: 1, dy: 1, height: 0 }, { tile: 'floor', dx: 2, dy: 1, height: 0 }, { tile: 'wall', dx: 3, dy: 1, height: 0 },
      { tile: 'wall', dx: 0, dy: 2, height: 0 }, { tile: 'door', dx: 1, dy: 2, height: 0 }, { tile: 'wall', dx: 2, dy: 2, height: 0 }, { tile: 'wall', dx: 3, dy: 2, height: 0 },
      // Second floor with windows
      { tile: 'wall', dx: 0, dy: 0, height: 1 }, { tile: 'window', dx: 1, dy: 0, height: 1 }, { tile: 'window', dx: 2, dy: 0, height: 1 }, { tile: 'wall', dx: 3, dy: 0, height: 1 },
      { tile: 'wall', dx: 0, dy: 1, height: 1 }, { tile: 'floor', dx: 1, dy: 1, height: 1 }, { tile: 'floor', dx: 2, dy: 1, height: 1 }, { tile: 'wall', dx: 3, dy: 1, height: 1 },
      { tile: 'wall', dx: 0, dy: 2, height: 1 }, { tile: 'window', dx: 1, dy: 2, height: 1 }, { tile: 'wall', dx: 2, dy: 2, height: 1 }, { tile: 'wall', dx: 3, dy: 2, height: 1 },
      // Third floor walls
      { tile: 'wall', dx: 0, dy: 0, height: 2 }, { tile: 'wall', dx: 1, dy: 0, height: 2 }, { tile: 'wall', dx: 2, dy: 0, height: 2 }, { tile: 'wall', dx: 3, dy: 0, height: 2 },
      { tile: 'wall', dx: 0, dy: 1, height: 2 }, { tile: 'floor', dx: 1, dy: 1, height: 2 }, { tile: 'floor', dx: 2, dy: 1, height: 2 }, { tile: 'wall', dx: 3, dy: 1, height: 2 },
      { tile: 'wall', dx: 0, dy: 2, height: 2 }, { tile: 'wall', dx: 1, dy: 2, height: 2 }, { tile: 'wall', dx: 2, dy: 2, height: 2 }, { tile: 'wall', dx: 3, dy: 2, height: 2 },
      // Roof
      { tile: 'roof_left', dx: 0, dy: 0, height: 3 }, { tile: 'roof_flat', dx: 1, dy: 0, height: 3 }, { tile: 'roof_flat', dx: 2, dy: 0, height: 3 }, { tile: 'roof_right', dx: 3, dy: 0, height: 3 },
      { tile: 'roof_flat', dx: 0, dy: 1, height: 3 }, { tile: 'roof_flat', dx: 1, dy: 1, height: 3 }, { tile: 'roof_flat', dx: 2, dy: 1, height: 3 }, { tile: 'roof_flat', dx: 3, dy: 1, height: 3 },
      { tile: 'roof_left', dx: 0, dy: 2, height: 3 }, { tile: 'roof_flat', dx: 1, dy: 2, height: 3 }, { tile: 'roof_flat', dx: 2, dy: 2, height: 3 }, { tile: 'roof_right', dx: 3, dy: 2, height: 3 },
      // Roof ridge
      { tile: 'roof_peak', dx: 1, dy: 0, height: 4 }, { tile: 'roof_peak', dx: 2, dy: 0, height: 4 },
      { tile: 'roof_peak', dx: 1, dy: 1, height: 4 }, { tile: 'roof_peak', dx: 2, dy: 1, height: 4 },
      { tile: 'roof_peak', dx: 1, dy: 2, height: 4 }, { tile: 'roof_peak', dx: 2, dy: 2, height: 4 },
    ]
  },

  tower: {
    name: 'Tower',
    description: 'Tall stone tower (2x2)',
    category: 'building',
    width: 2,
    depth: 2,
    tiles: [
      // Base through level 4
      ...Array.from({ length: 5 }, (_, h) => [
        { tile: 'wall_stone' as keyof typeof TILES, dx: 0, dy: 0, height: h },
        { tile: (h === 0 ? 'door' : h === 2 || h === 4 ? 'window' : 'wall_stone') as keyof typeof TILES, dx: 1, dy: 0, height: h },
        { tile: (h === 2 || h === 4 ? 'window' : 'wall_stone') as keyof typeof TILES, dx: 0, dy: 1, height: h },
        { tile: 'wall_stone' as keyof typeof TILES, dx: 1, dy: 1, height: h },
      ]).flat(),
      // Roof
      { tile: 'roof_peak', dx: 0, dy: 0, height: 5 }, { tile: 'roof_peak', dx: 1, dy: 0, height: 5 },
      { tile: 'roof_peak', dx: 0, dy: 1, height: 5 }, { tile: 'roof_peak', dx: 1, dy: 1, height: 5 },
    ]
  },

  // ═══════════════════════════════════════════════════════════════════
  // DECORATIONS
  // ═══════════════════════════════════════════════════════════════════

  lamppost: {
    name: 'Lamp Post',
    description: 'Street lamp',
    category: 'decoration',
    width: 1,
    depth: 1,
    tiles: [
      { tile: 'lamp_post', dx: 0, dy: 0, height: 0 },
      { tile: 'lamp_post', dx: 0, dy: 0, height: 1 },
      { tile: 'lamp', dx: 0, dy: 0, height: 2 },
    ]
  },

  well: {
    name: 'Well',
    description: 'Stone water well',
    category: 'decoration',
    width: 2,
    depth: 2,
    tiles: [
      { tile: 'well_edge', dx: 0, dy: 0, height: 0 },
      { tile: 'well_edge', dx: 1, dy: 0, height: 0 },
      { tile: 'well_edge', dx: 0, dy: 1, height: 0 },
      { tile: 'well_edge', dx: 1, dy: 1, height: 0 },
    ]
  },

  fence_row: {
    name: 'Fence Row',
    description: 'Horizontal fence (5 wide)',
    category: 'decoration',
    width: 5,
    depth: 1,
    tiles: [
      { tile: 'fence_corner', dx: 0, dy: 0, height: 0 },
      { tile: 'fence_h', dx: 1, dy: 0, height: 0 },
      { tile: 'fence_h', dx: 2, dy: 0, height: 0 },
      { tile: 'fence_h', dx: 3, dy: 0, height: 0 },
      { tile: 'fence_corner', dx: 4, dy: 0, height: 0 },
    ]
  },

  barrel_group: {
    name: 'Barrel Group',
    description: 'Cluster of barrels',
    category: 'decoration',
    width: 2,
    depth: 2,
    tiles: [
      { tile: 'barrel', dx: 0, dy: 0, height: 0 },
      { tile: 'barrel', dx: 1, dy: 0, height: 0 },
      { tile: 'barrel', dx: 0, dy: 1, height: 0 },
      { tile: 'crate', dx: 1, dy: 1, height: 0 },
    ]
  },

  crate_stack: {
    name: 'Crate Stack',
    description: 'Stacked wooden crates',
    category: 'decoration',
    width: 1,
    depth: 1,
    tiles: [
      { tile: 'crate', dx: 0, dy: 0, height: 0 },
      { tile: 'crate', dx: 0, dy: 0, height: 1 },
    ]
  },

  flower_bed: {
    name: 'Flower Bed',
    description: 'Row of flowers',
    category: 'decoration',
    width: 3,
    depth: 1,
    tiles: [
      { tile: 'flower', dx: 0, dy: 0, height: 0 },
      { tile: 'flower_yellow', dx: 1, dy: 0, height: 0 },
      { tile: 'flower', dx: 2, dy: 0, height: 0 },
    ]
  },

  rock_formation: {
    name: 'Rock Formation',
    description: 'Natural boulder cluster',
    category: 'decoration',
    width: 2,
    depth: 2,
    tiles: [
      { tile: 'rock', dx: 0, dy: 0, height: 0 },
      { tile: 'rock_small', dx: 1, dy: 0, height: 0 },
      { tile: 'rock_small', dx: 0, dy: 1, height: 0 },
      { tile: 'rock', dx: 1, dy: 1, height: 0 },
    ]
  },

  signpost: {
    name: 'Signpost',
    description: 'Wooden sign',
    category: 'decoration',
    width: 1,
    depth: 1,
    tiles: [
      { tile: 'fence_corner', dx: 0, dy: 0, height: 0 },
      { tile: 'sign', dx: 0, dy: 0, height: 1 },
    ]
  },
}

// ═══════════════════════════════════════════════════════════════════
// TERRAIN PRESETS - For quick terrain painting
// ═══════════════════════════════════════════════════════════════════

export interface TerrainPreset {
  name: string
  description: string
  groundTile: keyof typeof TILES
  heightChange: number
  blocking: boolean
}

export const TERRAIN_PRESETS: Record<string, TerrainPreset> = {
  cliff_edge: {
    name: 'Cliff Edge',
    description: 'Creates +1 height elevation',
    groundTile: 'cliff_top',
    heightChange: 1,
    blocking: true,
  },
  cliff_2: {
    name: 'High Cliff',
    description: 'Creates +2 height elevation',
    groundTile: 'cliff_top',
    heightChange: 2,
    blocking: true,
  },
  stairs: {
    name: 'Stairs',
    description: 'Walkable transition between heights',
    groundTile: 'stairs_up',
    heightChange: 0.5,
    blocking: false,
  },
  water_pond: {
    name: 'Deep Water',
    description: 'Impassable water',
    groundTile: 'water_deep',
    heightChange: -0.5,
    blocking: true,
  },
  water_wade: {
    name: 'Shallow Water',
    description: 'Walkable water',
    groundTile: 'water_shallow',
    heightChange: 0,
    blocking: false,
  },
  path: {
    name: 'Stone Path',
    description: 'Cobblestone walkway',
    groundTile: 'path_stone',
    heightChange: 0,
    blocking: false,
  },
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

export function getTilesByCategory(category: TileDef['category']): Record<string, TileDef> {
  const result: Record<string, TileDef> = {}
  for (const [key, tile] of Object.entries(TILES)) {
    if (tile.category === category) {
      result[key] = tile
    }
  }
  return result
}

export function getAssetsByCategory(category: CompositeAsset['category']): Record<string, CompositeAsset> {
  const result: Record<string, CompositeAsset> = {}
  for (const [key, asset] of Object.entries(COMPOSITE_ASSETS)) {
    if (asset.category === category) {
      result[key] = asset
    }
  }
  return result
}

export function getTile(key: string): TileDef | undefined {
  return TILES[key]
}

export function getAsset(key: string): CompositeAsset | undefined {
  return COMPOSITE_ASSETS[key]
}

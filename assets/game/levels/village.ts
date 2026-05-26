/**
 * VILLAGE LEVEL - Rebuilt from reference image
 * Grid: ~50x50, 16px per cell
 *
 * LAYOUT (from reference):
 * - Grass base everywhere
 * - Cross-shaped paths through center
 * - X-shaped rivers through middle
 * - Plaza at bottom center
 * - Buildings: top-center, bottom-left barn, bottom-right structure
 * - Trees scattered on edges
 * - Pond on left side
 */

import { IsometricGrid } from '@/engine/IsometricGrid'

export const VILLAGE_CONFIG = {
  cols: 50,
  rows: 50,
  cellSize: 16,
  isoScale: 2.5,  // Larger scale for smaller cells
  spawnCol: 35,
  spawnRow: 22,
}

export function createVillageLevel(): IsometricGrid {
  const grid = new IsometricGrid(VILLAGE_CONFIG)

  // ═══════════════════════════════════════════════════════════════════
  // BASE: All grass by default (handled by constructor)
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // PATHS - Cross shape through center
  // ═══════════════════════════════════════════════════════════════════

  // Vertical path (top to bottom through center)
  grid.fillGround(23, 0, 4, 50, 'road')

  // Horizontal path (left to right through middle)
  grid.fillGround(0, 21, 50, 3, 'road')

  // Wider intersection at center
  grid.fillGround(20, 18, 10, 8, 'road')

  // ═══════════════════════════════════════════════════════════════════
  // WATER - X-shaped rivers through center
  // ═══════════════════════════════════════════════════════════════════

  // Upper-left to center diagonal
  grid.fillGround(4, 8, 3, 2, 'water')
  grid.fillGround(6, 9, 3, 2, 'water')
  grid.fillGround(8, 10, 3, 2, 'water')
  grid.fillGround(10, 11, 3, 2, 'water')
  grid.fillGround(12, 12, 3, 2, 'water')
  grid.fillGround(14, 13, 3, 2, 'water')
  grid.fillGround(16, 14, 3, 2, 'water')
  grid.fillGround(18, 15, 3, 2, 'water')

  // Upper-right to center diagonal
  grid.fillGround(42, 8, 3, 2, 'water')
  grid.fillGround(40, 9, 3, 2, 'water')
  grid.fillGround(38, 10, 3, 2, 'water')
  grid.fillGround(36, 11, 3, 2, 'water')
  grid.fillGround(34, 12, 3, 2, 'water')
  grid.fillGround(32, 13, 3, 2, 'water')
  grid.fillGround(30, 14, 3, 2, 'water')
  grid.fillGround(28, 15, 3, 2, 'water')

  // Center pool where rivers meet
  grid.fillGround(21, 16, 8, 4, 'water')

  // Lower-left diagonal from center
  grid.fillGround(18, 24, 3, 2, 'water')
  grid.fillGround(16, 25, 3, 2, 'water')
  grid.fillGround(14, 26, 3, 2, 'water')
  grid.fillGround(12, 27, 3, 2, 'water')

  // Lower-right diagonal from center
  grid.fillGround(28, 24, 3, 2, 'water')
  grid.fillGround(30, 25, 3, 2, 'water')
  grid.fillGround(32, 26, 3, 2, 'water')
  grid.fillGround(34, 27, 3, 2, 'water')

  // Left side pond
  grid.fillGround(3, 18, 4, 4, 'water')

  // Right side pond
  grid.fillGround(43, 18, 4, 4, 'water')

  // ═══════════════════════════════════════════════════════════════════
  // BRIDGES - Where paths cross water
  // ═══════════════════════════════════════════════════════════════════

  grid.fillGround(8, 21, 4, 3, 'bridge')
  grid.fillGround(38, 21, 4, 3, 'bridge')
  grid.fillGround(23, 16, 4, 4, 'bridge')

  // ═══════════════════════════════════════════════════════════════════
  // PLAZA - Bottom center area
  // ═══════════════════════════════════════════════════════════════════

  grid.fillGround(15, 35, 20, 12, 'plaza')

  // Fountain in center of plaza
  grid.fillGround(23, 40, 4, 3, 'water')

  // ═══════════════════════════════════════════════════════════════════
  // ASSETS - Buildings, trees, decorations
  // ═══════════════════════════════════════════════════════════════════

  // === TOP CENTER BUILDING ===
  grid.placeAsset(['█'], 23, 1, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })
  grid.placeAsset(['█'], 24, 1, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })
  grid.placeAsset(['█'], 25, 1, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })
  grid.placeAsset(['█'], 23, 2, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })
  grid.placeAsset(['█'], 24, 2, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })
  grid.placeAsset(['█'], 25, 2, { type: 'building', blocking: true, color: '#aa7755', scale: 1 })

  // === LEFT BUILDING (barn) ===
  grid.placeAsset(['█'], 2, 8, { type: 'building', blocking: true, color: '#dd7755', scale: 1 })
  grid.placeAsset(['█'], 3, 8, { type: 'building', blocking: true, color: '#dd7755', scale: 1 })
  grid.placeAsset(['█'], 2, 9, { type: 'building', blocking: true, color: '#dd7755', scale: 1 })
  grid.placeAsset(['█'], 3, 9, { type: 'building', blocking: true, color: '#dd7755', scale: 1 })

  // === RIGHT BUILDING ===
  grid.placeAsset(['█'], 45, 8, { type: 'building', blocking: true, color: '#997766', scale: 1 })
  grid.placeAsset(['█'], 46, 8, { type: 'building', blocking: true, color: '#997766', scale: 1 })
  grid.placeAsset(['█'], 45, 9, { type: 'building', blocking: true, color: '#997766', scale: 1 })
  grid.placeAsset(['█'], 46, 9, { type: 'building', blocking: true, color: '#997766', scale: 1 })

  // === BOTTOM LEFT BUILDING ===
  grid.placeAsset(['█'], 10, 38, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 11, 38, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 12, 38, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 10, 39, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 11, 39, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 12, 39, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 10, 40, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 11, 40, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })
  grid.placeAsset(['█'], 12, 40, { type: 'building', blocking: true, color: '#aa6644', scale: 1 })

  // === TREES - scattered around edges ===
  // Top left area
  grid.placeAsset(['@'], 5, 3, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 8, 5, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 3, 6, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })

  // Top right area
  grid.placeAsset(['@'], 42, 4, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 45, 5, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 40, 7, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })

  // Left side
  grid.placeAsset(['@'], 2, 14, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 4, 28, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 3, 32, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })

  // Right side
  grid.placeAsset(['@'], 47, 14, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 46, 28, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 45, 32, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })

  // Bottom area
  grid.placeAsset(['@'], 6, 44, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })
  grid.placeAsset(['@'], 42, 44, { type: 'tree', blocking: true, color: '#33aa33', scale: 1 })

  // === CRATES/BOXES ===
  grid.placeAsset(['$'], 12, 5, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 38, 6, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 6, 16, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 44, 16, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 8, 30, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 40, 30, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 16, 45, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })
  grid.placeAsset(['$'], 32, 45, { type: 'crate', blocking: true, color: '#ddaa55', scale: 1 })

  // === LAMPS on paths ===
  grid.placeAsset(['!'], 23, 7, { type: 'lamp', blocking: true, color: '#ffff44', scale: 1 })
  grid.placeAsset(['!'], 17, 35, { type: 'lamp', blocking: true, color: '#ffff44', scale: 1 })
  grid.placeAsset(['!'], 31, 35, { type: 'lamp', blocking: true, color: '#ffff44', scale: 1 })
  grid.placeAsset(['!'], 17, 45, { type: 'lamp', blocking: true, color: '#ffff44', scale: 1 })
  grid.placeAsset(['!'], 31, 45, { type: 'lamp', blocking: true, color: '#ffff44', scale: 1 })

  // === FLOWERS ===
  grid.placeAsset(['+'], 10, 16, { type: 'flower', color: '#ff88cc', scale: 1 })
  grid.placeAsset(['+'], 38, 29, { type: 'flower', color: '#ff88cc', scale: 1 })
  grid.placeAsset(['+'], 8, 34, { type: 'flower', color: '#ffaa44', scale: 1 })
  grid.placeAsset(['+'], 40, 34, { type: 'flower', color: '#ffaa44', scale: 1 })

  return grid
}

// Ground tile colors - HIGH CONTRAST
// Vibrant Crash Bandicoot-style colors - natural formations (not checkerboard)
export const GROUND_COLORS: Record<string, { char: string[]; fg: string[]; bg: string[] }> = {
  // ═══════════════════════════════════════════════════════════════════
  // BASE GROUND TYPES
  // ═══════════════════════════════════════════════════════════════════
  grass: {
    char: [';', ','],
    fg: ['rgba(26, 182, 26, 0.85)', 'rgba(30, 190, 30, 0.85)'],
    bg: ['rgba(0, 130, 0, 0.92)', 'rgba(0, 135, 0, 0.90)'],
  },
  grass_tall: {
    char: ['"', '"'],
    fg: ['rgba(50, 210, 50, 0.9)', 'rgba(55, 215, 55, 0.88)'],
    bg: ['rgba(0, 150, 0, 0.92)', 'rgba(10, 155, 10, 0.90)'],
  },
  road: {
    char: ['=', '='],
    fg: ['rgba(194, 165, 92, 0.8)', 'rgba(180, 150, 80, 0.85)'],
    bg: ['rgba(120, 100, 60, 0.9)', 'rgba(100, 80, 50, 0.85)'],
  },
  road_center: {
    char: ['=', '='],
    fg: ['rgba(220, 200, 140, 0.85)', 'rgba(210, 190, 130, 0.8)'],
    bg: ['rgba(150, 130, 90, 0.92)', 'rgba(140, 120, 80, 0.88)'],
  },
  road_edge: {
    char: ['-', '-'],
    fg: ['rgba(140, 120, 70, 0.8)', 'rgba(130, 110, 60, 0.75)'],
    bg: ['rgba(80, 65, 40, 0.92)', 'rgba(70, 55, 35, 0.88)'],
  },
  plaza: {
    char: ['#', '#'],
    fg: ['rgba(252, 247, 241, 0.8)', 'rgba(240, 230, 210, 0.85)'],
    bg: ['rgba(180, 150, 100, 0.9)', 'rgba(160, 130, 85, 0.85)'],
  },
  water: {
    char: ['~', '~'],
    fg: ['rgba(85, 187, 255, 0.9)', 'rgba(68, 170, 238, 0.85)'],
    bg: ['rgba(17, 85, 170, 0.95)', 'rgba(0, 68, 136, 0.9)'],
  },
  water_deep: {
    char: ['≈', '≈'],
    fg: ['rgba(17, 68, 170, 0.9)', 'rgba(0, 51, 170, 0.85)'],
    bg: ['rgba(10, 34, 85, 0.95)', 'rgba(8, 26, 68, 0.9)'],
  },
  water_shallow: {
    char: ['~', '~'],
    fg: ['rgba(68, 136, 221, 0.85)', 'rgba(85, 153, 238, 0.8)'],
    bg: ['rgba(34, 102, 170, 0.9)', 'rgba(51, 119, 187, 0.85)'],
  },
  bridge: {
    char: ['=', '|'],
    fg: ['rgba(187, 136, 68, 0.9)', 'rgba(170, 119, 51, 0.85)'],
    bg: ['rgba(102, 68, 34, 0.95)', 'rgba(85, 51, 17, 0.9)'],
  },
  cliff: {
    char: ['▀', '▀'],
    fg: ['rgba(255, 212, 58, 0.9)', 'rgba(243, 191, 54, 0.85)'],
    bg: ['rgba(173, 134, 33, 0.95)', 'rgba(150, 110, 30, 0.9)'],
  },
  cliff_face: {
    char: ['█', '▓'],
    fg: ['rgba(139, 105, 20, 0.9)', 'rgba(120, 88, 16, 0.85)'],
    bg: ['rgba(90, 69, 16, 0.95)', 'rgba(74, 53, 10, 0.9)'],
  },
  stairs: {
    char: ['≡', '≡'],
    fg: ['rgba(153, 136, 102, 0.85)', 'rgba(136, 119, 85, 0.8)'],
    bg: ['rgba(85, 68, 51, 0.9)', 'rgba(68, 51, 34, 0.85)'],
  },
  path_stone: {
    char: ['░', '▒'],
    fg: ['rgba(204, 187, 170, 0.85)', 'rgba(187, 170, 153, 0.8)'],
    bg: ['rgba(153, 136, 119, 0.9)', 'rgba(136, 119, 102, 0.85)'],
  },
  path_dirt: {
    char: ['·', '·'],
    fg: ['rgba(170, 153, 119, 0.85)', 'rgba(153, 136, 102, 0.8)'],
    bg: ['rgba(119, 102, 85, 0.9)', 'rgba(102, 85, 68, 0.85)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // SNOW/ICE THEME
  // ═══════════════════════════════════════════════════════════════════
  snow: {
    char: ['*', '·'],
    fg: ['rgba(240, 248, 255, 0.95)', 'rgba(230, 240, 250, 0.90)'],
    bg: ['rgba(200, 220, 240, 0.95)', 'rgba(190, 210, 235, 0.92)'],
  },
  snow_deep: {
    char: ['≋', '≡'],
    fg: ['rgba(255, 255, 255, 0.95)', 'rgba(245, 250, 255, 0.92)'],
    bg: ['rgba(180, 200, 225, 0.95)', 'rgba(170, 195, 220, 0.92)'],
  },
  ice: {
    char: ['◊', '◇'],
    fg: ['rgba(150, 220, 255, 0.95)', 'rgba(130, 210, 250, 0.92)'],
    bg: ['rgba(80, 160, 220, 0.95)', 'rgba(70, 150, 210, 0.92)'],
  },
  ice_cracked: {
    char: ['╳', '╬'],
    fg: ['rgba(180, 230, 255, 0.95)', 'rgba(160, 220, 250, 0.92)'],
    bg: ['rgba(100, 170, 220, 0.95)', 'rgba(90, 160, 215, 0.92)'],
  },
  frozen_water: {
    char: ['~', '≈'],
    fg: ['rgba(160, 210, 250, 0.85)', 'rgba(140, 200, 245, 0.82)'],
    bg: ['rgba(80, 140, 200, 0.95)', 'rgba(70, 130, 195, 0.92)'],
  },
  snow_path: {
    char: [':', ':'],
    fg: ['rgba(210, 220, 235, 0.85)', 'rgba(200, 215, 230, 0.82)'],
    bg: ['rgba(160, 175, 200, 0.95)', 'rgba(150, 170, 195, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // DESERT/SAND THEME
  // ═══════════════════════════════════════════════════════════════════
  sand: {
    char: ['.', '·'],
    fg: ['rgba(255, 220, 150, 0.90)', 'rgba(250, 210, 140, 0.88)'],
    bg: ['rgba(220, 180, 100, 0.95)', 'rgba(210, 170, 95, 0.92)'],
  },
  sand_dune: {
    char: ['~', '∿'],
    fg: ['rgba(255, 230, 170, 0.90)', 'rgba(250, 220, 160, 0.88)'],
    bg: ['rgba(200, 160, 90, 0.95)', 'rgba(190, 150, 85, 0.92)'],
  },
  sandstone: {
    char: ['▓', '▒'],
    fg: ['rgba(230, 190, 130, 0.90)', 'rgba(220, 180, 120, 0.88)'],
    bg: ['rgba(180, 140, 80, 0.95)', 'rgba(170, 130, 75, 0.92)'],
  },
  oasis: {
    char: ['~', '≈'],
    fg: ['rgba(50, 180, 200, 0.90)', 'rgba(40, 170, 190, 0.88)'],
    bg: ['rgba(20, 120, 150, 0.95)', 'rgba(15, 110, 140, 0.92)'],
  },
  desert_road: {
    char: ['=', '-'],
    fg: ['rgba(200, 170, 120, 0.85)', 'rgba(190, 160, 110, 0.82)'],
    bg: ['rgba(150, 120, 70, 0.95)', 'rgba(140, 110, 65, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // VOLCANIC/LAVA THEME
  // ═══════════════════════════════════════════════════════════════════
  lava: {
    char: ['≈', '∿'],
    fg: ['rgba(255, 200, 50, 0.95)', 'rgba(255, 180, 30, 0.92)'],
    bg: ['rgba(200, 80, 20, 0.98)', 'rgba(180, 60, 15, 0.95)'],
  },
  magma: {
    char: ['▓', '█'],
    fg: ['rgba(255, 150, 30, 0.95)', 'rgba(255, 130, 20, 0.92)'],
    bg: ['rgba(150, 40, 10, 0.98)', 'rgba(130, 30, 5, 0.95)'],
  },
  obsidian: {
    char: ['■', '▪'],
    fg: ['rgba(80, 60, 80, 0.90)', 'rgba(70, 50, 70, 0.88)'],
    bg: ['rgba(30, 20, 35, 0.98)', 'rgba(25, 15, 30, 0.95)'],
  },
  volcanic_rock: {
    char: ['▒', '░'],
    fg: ['rgba(100, 70, 50, 0.90)', 'rgba(90, 60, 45, 0.88)'],
    bg: ['rgba(50, 35, 25, 0.98)', 'rgba(45, 30, 20, 0.95)'],
  },
  ash: {
    char: [':', '·'],
    fg: ['rgba(120, 115, 110, 0.90)', 'rgba(110, 105, 100, 0.88)'],
    bg: ['rgba(70, 65, 60, 0.95)', 'rgba(60, 55, 50, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CAVE/DUNGEON THEME
  // ═══════════════════════════════════════════════════════════════════
  cave_floor: {
    char: ['░', '▒'],
    fg: ['rgba(130, 120, 110, 0.90)', 'rgba(120, 110, 100, 0.88)'],
    bg: ['rgba(70, 65, 60, 0.95)', 'rgba(60, 55, 50, 0.92)'],
  },
  cave_moss: {
    char: ['~', '≈'],
    fg: ['rgba(80, 140, 70, 0.90)', 'rgba(70, 130, 60, 0.88)'],
    bg: ['rgba(40, 80, 35, 0.95)', 'rgba(35, 70, 30, 0.92)'],
  },
  crystal: {
    char: ['◆', '◇'],
    fg: ['rgba(200, 150, 255, 0.95)', 'rgba(180, 130, 250, 0.92)'],
    bg: ['rgba(100, 60, 150, 0.95)', 'rgba(90, 50, 140, 0.92)'],
  },
  ancient_stone: {
    char: ['▓', '▒'],
    fg: ['rgba(140, 130, 100, 0.90)', 'rgba(130, 120, 90, 0.88)'],
    bg: ['rgba(80, 75, 60, 0.95)', 'rgba(70, 65, 50, 0.92)'],
  },
  rune_floor: {
    char: ['☆', '✧'],
    fg: ['rgba(100, 200, 255, 0.95)', 'rgba(80, 180, 250, 0.92)'],
    bg: ['rgba(50, 50, 70, 0.95)', 'rgba(40, 40, 60, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CRYPT/CEMETERY THEME
  // ═══════════════════════════════════════════════════════════════════
  crypt_floor: {
    char: ['▓', '▒'],
    fg: ['rgba(100, 95, 90, 0.90)', 'rgba(90, 85, 80, 0.88)'],
    bg: ['rgba(50, 48, 45, 0.98)', 'rgba(45, 43, 40, 0.95)'],
  },
  dead_grass: {
    char: [',', ';'],
    fg: ['rgba(140, 130, 90, 0.85)', 'rgba(130, 120, 80, 0.82)'],
    bg: ['rgba(80, 75, 50, 0.95)', 'rgba(70, 65, 45, 0.92)'],
  },
  grave_dirt: {
    char: ['·', '.'],
    fg: ['rgba(100, 85, 65, 0.85)', 'rgba(90, 75, 55, 0.82)'],
    bg: ['rgba(55, 45, 35, 0.95)', 'rgba(50, 40, 30, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // UNDERWATER/CORAL THEME
  // ═══════════════════════════════════════════════════════════════════
  coral: {
    char: ['※', '❋'],
    fg: ['rgba(255, 150, 180, 0.95)', 'rgba(255, 130, 160, 0.92)'],
    bg: ['rgba(180, 80, 120, 0.95)', 'rgba(160, 70, 100, 0.92)'],
  },
  seaweed: {
    char: ['~', '≋'],
    fg: ['rgba(60, 180, 120, 0.90)', 'rgba(50, 170, 110, 0.88)'],
    bg: ['rgba(30, 100, 70, 0.95)', 'rgba(25, 90, 60, 0.92)'],
  },
  seafloor: {
    char: ['.', '·'],
    fg: ['rgba(100, 150, 180, 0.85)', 'rgba(90, 140, 170, 0.82)'],
    bg: ['rgba(40, 70, 100, 0.95)', 'rgba(35, 60, 90, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - ITALIAN
  // ═══════════════════════════════════════════════════════════════════
  terracotta: {
    char: ['▓', '▒'],
    fg: ['rgba(220, 140, 100, 0.90)', 'rgba(210, 130, 90, 0.88)'],
    bg: ['rgba(180, 100, 60, 0.95)', 'rgba(170, 90, 55, 0.92)'],
  },
  marble: {
    char: ['░', '▒'],
    fg: ['rgba(250, 248, 245, 0.90)', 'rgba(245, 243, 240, 0.88)'],
    bg: ['rgba(230, 225, 220, 0.95)', 'rgba(220, 215, 210, 0.92)'],
  },
  olive_grove: {
    char: [';', ','],
    fg: ['rgba(80, 120, 50, 0.85)', 'rgba(70, 110, 45, 0.82)'],
    bg: ['rgba(45, 75, 30, 0.95)', 'rgba(40, 70, 25, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - CHINESE
  // ═══════════════════════════════════════════════════════════════════
  red_lacquer: {
    char: ['▓', '▒'],
    fg: ['rgba(220, 60, 50, 0.95)', 'rgba(200, 50, 40, 0.92)'],
    bg: ['rgba(160, 30, 25, 0.98)', 'rgba(140, 25, 20, 0.95)'],
  },
  gold_tile: {
    char: ['◆', '◇'],
    fg: ['rgba(255, 220, 100, 0.95)', 'rgba(255, 210, 80, 0.92)'],
    bg: ['rgba(200, 160, 50, 0.95)', 'rgba(180, 140, 40, 0.92)'],
  },
  bamboo_floor: {
    char: ['|', '‖'],
    fg: ['rgba(180, 200, 100, 0.90)', 'rgba(170, 190, 90, 0.88)'],
    bg: ['rgba(120, 140, 60, 0.95)', 'rgba(110, 130, 55, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - SPANISH
  // ═══════════════════════════════════════════════════════════════════
  spanish_tile: {
    char: ['▓', '▒'],
    fg: ['rgba(255, 200, 150, 0.90)', 'rgba(250, 190, 140, 0.88)'],
    bg: ['rgba(200, 140, 80, 0.95)', 'rgba(190, 130, 75, 0.92)'],
  },
  whitewash: {
    char: ['░', '▒'],
    fg: ['rgba(255, 255, 250, 0.95)', 'rgba(250, 250, 245, 0.92)'],
    bg: ['rgba(245, 242, 235, 0.98)', 'rgba(240, 237, 230, 0.95)'],
  },
  courtyard_stone: {
    char: ['▓', '▒'],
    fg: ['rgba(220, 210, 190, 0.90)', 'rgba(210, 200, 180, 0.88)'],
    bg: ['rgba(170, 160, 140, 0.95)', 'rgba(160, 150, 130, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - RUSSIAN
  // ═══════════════════════════════════════════════════════════════════
  birch_forest: {
    char: [';', ','],
    fg: ['rgba(180, 200, 160, 0.90)', 'rgba(170, 190, 150, 0.88)'],
    bg: ['rgba(100, 130, 80, 0.95)', 'rgba(90, 120, 70, 0.92)'],
  },
  russian_red: {
    char: ['▓', '▒'],
    fg: ['rgba(180, 50, 40, 0.95)', 'rgba(160, 40, 30, 0.92)'],
    bg: ['rgba(120, 25, 20, 0.98)', 'rgba(100, 20, 15, 0.95)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - JAPANESE
  // ═══════════════════════════════════════════════════════════════════
  tatami: {
    char: ['=', '≡'],
    fg: ['rgba(200, 190, 150, 0.90)', 'rgba(190, 180, 140, 0.88)'],
    bg: ['rgba(160, 150, 100, 0.95)', 'rgba(150, 140, 95, 0.92)'],
  },
  sakura_petals: {
    char: ['❀', '✿'],
    fg: ['rgba(255, 200, 220, 0.95)', 'rgba(255, 180, 200, 0.92)'],
    bg: ['rgba(255, 230, 240, 0.95)', 'rgba(250, 220, 235, 0.92)'],
  },
  zen_garden: {
    char: ['~', '≈'],
    fg: ['rgba(220, 215, 200, 0.90)', 'rgba(210, 205, 190, 0.88)'],
    bg: ['rgba(180, 175, 160, 0.95)', 'rgba(170, 165, 150, 0.92)'],
  },
  koi_pond: {
    char: ['~', '≈'],
    fg: ['rgba(100, 180, 200, 0.90)', 'rgba(90, 170, 190, 0.88)'],
    bg: ['rgba(50, 120, 140, 0.95)', 'rgba(45, 110, 130, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - EGYPTIAN
  // ═══════════════════════════════════════════════════════════════════
  hieroglyph_floor: {
    char: ['☥', '𓂀'],
    fg: ['rgba(255, 210, 100, 0.95)', 'rgba(250, 200, 90, 0.92)'],
    bg: ['rgba(180, 140, 60, 0.95)', 'rgba(170, 130, 55, 0.92)'],
  },
  pyramid_stone: {
    char: ['▲', '△'],
    fg: ['rgba(230, 200, 150, 0.90)', 'rgba(220, 190, 140, 0.88)'],
    bg: ['rgba(180, 150, 100, 0.95)', 'rgba(170, 140, 95, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - AFRICAN
  // ═══════════════════════════════════════════════════════════════════
  savanna: {
    char: ['"', '‟'],
    fg: ['rgba(200, 180, 100, 0.90)', 'rgba(190, 170, 90, 0.88)'],
    bg: ['rgba(150, 130, 60, 0.95)', 'rgba(140, 120, 55, 0.92)'],
  },
  red_earth: {
    char: ['.', '·'],
    fg: ['rgba(180, 100, 60, 0.90)', 'rgba(170, 90, 50, 0.88)'],
    bg: ['rgba(140, 70, 40, 0.95)', 'rgba(130, 60, 35, 0.92)'],
  },
  mud_hut: {
    char: ['▓', '▒'],
    fg: ['rgba(160, 130, 90, 0.90)', 'rgba(150, 120, 80, 0.88)'],
    bg: ['rgba(120, 90, 60, 0.95)', 'rgba(110, 80, 55, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - LATIN AMERICAN
  // ═══════════════════════════════════════════════════════════════════
  tropical_grass: {
    char: [';', ','],
    fg: ['rgba(50, 200, 80, 0.90)', 'rgba(40, 190, 70, 0.88)'],
    bg: ['rgba(20, 140, 50, 0.95)', 'rgba(15, 130, 45, 0.92)'],
  },
  colorful_tile: {
    char: ['◆', '◇'],
    fg: ['rgba(255, 200, 50, 0.95)', 'rgba(50, 200, 255, 0.92)'],
    bg: ['rgba(255, 100, 100, 0.95)', 'rgba(100, 255, 150, 0.92)'],
  },
  inca_stone: {
    char: ['▓', '▒'],
    fg: ['rgba(160, 150, 130, 0.90)', 'rgba(150, 140, 120, 0.88)'],
    bg: ['rgba(100, 95, 85, 0.95)', 'rgba(90, 85, 75, 0.92)'],
  },
  pampas: {
    char: ['"', '‟'],
    fg: ['rgba(180, 200, 150, 0.90)', 'rgba(170, 190, 140, 0.88)'],
    bg: ['rgba(130, 150, 100, 0.95)', 'rgba(120, 140, 95, 0.92)'],
  },
  adobe: {
    char: ['▓', '▒'],
    fg: ['rgba(200, 160, 120, 0.90)', 'rgba(190, 150, 110, 0.88)'],
    bg: ['rgba(160, 120, 80, 0.95)', 'rgba(150, 110, 75, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - AMERICAN FRONTIER
  // ═══════════════════════════════════════════════════════════════════
  prairie: {
    char: ['"', '‟'],
    fg: ['rgba(200, 190, 130, 0.90)', 'rgba(190, 180, 120, 0.88)'],
    bg: ['rgba(150, 140, 90, 0.95)', 'rgba(140, 130, 85, 0.92)'],
  },
  wooden_planks: {
    char: ['=', '≡'],
    fg: ['rgba(170, 130, 80, 0.90)', 'rgba(160, 120, 70, 0.88)'],
    bg: ['rgba(120, 90, 50, 0.95)', 'rgba(110, 80, 45, 0.92)'],
  },

  // ═══════════════════════════════════════════════════════════════════
  // CULTURAL THEMES - AUSTRALIAN OUTBACK
  // ═══════════════════════════════════════════════════════════════════
  outback_red: {
    char: ['.', '·'],
    fg: ['rgba(220, 120, 60, 0.90)', 'rgba(210, 110, 50, 0.88)'],
    bg: ['rgba(180, 80, 40, 0.95)', 'rgba(170, 70, 35, 0.92)'],
  },
  eucalyptus: {
    char: [';', ','],
    fg: ['rgba(120, 160, 130, 0.90)', 'rgba(110, 150, 120, 0.88)'],
    bg: ['rgba(70, 110, 80, 0.95)', 'rgba(60, 100, 70, 0.92)'],
  },
}

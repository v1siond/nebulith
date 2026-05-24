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
export const GROUND_COLORS = {
  grass: {
    char: [';', ','],
    fg: ['rgba(26, 182, 26, 0.85)', 'rgba(30, 190, 30, 0.85)'], // Similar shades for consistency
    bg: ['rgba(0, 130, 0, 0.92)', 'rgba(0, 135, 0, 0.90)'], // Minimal variation
  },
  grass_tall: {
    char: ['"', '"'],
    fg: ['rgba(50, 210, 50, 0.9)', 'rgba(55, 215, 55, 0.88)'], // Brighter for tall grass
    bg: ['rgba(0, 150, 0, 0.92)', 'rgba(10, 155, 10, 0.90)'], // Slightly different
  },
  road: {
    char: ['=', '='],
    fg: ['rgba(194, 165, 92, 0.8)', 'rgba(180, 150, 80, 0.85)'],
    bg: ['rgba(120, 100, 60, 0.9)', 'rgba(100, 80, 50, 0.85)'],
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
}

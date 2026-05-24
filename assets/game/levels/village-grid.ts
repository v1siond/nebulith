/**
 * VILLAGE LEVEL - Tile Grid Definition
 *
 * Built from top-down perspective based on reference image.
 * Grid is 32x32, each cell is one tile.
 *
 * Reference layout (from top-down view):
 * - Irregular platform shape (edges drop to void)
 * - River cutting diagonally through middle
 * - Buildings: house at top-right, barns at bottom-left
 * - Stone plaza in center with fountain
 * - Grass areas with scattered trees
 */

import { TileGrid } from '@/engine/TileGrid'

export const VILLAGE_GRID_CONFIG = {
  cols: 32,
  rows: 32,
  cellSize: 64,
}

export function createVillageGrid(): TileGrid {
  const grid = new TileGrid(VILLAGE_GRID_CONFIG)

  // Start with void everywhere (will carve out the platform)
  grid.fillRect(0, 0, 32, 32, 'X', -10)

  // ═══════════════════════════════════════════════════════════════════
  // PLATFORM SHAPE - Carve out the walkable area
  // Based on reference: irregular polygon, wider at bottom
  // ═══════════════════════════════════════════════════════════════════

  // Main grass platform (height 0)
  // Row by row to match reference shape

  // Top section (rows 2-6) - narrow
  grid.fillRect(10, 2, 14, 1, '.', 0)
  grid.fillRect(8, 3, 18, 1, '.', 0)
  grid.fillRect(6, 4, 22, 1, '.', 0)
  grid.fillRect(5, 5, 24, 1, '.', 0)
  grid.fillRect(4, 6, 25, 1, '.', 0)

  // Upper-middle (rows 7-12) - expanding
  grid.fillRect(3, 7, 26, 1, '.', 0)
  grid.fillRect(2, 8, 27, 1, '.', 0)
  grid.fillRect(2, 9, 28, 1, '.', 0)
  grid.fillRect(2, 10, 28, 1, '.', 0)
  grid.fillRect(2, 11, 28, 1, '.', 0)
  grid.fillRect(2, 12, 28, 1, '.', 0)

  // Middle section (rows 13-18) - widest
  grid.fillRect(2, 13, 28, 1, '.', 0)
  grid.fillRect(2, 14, 28, 1, '.', 0)
  grid.fillRect(2, 15, 28, 1, '.', 0)
  grid.fillRect(3, 16, 27, 1, '.', 0)
  grid.fillRect(3, 17, 26, 1, '.', 0)
  grid.fillRect(4, 18, 25, 1, '.', 0)

  // Lower section (rows 19-24) - plaza area
  grid.fillRect(4, 19, 24, 1, '.', 0)
  grid.fillRect(5, 20, 23, 1, '.', 0)
  grid.fillRect(5, 21, 22, 1, '.', 0)
  grid.fillRect(6, 22, 21, 1, '.', 0)
  grid.fillRect(6, 23, 20, 1, '.', 0)
  grid.fillRect(7, 24, 18, 1, '.', 0)

  // Bottom section (rows 25-28) - narrowing
  grid.fillRect(8, 25, 16, 1, '.', 0)
  grid.fillRect(9, 26, 14, 1, '.', 0)
  grid.fillRect(10, 27, 12, 1, '.', 0)
  grid.fillRect(12, 28, 8, 1, '.', 0)

  // ═══════════════════════════════════════════════════════════════════
  // WATER - River cutting through
  // ═══════════════════════════════════════════════════════════════════

  // Main river - diagonal from upper-left to lower-right
  grid.fillRect(3, 9, 3, 2, '~', -1)
  grid.fillRect(5, 10, 3, 2, '~', -1)
  grid.fillRect(7, 11, 3, 2, '~', -1)
  grid.fillRect(9, 12, 3, 2, '~', -1)

  // River bends around center
  grid.fillRect(11, 13, 2, 3, '~', -1)
  grid.fillRect(12, 15, 3, 2, '~', -1)

  // Second river branch from upper-right
  grid.fillRect(24, 8, 3, 2, '~', -1)
  grid.fillRect(22, 9, 3, 2, '~', -1)
  grid.fillRect(20, 10, 3, 2, '~', -1)
  grid.fillRect(18, 11, 3, 2, '~', -1)
  grid.fillRect(16, 12, 3, 2, '~', -1)

  // Pond at top-left
  grid.fillRect(6, 5, 3, 3, '~', -1)

  // ═══════════════════════════════════════════════════════════════════
  // PATHS - Stone roads connecting areas
  // ═══════════════════════════════════════════════════════════════════

  // Main vertical path
  grid.fillRect(14, 4, 3, 8, '=', 0)
  grid.fillRect(14, 16, 3, 10, '=', 0)

  // Horizontal path
  grid.fillRect(5, 14, 22, 2, '=', 0)

  // ═══════════════════════════════════════════════════════════════════
  // PLAZA - Central stone area (elevated)
  // ═══════════════════════════════════════════════════════════════════

  grid.fillRect(10, 18, 12, 8, '#', 1)

  // Fountain center
  grid.fillRect(14, 21, 4, 3, '~', 0)

  // ═══════════════════════════════════════════════════════════════════
  // BUILDINGS - Roofs visible from top
  // ═══════════════════════════════════════════════════════════════════

  // Main house at top (roof = ▀)
  grid.fillRect(18, 3, 6, 4, '▀', 3)

  // Left barn (wood building)
  grid.fillRect(4, 16, 4, 5, '▀', 3)

  // Right building
  grid.fillRect(24, 13, 4, 5, '▀', 3)

  // Small shed at bottom-left
  grid.fillRect(6, 24, 3, 3, '▀', 2)

  // ═══════════════════════════════════════════════════════════════════
  // TREES - Scattered around
  // ═══════════════════════════════════════════════════════════════════

  // Trees near top
  grid.setCell(11, 3, '@')
  grid.setCell(13, 4, '@')
  grid.setCell(26, 4, '@')
  grid.setCell(28, 6, '@')

  // Trees middle-left
  grid.setCell(3, 11, '@')
  grid.setCell(4, 13, '@')

  // Trees middle-right
  grid.setCell(27, 10, '@')
  grid.setCell(28, 12, '@')

  // Trees near bottom
  grid.setCell(8, 22, '@')
  grid.setCell(24, 21, '@')
  grid.setCell(25, 23, '@')

  // Bushes
  grid.setCell(10, 5, '*')
  grid.setCell(25, 5, '*')
  grid.setCell(5, 18, '*')
  grid.setCell(26, 18, '*')

  // ═══════════════════════════════════════════════════════════════════
  // DECORATIONS
  // ═══════════════════════════════════════════════════════════════════

  // Flowers
  grid.setCell(7, 8, '+')
  grid.setCell(9, 7, '+')
  grid.setCell(23, 7, '+')
  grid.setCell(25, 16, '+')

  // Crates/objects
  grid.setCell(17, 6, '$')
  grid.setCell(9, 19, '$')

  // Lamps
  grid.setCell(10, 18, '!')
  grid.setCell(21, 18, '!')
  grid.setCell(14, 26, '!')

  // ═══════════════════════════════════════════════════════════════════
  // SPAWN POINT
  // ═══════════════════════════════════════════════════════════════════

  grid.setCell(16, 24, '?')

  return grid
}

export default createVillageGrid

/**
 * TILE GRID ENGINE v2
 *
 * Design philosophy: Build from top-down first, then project to isometric.
 * Each cell has: type (char), height, collision
 *
 * TILE TYPES (single ASCII char):
 * Terrain:
 *   . = grass
 *   , = tall grass
 *   ~ = water
 *   = = path/road
 *   # = stone floor
 *   _ = sand
 *
 * Structures:
 *   █ = solid wall
 *   ▄ = low wall / fence
 *   ▀ = roof
 *   ░ = floor interior
 *   ▒ = stairs
 *
 * Objects:
 *   @ = tree
 *   * = bush
 *   o = rock
 *   + = flower
 *   $ = chest/crate
 *   ! = lamp
 *
 * Special:
 *   X = void (edge of map, drops off)
 *   ? = spawn point
 */

export interface TileCell {
  char: string      // Single ASCII character representing tile type
  height: number    // Elevation (0 = base, negative = water/pit, positive = raised)
  collision: boolean
  color?: string    // Override color
}

export interface TileGridConfig {
  cols: number
  rows: number
  cellSize: number  // World units per cell
}

// Tile definitions - char to properties
export const TILE_DEFS: Record<string, {
  name: string
  color: string
  bgColor: string
  collision: boolean
  defaultHeight: number
}> = {
  // Terrain
  '.': { name: 'grass', color: '#55cc55', bgColor: '#227722', collision: false, defaultHeight: 0 },
  ',': { name: 'tall_grass', color: '#77dd55', bgColor: '#338833', collision: false, defaultHeight: 0 },
  '~': { name: 'water', color: '#55aaff', bgColor: '#1155aa', collision: true, defaultHeight: -1 },
  '=': { name: 'path', color: '#ccbb88', bgColor: '#887755', collision: false, defaultHeight: 0 },
  '#': { name: 'stone', color: '#aaaaaa', bgColor: '#666666', collision: false, defaultHeight: 0 },
  '_': { name: 'sand', color: '#eedd99', bgColor: '#ccaa66', collision: false, defaultHeight: 0 },

  // Structures
  '█': { name: 'wall', color: '#aa8866', bgColor: '#554433', collision: true, defaultHeight: 2 },
  '▄': { name: 'low_wall', color: '#998877', bgColor: '#554433', collision: true, defaultHeight: 1 },
  '▀': { name: 'roof', color: '#cc6644', bgColor: '#883322', collision: true, defaultHeight: 3 },
  '░': { name: 'floor', color: '#bbaa88', bgColor: '#776655', collision: false, defaultHeight: 1 },
  '▒': { name: 'stairs', color: '#aa9977', bgColor: '#665544', collision: false, defaultHeight: 0.5 },

  // Objects
  '@': { name: 'tree', color: '#33aa33', bgColor: '#115511', collision: true, defaultHeight: 0 },
  '*': { name: 'bush', color: '#44bb44', bgColor: '#226622', collision: true, defaultHeight: 0 },
  'o': { name: 'rock', color: '#888888', bgColor: '#444444', collision: true, defaultHeight: 0 },
  '+': { name: 'flower', color: '#ff88cc', bgColor: '#338833', collision: false, defaultHeight: 0 },
  '$': { name: 'crate', color: '#ddaa55', bgColor: '#885522', collision: true, defaultHeight: 0 },
  '!': { name: 'lamp', color: '#ffee55', bgColor: '#886600', collision: true, defaultHeight: 0 },

  // Special
  'X': { name: 'void', color: '#222244', bgColor: '#111122', collision: true, defaultHeight: -10 },
  '?': { name: 'spawn', color: '#ffff00', bgColor: '#227722', collision: false, defaultHeight: 0 },
  ' ': { name: 'empty', color: '#113311', bgColor: '#001100', collision: true, defaultHeight: -10 },
}

export class TileGrid {
  cols: number
  rows: number
  cellSize: number
  cells: TileCell[][]

  constructor(config: TileGridConfig) {
    this.cols = config.cols
    this.rows = config.rows
    this.cellSize = config.cellSize

    // Initialize with grass
    this.cells = []
    for (let row = 0; row < this.rows; row++) {
      this.cells[row] = []
      for (let col = 0; col < this.cols; col++) {
        this.cells[row][col] = {
          char: '.',
          height: 0,
          collision: false
        }
      }
    }
  }

  // Get cell at position
  getCell(col: number, row: number): TileCell | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return null
    }
    return this.cells[row][col]
  }

  // Set a single cell
  setCell(col: number, row: number, char: string, heightOverride?: number) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return

    const def = TILE_DEFS[char] || TILE_DEFS['.']
    this.cells[row][col] = {
      char,
      height: heightOverride ?? def.defaultHeight,
      collision: def.collision
    }
  }

  // Fill rectangle with tile
  fillRect(col: number, row: number, width: number, height: number, char: string, heightOverride?: number) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        this.setCell(col + c, row + r, char, heightOverride)
      }
    }
  }

  // Load from string array (for easy level design)
  loadFromStrings(lines: string[], startCol: number = 0, startRow: number = 0) {
    for (let r = 0; r < lines.length; r++) {
      const line = lines[r]
      for (let c = 0; c < line.length; c++) {
        const char = line[c]
        if (char !== ' ' || TILE_DEFS[' ']) {
          this.setCell(startCol + c, startRow + r, char)
        }
      }
    }
  }

  // Check collision at world position
  isBlocked(worldX: number, worldZ: number): boolean {
    const col = Math.floor(worldX / this.cellSize)
    const row = Math.floor(worldZ / this.cellSize)
    const cell = this.getCell(col, row)
    return cell ? cell.collision : true
  }

  // Get height at world position
  getHeight(worldX: number, worldZ: number): number {
    const col = Math.floor(worldX / this.cellSize)
    const row = Math.floor(worldZ / this.cellSize)
    const cell = this.getCell(col, row)
    return cell ? cell.height : -10
  }

  // Export to string array (for saving)
  toStrings(): string[] {
    const lines: string[] = []
    for (let row = 0; row < this.rows; row++) {
      let line = ''
      for (let col = 0; col < this.cols; col++) {
        line += this.cells[row][col].char
      }
      lines.push(line)
    }
    return lines
  }

  // Get grid bounds that contain non-void tiles
  getBounds(): { minCol: number; maxCol: number; minRow: number; maxRow: number } {
    let minCol = this.cols, maxCol = 0, minRow = this.rows, maxRow = 0

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.cells[row][col]
        if (cell.char !== ' ' && cell.char !== 'X') {
          minCol = Math.min(minCol, col)
          maxCol = Math.max(maxCol, col)
          minRow = Math.min(minRow, row)
          maxRow = Math.max(maxRow, row)
        }
      }
    }

    return { minCol, maxCol, minRow, maxRow }
  }
}

export default TileGrid

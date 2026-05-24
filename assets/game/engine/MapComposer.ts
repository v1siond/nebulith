/**
 * MAP COMPOSER - Places ASCII components on a grid to create maps
 *
 * Usage:
 *   const composer = new MapComposer(150, 75)
 *   composer.place('mountain_large', 50, 20)
 *   composer.place('tree_medium', 30, 60)
 *   composer.place('bush_small', 35, 65)
 *   const { template, blockingGrid } = composer.render()
 */

import { AsciiComponent, COMPONENTS } from './asciiComponents'

export interface PlacedComponent {
  component: AsciiComponent
  x: number  // Grid position (column)
  y: number  // Grid position (row)
  zIndex: number  // Render order (higher = on top)
}

export interface ComposedMap {
  template: string[]
  blockingGrid: boolean[][]
  width: number
  height: number
}

export class MapComposer {
  private width: number
  private height: number
  private placements: PlacedComponent[] = []
  private zCounter: number = 0

  // Layer z-index bases
  private static LAYER_Z: Record<string, number> = {
    terrain: 0,
    vegetation: 100,
    structure: 200,
    decoration: 300,
    character: 400,
  }

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /**
   * Place a component on the map
   * @param componentName Name from COMPONENTS
   * @param x Grid column (0-based)
   * @param y Grid row (0-based)
   * @param zOffset Optional z-index offset within layer
   */
  place(componentName: string, x: number, y: number, zOffset: number = 0): this {
    const component = COMPONENTS[componentName]
    if (!component) {
      console.warn(`Component not found: ${componentName}`)
      return this
    }

    const baseZ = MapComposer.LAYER_Z[component.category] ?? 0
    this.placements.push({
      component,
      x,
      y,
      zIndex: baseZ + zOffset + this.zCounter++
    })

    return this
  }

  /**
   * Place a custom component (not from library)
   */
  placeCustom(component: AsciiComponent, x: number, y: number, zOffset: number = 0): this {
    const baseZ = MapComposer.LAYER_Z[component.category] ?? 0
    this.placements.push({
      component,
      x,
      y,
      zIndex: baseZ + zOffset + this.zCounter++
    })
    return this
  }

  /**
   * Place multiple components at once
   */
  placeMany(placements: Array<{ name: string, x: number, y: number }>): this {
    for (const p of placements) {
      this.place(p.name, p.x, p.y)
    }
    return this
  }

  /**
   * Fill a horizontal line with wall characters
   */
  fillWallHorizontal(y: number, x1: number, x2: number, char: string = '|'): this {
    const wall: AsciiComponent = {
      name: 'wall_fill',
      category: 'structure',
      width: x2 - x1 + 1,
      height: 1,
      sprite: [char.repeat(x2 - x1 + 1)],
      blocking: [Array(x2 - x1 + 1).fill(true)],
      anchor: { x: 0, y: 0 }
    }
    return this.placeCustom(wall, x1, y)
  }

  /**
   * Fill a vertical line with wall characters
   */
  fillWallVertical(x: number, y1: number, y2: number, char: string = '|'): this {
    const wall: AsciiComponent = {
      name: 'wall_fill',
      category: 'structure',
      width: 1,
      height: y2 - y1 + 1,
      sprite: Array(y2 - y1 + 1).fill(char),
      blocking: Array(y2 - y1 + 1).fill([true]),
      anchor: { x: 0, y: 0 }
    }
    return this.placeCustom(wall, x, y1)
  }

  /**
   * Fill an area with a repeating pattern (like grass)
   */
  fillArea(x1: number, y1: number, x2: number, y2: number, pattern: string, blocking: boolean = false): this {
    const width = x2 - x1 + 1
    const height = y2 - y1 + 1
    const sprite: string[] = []
    const blockingGrid: boolean[][] = []

    for (let row = 0; row < height; row++) {
      let line = ''
      const blockRow: boolean[] = []
      for (let col = 0; col < width; col++) {
        const charIndex = (row + col) % pattern.length
        line += pattern[charIndex]
        blockRow.push(blocking)
      }
      sprite.push(line)
      blockingGrid.push(blockRow)
    }

    const fill: AsciiComponent = {
      name: 'area_fill',
      category: 'decoration',
      width,
      height,
      sprite,
      blocking: blockingGrid,
      anchor: { x: 0, y: 0 }
    }
    return this.placeCustom(fill, x1, y1)
  }

  /**
   * Clear all placements
   */
  clear(): this {
    this.placements = []
    this.zCounter = 0
    return this
  }

  /**
   * Render the composed map to a template
   */
  render(): ComposedMap {
    // Initialize empty grids
    const charGrid: string[][] = Array(this.height).fill(null)
      .map(() => Array(this.width).fill(' '))
    const blockingGrid: boolean[][] = Array(this.height).fill(null)
      .map(() => Array(this.width).fill(false))

    // Sort by z-index (lower first, so higher z renders on top)
    const sorted = [...this.placements].sort((a, b) => a.zIndex - b.zIndex)

    // Render each component
    for (const placement of sorted) {
      const { component, x, y } = placement
      const { sprite, blocking, anchor } = component

      // Calculate top-left position based on anchor
      const startX = x - anchor.x
      const startY = y - anchor.y

      // Draw each character of the sprite
      for (let row = 0; row < sprite.length; row++) {
        const gridY = startY + row
        if (gridY < 0 || gridY >= this.height) continue

        const line = sprite[row]
        for (let col = 0; col < line.length; col++) {
          const gridX = startX + col
          if (gridX < 0 || gridX >= this.width) continue

          const char = line[col]
          // Only overwrite if not a space (transparent)
          if (char !== ' ') {
            charGrid[gridY][gridX] = char
          }

          // Update blocking
          if (blocking[row] && blocking[row][col]) {
            blockingGrid[gridY][gridX] = true
          }
        }
      }
    }

    // Convert char grid to template strings
    const template = charGrid.map(row => row.join(''))

    return {
      template,
      blockingGrid,
      width: this.width,
      height: this.height
    }
  }

  /**
   * Get placements for debugging
   */
  getPlacements(): PlacedComponent[] {
    return [...this.placements]
  }
}

/**
 * Helper: Create a simple map quickly
 */
export function createSimpleMap(
  width: number,
  height: number,
  placements: Array<{ name: string, x: number, y: number }>
): ComposedMap {
  const composer = new MapComposer(width, height)
  composer.placeMany(placements)
  return composer.render()
}

export default MapComposer

/**
 * ISOMETRIC GRID ENGINE
 * Simple grid system for isometric rendering
 *
 * Usage:
 *   const grid = new IsometricGrid(32, 24, 64)  // 32x24 cells, 64px each
 *   grid.placeAsset(asset, col, row)
 *   grid.render(ctx, cameraX, cameraZ)
 */
import type { AnimationCycle } from './animationCycles'
import type { CellAnimation } from './cellAnimation'

export interface GridAsset {
  art: string[]
  col: number
  row: number
  type: string
  blocking?: boolean
  scale?: number
  color?: string
  bgColor?: string
  height?: number       // Height in blocks (for buildings, towers, etc.)
  heightLevel?: number  // Which height level this asset sits on (for stacked tiles)
  tileKey?: string      // Reference to tile definition key
  tileOverride?: string // Art-style override: a style-agnostic Tile Library id pinning THIS cell's
                        // visual regardless of the active global style. Absent → follows the style.
  label?: string        // Cell-part label for generated multi-cell assets (tree_leaf_top, roof_top, door, …)
  opacity?: number      // 0–1 render opacity (default 1) — play with contrast / depth
  brightness?: number   // render brightness multiplier (default 1) — dim or pop an element
  cycles?: AnimationCycle[]  // authored glyph-swap cycles — driven by animationCycles
  cellAnim?: CellAnimation   // authored FRAME-BASED transform animation (sway/wind) — driven by cellAnimation
  baseShadow?: boolean  // generator-marked tree-base cell → always casts a ground shadow
  buildingType?: string // building cell's TYPE (store/hospital/…) → drives the apex signage badge
  edge?: string         // building cell's corner/edge/interior class (nw/n/ne/w/interior/e/sw/s/se) → tileset mapping + debug overlay
  footprint?: number    // town-square fountain: the basin side (cells) this ONE prop spans → render one big fountain, not N
  cellPart?: string     // generated cell-part label (tree_stem/tree_top_left/…) surfaced for the DEBUG overlay only. Kept
                        // separate from `label` on purpose: `label` gates a different per-cell render path, so reusing it
                        // here would silently flip world rendering — this field never touches the renderers.
}

export interface GridConfig {
  cols: number
  rows: number
  cellSize: number
  isoScale?: number  // Default 1.4
}

// A grouped building (the 2D facade + its plot anchor) so the ISO view can render it as ONE
// upright unit — the same 2D facade tiles standing at the plot, plus a z-depth — instead of a
// loose pile of per-cell assets. 2D still renders the per-cell assets; this is iso-only.
export interface GridBuilding {
  col: number          // anchor (left) column
  row: number          // ground (front, bottom) row
  length: number       // footprint GRID col-span
  height: number       // footprint GRID row-span (NOT the facade elevation — see cells)
  depth: number        // logical GROUND depth (perpendicular to the facade) — iso box z-extrusion
  type: string
  cells: string[][]    // facade kind grid [row][col]: 'roof' | 'wall' | 'window' | 'door' | 'empty'
  facing?: number      // ISO-only facing index (which iso axis the facade runs along); 2D is always front
  facadeOnBack?: boolean // ISO-only: door/facade is on the camera-far face (north/west houses); 2D unaffected
}

export class IsometricGrid {
  cols: number
  rows: number
  cellSize: number
  isoScale: number

  // Ground tiles - what type each cell is
  ground: string[][]

  // Height grid - elevation in blocks (0 = ground level, negative = water/pit)
  height: number[][]

  // Collision grid - 0 = walkable, 1 = blocked
  collision: number[][]

  // Placed assets
  assets: GridAsset[]

  // Grouped buildings for the ISO view (see GridBuilding). Empty for non-stage maps.
  buildings: GridBuilding[]

  constructor(config: GridConfig) {
    this.cols = config.cols
    this.rows = config.rows
    this.cellSize = config.cellSize
    this.isoScale = config.isoScale ?? 1.4

    // Initialize ground as grass
    this.ground = []
    for (let r = 0; r < this.rows; r++) {
      this.ground[r] = []
      for (let c = 0; c < this.cols; c++) {
        this.ground[r][c] = 'grass'
      }
    }

    // Initialize height as 0 (ground level)
    this.height = []
    for (let r = 0; r < this.rows; r++) {
      this.height[r] = []
      for (let c = 0; c < this.cols; c++) {
        this.height[r][c] = 0
      }
    }

    // Initialize collision as all walkable
    this.collision = []
    for (let r = 0; r < this.rows; r++) {
      this.collision[r] = []
      for (let c = 0; c < this.cols; c++) {
        this.collision[r][c] = 0
      }
    }

    this.assets = []
    this.buildings = []
  }

  // Convert grid position to world position
  gridToWorld(col: number, row: number): { x: number; z: number } {
    return {
      x: col * this.cellSize,
      z: row * this.cellSize
    }
  }

  // Convert world position to grid position
  worldToGrid(x: number, z: number): { col: number; row: number } {
    return {
      col: Math.floor(x / this.cellSize),
      row: Math.floor(z / this.cellSize)
    }
  }

  // Convert world coords to screen coords (isometric projection)
  worldToScreen(worldX: number, worldZ: number, cameraX: number, cameraZ: number, screenW: number, screenH: number) {
    const relX = worldX - cameraX
    const relZ = worldZ - cameraZ
    return {
      x: screenW / 2 + (relX - relZ) * this.isoScale * 0.7,
      y: screenH / 2 + (relX + relZ) * this.isoScale * 0.35
    }
  }

  // Set ground tile type
  setGround(col: number, row: number, type: string) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.ground[row][col] = type
    }
  }

  // Set collision
  setCollision(col: number, row: number, blocked: boolean) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.collision[row][col] = blocked ? 1 : 0
    }
  }

  // Fill rectangle of ground
  fillGround(col: number, row: number, width: number, height: number, type: string) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        this.setGround(col + c, row + r, type)
      }
    }
  }

  // Fill rectangle collision
  fillCollision(col: number, row: number, width: number, height: number, blocked: boolean) {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        this.setCollision(col + c, row + r, blocked)
      }
    }
  }

  // Set height at position
  setHeight(col: number, row: number, h: number) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.height[row][col] = h
    }
  }

  // Get height at position
  getHeight(col: number, row: number): number {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      return this.height[row][col]
    }
    return 0
  }

  // Fill rectangle with height
  fillHeight(col: number, row: number, width: number, h: number, heightValue: number) {
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < width; c++) {
        this.setHeight(col + c, row + r, heightValue)
      }
    }
  }

  // Place an asset at grid position
  placeAsset(art: string[], col: number, row: number, options: Partial<GridAsset> = {}) {
    this.assets.push({
      art,
      col,
      row,
      type: options.type ?? 'decoration',
      blocking: options.blocking ?? false,
      scale: options.scale ?? 1.0,
      color: options.color ?? '#ffffff',
      bgColor: options.bgColor,
      opacity: options.opacity,
      brightness: options.brightness,
      cycles: options.cycles,
      baseShadow: options.baseShadow,
      edge: options.edge,
      footprint: options.footprint,
      cellPart: options.cellPart,
      tileOverride: options.tileOverride, // per-cell art-style pin (e.g. a season's tree tile) — was dropped
    })

    // If blocking, update collision grid
    if (options.blocking) {
      this.setCollision(col, row, true)
    }
  }

  // Check if position is blocked
  isBlocked(col: number, row: number): boolean {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
      return true  // Out of bounds
    }
    return this.collision[row][col] === 1
  }

  // Check if world position is blocked
  isWorldBlocked(x: number, z: number): boolean {
    const { col, row } = this.worldToGrid(x, z)
    return this.isBlocked(col, row)
  }

  // Get all assets sorted by depth for rendering
  getAssetsByDepth(): GridAsset[] {
    return [...this.assets].sort((a, b) => {
      // Sort by z + x for isometric depth
      const depthA = a.row + a.col
      const depthB = b.row + b.col
      return depthA - depthB
    })
  }

  // Get visible assets within camera view
  getVisibleAssets(cameraCol: number, cameraRow: number, viewCols: number, viewRows: number): GridAsset[] {
    const margin = 5
    const minCol = cameraCol - viewCols / 2 - margin
    const maxCol = cameraCol + viewCols / 2 + margin
    const minRow = cameraRow - viewRows / 2 - margin
    const maxRow = cameraRow + viewRows / 2 + margin

    return this.getAssetsByDepth().filter(asset =>
      asset.col >= minCol && asset.col <= maxCol &&
      asset.row >= minRow && asset.row <= maxRow
    )
  }

  // Place a single tile at a specific height level
  placeTile(
    tileKey: string,
    char: string,
    col: number,
    row: number,
    heightLevel: number,
    options: {
      type?: string
      blocking?: boolean
      color?: string
      bgColor?: string
    } = {}
  ) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return

    this.assets.push({
      art: [char],
      col,
      row,
      type: options.type ?? 'tile',
      blocking: options.blocking ?? false,
      color: options.color ?? '#ffffff',
      bgColor: options.bgColor,
      heightLevel,
      tileKey,
    })

    // Blocks are collision, independent of elevation: a blocking asset marks its
    // cell blocked regardless of visual height level.
    if (options.blocking) {
      this.setCollision(col, row, true)
    }
  }

  // Place a composite asset (multi-tile structure)
  placeComposite(
    assetKey: string,
    tiles: Array<{
      tile: string
      char: string
      dx: number
      dy: number
      height: number
      color?: string
      bgColor?: string
      blocking?: boolean
      type?: string
    }>,
    col: number,
    row: number,
    options: {
      colorOverride?: string
    } = {}
  ) {
    for (const t of tiles) {
      const tileCol = col + t.dx
      const tileRow = row + t.dy

      if (tileCol < 0 || tileCol >= this.cols || tileRow < 0 || tileRow >= this.rows) continue

      // Composite assets mark collision (via placeTile) but do NOT raise terrain
      // height — elevation is a separate, deliberate feature (the Height tool).
      this.placeTile(
        t.tile,
        t.char,
        tileCol,
        tileRow,
        t.height,
        {
          type: t.type ?? assetKey,
          blocking: t.blocking ?? false,
          color: options.colorOverride ?? t.color,
          bgColor: t.bgColor,
        }
      )
    }
  }

  // Get assets at a specific cell, sorted by height level
  getAssetsAtCell(col: number, row: number): GridAsset[] {
    return this.assets
      .filter(a => a.col === col && a.row === row)
      .sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
  }

  // Clear all assets at a cell
  clearAssetsAtCell(col: number, row: number) {
    this.assets = this.assets.filter(a => !(a.col === col && a.row === row))
    this.setCollision(col, row, false)
    this.setHeight(col, row, 0)
  }
}

export default IsometricGrid

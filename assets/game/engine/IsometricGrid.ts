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
import type { GroundCellDims } from './groundDims'

/** GENERIC per-tile BEHAVIOR flags copied from the resolved tile's `settings` onto a placed asset, so ONE
 *  render path drives them for ANY tile — a wall, a roof, or a tree leaf. No `type:'building'` special case:
 *  a tree tile carrying `fadeNear` fades near the player exactly like a wall does. */
export interface AssetSettings {
  fadeNear?: boolean    // near the player this tile eases translucent (walls/windows/doors/roof_top)
  cutawayRoof?: boolean // near the player this tile lifts off entirely (roof) — skipped when fully gone
  badge?: { text: string; color: string } // apex signage (STORE/HOSPITAL) drawn generically, no buildingType
}

export interface GridAsset {
  art: string[]
  col: number
  row: number
  type: string
  blocking?: boolean
  scale?: number        // uniform Zoom — multiplies every draw axis (#77/#78). Default 1.
  scaleX?: number       // Width — horizontal sprite stretch, every view (#77/#78). Default 1.
  scaleY?: number       // Height — vertical stretch, grows UP from the base; iso/2D views (#77/#78). Default 1.
  scaleZ?: number       // Depth — vertical stretch in the overhead/top view only (#77/#78). Default 1.
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
  settings?: AssetSettings // GENERIC per-tile behavior (fade/cutaway/badge) copied from the tile — ONE render path reads it
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

  // Per-cell FLOOR COLOUR override (null = use the tile catalog colour). Set from the Property panel,
  // serialized with the template. A colour edit bumps groundVersion so the cached ground layer rebuilds.
  groundColor: (string | null)[][]

  // Per-cell FLOOR DIMS override (per-tile Width/Height/Depth/Zoom + a per-cell pose) — the SAME settings
  // props carry, now on EVERY floor tile. undefined = the default (byte-identical) render. Sparse; set
  // from the Property panel and serialized with the template. A dims edit bumps groundVersion so the
  // cached ground layers (2D static layer + iso offscreen cache) rebuild. Mirrors groundColor.
  groundDims: (GroundCellDims | undefined)[][]

  // Placed assets
  assets: GridAsset[]

  // Grouped buildings for the ISO view (see GridBuilding). Empty for non-stage maps.
  buildings: GridBuilding[]

  // Bumped on every ground/height edit so the 2D renderer can cache the static ground layer and rebuild
  // it ONLY when the terrain actually changed (see render2D's _groundLayer).
  groundVersion = 0

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

    // Initialize floor-colour overrides as none (null → the tile's own catalog colour shows)
    this.groundColor = []
    for (let r = 0; r < this.rows; r++) {
      this.groundColor[r] = []
      for (let c = 0; c < this.cols; c++) {
        this.groundColor[r][c] = null
      }
    }

    // Initialize floor-dims overrides as none (sparse — a cell stays undefined until it's edited)
    this.groundDims = []
    for (let r = 0; r < this.rows; r++) this.groundDims[r] = []

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
      if (this.ground[row][col] !== type) this.groundVersion++
      this.ground[row][col] = type
    }
  }

  // Set collision
  setCollision(col: number, row: number, blocked: boolean) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      this.collision[row][col] = blocked ? 1 : 0
    }
  }

  // Set (or clear, with null) a per-cell FLOOR COLOUR override. Bumps groundVersion so the cached
  // ground layer rebuilds and the edit shows immediately.
  setGroundColor(col: number, row: number, color: string | null) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      if (!this.groundColor[row]) this.groundColor[row] = []
      this.groundColor[row][col] = color
      this.groundVersion++
    }
  }

  // Merge a per-cell FLOOR DIMS override (per-tile Width/Height/Depth/Zoom + pose). The partial merges
  // onto the cell's existing entry (set one axis at a time from the panel); pass { pose: undefined } to
  // clear the pose. Bumps groundVersion so the cached ground layers rebuild and the edit shows at once.
  setGroundDims(col: number, row: number, partial: Partial<GroundCellDims>) {
    if (col >= 0 && col < this.cols && row >= 0 && row < this.rows) {
      if (!this.groundDims[row]) this.groundDims[row] = []
      this.groundDims[row][col] = { ...this.groundDims[row][col], ...partial }
      this.groundVersion++
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
      if (this.height[row][col] !== h) this.groundVersion++
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

  // Place an asset at grid position. Returns the placed asset so a caller can set the few GridAsset
  // fields this fixed option list doesn't carry (height/label/buildingType/…) WITHOUT reaching into
  // grid.assets directly — the same trick cellStack.pushTile uses.
  placeAsset(art: string[], col: number, row: number, options: Partial<GridAsset> = {}): GridAsset {
    const asset: GridAsset = {
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
      heightLevel: options.heightLevel,   // stack level: the editor brush stacks assets on one cell
    }
    this.assets.push(asset)

    // If blocking, update collision grid
    if (options.blocking) {
      this.setCollision(col, row, true)
    }
    return asset
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

  // Assets within the camera view rect (+ margin). Just a cull — NO depth sort here: every render path
  // re-sorts the merged asset+building+entity+player draw list by the same depth key, so sorting the
  // assets first was a second O(N log N) pass over EVERY asset on the map, every frame, thrown away.
  getVisibleAssets(cameraCol: number, cameraRow: number, viewCols: number, viewRows: number): GridAsset[] {
    const margin = 5
    const minCol = cameraCol - viewCols / 2 - margin
    const maxCol = cameraCol + viewCols / 2 + margin
    const minRow = cameraRow - viewRows / 2 - margin
    const maxRow = cameraRow + viewRows / 2 + margin

    return this.assets.filter(asset =>
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

  // Replace the WHOLE asset list — the single write-point for a wholesale swap (load/deserialize), so a
  // later step can rebuild per-cell stacks here instead of code assigning grid.assets directly.
  setAssets(assets: GridAsset[]) {
    this.assets = assets
  }

  // Drop every asset (keeps ground/collision/height). Reassigns the array — identical to the `assets = []`
  // it replaces — so identity-keyed render caches (e.g. the tree-cell set) rebuild.
  clearAssets() {
    this.assets = []
  }

  // Drop every asset matching `pred`. Reassigns to a filtered array (new identity) exactly like the
  // `assets = assets.filter(...)` writes it replaces, so behaviour and cache-busting are unchanged.
  removeAssetsWhere(pred: (asset: GridAsset) => boolean) {
    this.assets = this.assets.filter(a => !pred(a))
  }
}

export default IsometricGrid

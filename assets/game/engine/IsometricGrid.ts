/**
 * ISOMETRIC GRID ENGINE
 * Simple grid system for isometric rendering
 *
 * Usage:
 *   const grid = new IsometricGrid(32, 24, 64)  // 32x24 cells, 64px each
 *   grid.placeAsset(asset, col, row)
 *   grid.render(ctx, cameraX, cameraZ)
 */
import type { Animation } from './animation/tileAnimation'
import type { AnimationCycle } from './animationCycles'
import type { CellAnimation } from './cellAnimation'
import type { DepthDir } from './render/isoBlock'
import type { TilePose } from './tileset/pose'
import type { AssetLight, TileDisplay, TileShape } from './tileset/tileset'
import { groundTileColor } from './tileset/groundColor'

/** GENERIC per-tile BEHAVIOR flags copied from the resolved tile's `settings` onto a placed asset, so ONE
 *  render path drives them for ANY tile — a wall, a roof, or a tree leaf. No `type:'building'` special case:
 *  a tree tile carrying `fadeNear` fades near the player exactly like a wall does. */
export interface AssetSettings {
  fadeNear?: boolean    // near the player this tile eases translucent (walls/windows/doors/roof_top)
  cutawayRoof?: boolean // near the player this tile lifts off entirely (roof) — skipped when fully gone
  badge?: { text: string; color: string } // apex signage (STORE/HOSPITAL) drawn generically, no buildingType
  display?: TileDisplay // 'single' → ONE centered tile drawn INSIDE the block (billboard at the block centre)
                        // over a plain shell; absent/'all-faces' → the tile is painted on all visible faces.
  transparent?: boolean // the block SHELL is not drawn — only the tile's content shows (with 'single', just the
                        // centered billboard, in its own colour). Lets a flower show WITHOUT colouring its block.
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
  depth?: number        // Directional DEPTH (blocks): >1 (with depthDir) extrudes this block into a long iso
                        // box spanning `depth` cells along a diagonal, anchored at its base cell. Default 1
                        // (a unit cube). ISO view. Distinct from scaleZ (the flat top-view stretch).
  depthDir?: DepthDir   // Which iso diagonal the depth extrudes along: right-up/left-up/left-down/right-down.
  pose?: TilePose       // PER-INSTANCE position/rotation/flip (x/y/rotate/flip inspector). Deviations-only; the
                        // render applies it through applyPose in every view. Distinct from the tileset-KIND pose
                        // (shared art tuning) — this moves THIS placed tile, not every tile of its kind.
  zOffset?: number      // "z position" — ISO-DIAGONAL slide magnitude in cells (NOT a vertical lift). The tile
                        // moves along zDir's iso diagonal: +z toward zDir, −z toward its opposite. Every view
                        // shows the ground-plane slide (iso/2D/top). Default 0. (Field name kept for round-trip.)
  zDir?: DepthDir       // Which iso diagonal the "z position" slides along (right-up/left-up/left-down/right-down).
                        // Default right-up → +z = up-right (toward the back), −z = down-left. Same 4 dirs as depthDir.
  zIndex?: number       // DRAW-PRIORITY (CSS z-index style): the depth sort draws a HIGHER zIndex LATER (on top /
                        // in front), overriding the positional iso/2D/top key — e.g. a cell authored with a higher
                        // zIndex renders in front of one behind it. A capability for composition optimization;
                        // every cell defaults to 0 → sorts positionally, exactly as before.
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
  animations?: Animation[]   // authored TILE ANIMATIONS (settings tweens) — a LIST so they chain; the render
                             // resolves their live per-frame overrides via resolveAnimatedSettings, scoped by
                             // each animation's scope{styles,views}. Round-trips in Template.assetsData like cellAnim.
  placedAt?: number          // clock timestamp (ms) this tile was placed — the anchor a tile animation's
                             // start/loop delays are measured from. Absent → 0 (treated as placed at the origin).
  baseShadow?: boolean  // generator-marked tree-base cell → always casts a ground shadow
  buildingType?: string // building cell's TYPE (store/hospital/…) → drives the apex signage badge
  settings?: AssetSettings // GENERIC per-tile behavior (fade/cutaway/badge) copied from the tile — ONE render path reads it
  shape?: TileShape     // PER-INSTANCE render SHAPE: 'square' (default cube) | 'circle' (shaded ball). Absent/'square'
                        // → the existing cube render, byte-identical. 'circle' → the renderer builds a ball in the
                        // SAME volume, tinted by `color`. Round-trips in Template.assetsData like scaleX/pose/display.
                        // Extensible via a render dispatch map keyed by this value ('oval', … add one drawer, no if).
  light?: AssetLight    // PER-INSTANCE LIGHT setting: this tile casts a warm ground GLOW POOL, drawn only at night
                        // (collectLampGlows → drawNightLighting). `distance` sizes the pool (cells), `intensity`/
                        // `color` its strength/hue, `on:false` casts none. Absent → no pool (a lamp with no light
                        // falls back to the default warm glow). Round-trips in Template.assetsData like shape.
  edge?: string         // building cell's corner/edge/interior class (nw/n/ne/w/interior/e/sw/s/se) → tileset mapping + debug overlay
  footprint?: number    // town-square fountain: the basin side (cells) this ONE prop spans → render one big fountain, not N
  cellPart?: string     // generated cell-part label (tree_stem/tree_top_left/…) surfaced for the DEBUG overlay only. Kept
                        // separate from `label` on purpose: `label` gates a different per-cell render path, so reusing it
                        // here would silently flip world rendering — this field never touches the renderers.
}

/** A floor is a regular GridAsset carrying this type — the discriminator setGround/clear/getStack use to find
 *  "the floor" among a cell's level-0 assets. It is NOT a render mode: the floor renders through the same
 *  per-asset block path as every tile; `type:'floor'` only routes its art KIND to groundKind (see assetKind). */
export const FLOOR_TYPE = 'floor'

/** The default terrain slug a fresh grid / a repaint with no explicit type uses. */
export const DEFAULT_FLOOR_SLUG = 'grass'

export interface GridConfig {
  cols: number
  rows: number
  cellSize: number
  isoScale?: number  // Default 1.4
}

export class IsometricGrid {
  cols: number
  rows: number
  cellSize: number
  isoScale: number

  // Height grid - elevation in blocks (0 = ground level, negative = water/pit)
  height: number[][]

  // Collision grid - 0 = walkable, 1 = blocked
  collision: number[][]

  // Placed assets (buildings are just stamped per-cell tiles here — no separate grouped-building array).
  // THE FLOOR IS AN ASSET: a floor is a plain GridAsset with type 'floor' at heightLevel 0 — a regular tile
  // that carries NO hardcoded height; the renderer reads its ground tile's OWN DB block-height (a flat tile is
  // 0.1) and draws a thin slab, just like a flower/decor. It rides this same list and renders through the SAME per-asset tile path as every wall/prop, so
  // there is NO separate ground store and NO separate ground renderer. `floorIndex` is a per-cell O(1) lookup
  // accelerator over that ONE source of truth (the asset), not a parallel store.
  assets: GridAsset[]

  // O(1) "which floor asset is at this cell" index, keyed `${col},${row}`. Kept in sync by the floor
  // mutators (setGround/…) + rebuilt on a wholesale asset swap (setAssets/clearAssets/removeAssetsWhere).
  private floorIndex = new Map<string, GridAsset>()

  // O(1) "assets at this cell" index, keyed `${col},${row}` → that cell's assets in the SAME order
  // getAssetsAtCell used to produce by filtering + sorting the WHOLE list every call (floor first, then by
  // heightLevel). Rebuilt LAZILY on the next read after any asset mutation (invalidated → null below), so a
  // frame that draws N cells over M assets costs ONE O(M) rebuild instead of O(N·M) full-list filters — the
  // per-frame N+1. Safe to share the cached array: no tile ever changes cell in place, and every caller only
  // READS it (verified). null = must rebuild.
  private cellIndex: Map<string, GridAsset[]> | null = null

  // Bumped on every floor/height edit — a cheap dirty counter cold-path callers (the debug terrain-label
  // overlay) can memo against. There is NO parallel ground/groundColor/groundDims store: the floor assets in
  // `assets` are the ONE source of truth, read per-cell via floorAt()/groundAt().
  groundVersion = 0

  constructor(config: GridConfig) {
    this.cols = config.cols
    this.rows = config.rows
    this.cellSize = config.cellSize
    this.isoScale = config.isoScale ?? 1.4

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

    // Default terrain: a grass floor asset in every cell (the old all-'grass' ground default). The generators
    // then repaint via setGround; CLEARING a cell removes its floor (→ empty), which is the new bare state.
    this.fillGround(0, 0, this.cols, this.rows, DEFAULT_FLOOR_SLUG)
  }

  // ── FLOOR-AS-ASSET helpers ────────────────────────────────────────────────────────────────────────
  private floorKey(col: number, row: number): string { return `${col},${row}` }

  /** The floor asset at a cell (type 'floor', heightLevel 0), or undefined for a bare/cleared cell. */
  floorAt(col: number, row: number): GridAsset | undefined {
    return this.floorIndex.get(this.floorKey(col, row))
  }

  /** The floor slug at a cell (e.g. 'grass'/'road') — the O(1) replacement for the old `ground[row][col]`.
   *  A cleared/empty cell has no floor → falls back to the default slug so callers never read undefined. */
  groundAt(col: number, row: number): string {
    return this.floorAt(col, row)?.tileKey ?? DEFAULT_FLOOR_SLUG
  }

  /** The grid cells a floor covers. A plain floor is its one cell; a Z-WIDTH RUN floor (depth>1 + depthDir —
   *  the "same as roofs" merge) covers `depth` cells stepping along its diagonal, so every covered cell maps
   *  back to the ONE run tile (groundAt / 2D / stack still resolve per-cell). */
  floorCoveredCells(f: GridAsset): { col: number; row: number }[] {
    const n = Math.max(1, Math.floor(f.depth ?? 1))
    if (n <= 1 || !f.depthDir) return [{ col: f.col, row: f.row }]
    const S = { 'right-up': { dc: 0, dr: -1 }, 'left-up': { dc: -1, dr: 0 }, 'left-down': { dc: 0, dr: 1 }, 'right-down': { dc: 1, dr: 0 } }[f.depthDir]
    const out: { col: number; row: number }[] = []
    for (let k = 0; k < n; k++) out.push({ col: f.col + k * S.dc, row: f.row + k * S.dr })
    return out
  }

  /** Rebuild the floorIndex from the current asset list (after a wholesale swap / load). A Z-WIDTH run floor
   *  is indexed at EVERY cell it covers, so floorAt/groundAt resolve per-cell even though it is one tile. */
  private rebuildFloorIndex(): void {
    this.floorIndex.clear()
    for (const a of this.assets) if (a.type === FLOOR_TYPE) for (const { col, row } of this.floorCoveredCells(a)) this.floorIndex.set(this.floorKey(col, row), a)
  }

  /** Merge contiguous same-floor cells (same tileKey + colour) into ONE Z-WIDTH floor tile — the SAME
   *  depth-spanned-block trick roofs use (settings.depth + depthDir), applied to grass/road so the map draws a
   *  handful of run tiles instead of one per cell. Each seed run is measured in BOTH directions and merged along
   *  the LONGER one, so a run spans ALONG its road: a grid-ROW road runs `\` (depthDir 'right-down' = +col), a
   *  grid-COLUMN road runs `/` (depthDir 'left-down' = +row). The run anchors at its BACKMOST cell (min col / min
   *  row) so the flat-run depth sort keeps it behind standing tiles. Data stays TILES (no new model); the rest of
   *  a run are dropped + re-indexed to the anchor. Call after the ground is bulk-set (generation / load). Editing
   *  a covered cell decompresses its run first (decompressGroundAt), so per-cell edits keep working. */
  compressGround(): void {
    const remove = new Set<GridAsset>()
    const used = new Set<GridAsset>() // floors already merged into a run (anchor or consumed member)
    // A neighbour joins the seed run only if it's an UNCLAIMED, un-merged floor of the SAME tile + colour.
    const joins = (g: GridAsset | undefined, seed: GridAsset): g is GridAsset =>
      !!g && !used.has(g) && (g.depth ?? 1) <= 1 && g.tileKey === seed.tileKey && (g.color ?? '') === (seed.color ?? '')
    for (let r = 0; r < this.rows; r++) {
      let c = 0
      while (c < this.cols) {
        const f = this.floorAt(c, r)
        if (!f || (f.depth ?? 1) > 1 || used.has(f)) { c++; continue } // no floor, already a run, or claimed
        // How far the same floor runs RIGHT (along the row, +col) vs DOWN (along the column, +row) from here.
        let hEnd = c; while (hEnd + 1 < this.cols && joins(this.floorAt(hEnd + 1, r), f)) hEnd++
        let vEnd = r; while (vEnd + 1 < this.rows && joins(this.floorAt(c, vEnd + 1), f)) vEnd++
        const hLen = hEnd - c + 1, vLen = vEnd - r + 1
        if (hLen < 2 && vLen < 2) { used.add(f); c++; continue } // lone cell — nothing to merge
        if (hLen >= vLen) { // ROW run → `\`
          for (let cc = c; cc <= hEnd; cc++) { const g = this.floorAt(cc, r); if (g) { used.add(g); if (g !== f) remove.add(g) } }
          f.depth = hLen; f.depthDir = 'right-down'
          c = hEnd + 1
        } else { // COLUMN run → `/` (anchor stays at min row, the backmost cell)
          for (let rr = r; rr <= vEnd; rr++) { const g = this.floorAt(c, rr); if (g) { used.add(g); if (g !== f) remove.add(g) } }
          f.depth = vLen; f.depthDir = 'left-down'
          c++
        }
      }
    }
    if (remove.size) this.assets = this.assets.filter(a => !remove.has(a))
    this.rebuildFloorIndex()
    this.cellIndex = null
    this.groundVersion++
  }

  /** If (col,row) sits in a Z-WIDTH run floor, split that run back into plain per-cell floors so an edit can
   *  change just this cell ("cut it to put another tile"). No-op for a plain floor / bare cell. */
  private decompressGroundAt(col: number, row: number): void {
    const run = this.floorAt(col, row)
    if (!run || (run.depth ?? 1) <= 1) return
    const cells = this.floorCoveredCells(run)
    this.assets = this.assets.filter(a => a !== run)
    for (const { col: cc, row: rr } of cells) {
      const cell = this.makeFloorAsset(cc, rr, run.tileKey ?? DEFAULT_FLOOR_SLUG)
      if (run.color) cell.color = run.color
      this.assets.push(cell)
      this.floorIndex.set(this.floorKey(cc, rr), cell)
    }
    this.cellIndex = null
  }

  /** Rebuild the per-cell asset index in ONE O(assets) pass — grouped by cell, then each cell sorted (floor
   *  first, then heightLevel), matching the old getAssetsAtCell result. Called lazily by getAssetsAtCell when
   *  the index is null (invalidated by a mutation). */
  private rebuildCellIndex(): void {
    const idx = new Map<string, GridAsset[]>()
    for (const a of this.assets) {
      // A Z-WIDTH run FLOOR belongs to EVERY cell it covers (so a prop's stack + a per-cell pick see the ground
      // beneath); every other tile is its single cell.
      const cells = (a.type === FLOOR_TYPE && (a.depth ?? 1) > 1) ? this.floorCoveredCells(a) : [{ col: a.col, row: a.row }]
      for (const { col, row } of cells) {
        const key = this.floorKey(col, row)
        const arr = idx.get(key)
        if (arr) arr.push(a)
        else idx.set(key, [a])
      }
    }
    for (const arr of idx.values()) {
      arr.sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0) || (a.type === FLOOR_TYPE ? -1 : 0) - (b.type === FLOOR_TYPE ? -1 : 0))
    }
    this.cellIndex = idx
  }

  private _slugSnap: string[][] = []
  private _slugSnapVer = -1
  /** A [row][col] slug grid derived from the floor assets — for the DEV terrain-label overlay only (its
   *  autotiling needs neighbour lookups). NOT a source of truth: the floor assets are; this is a snapshot
   *  memoized against groundVersion so the debug pass's per-cell reads stay O(1). */
  groundSlugs(): string[][] {
    if (this._slugSnapVer === this.groundVersion) return this._slugSnap
    const out: string[][] = []
    for (let r = 0; r < this.rows; r++) {
      out[r] = []
      for (let c = 0; c < this.cols; c++) out[r][c] = this.groundAt(c, r)
    }
    this._slugSnap = out
    this._slugSnapVer = this.groundVersion
    return out
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

  /** Build a bare floor asset for a cell — a regular tile that carries NO hardcoded height: the renderer reads
   *  the floor tile's OWN block-height from the DB (its ground tile, resolved via groundKind(tileKey)) and draws
   *  it as a thin slab (a flat tile is 0.1 blocks tall in the DB). Height is DATA, never invented here. The
   *  ground COLOUR is per-cell STATE the map-builder writes (`color` — see setGround); renders READ it, never
   *  derive it, so a floor with no colour renders nothing (empty), never a hardcoded fallback. */
  private makeFloorAsset(col: number, row: number, slug: string, color?: string): GridAsset {
    // A floor is BORN with its colour as STATE — either the explicit colour a map-builder PICKED, or (when a raw
    // setGround / the ctor default lays one down) auto-picked from the ground tile's own DB colour. So no floor is
    // ever colourless and every view just READS floor.color, never deriving it or falling back to a hardcode.
    return { art: [''], col, row, type: FLOOR_TYPE, tileKey: slug, heightLevel: 0, blocking: false, color: color ?? groundTileColor(slug, col, row) }
  }

  // Set the floor tile TYPE of a cell — place/replace its level-0 floor asset (the slug rides `tileKey`,
  // which the renderer maps to groundKind for the tile's art). `color` is the per-cell ground COLOUR the
  // map-builder (generator / editor paint) PICKS and writes as state, so the render reads it instead of
  // deriving it (no render-time colour math, no fallback). Omitting it keeps any existing colour (a re-slug
  // that shouldn't recolour); passing it sets/updates the colour.
  setGround(col: number, row: number, type: string, color?: string) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return
    this.decompressGroundAt(col, row) // if this cell is inside a z-width run, cut the run so only THIS cell changes
    const existing = this.floorAt(col, row)
    if (existing) {
      if (existing.tileKey !== type) { existing.tileKey = type; this.groundVersion++ }
      if (color !== undefined && existing.color !== color) { existing.color = color; this.groundVersion++ }
      return
    }
    const floor = this.makeFloorAsset(col, row, type, color)
    this.assets.push(floor)
    this.floorIndex.set(this.floorKey(col, row), floor)
    this.cellIndex = null
    this.groundVersion++
  }

  /** Remove a cell's floor entirely (→ EMPTY cell, not grass) — the bare state after a Clear. */
  removeFloor(col: number, row: number) {
    this.decompressGroundAt(col, row) // clear just THIS cell, not the whole z-width run it may belong to
    const key = this.floorKey(col, row)
    const floor = this.floorIndex.get(key)
    if (!floor) return
    this.floorIndex.delete(key)
    this.assets = this.assets.filter(a => a !== floor)
    this.cellIndex = null
    this.groundVersion++
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

  // Set height at position. `col`/`row` address a CELL: a caller holding a CONTINUOUS position (a unit's
  // `player.x / cellSize`, an interpolated walk) means "the cell it stands in", so the index is floored here.
  // A range check alone lets a fraction through and `height[8.34]` is undefined — the crash this guards.
  setHeight(col: number, row: number, h: number) {
    const c = Math.floor(col), r = Math.floor(row)
    if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
      if (this.height[r][c] !== h) this.groundVersion++
      this.height[r][c] = h
    }
  }

  // Get height at position — the CELL a coordinate falls inside (see setHeight).
  getHeight(col: number, row: number): number {
    const c = Math.floor(col), r = Math.floor(row)
    if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
      return this.height[r][c]
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
      zIndex: options.zIndex,   // draw-priority (CSS z-index) — undefined ⇒ the sort treats it as 0 (positional)
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
      height: options.height,             // per-instance block-height (a generated flower stands 1 block); undefined ⇒ tile height
      settings: options.settings,         // per-instance render (e.g. display:'single' for a standing billboard); undefined ⇒ tile default
    }
    this.assets.push(asset)
    this.cellIndex = null

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
    this.cellIndex = null

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

  // Get assets at a specific cell, sorted by height level. Within a level the FLOOR sorts first so it stays
  // the base of the stack (getStack index 0) and renders UNDER same-cell props.
  getAssetsAtCell(col: number, row: number): GridAsset[] {
    if (!this.cellIndex) this.rebuildCellIndex()
    return this.cellIndex!.get(this.floorKey(col, row)) ?? []
  }

  // Clear all assets at a cell (INCLUDING its floor → empty cell).
  clearAssetsAtCell(col: number, row: number) {
    this.decompressGroundAt(col, row) // split a z-width run so only THIS cell is cleared
    this.assets = this.assets.filter(a => !(a.col === col && a.row === row))
    this.floorIndex.delete(this.floorKey(col, row))
    this.cellIndex = null
    this.setCollision(col, row, false)
    this.setHeight(col, row, 0)
    this.groundVersion++
  }

  // Replace the WHOLE asset list — the single write-point for a wholesale swap (load/deserialize). Floors ride
  // this list now, so rebuild the floor index + bump the projection version.
  setAssets(assets: GridAsset[]) {
    this.assets = assets
    this.rebuildFloorIndex()
    this.cellIndex = null
    this.groundVersion++
  }

  // Drop every NON-FLOOR asset (keeps the floor/ground + collision/height) — the "clear props, keep terrain"
  // semantics callers rely on. Floors are assets now, so they must be preserved explicitly.
  clearAssets() {
    this.assets = this.assets.filter(a => a.type === FLOOR_TYPE)
    this.cellIndex = null
  }

  // Drop every asset matching `pred`. Reassigns to a filtered array (new identity). Resync the floor index
  // in case a floor was removed.
  removeAssetsWhere(pred: (asset: GridAsset) => boolean) {
    this.assets = this.assets.filter(a => !pred(a))
    this.rebuildFloorIndex()
    this.cellIndex = null
    this.groundVersion++
  }
}

export default IsometricGrid

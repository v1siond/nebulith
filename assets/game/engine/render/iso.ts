import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, IsometricGrid, FLOOR_TYPE } from '@/engine/IsometricGrid'
import { assetAnimFrame, assetCycleFrame } from '@/engine/assetAnimations'
import { type AttackAnim, animFrame } from '@/engine/attackAnimations'
import { type Facing } from '@/engine/villageLayout'
import { assetCellTransform } from '@/engine/cellAnimation'
import { isGroundContact } from '@/engine/cellLabels'
import { darkenColor, lightenColor, withAlpha } from '@/engine/colors'
import { entityPalette } from '@/engine/entityArt'
import { entityQuestMarker } from '@/engine/entityQuestMarker'
import { type Projectile, projectileCellAt } from '@/game/projectiles'
import { type HitMarker } from '@/game/runtime/combat'
import { type PlayerState, barFraction, hpFraction, playerDisplayName } from '@/game/runtime/player'
import { type CombatState, type Entity, type Quest } from '@/game/types'
import { resolveGroundTile, type TileShape } from '@/engine/tileset/tileset'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { Connector } from '@/lib/api'
import { ASCII_FONT, COMBAT_RANGE, type DayNight, type DrawVisual, ENEMY_MOVE_MS, LIGHT, applyCellTransform, isoCameraFocus, assetCaptionByCell, terrainLabelAt, collectLampGlows, type CompositionGhost, compositionGhostColors, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawConnectorMarker, drawAttackAnimFrame, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, clipToBall, SINGLE_TILE_FRAC, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, labelTileImage, kindTileImage, labelTileRecolor, groundDecorImage, tileImage, tintedImage, tintedGlyphSprite, treeCanopyLayers, treeCellSet } from './shared'
import { resolveAssetDrawSize } from './assetDimensions'
import { resolveAssetAnimation } from './assetAnimation'
import { getStack, assetStackIndexer, type TileSource } from '@/engine/cellStack'
import { isoBlockFaces, isoDepthBox, depthCells, depthFrontExtent, isoZOffset, rotateDepthDir, spanBackmost, type BlockFace, type DepthDir } from './isoBlock'
import { type Orientation } from './isoOrientation'
import { cellOrienterFor, orientCellTurn, deorientCellTurn, orientedDimsForTurn, facingForTurn, wrapTurn } from './isoTurn'
import { resolveTileHeight, blockLayers, layerBlockScale } from '@/engine/tileset/tileHeight'
import { EMOJI_TILESET } from '@/engine/tileset/emojiTileset'
import { applyPose } from '@/engine/tileset/pose'
import { cubeGeom, depthBoxGeom, billboardGeom, diamondGeom, pointInTileGeom, outlineSegments, poseMapper, tileGeomCentroid, tilesInScreenRect, type TileGeom } from './tileHit'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, type ElementKind, type ImageVisual, type Style } from '@/game/artStyle'
import { DEFAULT_CHARACTER_ANIMATIONS, activeFrame } from '@/game/runtime/entityAnimation'


/** Per-face brightness from the global light: a face whose outward screen normal points toward the
 *  sun is brighter, one facing away dimmer. Returns a darken factor in [0.6, 1.0]. */
export function faceLight(nx: number, ny: number): number {
  const len = Math.hypot(nx, ny) || 1
  const d = (nx / len) * LIGHT.dir.x + (ny / len) * LIGHT.dir.y // -1 (away) .. 1 (toward)
  return 0.6 + 0.4 * (d * 0.5 + 0.5)
}


// ════════════════════════════════════════════════════════════════════════════
// INVERTED TILE PICK — record the geometry of every drawn tile, then hit-test IT
// The selector picks the TILE the user visually points at (transform-aware) and cascades to its cell —
// NOT the flat ground cell. render() RECORDS each drawn asset's real screen silhouette (tileHit geoms,
// computed at the draw site so they can NEVER drift from the draw) into this per-frame list, in draw order
// (back→front). The picker walks it front→back (topmost first) so the tile you SEE on top wins an overlap.
// ════════════════════════════════════════════════════════════════════════════

/** One recorded rendered tile: its cell, its `level` (heightLevel — used by internal anchors like the lamp
 *  glow), its `stackIndex` (its slot in the cell's ordered stack — the per-tile identity the SELECTION uses so
 *  two tiles at the same level are distinguishable), the store it came from, and its transform-aware screen
 *  silhouette. Populated by render(); read by the pick + the selection/hover highlight. */
export interface TileHit {
  col: number
  row: number
  level: number
  stackIndex: number
  source: TileSource
  geom: TileGeom
  /** For a UNIT hit (source 'entity'): the entity id to select. A UNIT is just a tile the picker returns like
   *  any other — it records its billboard silhouette here so a click on the figure selects the unit (not the
   *  floor under it). Absent for asset/floor tiles. */
  entityId?: string
}

// The tiles drawn by the LAST render(), in draw order. The RAF loop refreshes this every frame, so a pick on
// mousemove/mousedown reads current geometry. Reset at the top of the asset loop.
let isoTileHits: TileHit[] = []

/** EVERY recorded tile whose silhouette contains (x,y), TOPMOST (last-drawn) FIRST — the frontmost is the
 *  pick; the rest are occluded behind it (click-to-cycle reaches them). Canvas-internal pixels. */
export function pickIsoTilesAt(x: number, y: number): TileHit[] {
  const hits: TileHit[] = []
  for (let i = isoTileHits.length - 1; i >= 0; i--) {
    if (pointInTileGeom(x, y, isoTileHits[i].geom)) hits.push(isoTileHits[i])
  }
  return hits
}

/** The frontmost recorded tile under (x,y), or null (the caller then falls back to the flat ground cell). */
export function pickIsoTileAt(x: number, y: number): TileHit | null {
  return pickIsoTilesAt(x, y)[0] ?? null
}

/** Every recorded tile whose silhouette centroid is inside the screen rect — the block-aware MARQUEE query
 *  (the shift+drag box's tiles), de-duped, topmost first. Canvas-internal pixels, like pickIsoTilesAt. */
export function renderedTilesInRect(x0: number, y0: number, x1: number, y1: number): TileHit[] {
  return tilesInScreenRect(isoTileHits, x0, y0, x1, y1)
}

/** The recorded silhouette of the tile at (col,row,level) drawn this frame, TOPMOST first — so an internal
 *  anchor (the lamp glow) outlines the ACTUAL rendered tile by its heightLevel. null = not drawn. */
export function isoRecordedGeom(col: number, row: number, level: number): TileGeom | null {
  for (let i = isoTileHits.length - 1; i >= 0; i--) {
    const t = isoTileHits[i]
    if (t.col === col && t.row === row && t.level === level) return t.geom
  }
  return null
}

/** The recorded silhouette of the tile at (col,row) that sits at STACK INDEX `stackIndex` — the per-tile
 *  identity the SELECTION highlight uses, so a grass slab and a wall block at the SAME level hug their OWN
 *  silhouettes (not just the topmost). null = that slot wasn't drawn this frame (→ flat-cell fallback). */
export function isoRecordedTileGeom(col: number, row: number, stackIndex: number): TileGeom | null {
  for (let i = isoTileHits.length - 1; i >= 0; i--) {
    const t = isoTileHits[i]
    if (t.col === col && t.row === row && t.stackIndex === stackIndex) return t.geom
  }
  return null
}

/** Stroke a tile's outline so the highlight HUGS the tile (cube = base+top rings + verticals; poly = ring). */
function strokeTileOutline(ctx: CanvasRenderingContext2D, geom: TileGeom): void {
  for (const seg of outlineSegments(geom)) {
    if (seg.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(seg[0].x, seg[0].y)
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y)
    ctx.stroke()
  }
}


// ════════════════════════════════════════════════════════════════════════════
// The separate ISO GROUND LAYER and its offscreen cache were REMOVED: a floor is now
// an ordinary level-0 tile in grid.assets (a thin colored slab) drawn by the per-asset
// loop below, so the map renders through ONE tile path with no bespoke ground renderer.

export let isoRenderMsEMA = 0

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}


// ════════════════════════════════════════════════════════════════════════════
// CAMERA TURN — HORIZONTAL rotation of the iso camera, continuous, settling on the 4 corners (#75)
// Alexander: "the rotate button or action … just rotates the map horizontally, changing the front perspective
// of the map and showing a different side of it" / "we can rotate the corners, 4 corners, 4 rotation options,
// all faces of the map are visible" — because "tiles that aren't in the front side from the camera perspective
// are hard to select, specially with collisions on" — and then: "when rotating i want to see the animation of
// the world rotating … Ideally, I should have a controller that allows me to rotate more accurately, with the
// current 4 options as the quick turnarounds".
//
// So the camera carries a TURN in quarter-turns (isoTurn), not just a corner: a WHOLE turn IS an `Orientation`
// and runs today's exact integer maths; a fractional turn is the transient a drag/settle animation passes
// through. The iso PROJECTION is untouched — a turned camera rotates the WORLD coord into the VIEW FRAME first
// (isoTurn.cellOrienterFor) and then projects it, which is what swings a different map corner to the front.
// Turn 0 short-circuits everywhere, so an un-turned frame is byte-identical.
// ════════════════════════════════════════════════════════════════════════════

/** The turn a render() uses when its params omit `cameraTurn`/`cameraFacing` — driven by the `__setCameraTurn`
 *  debug seam until the editor UI owns it in React state and passes the param (an explicit param always wins).
 *  ONE source of truth: the facing accessors below are just this value read at its nearest corner. */
let currentCameraTurn = 0

/** The camera turn (quarter-turns, 0..4) a param-less render() will use. */
export function isoCameraTurn(): number {
  return currentCameraTurn
}

/** Turn the camera to `turn` quarter-turns (any real; wrapped onto 0..4). The editor's RAF loop redraws every
 *  frame, so the next frame shows it — driving this from an animation frame IS the rotation animation.
 *  Returns the wrapped turn so a caller/seam can echo it. */
export function setIsoCameraTurn(turn: number): number {
  currentCameraTurn = wrapTurn(turn)
  return currentCameraTurn
}

/** The camera CORNER a param-less render() is at/nearest — a whole turn is exactly its facing. */
export function isoCameraFacing(): Orientation {
  return facingForTurn(currentCameraTurn)
}

/** Turn the camera to `facing` (quarter-turns CW, 0–3) — the instant 4-way jump the nav buttons drive today.
 *  A facing IS a whole turn, so this writes the same state the continuous turn does. */
export function setIsoCameraFacing(facing: Orientation): Orientation {
  setIsoCameraTurn(facing)
  return isoCameraFacing()
}

/** Window debug/validation seam — the `__setDepth` / `__setShape` family, installed from the render itself
 *  (like `__isoRenderMs` below) because that is the one place the ISO view is guaranteed to run. Idempotent. */
function installCameraSeams(): void {
  if (typeof window === 'undefined') return
  const win = window as unknown as {
    __setCameraFacing?: (f: Orientation) => Orientation
    __cameraFacing?: () => Orientation
    __setCameraTurn?: (t: number) => number
    __cameraTurn?: () => number
  }
  if (win.__setCameraTurn) return
  win.__setCameraFacing = setIsoCameraFacing
  win.__cameraFacing = isoCameraFacing
  win.__setCameraTurn = setIsoCameraTurn
  win.__cameraTurn = isoCameraTurn
}

/** The iso camera focus IN THE VIEW FRAME: turn the world focus by `turn`, then clamp it against the ORIENTED
 *  map dims — an odd corner SWAPS cols/rows, so clamping a turned non-square map with the world dims would
 *  throw the camera clean off it. Turn 0 → exactly today's `clampCamera ? isoCameraFocus(…) : raw`.
 *  Exported so the editor's screen→cell inverse can reuse the SAME focus the render draws with (one source of
 *  truth — the click and the pixels must not drift apart).
 *
 *  MID-TURN the clamp dims follow the NEAREST corner (`orientedDimsForTurn`): the map's on-screen silhouette
 *  between corners is a rotated rectangle, which `isoCameraFocus`'s diamond clamp doesn't model. The cost is a
 *  small camera shift at the 45° crossover on a NON-SQUARE map in clamped (game) mode only — the editor, where
 *  the drag controller lives, renders unclamped, and there the dims term cancels against the cell's own
 *  re-centring so the spin is perfectly smooth. */
export function isoViewFocus(
  playerFc: number,
  playerFr: number,
  panCol: number,
  panRow: number,
  pPad: number,
  qPad: number,
  cols: number,
  rows: number,
  turn: number,
  clamp: boolean,
): { fc: number; fr: number } {
  // The PLAYER focus is oriented + clamped in the rotated view frame (so the camera centres on the hero at
  // any facing). The drag PAN (`panCol`/`panRow`) is a SCREEN-fixed gesture — the camera rotates the map, not
  // the controls — so it is applied AFTER, UN-rotated: a drag pans the map the same direction at every facing.
  const view = turn === 0 ? { col: playerFc, row: playerFr } : orientCellTurn(playerFc, playerFr, cols, rows, turn)
  const focus = clamp
    ? (() => { const dims = orientedDimsForTurn(cols, rows, turn); return isoCameraFocus(view.col, view.row, pPad, qPad, dims.cols, dims.rows) })()
    : { fc: view.col, fr: view.row }
  return { fc: focus.fc - panCol, fr: focus.fr - panRow }
}

/** The camera the FLAT (bare-cell) iso projection needs, in the render's own numbers: the viewport, the cell
 *  size, the ZOOMED isoScale (`grid.isoScale * zoom`) and the VIEW-FRAME focus that `isoViewFocus` returned. */
export interface IsoFlatCamera {
  w: number
  h: number
  cellSize: number
  isoScale: number
  fc: number
  fr: number
}

/** WORLD cell → the screen point the render draws its diamond CENTRE at — the forward flat projection, kept
 *  here (not re-derived per call site) so a click, the selection outline and the pixels can't drift apart. */
export function isoWorldCellToScreen(
  col: number,
  row: number,
  cam: IsoFlatCamera,
  cols: number,
  rows: number,
  turn: number,
): { x: number; y: number } {
  const v = turn === 0 ? { col, row } : orientCellTurn(col, row, cols, rows, turn)
  const wx = (v.col - cam.fc) * cam.cellSize
  const wz = (v.row - cam.fr) * cam.cellSize
  return { x: cam.w / 2 + (wx - wz) * cam.isoScale * 0.71, y: cam.h / 2 + (wx + wz) * cam.isoScale * 0.36 }
}

/** Screen (canvas-internal px) → the WORLD cell under it — the EXACT inverse of isoWorldCellToScreen: invert
 *  the diamond to a VIEW coord, then turn it back to world. This is the bare-cell fallback the editor picks
 *  with when no rendered tile is under the pointer; without the de-turn step a rotated camera would select a
 *  mirrored/transposed cell. Turn 0 → today's inverse, untouched.
 *
 *  WHERE the floor lands differs by case and must: at a WHOLE turn the view coord is floored to a view CELL
 *  first, because the corner maths (`h−1−row`) maps cell INDEX to cell INDEX; mid-turn the axes are diagonal
 *  to the grid, so the continuous coord is de-turned FIRST and floored in world space. */
export function isoScreenToWorldCell(
  x: number,
  y: number,
  cam: IsoFlatCamera,
  cols: number,
  rows: number,
  turn: number,
): { col: number; row: number } {
  const a = (x - cam.w / 2) / (cam.isoScale * 0.71)
  const b = (y - cam.h / 2) / (cam.isoScale * 0.36)
  const viewCol = (a + b) / 2 / cam.cellSize + cam.fc
  const viewRow = (b - a) / 2 / cam.cellSize + cam.fr
  if (Number.isInteger(turn)) return deorientCellTurn(Math.floor(viewCol), Math.floor(viewRow), cols, rows, turn)
  const world = deorientCellTurn(viewCol, viewRow, cols, rows, turn)
  return { col: Math.floor(world.col), row: Math.floor(world.row) }
}

/** A WORLD depth axis as the rotated view sees it. `DEPTH_CELL_STEP` maps every DepthDir to a grid step
 *  (dc,dr), and one camera quarter-turn carries a grid step the same way it carries a coord — so the two use
 *  the identical rotation and can never disagree. Facing 0 → the same dir (no lookup).
 *  A DepthDir is one of 4 discrete diagonals with no continuous form, so mid-turn it follows the NEAREST
 *  corner — see `isoDepthComparatorFor` for what that quantisation costs. */
function viewDepthDir(dir: DepthDir, facing: Orientation): DepthDir {
  return facing === 0 ? dir : rotateDepthDir(dir, facing)
}

/** The asset AS THE ROTATED VIEW SEES IT: its directional axes — `depthDir` (z-width span) and `zDir`
 *  (z-position slide) — are WORLD grid axes, so a rotated camera must carry them CW by the same quarter-turns
 *  the coords take, or a spanned/slid tile would point off-grid the moment you rotate. This is general to
 *  EVERY depth-box asset (a roof is just the common one). Facing 0, or no axes → the SAME object, untouched. */
function orientAssetForView(asset: GridAsset, facing: Orientation): GridAsset {
  if (facing === 0 || (!asset.depthDir && !asset.zDir)) return asset
  return {
    ...asset,
    depthDir: asset.depthDir && rotateDepthDir(asset.depthDir, facing),
    zDir: asset.zDir && rotateDepthDir(asset.zDir, facing),
  }
}

/** Everything render() needs to draw one iso frame. Required: the ctx, the viewport (w, h), the grid,
 *  the player, and the clock. Everything else is optional and defaults to an empty/neutral value — a bare
 *  render({ ctx, w, h, grid, player, time }) draws just the map. Kept as ONE struct (not 24 positional
 *  args) so every call site reads by name and can't silently transpose two same-typed arguments. */
export interface IsoRenderParams {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  grid: IsometricGrid
  player: PlayerState
  time: number
  camOffset?: { x: number; y: number }
  entities?: readonly Entity[]
  enemyCombat?: ReadonlyMap<string, CombatState>
  hitMarkers?: readonly HitMarker[]
  now?: number
  zoom?: number
  attackAnims?: readonly AttackAnim[]
  connectors?: Connector[]
  quests?: readonly Quest[]
  projectiles?: readonly Projectile[]
  dayNight?: DayNight
  attackReach?: number
  style?: Style
  clampCamera?: boolean
  targetId?: string | null
  hoverId?: string | null
  selectedCells?: ReadonlySet<string>
  hoveredCell?: { col: number; row: number; stackIndex?: number } | null
  /** Armed Tile-composition placement ghost — a translucent footprint drawn at the hover cell before the click. */
  ghost?: CompositionGhost | null
  /** PLAYER-CAMERA RANGE (radius in cells): when set, only elements within this many cells of the player
   *  render, and a ring is drawn around the player at that edge. Undefined/≤0 = off (today's full window). */
  playerViewRange?: number
  /** Which of the map's 4 corners the camera looks from — quarter-turns CW. 0 (the default) is the historical
   *  iso view and renders identically to before; 1/2/3 swing the map horizontally so a different side faces
   *  the camera. A facing IS a whole `cameraTurn`; this is the instant-jump shorthand the 4 nav buttons use. */
  cameraFacing?: Orientation
  /** The camera's CONTINUOUS turn in quarter-turns (0..4, wrapping) — what a drag controller animates. A WHOLE
   *  value is exactly `cameraFacing` and renders the identical frame; between corners the world visibly
   *  rotates. Wins over `cameraFacing` when both are given. Omitted → `cameraFacing`, else the
   *  `__setCameraTurn` debug seam's current value (0 until it's called). */
  cameraTurn?: number
}

/** Draw the composition-placement GHOST in ISO: each occupied cell gets a translucent tinted diamond on the
 *  ground (the footprint = "how many blocks"), a faded top diamond raised by the composition's height, and
 *  the vertical edges between them — a see-through massing box so you sense the volume before you click.
 *  Green when it fits, red when blocked. `toScreen`/`tileW`/`tileH`/`heightStep` come from the live render. */
export function drawCompositionGhostIso(
  ctx: CanvasRenderingContext2D,
  ghost: CompositionGhost,
  toScreen: (col: number, row: number) => { x: number; y: number },
  tileW: number,
  tileH: number,
  heightStep: number,
): void {
  if (ghost.cells.length === 0) return
  const { fill, edge, edgeDim } = compositionGhostColors(ghost.valid)
  const rise = Math.min(ghost.height, 12) * heightStep // cap so a tall castle preview stays on screen
  ctx.save()
  ctx.lineWidth = 1.5
  for (const { col, row } of ghost.cells) {
    const p = toScreen(col, row)
    const gt = { x: p.x, y: p.y - tileH }, gr = { x: p.x + tileW, y: p.y }, gb = { x: p.x, y: p.y + tileH }, gl = { x: p.x - tileW, y: p.y }
    // Ground footprint diamond — filled + crisp outline (the primary "these cells" read).
    ctx.fillStyle = fill
    ctx.strokeStyle = edge
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gr.x, gr.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(gl.x, gl.y); ctx.closePath(); ctx.fill(); ctx.stroke()
    // Raised top diamond + vertical edges — a faded wireframe volume so you sense the massing/height.
    ctx.strokeStyle = edgeDim
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y - rise); ctx.lineTo(gr.x, gr.y - rise); ctx.lineTo(gb.x, gb.y - rise); ctx.lineTo(gl.x, gl.y - rise); ctx.closePath(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(gt.x, gt.y); ctx.lineTo(gt.x, gt.y - rise)
    ctx.moveTo(gr.x, gr.y); ctx.lineTo(gr.x, gr.y - rise)
    ctx.moveTo(gb.x, gb.y); ctx.lineTo(gb.x, gb.y - rise)
    ctx.moveTo(gl.x, gl.y); ctx.lineTo(gl.x, gl.y - rise)
    ctx.stroke()
  }
  ctx.restore()
}

export function render(params: IsoRenderParams) {
  const {
    ctx, w, h, grid, player, time,
    camOffset = { x: 0, y: 0 },
    entities = [],
    enemyCombat = new Map<string, CombatState>(),
    hitMarkers = [],
    now = time,
    zoom = 1,
    attackAnims = [],
    connectors = [],
    quests = [],
    projectiles = [],
    dayNight = 'day',
    attackReach = 1,
    style = ASCII_STYLE,
    clampCamera = true,
    targetId = null,
    hoverId = null,
    selectedCells = new Set<string>(),
    hoveredCell = null,
    ghost = null,
    cameraFacing,
    cameraTurn = cameraFacing ?? isoCameraTurn(),
    playerViewRange,
  } = params
  installCameraSeams() // __setCameraTurn / __setCameraFacing … — idempotent, no draw side effects
  // The camera's continuous turn, and the CORNER it is nearest. Everything positional reads `turn`; the few
  // decisions with no continuous form (a span's diagonal axis, the clamp dims) read `facing`.
  const turn = wrapTurn(cameraTurn)
  const facing = facingForTurn(turn)
  const __isoT0 = perfNow() // perf probe — rolling avg of render() ms, exposed on window.__isoRenderMs
  // Clear
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const isoScale = grid.isoScale * zoom // mouse-wheel zoom scales the iso projection

  // Camera follows player + pan offset, then CLAMP so the viewport stays on the map. Iso maps
  // screen x/y to the diagonal coords p = col-row (horizontal) and q = col+row (vertical); the
  // viewport spans ±pPad in p and ±qPad in q.
  const Kx = cellSize * isoScale * 0.71  // screen px per unit of (col - row)
  const Ky = cellSize * isoScale * 0.36  // screen px per unit of (col + row)
  const pPad = w / (2 * Kx)              // half viewport width, in (col-row) units
  const qPad = h / (2 * Ky)              // half viewport height, in (col+row) units
  // Clamp in (p, q) space: q to the diamond's full vertical extent so the camera can pan all the
  // way to the top/bottom corners — the old combined (pPad+qPad)/2 col/row clamp kept the whole
  // rect inside the diamond but stopped the camera pPad short of the bottom/top rows (#38). p is
  // then clamped to the diamond's width AT THAT HEIGHT so the sides stay inside it.
  // Clamp the camera to the map ONLY in game mode (predefined zooms, no drag). In dev mode the clamp
  // fought drag-to-pan — the system couldn't decide when to limit — so there the camera pans freely.
  // The focus is resolved IN THE VIEW FRAME (isoViewFocus): rotated by `facing`, then clamped against the
  // ORIENTED dims — so a rotated non-square map still clamps to its real on-screen extent. Facing 0 collapses
  // to exactly the previous `clampCamera ? isoCameraFocus(…) : raw` line.
  // Player focus is oriented/clamped; the drag PAN (camOffset) is applied un-rotated so drag is screen-fixed.
  const { fc, fr } = isoViewFocus(player.x / cellSize, player.z / cellSize, camOffset.x / cellSize, camOffset.y / cellSize, pPad, qPad, grid.cols, grid.rows, turn, clampCamera)
  const camX = fc * cellSize
  const camZ = fr * cellSize

  // Tile dimensions - slightly overlapping to eliminate gaps
  const tileW = cellSize * isoScale * 0.71  // Half-width of diamond
  const tileH = cellSize * isoScale * 0.36  // Half-height of diamond
  const heightStep = cellSize * isoScale * 0.4  // Height per elevation level

  // The FIXED iso projection of a VIEW-frame coord (center of diamond tile) — unchanged by rotation.
  const viewToScreen = (col: number, row: number) => {
    const wx = col * cellSize - camX
    const wz = row * cellSize - camZ
    return {
      x: w / 2 + (wx - wz) * isoScale * 0.71,
      y: h / 2 + (wx + wz) * isoScale * 0.36
    }
  }
  // Convert WORLD to screen. A rotated camera turns the world coord into the view frame first — that ONE hook
  // is the whole rotation: every caller below (assets, units, connectors, ghosts, debug, lamp glows) keeps
  // passing WORLD coords and lands in the right place. Turn 0 skips the turn, so the frame is untouched; a
  // FRACTIONAL turn spins the world about the camera focus (the orienter resolves its trig once per frame).
  const orientForView = cellOrienterFor(grid.cols, grid.rows, turn)
  const toScreen = turn === 0
    ? viewToScreen
    : (col: number, row: number) => {
      const v = orientForView(col, row)
      return viewToScreen(v.col, v.row)
    }

  // ─── GROUND: nothing special here anymore ──────────────────────────
  // Floors are ordinary level-0 tiles in grid.assets (thin colored slabs) — they flow through the SAME
  // per-asset draw loop below as every wall/prop. There is NO separate ground layer / offscreen cache.

  // Zoom-aware visible range: derive the half-span from the ACTUAL (zoomed) tile size, so we iterate
  // exactly the cells (and thus floor/prop assets) the camera can see — fewer zoomed in, more zoomed out.
  const halfSpan = Math.ceil((w / tileW + h / tileH) / 2) + 4

  ctx.globalAlpha = 1

  // ─── CONNECTOR MARKERS (purple diamond + ◊ on each owned cell's top face) ──
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col, pcell.row)
      const drawY = p.y - grid.getHeight(pcell.col, pcell.row) * heightStep
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()
      ctx.font = `bold ${tileH * 1.1}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Portal marker is a TILE now: 🌀 under a reskin, ◊ under ASCII — over the purple diamond backing.
      drawConnectorMarker(ctx, style, p.x, drawY, tileH * 2)
    }
  }

  // ─── ASSETS + PLAYER (ASCII art stacked in isometric space) ────────

  // Zoom-aware cull: use the SAME span the camera can see (matches the ground tiles above),
  // so zooming OUT reveals more of the map's elements instead of a fixed 30×20 window — at
  // full zoom-out the span covers the whole map, so every element shows.
  // camX/camZ are the camera in the VIEW frame, but the grid indexes WORLD cells — so turn the focus back
  // (deorientCell) before asking what's visible, or a rotated camera would cull the wrong corner of the map.
  // The window is a square centred on it, so rotating the CENTRE is all it takes. Facing 0 → today's floor().
  const camCell = turn === 0
    ? { col: camX / cellSize, row: camZ / cellSize }
    : deorientCellTurn(fc, fr, grid.cols, grid.rows, turn)
  const rectAssets = grid.getVisibleAssets(
    Math.floor(camCell.col),
    Math.floor(camCell.row),
    halfSpan * 2, halfSpan * 2
  )
  // PLAYER-CAMERA RANGE: when set, only elements within `playerViewRange` cells of the PLAYER render — a
  // radial cull (measured from the hero, so it matches the ring drawn around them), restoring the old fixed
  // render window as a controllable setting. Undefined/≤0 = off → today's zoom-derived window, byte-identical.
  const pcol = player.x / cellSize, prow = player.z / cellSize
  const rangeOn = typeof playerViewRange === 'number' && playerViewRange > 0
  // RANGE IS A GRID TEST, NOT A PER-TILE ONE (Alexander: "the range should actually work on per cell … on roads
  // we use 1 block with lots of z-width, if we do per tile range then unless we hit the specific part the tile
  // is located, road won't show … for vision range, rendering player camera, it's better to use the grid").
  // A tile is in range when ANY GRID CELL IT COVERS is — so a long road/grass run stays visible while the ring
  // crosses it, instead of vanishing whenever its anchor happens to sit outside. ONE rule for every tile: a
  // depth-less tile covers just its own cell, so this is the plain cell test for everything else.
  const coveredCells = (a: GridAsset): { col: number; row: number }[] =>
    (a.depth ?? 1) > 1 && a.depthDir ? depthCells(a.col, a.row, a.depth!, a.depthDir) : [{ col: a.col, row: a.row }]
  const tileInRange = (a: GridAsset): boolean =>
    coveredCells(a).some(c => withinPlayerRange(c.col, c.row, pcol, prow, playerViewRange!))
  const visibleAssets = rangeOn ? rectAssets.filter(tileInRange) : rectAssets
  // Ground shadow goes ONLY on a tree's bottom (ground-contact) cell — see isGroundContact. The
  // tree-cell Set is memoized (treeCellSet) so we don't rescan every asset + realloc each frame.
  const treeCells = treeCellSet(grid)
  const isTreeCell = (c: number, r: number): boolean => treeCells.has(`${c},${r}`)

  // Sort all objects by depth (back to front). Placed entities depth-sort with
  // assets/player and draw as glyphs on top of their cell.
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  // A BUILDING is just TILES: a pre-built building is stamped as its composition's per-cell assets (like a
  // tree cell), so its walls/windows/door/roof flow into the draw list through the SAME `asset` path as any
  // stacked tile — no building-specific collect/filter/drawer, and no grouped-building array to read.
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset; entity?: Entity; moving?: boolean; inRange?: boolean }[] = [
    ...visibleAssets.map(a => ({ col: a.col, row: a.row, asset: a })),
    // The player ENTITY is drawn as the live sprite below (isPlayer), so skip it here
    // to avoid a ghost double at the spawn cell. (Top view keeps it — see renderTopView.)
    // A non-player unit is an element too, so the player-camera range culls it like any tile (the player
    // themselves is always drawn — they are the centre of the range).
    ...entities.filter(e => e.kind !== 'player')
      .filter(e => !rangeOn || withinPlayerRange(e.col, e.row, pcol, prow, playerViewRange!))
      .map(e => {
        const pos = entityRenderCell(e, now) // smooth, deterministic interpolation (motionPos)
        const mot = entityMotion.get(e.id)
        const moving = !!mot && now < mot.startMs + ENEMY_MOVE_MS // mid-interpolation → walk anim
        const inRange = e.kind === 'enemy' && Math.hypot(e.col - pCol, e.row - pRow) <= COMBAT_RANGE
        return { col: pos.col, row: pos.row, entity: e, moving, inRange }
      }),
    {
      col: player.x / cellSize,
      row: player.z / cellSize,
      isPlayer: true
    }
  ]
  // back-to-front, then bottom-up within a stacked cell (higher blocks over lower) — keyed on the ORIENTED
  // coord so occlusion stays correct from whichever corner the camera looks. Turn 0 → isoDepthCompare itself.
  allObjects.sort(isoDepthComparatorFor(allObjects, grid.cols, grid.rows, turn))

  // Render each object with ASCII art style
  const playerIsTarget = !!targetId && entities.some(e => e.kind === 'player' && e.id === targetId)
  const playerIsHover = !!hoverId && entities.some(e => e.kind === 'player' && e.id === hoverId)
  // Proximity reveal is a GENERIC per-tile behavior now — NO building special case, no grouped-building read.
  // Any asset whose tile opted into settings.fadeNear eases translucent as the hero closes in, and
  // settings.cutawayRoof lifts the tile off entirely — each computed from the asset's OWN cell distance in the
  // draw loop below (fadeNearAlpha / cutawayAlpha). So a tree-leaf tile carrying fadeNear fades exactly like a wall.
  isoTileHits = [] // fresh per-frame record of every drawn tile's silhouette — the inverted picker reads it
  const stackIndexOf = assetStackIndexer(grid) // per-frame memo: an asset → its slot in its cell's stack (0 = base/floor)
  // The player is drawn from PlayerState (no id); its selectable id lives on the player ENTITY in `entities`.
  const playerEntityId = entities.find(e => e.kind === 'player')?.id
  // A UNIT is just a tile the picker returns: record the figure's billboard silhouette so a click ANYWHERE on
  // the sprite (feet to head) selects the unit (source 'entity'), instead of the floor under it. `cx` = sprite
  // centre-x, `footY` = the sprite's base. The silhouette spans a touch below the feet up to the head — a
  // generous, uniform box so both the hero and NPCs are fully clickable. stackIndex -1 = "not a cell-stack slot".
  const recordUnitHit = (col: number, row: number, cx: number, footY: number, entityId: string): void => {
    const bottom = footY + tileH * 0.6      // just under the feet
    const top = footY - tileH * 4.8         // up past the head of a standing figure
    // A unit's position is CONTINUOUS (`player.x / cellSize`, or the interpolated `entityRenderCell` while it
    // walks) but a tile hit is keyed by CELL INDEX — and the pick's col/row becomes the selection KEY, which
    // later frames re-parse into the cell-indexed grid APIs. Convert at this boundary so no fraction escapes.
    isoTileHits.push({ col: Math.floor(col), row: Math.floor(row), level: 0, stackIndex: -1, source: 'entity', entityId, geom: billboardGeom(tileW * 1.7, bottom - top, poseMapper({ x: cx, y: (bottom + top) / 2 }, undefined, tileH)) })
  }
  // Draw ONE unit (hero / npc / enemy): its figure + its pick silhouette. Called in PASS 2 below, so a unit
  // renders ON TOP of the map tiles (never hidden behind one — z-index: the unit is the interactive focus) and
  // its recorded silhouette lands LAST, so a click on the figure always wins the pick.
  const drawUnit = (obj: { col: number; row: number; isPlayer?: boolean; entity?: Entity; moving?: boolean; inRange?: boolean }, p: { x: number; y: number }, heightOffset: number): void => {
    if (obj.isPlayer) {
      const inHandSlash = attackAnims.find(a => a.inHand && now - a.start < a.durationMs)
      const swingP = inHandSlash ? Math.min(1, (now - inHandSlash.start) / inHandSlash.durationMs) : null
      const footY = p.y - heightOffset - (player.jumpHeight ?? 0)
      drawIsoPlayer(ctx, p.x, footY, tileW, tileH, player, time, swingP, inHandSlash?.tint, style, playerIsTarget, playerIsHover)
      if (playerEntityId) recordUnitHit(obj.col, obj.row, p.x, footY, playerEntityId) // pick the hero figure (foot→head)
    } else if (obj.entity) {
      const combat = obj.entity.kind === 'enemy' ? enemyCombat.get(obj.entity.id) : undefined
      if (isDeadEnemy(obj.entity, combat)) return // hidden until it respawns
      const attackable = enemyInAttackReach(obj.entity, Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), attackReach)
      const footY = p.y - heightOffset
      const anchor = drawIsoEntity(ctx, p.x, footY, obj.entity, tileH, combat, now, obj.moving ?? false, obj.inRange ?? false, attackable, style, obj.entity.id === targetId, obj.entity.id === hoverId)
      drawQuestMarker(ctx, entityQuestMarker(obj.entity, quests), anchor.x, anchor.y, Math.max(14, tileH * 1.6))
      recordUnitHit(obj.col, obj.row, p.x, footY, obj.entity.id) // pick the unit figure (foot→head)
    }
  }
  // ONE PASS — tiles AND units, in the single depth order `allObjects` already carries. A unit is a tile, so
  // perspective decides what covers what: a wall nearer the camera hides the figure behind it, and the figure
  // hides what stands behind IT. (Units used to draw in a separate later pass, which painted them over every
  // tile — the hero standing on a roof he was actually behind.) A unit that wants to sit above its
  // surroundings does it the same way any tile does: with a higher z-index, not with a privileged pass.
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer || obj.entity) { drawUnit(obj, p, heightOffset); continue }

    if (obj.asset) {
      // A BUILDING is JUST tiles: walls, windows, doors AND the roof all render per-cell through this one
      // generic path. The roof is a STACK of roof blocks forming a peaked gable (buildingCellTiles →
      // gableRoofLevels), so it needs no special cap drawer — the SAME stacked tiles project to a triangle
      // (2D front), a 3D gable (iso), and the footprint rectangle (top), like any other stacked tile.
      // Live TILE ANIMATION overrides for THIS frame (settings tweens), scoped to the iso view + active style.
      // null when the asset has no animations / none in scope → the effective asset IS obj.asset (byte-identical).
      const anim = resolveAssetAnimation(obj.asset, time, style, 'iso', dayNight)
      // colour/zoom/width/height overlaid onto the draw, then the asset's WORLD depth axes turned into the
      // view frame so a z-width span (a roof) rotates WITH the grid instead of pointing off it.
      const drawAsset = orientAssetForView(anim ? anim.asset : obj.asset, facing)
      let op = obj.asset.opacity ?? 1 // per-asset opacity for contrast/depth
      // GENERIC proximity behavior: ANY asset whose tile opted into fadeNear/cutawayRoof eases by its OWN
      // distance to the hero — walls/leaves ease translucent (fadeNearAlpha), a roof lifts off (cutawayAlpha).
      const fx = obj.asset.settings
      if (fx && (fx.fadeNear || fx.cutawayRoof)) {
        const dist = Math.hypot(pCol - obj.asset.col, pRow - obj.asset.row)
        const alpha = fx.cutawayRoof ? cutawayAlpha(dist) : fadeNearAlpha(dist)
        if (alpha <= 0.03) continue // a cutaway tile lifted off → skip drawing entirely
        op = Math.min(op, alpha)
      }
      if (anim) op *= anim.opacity // animated opacity fades the drawn tile (multiplies base + proximity alpha)
      if (op < 1) ctx.globalAlpha = op
      // STACK: lift this tile `heightLevel` blocks up so the pile climbs in iso. This is the WHOLE lift —
      // there is no floor-shaped extra term and no "floor stack lift" (Alexander: "FLOOR ARE TILES, ALL TILES
      // STACK ON TOP OF ANOTHER LIKE LEGOS BY DEFAULT … THE FLOOR IS NO DIFFERENT FROM IT"). A tile's level
      // already accounts for everything beneath it, floor included, because `stackTop` (cellStack) assigns it
      // as `level + own height` over the cell's tiles — so raising a floor tile lifts what sits on it for free.
      const stackLift = isoStackLift(tileW, obj.asset.heightLevel)
      // "z position" (per-asset zOffset): SLIDE the tile along an ISO DIAGONAL — NOT a vertical lift. zOffset is
      // the magnitude in cells; zDir picks the diagonal (default right-up), so +z slides TOWARD it (right-up =
      // up-right toward the back) and −z toward its opposite, landing on the neighbouring diamond exactly like
      // z-width's per-cell step. 0 (every generated/existing asset) → no-op.
      // The slide axis is a WORLD diagonal, so it turns with the camera — a slid tile stays on the cell it slid to.
      const zMove = isoZOffset(obj.asset.zOffset ?? 0, viewDepthDir(obj.asset.zDir ?? 'right-up', facing), tileW, tileH)
      // Animated screen shift: `x` slides right, `y` LIFTS up (screen-space up is −Y), in tile fractions. 0 when
      // not animated → the anchor is unchanged.
      const animShiftX = anim ? anim.x * tileW : 0
      const animShiftY = anim ? anim.y * tileH : 0
      // Authored frame animation: offset/rotate/scale the asset around its cell (sway/wind).
      const ax = p.x + zMove.dx + animShiftX, ay = p.y - heightOffset - stackLift + zMove.dy - animShiftY
      const ct = assetCellTransform(obj.asset.cellAnim, time)
      if (ct) applyCellTransform(ctx, ax, ay, ct, tileW, tileH)
      const geom = drawIsoAssetAscii(ctx, ax, ay, drawAsset, tileW, tileH, time, obj.asset.type === 'tree' && (!!obj.asset.baseShadow || isGroundContact(isTreeCell, obj.asset.col, obj.asset.row)), dayNight, style)
      if (ct) ctx.restore()
      if (op < 1) ctx.globalAlpha = 1
      // Record this tile's ACTUAL rendered silhouette so the inverted picker + the highlight hit-test IT, not
      // the flat ground cell. Uses the real asset's cell/level (the anim overlay never moves the cell).
      if (geom) {
        // ONE selector system for EVERY tile — floors included, no special case: record the tile's ACTUAL drawn
        // silhouette (`geom`) at its cell/level/stack-slot, exactly like the trunk/wall/prop. A z-width run floor
        // is ONE tile, so it records ONE box (its drawn depth-box) and selects/hovers as that box — the SAME
        // validated selector, not a parallel per-cell floor path.
        isoTileHits.push({ col: obj.asset.col, row: obj.asset.row, level: obj.asset.heightLevel ?? 0, stackIndex: stackIndexOf(obj.asset), source: 'asset', geom })
      }
    }
  }

  ctx.globalAlpha = 1
  // (Units are drawn in the single depth-sorted loop above — no separate later pass, so perspective governs
  //  them like every other tile. No post-loop roof CAP either: the roof is per-cell stacked tiles.)

  // PLAYER-CAMERA RANGE RING — the visible edge of the render range, drawn around the player. A circle of
  // `playerViewRange` cells projects to an iso ELLIPSE: the diagonal reaches `range·√2` cells, so the screen
  // half-width is `range·√2·tileW` and half-height `range·√2·tileH` (the 2:1 iso squash).
  if (rangeOn) {
    const pp = toScreen(pcol, prow)
    const reach = playerViewRange! * Math.SQRT2
    ctx.save()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.55)'
    ctx.beginPath()
    ctx.ellipse(pp.x, pp.y, reach * tileW, reach * tileH, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }

  // Attack animations (slash / shot / lightning / block) in iso space. Read-only:
  // the loop prunes finished ones (animFrame returns null past the duration).
  if (attackAnims.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(14, tileH * 1.7)}px ${ASCII_FONT}`
    for (const a of attackAnims) {
      if (a.inHand) continue // the player's melee is the ONE in-hand weapon swinging (drawn by drawIsoPlayer)
      const f = animFrame(a, now)
      if (!f) continue
      const sp = toScreen(f.x / cellSize, f.z / cellSize)
      // Under a reskin this draws the ability's FX TILE (🔥/⚡/…) recoloured to f.color, keeping the slash-arc
      // rotation; ASCII keeps the \ | / ─ frame glyph. Slash lifts a touch higher to swing at the hand.
      const ay = f.angle != null ? sp.y - tileH * 1.25 : sp.y - tileH
      drawAttackAnimFrame(ctx, a, f, style, sp.x, ay, Math.max(14, tileH * 1.7))
    }
  }

  // Travelling projectiles (arrow/bullet/bolt) — lerp along their path in iso space. The
  // loop ticks/resolves/drops them; this is read-only draw at the interpolated cell.
  if (projectiles.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const projPx = Math.max(14, tileH * 1.6)
    ctx.font = `bold ${projPx}px ${ASCII_FONT}`
    ctx.fillStyle = '#ffe9a8'
    for (const pr of projectiles) {
      const pc = projectileCellAt(pr, now)
      const sp = toScreen(pc.col + 0.5, pc.row + 0.5)
      const from = toScreen(pr.fromCol + 0.5, pr.fromRow + 0.5)
      const to = toScreen(pr.toCol + 0.5, pr.toRow + 0.5)
      // Under a reskin the glyph resolves to its arrow/bullet/dart tile IMAGE (warm-tinted like the glyph);
      // ASCII keeps the rotated glyph.
      drawProjectileGlyph(ctx, pr.glyph, sp.x, sp.y - tileH, from.x, from.y, to.x, to.y, style, projPx, '#ffe9a8')
    }
  }

  // Floating "+dmg" hit markers, drawn over everything in iso space.
  for (const marker of hitMarkers) {
    const p = toScreen(marker.col + 0.5, marker.row + 0.5)
    drawHitMarker(ctx, p.x, p.y, marker, now)
  }

  // ─── NIGHT LIGHTING ─────────────────────────────────────────────────
  // After the scene draws: a navy veil over everything, then steady warm pools at each lamp head.
  if (dayNight === 'night') {
    // Anchor each pool on the BULB, not the ground cell: the bulb is a composition cell drawn high on the post,
    // so use its OWN recorded silhouette centroid (this frame's draw) — the pool then sits ON the glowing bulb
    // instead of `tileH*1.5` off the ground. Off-screen / not-drawn bulb → null → the old cellCenter-lift anchor.
    const bulbAnchor = (a: GridAsset) => {
      const g = isoRecordedGeom(a.col, a.row, a.heightLevel ?? 0)
      return g ? tileGeomCentroid(g) : null
    }
    const lamps = collectLampGlows(grid, (c, r) => toScreen(c, r), tileW, tileH * 1.5, w, h, { time, style, view: 'iso' }, bulbAnchor)
    drawNightLighting(ctx, w, h, lamps)
  }

  // ─── DEBUG MODE ────────────────────────────────────────────────────

  if (isDebugMode()) {
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, true, tileW, tileH)
  } else if (isShowCollisions()) {
    // Collision-only overlay: same red diamonds as debug, no coords/labels. Pass the render's ZOOMED
    // tileW/tileH so the diamonds fill each cell edge-to-edge (not the unzoomed grid.isoScale default).
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, false, tileW, tileH)
  }

  // ─── Hover + selection HIGHLIGHT — INVERTED: outline the ACTUAL rendered TILE (its transformed cube /
  //     billboard, from the frame's recorded geometry, resolved by the tile's STACK INDEX so same-level tiles
  //     hug their OWN silhouettes) so the ring hugs what the user points at, never the flat ground cell. A bare
  //     cell region (no stack index), or a tile not drawn this frame, falls back to the flat ground cell cube.
  const strokeCellOrTile = (col: number, row: number, stackIndex: number | undefined): void => {
    const geom = stackIndex !== undefined ? isoRecordedTileGeom(col, row, stackIndex) : null
    if (geom) { strokeTileOutline(ctx, geom); return } // the real tile silhouette (scaleY/pose/zOffset/depth-aware)
    // Fallback: the flat ground cell cube (a bare cell region, or a selected tile not drawn this frame — the
    // key carries the stack slot, not a heightLevel, so we outline the ground cell rather than guess a lift).
    const selH = tileW * ISO_BLOCK_H_FRAC
    const p = toScreen(col, row)
    const raise = grid.getHeight(col, row) * heightStep
    const py = p.y - raise
    const gt = { x: p.x, y: py - tileH }, gr = { x: p.x + tileW, y: py }, gb = { x: p.x, y: py + tileH }, gl = { x: p.x - tileW, y: py }
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y - selH); ctx.lineTo(gr.x, gr.y - selH); ctx.lineTo(gb.x, gb.y - selH); ctx.lineTo(gl.x, gl.y - selH); ctx.closePath(); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gr.x, gr.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(gl.x, gl.y); ctx.closePath(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(gl.x, gl.y); ctx.lineTo(gl.x, gl.y - selH)
    ctx.moveTo(gr.x, gr.y); ctx.lineTo(gr.x, gr.y - selH)
    ctx.moveTo(gb.x, gb.y); ctx.lineTo(gb.x, gb.y - selH)
    ctx.moveTo(gt.x, gt.y); ctx.lineTo(gt.x, gt.y - selH)
    ctx.stroke()
  }

  // Cell/tile-hover outline — a DIM ring on the tile under the cursor, drawn UNDER the yellow selection.
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    strokeCellOrTile(hoveredCell.col, hoveredCell.row, hoveredCell.stackIndex)
  }

  // Selection outline (property-editor multi-select) — a yellow ring hugging each selected tile/cell.
  if (selectedCells.size > 0) {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    for (const key of selectedCells) {
      // "col,row,stackIndex" = a recorded TILE (hug its silhouette); "col,row" = a bare cell region (flat fallback).
      const [col, row, stackIndex] = key.split(',').map(Number)
      strokeCellOrTile(col, row, Number.isFinite(stackIndex) ? stackIndex : undefined)
    }
  }

  // Armed-composition GHOST — a translucent footprint at the hover cell (drawn last so it reads over the scene).
  if (ghost) drawCompositionGhostIso(ctx, ghost, toScreen, tileW, tileH, heightStep)

  // ─── UI ───────────────────────────────────────────────────────────

  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillText(`Grid: ${Math.floor(player.x / cellSize)}, ${Math.floor(player.z / cellSize)}`, 10, 50)

  if (isDebugMode()) {
    ctx.fillStyle = '#ff4444'
    ctx.fillText('DEBUG MODE', 10, 70)
  }

  const __isoMs = perfNow() - __isoT0
  isoRenderMsEMA = isoRenderMsEMA === 0 ? __isoMs : isoRenderMsEMA * 0.9 + __isoMs * 0.1
  if (typeof window !== 'undefined') (window as unknown as { __isoRenderMs?: number }).__isoRenderMs = isoRenderMsEMA
}


/** Draw multi-row ASCII art in the TREE block language: each row gets a solid `bg` block
 *  (sized to that row's glyph extent) + a bright `fg` glyph + a 1px shadow. Rows stack
 *  bottom-to-top from `baseY`, left-aligned at `leftX` (monospace advance = `charW`). Shared
 *  by entities + the player so the whole cast reads as ROBUST sprites, not thin line-art.
 *  Caller sets ctx.font + textAlign 'left' + textBaseline 'middle'. */
function drawBlockFigure(
  ctx: CanvasRenderingContext2D,
  art: readonly string[],
  leftX: number,
  baseY: number,
  lineHeight: number,
  charW: number,
  fg: string,
  bg: string,
): void {
  for (let i = 0; i < art.length; i++) {
    const line = art[art.length - 1 - i]
    const ly = baseY - i * lineHeight
    const start = line.length - line.trimStart().length // skip leading spaces — block hugs the glyphs
    const end = line.trimEnd().length
    if (end > start) {
      const blockH = lineHeight * 0.78 // skinnier than the full line — the backing hugs the glyph row
      ctx.fillStyle = bg
      ctx.fillRect(leftX + start * charW - 1, ly - blockH / 2, (end - start) * charW + 2, blockH)
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)' // 1px drop shadow for crisp edges
    ctx.fillText(line, leftX + 1, ly + 1)
    ctx.fillStyle = fg
    ctx.fillText(line, leftX, ly)
  }
}


export function drawIsoPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  player: PlayerState,
  time: number,
  swingP: number | null = null,
  swingTint?: string,
  style: Style = ASCII_STYLE,
  isTarget: boolean = false,
  isHover: boolean = false,
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // The hero does NOT bob: the old sin() breathe made the figure loop up-and-down and read as FLOATING
  // (NPCs never bobbed, so it also made the hero inconsistent with them). Kept as a named 0 so the body,
  // weapon and vitals still share one anchor origin — re-enabling is a one-line change.
  const breathe = 0

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // Armor tint: steel-blue when wearing gear, warm yellow otherwise — the figure visibly
  // changes the moment you equip armor. Paired with a dark block bg (the trees' language).
  const bodyColor = player.armored ? '#bcd4ff' : (player.bodyColor ?? '#ffdd00')
  const bodyBg = player.armored ? '#243a5e' : (player.bodyBg ?? '#5a4412')

  const charW = fontSize * 0.6
  const maxW = playerArt.reduce((m, r) => Math.max(m, r.length), 0)
  const pHalf = (maxW * charW) / 2
  // Bottom-anchor the figure EXACTLY like drawIsoEntity (the enemies/NPCs), so the hero stands the same
  // way instead of floating: `groundY` is the feet contact point; the emoji is lifted by 0.42 of its own
  // size so its feet land there, and the shadow + reticles sit AT groundY. (Replaces the old `emojiFootLift`
  // band-aid that only nudged the emoji figure and left the player anchored differently from every NPC.)
  const baseY = y - lineHeight * 0.5
  const groundY = baseY + tileH * 0.24
  // Ground shadow sized to the player figure (always reads; fixed — doesn't bob).
  drawGroundShadow(ctx, x, groundY, pHalf)
  if (isTarget) drawSelectionRing(ctx, x, groundY, pHalf * 0.8) // red target reticle at the feet
  else if (isHover) drawHoverRing(ctx, x, groundY, pHalf * 0.8) // dim white hover reticle

  // Robust block figure — same recipe as entities + trees; `breathe` bobs the whole figure. When
  // attacking, HIDE the static arm on the swinging side (the animated swing-arm below replaces it) so
  // we never draw two arms (#47/#39).
  const swingArmDir = player.facing === 'left' ? -1 : 1
  // During a swing, base the figure on the IDLE pose (predictable arm) and HIDE the facing-side arm
  // bracket — the swing-arm below (the SAME bracket glyph, just rotated) replaces it. (#47/#67)
  const figArt = swingP == null
    ? playerArt
    : playerSprite.idle.map(row => (swingArmDir > 0 ? row.replace('>', ' ') : row.replace('<', ' ')))
  const pdv = resolveDraw('player', style, personVariantTileId(player.variant, style), '', bodyColor)
  // Under an emoji/image style the ACTIVE animation frame drives what's drawn (idle/walk/run) — data, not
  // hardcoded. The frame resolves to a baked image (the base tile or an override tile) OR a glyph, honouring
  // its flipX, so the authored walk/idle actually PLAYS instead of freezing on the static base image. ASCII
  // (no image, empty char) keeps its block-figure sprite below (which animates via getPlayerArt).
  // The drawn figure's HEAD (top edge in screen y) — set by whichever branch draws, so the vitals bar hugs
  // the REAL sprite top (emoji billboard vs ascii block figure differ) instead of a phantom ascii-height lift.
  let headY: number
  if (pdv.image || pdv.char) {
    const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
    const pfImg = frameImage(pf, pdv.char, pdv.image)
    if (pfImg) {
      const imgPx = tileH * 2.6
      const cy = groundY - imgPx * 0.42 - breathe
      drawStyledImage(ctx, pfImg, x, cy, imgPx, pf.flipX)
      headY = cy - imgPx * 0.5
    } else {
      const glyphPx = fontSize * 1.8
      const cy = groundY - glyphPx * 0.42 - breathe
      ctx.font = `bold ${glyphPx}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = pdv.color
      drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), x, cy, pf.flipX)
      ctx.textAlign = 'left'
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      headY = cy - glyphPx * 0.5
    }
  } else {
    drawBlockFigure(ctx, figArt, x - pHalf, baseY - breathe, lineHeight, charW, bodyColor, bodyBg)
    // Block figure stacks rows UP from baseY; the top row's centre sits (len-1) rows up, its top edge a half
    // row higher — that edge is the head the bar hugs (matching the emoji billboard's top).
    headY = baseY - breathe - (playerArt.length - 1) * lineHeight - lineHeight * 0.5
  }

  // The held weapon + the shield, both at the ARM row. The weapon sits on the FACING hand; the
  // shield on the OFF-hand (the side OPPOSITE the weapon) at the SAME arm height — so they never
  // land on the same hand in any facing (#49).
  const onLeft = player.facing === 'left'
  const dir = onLeft ? -1 : 1 // +1 → facing right, weapon on the RIGHT hand
  const weaponSize = fontSize * 1.7
  const handY = baseY - lineHeight - breathe // the HAND, at the arm/body row (shared by weapon + shield), off groundY
  const shoulderX = x + dir * pHalf * 0.25 // at the body, on the weapon side
  const shoulderY = baseY - lineHeight * 1.45 - breathe // shoulder = TOP of the # row (the pivot)
  drawPlayerArm(ctx, {
    swinging: swingP != null, // an attack is mid-flight → the ARM drives the swing (#47)
    swingP: swingP ?? 0,
    facingDir: dir,
    isEmoji: style.id !== ASCII_STYLE.id, // reskin → no ASCII `>`/`<` bracket beside the emoji figure
    fontSize,
    bodyColor,
    weaponGlyph: player.weaponGlyph,
    weaponPose: player.weaponPose,
    punchGlyph: player.punchGlyph,
    punchPose: player.punchPose,
    weaponTint: '#e6e6e6',
    swingTint,
    shoulderX,
    shoulderY,
    restHandX: x + dir * (pHalf + weaponSize * 0.18),
    restHandY: handY,
    shieldGlyph: player.shieldGlyph,
    shieldPose: player.shieldPose,
    shieldX: x - dir * (pHalf + fontSize * 0.3), // off-hand: opposite the weapon
    shieldY: handY, // same arm row as the weapon hand
    shieldR: fontSize * 0.5,
  })

  // Life bar + name above the head — the SAME treatment enemies get (drawFigureVitals), so the
  // player reads identically. Drawn only once HP is mirrored onto the struct (see the game loop).
  if (player.maxHp != null) {
    const barWidth = Math.max(28, tileH * 2.2)
    const nameSize = Math.max(9, tileH * 0.95)
    drawFigureVitals(ctx, x, headY, barWidth, 7, nameSize, barFraction(player.hp ?? player.maxHp, player.maxHp), playerDisplayName(player.name))
  }
}


/** Apex signage (a "STORE" marquee, a "HOSPITAL" word) drawn above a cell's apex at (x, apexY). GENERIC:
 *  driven by the tile's own `settings.badge` ({text,color}), NOT a buildingType lookup — so any tile that
 *  carries a badge shows one, through whichever draw path (cube or labeled cell) rendered the block. */
export function drawApexBadge(ctx: CanvasRenderingContext2D, x: number, apexY: number, fontSize: number, badge: { text: string; color: string }): void {
  const bf = fontSize * (badge.text.length > 1 ? 0.5 : 0.9)
  ctx.font = `bold ${bf}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const by = apexY - fontSize * 0.95
  const bw = ctx.measureText(badge.text).width
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(x - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
  ctx.fillStyle = badge.color
  ctx.fillText(badge.text, x, by)
}


export function drawIsoLabeledCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileH: number,
): void {
  const char = asset.art[0] ?? '?'
  const fontSize = tileH * 1.25
  // Sit the glyph ON its own cell (same anchor as the ground glyph: p.y -
  // heightOffset). The old half-tile lift floated the canopy ~half a cell north
  // of the cell it actually blocks, so leaves *looked* passable. Aligned now:
  // the leaf you see is the cell that blocks; only the canopy TOP stays walkable.
  const cy = y
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Monospace advance ≈ 0.6em per char → width from the glyph's CHAR COUNT, so a multi-char composition
  // tile (a leaf '(@&@)') gets a backing that fits it, while a single glyph is unchanged. No per-cell
  // measureText() — the canvas-2D layout call that tanked iso FPS on dense (forest) stages.
  const w = char.length * fontSize * 0.6
  // A cell carrying apex signage FILLS solid (its darkened tint) so the word reads over it; every other
  // labeled cell keeps the plain dark backing behind its glyph. No `type:'building'` special case.
  const base = asset.color ?? '#cccccc'
  ctx.fillStyle = asset.settings?.badge ? darkenColor(base, 0.28) : 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x - w / 2 - 2, cy - fontSize * 0.55, w + 4, fontSize * 1.1)
  ctx.fillStyle = base
  ctx.fillText(char, x, cy)

  // Apex signage — driven GENERICALLY by settings.badge (not buildingType). Only the one apex tile per
  // building carries it → the measureText here is rare, not per-cell.
  if (asset.settings?.badge) drawApexBadge(ctx, x, cy, fontSize, asset.settings.badge)
}


export function drawIsoEntity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  entity: Entity,
  tileH: number,
  combat?: CombatState,
  now: number = idleNow(),
  moving = false,
  inRange = false,
  attackable = false,
  style: Style = ASCII_STYLE,
  isTarget = false,
  isHover = false,
): { x: number; y: number } {
  // Multi-row ASCII creature, drawn bottom-to-top. The frame comes from the animation
  // engine (frameAt): idle bob when still, a faster step cycle while moving, an attack
  // cadence when the player is in range — built on top of the existing base/alt art.
  const art = entityAnimFrame(entity, now, moving, inRange)
  // Same scale as drawIsoPlayer, so NPCs/monsters stand as tall as the player
  // (a 3-row figure ≈ 2 cells tall), not a squished 1×1.
  const fontSize = tileH * 1.2
  const lineHeight = tileH * 1.4
  const baseY = y - lineHeight * 0.5
  // LEFT-align all rows on a shared origin (monospace advance ≈ 0.6em) so the figure's
  // shape holds together — centering each row independently mangles real ASCII art.
  const charW = fontSize * 0.6
  const maxW = art.reduce((m, r) => Math.max(m, r.length), 0)
  const leftX = x - (maxW * charW) / 2
  // Ground shadow sized to the figure so it always reads (not hidden behind it).
  drawGroundShadow(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2)
  if (isTarget) drawSelectionRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.8) // red target reticle at the feet
  else if (isHover) drawHoverRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.8) // dim white hover reticle
  // In-strike-range indicator: a ring at the feet, under the figure (#35).
  if (attackable) drawRangeRing(ctx, x, baseY + tileH * 0.24, (maxW * charW) / 2 * 0.85, now)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const pal = entityPalette(entity)
  const kind = entityKind(entity.kind)
  const isEnemy = kind === 'enemy'
  // An enemy draws its per-type tile (goblin→👺, wolf→🐺, …); a person draws its per-variant figure
  // (male→🧍‍♂️, old→🧓, …) — both baked images. A brush-placed unit's manual `tileOverride` RE-HOMES onto
  // the active style (resolveEntityDraw) so it RESKINS like a placed asset instead of freezing to the
  // style it was placed in; no pin → the style-derived default, byte-identical to before.
  const edv = resolveEntityDraw(kind, style, entity.tileOverride, entityStyleOverride(entity, style), '', pal.fg)
  // Ground the billboard by its BOTTOM at the shadow line, so ANY tile size stays grounded (a
  // smaller enemy no longer floats above its shadow). `groundY` is the feet contact point.
  const groundY = baseY + tileH * 0.24
  // Per-entity SIZE scales the drawn figure (a size-2 boss draws twice as big). It grows UP from the
  // feet line (the `- (drawPx-basePx)*0.5` keeps the BOTTOM fixed), so a bigger figure stays grounded
  // on its shadow instead of sinking through the floor. size 1 is byte-identical to before.
  const size = Math.max(1, entity.size ?? 1)
  // The entity's AUTHORED animation frame drives what's drawn (data-driven); people default to the walk/
  // idle set, enemies to their static glyph. The frame resolves to a baked image (base or override tile)
  // OR a glyph — honouring flipX — so a moving person actually animates instead of freezing on the base
  // image. ASCII (no image, empty char) keeps its block-figure sprite below.
  const anims = entity.animations ?? (isEnemy ? undefined : DEFAULT_CHARACTER_ANIMATIONS)
  // The drawn figure's HEAD (top edge in screen y) — set by whichever branch draws, so the vitals bar +
  // quest marker hug the REAL sprite top (emoji billboard vs ascii block figure differ) instead of the
  // phantom ascii-height lift that floated the bar cells above the emoji.
  let figureTop: number
  if (edv.image || edv.char) {
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    const efImg = frameImage(ef, edv.char, edv.image)
    if (efImg) {
      const baseImgPx = tileH * (isEnemy ? 1.9 : 2.4)
      const imgPx = baseImgPx * size
      const cy = groundY - baseImgPx * 0.42 - (imgPx - baseImgPx) * 0.5
      drawStyledImage(ctx, efImg, x, cy, imgPx, ef.flipX)
      figureTop = cy - imgPx * 0.5
    } else {
      // Enemies read a touch smaller than people so a mob doesn't tower over the hero.
      const baseEmojiPx = fontSize * (isEnemy ? 1.35 : 1.7)
      const emojiPx = baseEmojiPx * size
      const cy = groundY - baseEmojiPx * 0.42 - (emojiPx - baseEmojiPx) * 0.5
      ctx.font = `bold ${emojiPx}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = edv.color
      drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), x, cy, ef.flipX)
      ctx.textAlign = 'left'
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      figureTop = cy - emojiPx * 0.5
    }
  } else {
    drawBlockFigure(ctx, art, leftX, baseY, lineHeight, charW, pal.fg, pal.bg)
    // Block figure stacks rows UP from baseY; the top row's top edge (a half row above its centre) is the head.
    figureTop = baseY - (art.length - 1) * lineHeight - lineHeight * 0.5
  }
  if (entity.kind !== 'enemy') return { x, y: figureTop - lineHeight * 0.5 }

  // Enemy vitals (HP bar + name) drew for EVERY enemy, so a mob-heavy cave/temple became a wall of
  // "skeleton/bat/spider" text. Show them only when the enemy is ENGAGED (in combat proximity) or
  // DAMAGED; an idle distant enemy is just its self-identifying glyph (💀/🦇/🕷️) — click it for the
  // Inspector. Standard action-RPG behaviour: bars appear on engagement/damage, not always-on.
  const frac = hpFraction(entity, combat)
  if (frac >= 0.999 && !inRange && !attackable) return { x, y: figureTop - lineHeight * 0.5 }
  const barWidth = Math.max(28, tileH * 2.2)
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, tileH * 0.95)
  return drawFigureVitals(ctx, x, figureTop, barWidth, 7, nameSize, frac, label)
}


// Proximity reveal (Zelda/PoE style), now a GENERIC per-tile behavior driven by settings.fadeNear /
// settings.cutawayRoof — not building-only. A `fadeNear` tile eases to translucent as the hero closes in; a
// `cutawayRoof` tile eases to fully invisible — SMOOTHLY (smoothstep), not a hard pop. Constants kept.
export const BUILDING_FADE_RADIUS = 4.5 // fade begins easing this far out — a wide, gentle onset
export const BUILDING_MIN_ALPHA = 0.22  // a fadeNear tile eases to this (translucent but readable) on top
export const ROOF_GONE_DIST = 1.8       // a cutaway tile is fully invisible within this distance — lifted clean off

const smoothstep = (t: number): number => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c) }
/** fadeNear opacity by the hero's distance: 1 far, easing to BUILDING_MIN_ALPHA on top (walls, leaves, …). */
export function fadeNearAlpha(dist: number): number {
  if (dist >= BUILDING_FADE_RADIUS) return 1
  return BUILDING_MIN_ALPHA + (1 - BUILDING_MIN_ALPHA) * smoothstep(dist / BUILDING_FADE_RADIUS)
}
/** cutawayRoof opacity by distance: 1 far, easing to 0 by ROOF_GONE_DIST — the tile lifts off smoothly, no pop. */
export function cutawayAlpha(dist: number): number {
  if (dist >= BUILDING_FADE_RADIUS) return 1
  if (dist <= ROOF_GONE_DIST) return 0
  return smoothstep((dist - ROOF_GONE_DIST) / (BUILDING_FADE_RADIUS - ROOF_GONE_DIST))
}


// ISO facing. Each building stands inside its plot RECT — cols [col, col+L] × the clear headroom
// rows ABOVE the frontage (that whole rect is road-free, verified on the grid). A facing keeps
// the footprint inside that rect by extruding UP into the headroom, never DOWN onto the street
// it fronts. `baseColFrac` is which end of the frontage the base starts at; `len`/`dep` are the
// grid axes the length + depth run along. Applied only when the rotated footprint fits (L < H);
// wide-short types (store/temple/castle) stay front-facing so they can't spill past the rect.
export const ISO_FACINGS: { len: [number, number]; dep: [number, number]; baseColFrac: number }[] = [
  { len: [1, 0], dep: [0, -1], baseColFrac: 0 },  // faces down-left:  base +col,        depth up-right
  { len: [0, -1], dep: [-1, 0], baseColFrac: 1 }, // faces down-right: base up the right, depth up-left
]


export type Pt = { x: number; y: number }

const fillQuad = (ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: Pt, d: Pt): void => {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.fill()
}


/**
 * Fill an iso FACE by tiling a TILE across it, SHEARED to the face — the ONE place a tile
 * (an emoji glyph now, an image sprite later) becomes an iso-angled texture. The face is the
 * parallelogram `origin + [0,1]·eA + [0,1]·eB` (eA = the bottom edge vector, eB = the up/side
 * edge vector). We push a CTM built from (eA, eB, origin) scaled into a 64×64 work box — so a
 * unit tile maps onto the parallelogram and every glyph/image inherits the shear — clip to the
 * box, then stamp `na`×`nb` tiles across it. That single transform is why a colored-square emoji
 * becomes the ground DIAMOND fill and a brick emoji tiles UP a wall at the iso angle, instead of
 * standing upright. Font size is kept in a normal px range (the 64-box) so glyphs never clamp to
 * a sub-pixel size. Callers invoke this only on a reskin (a style tile is active); the ASCII
 * passthrough path never reaches here, so ASCII stays byte-identical.
 */
export function fillIsoFaceWithTile(
  ctx: CanvasRenderingContext2D,
  origin: Pt,
  eA: Pt,
  eB: Pt,
  tv: { char?: string; color: string; image?: ImageVisual; tintTo?: string }, // tintTo → recolour a colour-emoji GLYPH (the roof 🟥 → roof colour)
  na: number,
  nb: number,
  tint?: string, // an editor floor-colour override → recolour the tile image (#80)
): void {
  const S = 64 // work-box side; keeps font px normal under the shear CTM (no sub-pixel fonts)
  const cols = Math.max(1, Math.round(na))
  const rows = Math.max(1, Math.round(nb))
  const cw = S / cols
  const ch = S / rows
  ctx.save()
  ctx.transform(eA.x / S, eA.y / S, eB.x / S, eB.y / S, origin.x, origin.y)
  // Image tile if its raster is ready; otherwise fall back to the glyph so the face is NEVER blank. This is
  // NO LONGER a pre-load placeholder — the loader gate decodes every baked image before the first frame
  // (tilesetLoader → preloadTileImages), so on a fresh load this always takes the image path; the glyph only
  // covers a genuinely failed/missing raster AFTER load (graceful degradation, a backend data gap).
  const img = tv.image ? tileImage(tv.image.src) : null
  if (img) {
    // PERF: an image scaled to (0,0,S,S) fills the sheared box EXACTLY — i.e. this face — so it can never
    // spill past it. The per-face ctx.clip() (a real hotspot at ~thousands of building-cube faces/frame) is
    // therefore redundant for the image path and is skipped; only the overfilling GLYPH path still clips.
    const drawSrc = tint ? tintedImage(img, tv.image!.src, tint) : img
    const sx = tv.image!.sx ?? 0
    const sy = tv.image!.sy ?? 0
    const sw = tv.image!.sw ?? img.naturalWidth
    const sh = tv.image!.sh ?? img.naturalHeight
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(drawSrc, sx, sy, sw, sh, i * cw, j * ch, cw, ch)
  } else if (tv.char) {
    ctx.beginPath()
    ctx.rect(0, 0, S, S)
    ctx.clip()
    // A colour-emoji ignores fillStyle, so a per-building roof colour can't be applied with fillText — when
    // `tintTo` is set (the roof), shear a RECOLOURED sprite instead so the roof 🟥 reads the roof's own hue.
    const sprite = tv.tintTo ? tintedGlyphSprite(tv.char, Math.max(cw, ch), tv.tintTo) : null
    if (sprite) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, i * cw, j * ch, cw, ch)
    } else {
      ctx.fillStyle = tv.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.min(cw, ch) * 1.16}px ${ASCII_FONT}` // slight overfill; the clip trims the excess
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.fillText(tv.char, (i + 0.5) * cw, (j + 0.5) * ch)
    }
  }
  ctx.restore()
}




// The default iso BLOCK height (screen px) of ONE stack level — one cube tall. drawIsoTileBlock draws
// a default-dim cube exactly this tall (its `bh` base is tileW * 0.9), so lifting a stacked asset by
// this per level makes the pile climb in lockstep with the cubes (and with the 2D raised stack).
export const ISO_BLOCK_H_FRAC = 0.9

/** Iso screen-space RISE for a stacked asset: `heightLevel` cubes up (one ISO_BLOCK_H per level). The
 *  new brush stacks assets on a cell with heightLevel 0,1,2,… so the render lifts each entry by this —
 *  a 3-tall stack reads as 3 items climbing. heightLevel absent/0 (every generated/existing asset) → 0,
 *  so this is a pure no-op for non-stacked maps. Matches topdown.ts's 2D `heightLevel * tileH * 0.9`. */
export function isoStackLift(tileW: number, heightLevel: number | undefined): number {
  return (heightLevel ?? 0) * tileW * ISO_BLOCK_H_FRAC
}

/** Depth order for the merged iso draw list: back-to-front by the iso key (col + row), then — for two
 *  ASSETS on the SAME cell — bottom-up by heightLevel so a brush STACK composites higher blocks OVER
 *  lower ones (matching the isoStackLift rise). A non-asset tie (entity/player/building) returns 0 to
 *  keep the array's stable insertion order, so nothing but same-cell asset stacks is reordered — the
 *  no-stack case is byte-identical to the old `(a.col+a.row)-(b.col+b.row)` sort. */
export function isoDepthCompare(
  a: { col: number; row: number; asset?: { heightLevel?: number; depth?: number; depthDir?: DepthDir; zIndex?: number } },
  b: { col: number; row: number; asset?: { heightLevel?: number; depth?: number; depthDir?: DepthDir; zIndex?: number } },
): number {
  // DRAW-PRIORITY first (CSS z-index): a HIGHER zIndex draws LATER (on top / in front), overriding the
  // positional key below — a cell authored with a higher zIndex sits in front of one behind it no matter where
  // it is (a capability for composition optimization). Every cell currently defaults to 0, so `0 - 0 = 0` falls
  // straight through to the positional sort → every map (all zIndex 0) orders BYTE-IDENTICALLY to before.
  const dz = (a.asset?.zIndex ?? 0) - (b.asset?.zIndex ?? 0)
  if (dz !== 0) return dz
  // A directional-depth box reaches `depthFrontExtent` cells toward the camera past its anchor, so it sorts by
  // its FRONTMOST covered cell — a box extending toward the camera draws in front of what it overlaps. A
  // depth-less asset (every existing tile) adds 0, so the no-depth case is byte-identical to (col+row).
  const key = (o: { col: number; row: number; asset?: { depth?: number; depthDir?: DepthDir; heightLevel?: number } }): number => {
    const dep = o.asset?.depth
    const dir = o.asset?.depthDir
    // The front-extent (sort by the FRONTMOST covered cell) is only correct for an ELEVATED depth box (a roof,
    // heightLevel ≥ 1) that actually OVERHANGS + occludes what's behind it. A FLAT run (heightLevel 0 — a
    // z-width grass/road tile) occludes nothing, so it must sort by its ANCHOR (its backmost cell) and stay
    // BEHIND every standing tile, like the ground it is — otherwise a long road draws over a house in front of it.
    const extend = dir && dep && Math.floor(dep) > 1 && (o.asset?.heightLevel ?? 0) >= 1
    return o.col + o.row + (extend ? depthFrontExtent(dep!, dir!) : 0)
  }
  const d = key(a) - key(b)
  if (d !== 0) return d
  if (a.asset && b.asset) return (a.asset.heightLevel ?? 0) - (b.asset.heightLevel ?? 0)
  return 0
}

/** Is (col,row) within `range` cells of the player, measured RADIALLY (straight-line distance, not a box)?
 *  The player-camera render cull uses this so what's drawn matches the circular ring drawn around the hero. */
export function withinPlayerRange(col: number, row: number, playerCol: number, playerRow: number, range: number): boolean {
  return Math.hypot(col - playerCol, row - playerRow) <= range
}

/** One item the iso painter sorts — the structural shape isoDepthCompare reads. */
type IsoDepthItem = Parameters<typeof isoDepthCompare>[0]

/** One sortable item AS THE TURNED VIEW SEES IT: its cell oriented, its span axis carried round with it, and
 *  — the part that bites — a multi-cell span RE-ANCHORED to its backmost end. A quarter-turn can flip a span
 *  to run backward from its stored anchor, and `isoDepthCompare` assumes the anchor IS the backmost cell, so
 *  without this a merged ground run sorts as the nearest thing on screen and paints over what stands behind it. */
function orientDepthItem(
  item: IsoDepthItem,
  orient: (col: number, row: number) => { col: number; row: number },
  facing: Orientation,
): IsoDepthItem {
  const { col, row } = orient(item.col, item.row)
  if (!item.asset) return { col, row, asset: item.asset }

  const dir = item.asset.depthDir && rotateDepthDir(item.asset.depthDir, facing)
  if (!dir || !item.asset.depth) return { col, row, asset: { ...item.asset, depthDir: dir } }

  const back = spanBackmost(col, row, item.asset.depth, dir)
  return { col: back.col, row: back.row, asset: { ...item.asset, depthDir: back.dir } }
}

/** The back-to-front comparator for a camera at `turn`: isoDepthCompare's key is (col + row), which is a
 *  VIEW-frame quantity — so under rotation it must be fed the ORIENTED coord and the ORIENTED depth axis, or
 *  the painter would occlude by the old front corner and the rotated map would draw inside-out. Each item is
 *  mapped ONCE (not per comparison, which sort calls O(n log n) times) and the mapped pair is handed to the
 *  UNCHANGED isoDepthCompare, so every rule in it (z-index priority, depth front-extent, stack tie-break) keeps
 *  working. Turn 0 returns isoDepthCompare ITSELF — same function, same sort, byte-identical frame.
 *
 *  ── MID-TURN, the deliberate choice ────────────────────────────────────────────────────────────────────
 *  `col + row` is only a valid depth ORDER at a whole quarter-turn — but it is valid for a CONTINUOUS reason:
 *  the projection puts screen-y ∝ (viewCol + viewRow), so that sum IS the camera-depth of a cell at ANY angle.
 *  So mid-turn we feed isoDepthCompare the FRACTIONAL oriented coords and its key becomes exactly the
 *  continuous projected depth — the painter stays correct through the whole spin and the order flips where two
 *  tiles genuinely reach the same screen depth, not at an arbitrary threshold.
 *
 *  LIMITATION: the two DISCRETE parts have no continuous form and follow the NEAREST corner — a span's
 *  `depthDir` (one of 4 diagonals) and therefore its backmost re-anchor + `depthFrontExtent` bonus. So while a
 *  MULTI-CELL span (a roof/merged ground run) is between corners, it is sorted by the end that will be its
 *  backmost at the corner it is heading for. It can therefore occlude wrongly against something it overlaps
 *  for at most half a quarter-turn of the transient. Single-cell tiles — every ordinary tile — are exact. */
export function isoDepthComparatorFor<T extends IsoDepthItem>(
  items: readonly T[],
  cols: number,
  rows: number,
  turn: number,
): (a: T, b: T) => number {
  if (turn === 0) return isoDepthCompare
  const orient = cellOrienterFor(cols, rows, turn)
  const facing = facingForTurn(turn)
  const inView = new Map<T, IsoDepthItem>()
  for (const item of items) {
    inView.set(item, orientDepthItem(item, orient, facing))
  }
  return (a, b) => isoDepthCompare(inView.get(a)!, inView.get(b)!)
}




/** The camera/zoom/viewport the iso projection needs — the SAME numbers render() computes:
 *  `isoScale` is already the zoom-scaled value (grid.isoScale * zoom); camX/camZ are the clamped
 *  focus in world units (fc*cellSize, fr*cellSize). */
export interface IsoPickCamera {
  w: number
  h: number
  cellSize: number
  isoScale: number
  camX: number
  camZ: number
}

/** One raised block to hit-test: its cell, its stack level, and the ELEVATION of its cell (grid.getHeight)
 *  so the block's on-screen position matches the render, which lifts a stacked asset by BOTH the terrain
 *  height and isoStackLift. */
export interface IsoPickBlock {
  col: number
  row: number
  heightLevel: number
  terrainHeight: number
  /** which store this block came from (floor/asset/building/entity) — carried straight through to the
   *  result so the caller routes the hit to the right selection WITHOUT the picker ever branching on it.
   *  Absent for the legacy asset-only callers, where the result is `{col,row,level}` exactly as before. */
  source?: TileSource
}

export interface IsoPickResult {
  col: number
  row: number
  level: number
  /** the hit block's store (from IsoPickBlock.source). Undefined for asset-only callers. */
  source?: TileSource
}

/** Screen → the RAISED block the pointer is on, or null. Fixes the iso selection ignoring stacked blocks:
 *  `screenToCell` inverts the FLAT diamond projection, so a click on a block that the render LIFTED up
 *  (isoStackLift) resolves to the ground cell under that pixel — the bottom — never the block. This mirrors
 *  render()'s projection + lift to hit-test each block's on-screen footprint (its iso diamond at its lifted
 *  height) and returns the FIRST one the point falls inside, NEAREST the camera first — the draw order
 *  reversed (higher col+row, then higher level = drawn last / on top), so the block you SEE on top wins an
 *  overlap. Only heightLevel ≥ 1 blocks are tested; a flat cell / lone level-0 asset returns null so the
 *  caller's existing flat pick stays byte-identical (normal, unstacked selection is unchanged). Pure. */
export function pickIsoBlocksAll(
  screenX: number,
  screenY: number,
  blocks: readonly IsoPickBlock[],
  cam: IsoPickCamera,
): IsoPickResult[] {
  const { w, h, cellSize, isoScale, camX, camZ } = cam
  const tileW = cellSize * isoScale * 0.71
  const tileH = cellSize * isoScale * 0.36
  const heightStep = cellSize * isoScale * 0.4
  if (tileW <= 0 || tileH <= 0) return []
  // Nearest-camera-first = the reverse of render's back-to-front sort (isoDepthCompare): a higher (col+row)
  // is drawn later / on top, then a higher level within the same cell. Collect hits IN that order, so the
  // topmost VISIBLE block is first and the ones it occludes follow (front→back) — the order click-to-cycle
  // walks to reach a hidden block. Hit-test EVERY provided block, including level 0 — a ground-floor wall is
  // a 0-based CUBE seated on the floor and must be selectable. The CALLER decides what counts as a block (the
  // flat floor is excluded upstream); this pure fn just projects + hit-tests whatever it's given.
  const ordered = blocks
    .slice()
    .sort((a, b) => {
      const d = (b.col + b.row) - (a.col + a.row)
      if (d !== 0) return d
      return (b.heightLevel ?? 0) - (a.heightLevel ?? 0)
    })
  const hits: IsoPickResult[] = []
  for (const b of ordered) {
    const wx = b.col * cellSize - camX
    const wz = b.row * cellSize - camZ
    const px = w / 2 + (wx - wz) * isoScale * 0.71
    const py = h / 2 + (wx + wz) * isoScale * 0.36
    // isoBlockFaces: `center` is the block's BASE diamond and the cube extrudes UP. So hit-test the whole
    // visible cube UPWARD from the base: the TOP CAP diamond (at yTop), OR the two FRONT wall faces running
    // from the base (yBase, bottom) up to the top (yTop).
    const yBase = py - b.terrainHeight * heightStep - isoStackLift(tileW, b.heightLevel)
    const blockH = tileW * ISO_BLOCK_H_FRAC // one block's on-screen height
    const yTop = yBase - blockH
    const dxAbs = Math.abs(screenX - px)
    const hit = dxAbs / tileW + Math.abs(screenY - yTop) / tileH <= 1        // TOP cap diamond
      || (screenY >= yTop && screenY <= yBase && dxAbs <= tileW)             // FRONT wall faces (base → top)
    if (hit) hits.push({ col: b.col, row: b.row, level: b.heightLevel, source: b.source })
  }
  return hits
}

/** Screen → the frontmost RAISED block under the pointer (nearest-camera), or null — the block the render
 *  draws ON TOP at that pixel. The first of pickIsoBlocksAll; the rest are occluded behind it (reach them
 *  via click-to-cycle / nextPickIndex). Unchanged for every existing caller. */
export function pickIsoBlock(
  screenX: number,
  screenY: number,
  blocks: readonly IsoPickBlock[],
  cam: IsoPickCamera,
): IsoPickResult | null {
  return pickIsoBlocksAll(screenX, screenY, blocks, cam)[0] ?? null
}

/** Click-to-cycle index for reaching an OCCLUDED block: repeated clicks on (nearly) the same pixel walk
 *  front→back through the `count` overlapping candidates (wrapping); a click on a NEW pixel (beyond `tol`
 *  px) resets to the frontmost (0). Pure — the caller holds the {x,y,index} of the previous pick. */
export function nextPickIndex(
  prev: { x: number; y: number; index: number } | null,
  x: number,
  y: number,
  count: number,
  tol: number,
): number {
  if (count <= 0) return 0
  if (prev && Math.abs(x - prev.x) <= tol && Math.abs(y - prev.y) <= tol) return (prev.index + 1) % count
  return 0
}


/** Render a height≥1 tile/asset as an iso CUBE — the 3D half of the 2D+3D tileset model. The cell's
 *  flat diamond extrudes into `height` stacked blocks (isoBlockFaces); each block fills its two
 *  camera-visible side faces + the top face gets the final cap, and the tile is SHEARED onto every
 *  face via fillIsoFaceWithTile (auto-extrude — one image on all faces; per-face art is a later phase).
 *  Side faces are shaded by the global LIGHT (top brightest, the two front walls dimmer) so the block
 *  reads 3D even when the tile has no per-face detail. `tint` = a per-instance colour override that
 *  recolours the whole cube (the colour-as-data rule). Impure canvas glue; the corner math is the pure,
 *  unit-tested isoBlockFaces. `dv.char`/`dv.image` come from resolveDraw — ASCII passthrough never
 *  reaches here (its assets stay flat), only a styled/emoji tile block does. */
function drawIsoTileBlockLive(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  topDv?: DrawVisual, // optional DIFFERENT tile for the TOP face (e.g. a ROOF cap on a WALL block)
  depth = 1, // directional-depth: >1 (with depthDir) extrudes into a long iso box spanning `depth` cells
  depthDir?: DepthDir,
): void {
  const n = blockLayers(height)
  const faceColor = tint ?? dv.tint ?? dv.color
  // Per-face brightness from the sun (outward screen normals of the two FRONT walls). Constant per
  // block → hoisted out of the stacking loop. Same faceLight shading the peaked roof uses.
  const leftShade = darkenColor(faceColor, faceLight(-tileH, tileW)) // front-left wall (L→B edge)
  const rightShade = darkenColor(faceColor, faceLight(tileH, tileW)) // front-right wall (B→R edge)
  // Fill a face as a shaded solid quad, then overlay ITS tile sheared onto it (the auto-extrude).
  const fillFace = (f: BlockFace, colour: string, fdv: DrawVisual, ftint?: string): void => {
    ctx.fillStyle = colour
    fillQuad(ctx, f.a, f.b, f.c, f.d)
    if (fdv.image || fdv.char) {
      fillIsoFaceWithTile(ctx, f.a, { x: f.b.x - f.a.x, y: f.b.y - f.a.y }, { x: f.d.x - f.a.x, y: f.d.y - f.a.y }, { char: fdv.char, color: fdv.color, image: fdv.image }, 1, 1, ftint)
    }
  }

  // DIRECTIONAL-DEPTH path (depth>1 + a direction): draw the extruded long-box HULL instead of a unit cube.
  // Guarded so a depth-less block (every existing tree/wall/terrain) never reaches here → byte-identical render.
  if (depthDir && Math.floor(depth) > 1) {
    const shade = (role: 'left' | 'right') => (role === 'left' ? leftShade : rightShade)
    // Stack bottom→top exactly like the cube path; each level is one long box, higher levels composite over lower.
    for (let k = 0; k < n; k++) {
      const box = isoDepthBox(center, tileW, tileH, blockH, depth, depthDir, k)
      fillFace(box.long, shade(box.longShade), dv, tint)
      fillFace(box.cap, shade(box.capShade), dv, tint)
    }
    const boxTop = isoDepthBox(center, tileW, tileH, blockH, depth, depthDir, n - 1).top
    if (topDv) fillFace(boxTop, topDv.tint ?? topDv.color ?? faceColor, topDv)
    else fillFace(boxTop, faceColor, dv, tint)
    return
  }

  // Stack bottom→top so higher blocks composite over lower ones; the TOP face is capped last (full-bright).
  for (let k = 0; k < n; k++) {
    const faces = isoBlockFaces(center, tileW, tileH, blockH, k)
    fillFace(faces.left, leftShade, dv, tint)
    fillFace(faces.right, rightShade, dv, tint)
  }
  const top = isoBlockFaces(center, tileW, tileH, blockH, n - 1).top
  if (topDv) fillFace(top, topDv.tint ?? topDv.color ?? faceColor, topDv) // a ROOF tile capping a wall block
  else fillFace(top, faceColor, dv, tint)
}

// ── Single-block cube SPRITE CACHE (the building-cell hotspot) ────────────────────────────────────────
// A building cell is a height-1 image cube (drawIsoTileBlock(..., 1, ...)). It is pixel-identical for every
// cell of the same (tile image, face colour, tint, top-cap, dims) — a city has THOUSANDS (every wall / roof /
// window cell). Bake that cube ONCE to an offscreen canvas and blit it per cell, exactly like the ground
// sprite cache — instead of re-drawing 3 faces (each a fillQuad + a save/transform/drawImage) per cell/frame.
const _cubeSpriteCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number } | null>()

function cubeBlockSprite(dv: DrawVisual, tileW: number, tileH: number, blockH: number, tint?: string, topDv?: DrawVisual) {
  if (typeof document === 'undefined') return null
  // Don't bake until the image raster(s) decoded — else the sprite would freeze the glyph fallback.
  if (dv.image && !tileImage(dv.image.src)) return null
  if (topDv?.image && !tileImage(topDv.image.src)) return null
  const faceColor = tint ?? dv.tint ?? dv.color
  const key = `${dv.image?.src ?? dv.char}|${faceColor}|${tint ?? ''}|${topDv?.image?.src ?? ''}|${topDv?.tint ?? topDv?.color ?? ''}|${Math.round(tileW)}|${Math.round(tileH)}|${Math.round(blockH)}`
  const hit = _cubeSpriteCache.get(key)
  if (hit !== undefined) return hit
  const m = 1 // 1px margin so edge anti-aliasing never clips
  const ox = tileW + m // local centre-x
  const oy = blockH + tileH + m // local centre-y: room above for the block top diamond, below for the base
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(2 * tileW + 2 * m)
  cv.height = Math.ceil(blockH + 2 * tileH + 2 * m)
  const c = cv.getContext('2d')
  // A real browser ctx supports the full path API; jsdom's stub canvas (jest) does not — fall through to the
  // LIVE draw there instead of throwing in fillQuad.
  if (!c || typeof c.beginPath !== 'function') {
    _cubeSpriteCache.set(key, null)
    return null
  }
  drawIsoTileBlockLive(c, { x: ox, y: oy }, tileW, tileH, blockH, 1, dv, tint, topDv)
  const sprite = { canvas: cv, ox, oy }
  _cubeSpriteCache.set(key, sprite)
  return sprite
}

/** Draw a stacked iso cube. A single-block, full-opacity IMAGE cube blits a CACHED sprite (the building-cell
 *  fast path — the big city hotspot); taller stacks, fading/cutaway cubes (globalAlpha < 1) and glyph-only
 *  ASCII draw live. Skipping the cache at globalAlpha < 1 keeps proximity fade compositing exactly as before. */
export function drawIsoTileBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  topDv?: DrawVisual,
  depth = 1, // directional-depth (with depthDir) → a long iso box; default 1 = the unmodified cube
  depthDir?: DepthDir,
): void {
  const isDepthBox = !!depthDir && Math.floor(depth) > 1
  // The cube-sprite cache bakes a UNIT cube — never a directional box; skip it so a depth box always draws live.
  if (!isDepthBox && Math.floor(height) === 1 && ctx.globalAlpha === 1 && dv.image) {
    const spr = cubeBlockSprite(dv, tileW, tileH, blockH, tint, topDv)
    if (spr) {
      ctx.drawImage(spr.canvas, center.x - spr.ox, center.y - spr.oy)
      return
    }
  }
  drawIsoTileBlockLive(ctx, center, tileW, tileH, blockH, height, dv, tint, topDv, depth, depthDir)
}

/** DISPLAY = "single" (per-tile `settings.display`): draw the block as a PLAIN, shaded SHELL — the SAME cube
 *  geometry as drawIsoTileBlock, but a dv with NO tile image/char, so the faces are just the block's colour,
 *  shaded per face — then draw ONE centered instance of the tile INSIDE the block volume: a billboard at the
 *  block's screen-space centre, colour-composited the SAME way the faces would be (tintedImage, via
 *  drawStyledImage). This is the per-tile alternative to the 3-face paint — one water droplet floating inside
 *  the block, not the tile repeated on every face. The shell keeps the block readable as a 3D volume; the
 *  single tile is inset (SINGLE_TILE_FRAC) so the shell shows around it. `height` blocks tall; `tint`
 *  recolours BOTH the shell and the single tile. */
export function drawIsoSingleTileBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
  depth = 1,
  depthDir?: DepthDir,
  transparent = false,
): void {
  // 1) The plain block SHELL — same cube, but no image/char on the faces (fillFace only fills the shaded quad).
  //    SKIPPED when the tile is transparent: only the billboard (step 2) shows, so a flower stands with NO
  //    coloured block around it — "style the flower without colouring the whole block".
  if (!transparent) drawIsoTileBlock(ctx, center, tileW, tileH, blockH, height, { char: '', color: dv.color, tint: dv.tint }, tint, undefined, depth, depthDir)
  // 2) ONE centered tile INSIDE the block. `center` is the base diamond centre; the stack rises `total` px, so
  //    the volume's vertical mid-point is total/2 above it. The tile is drawn at SINGLE_TILE_FRAC of the block
  //    width so the shell stays visible around it.
  const total = blockLayers(height) * blockH
  const cx = center.x
  const cy = center.y - total / 2
  const size = tileW * 2 * SINGLE_TILE_FRAC
  if (dv.image) {
    drawStyledImage(ctx, dv.image, cx, cy, size, false, tint, size) // colour FILTERS the image, same as the faces
    return
  }
  // No baked image (a raw ascii glyph) → draw the glyph ONCE at the centre, tinted, so 'single' still shows one tile.
  if (dv.char) {
    ctx.save()
    ctx.font = `bold ${size}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fillTintedGlyph(ctx, dv.char, cx, cy, size, tint, tint ? 0.85 : 0)
    ctx.restore()
  }
}

/** The rounding-clip ellipse for a circle-shape block — the INSCRIBED ellipse of the block's projected
 *  hexagon silhouette. A stacked iso block draws as a 6-vertex hexagon: the top-diamond apex, the two upper
 *  side vertices, the two mid (base-diamond) side vertices, and the bottom apex. The OLD ellipse
 *  (`ry = stack/2 + tileH`) passed exactly THROUGH the apex + bottom and CUT ACROSS the slanted top/bottom
 *  faces, so three things stayed angular: the top point poked out sharp, the bottom point poked out sharp, and
 *  where the straight slant edge met the ellipse arc there was a visible KINK (the mid-right corner Alexander
 *  circled). To bend EVERY corner we shrink `ry` just enough that the ellipse is TANGENT to the four slanted
 *  faces (and to the vertical sides at `rx = tileW`) — i.e. fully INSCRIBED. Tangency to the slant edge
 *  (slope tileH/tileW through the apex) solves to `ry² = (stack/2)² + stack·tileH`, a hair below the old
 *  `stack/2 + tileH` (they differ only by the `tileH²` term). Now every hexagon vertex sits OUTSIDE the
 *  ellipse (so the clip rounds it away) and the ellipse never crosses an edge (so there is no straight-edge/arc
 *  kink): the whole outline is one smooth oval. Still PROPORTIONAL — a tall block → a tall oval, a unit cube →
 *  a rounder blob — with the top/bottom domes at radius-of-curvature `rx²/ry` (visibly bent, not a point) and
 *  the sides gently curved. Pure geometry → unit-tested directly. */
export function roundedBlockEllipse(
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
): { cx: number; cy: number; rx: number; ry: number } {
  const stack = blockLayers(height) * blockH // the extruded height in px (top diamond centre lifts this)
  const rx = tileW                                       // footprint half-width (honours scaleX/zoom via the caller's bw)
  const ry = Math.sqrt((stack / 2) * (stack / 2) + stack * tileH) // tangent to the slanted faces → inscribes the hexagon
  return { cx: center.x, cy: center.y - stack / 2, rx, ry }       // centred at the cuboid's vertical mid-point
}

/** Round the ONE corner the outer ellipse can't: the top face's FRONT vertex. The inscribed ellipse only bends
 *  the outer SILHOUETTE — but where the bright top diamond's front point meets the two front walls is an INTERIOR
 *  colour seam (a sharp downward V), so no outer clip reaches it (Image #61: the last angular corner). We overpaint
 *  that sharp tip with the front-wall shades up to a smooth arc, so the bright top RECEDES to a rounded front edge
 *  instead of a point — left half → leftShade, right half → rightShade, matching the walls beneath so the bevel
 *  reads as the top surface curving down into the front faces. `faceColor` is the block's fill (same base the
 *  walls shade from). ISO-only: the 2D/top circle draws ONE ellipse-clipped face and has no such seam. */
function roundIsoTopFrontCorner(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  faceColor: string,
): void {
  const stack = blockLayers(height) * blockH
  const ty = center.y - stack // top diamond centre-y
  const fx = center.x, fy = ty + tileH // F — the top face's front vertex (where its two front edges meet)
  const bevel = 0.5 // how far up the two front edges the round reaches, as a fraction of the top-diamond edge
  const plx = fx - bevel * tileW, prx = fx + bevel * tileW, py = fy - bevel * tileH // bevel ends on the front edges
  const leftShade = darkenColor(faceColor, faceLight(-tileH, tileW))
  const rightShade = darkenColor(faceColor, faceLight(tileH, tileW))
  // The sharp bright tip = the lens between the front edges (PL→F→PR) and a curve bulging toward F: overpaint it
  // with wall shading so the top's front boundary becomes that curve. Split at the front vertical seam (x = fx)
  // so each half wears its own wall shade, seamless with the walls below.
  const lens = () => { ctx.beginPath(); ctx.moveTo(plx, py); ctx.quadraticCurveTo(fx, fy, prx, py); ctx.lineTo(fx, fy); ctx.closePath() }
  ctx.save(); ctx.beginPath(); ctx.rect(fx - tileW, py - 1, tileW, tileH + 2); ctx.clip(); ctx.fillStyle = leftShade; lens(); ctx.fill(); ctx.restore()
  ctx.save(); ctx.beginPath(); ctx.rect(fx, py - 1, tileW, tileH + 2); ctx.clip(); ctx.fillStyle = rightShade; lens(); ctx.fill(); ctx.restore()
}

/** SHAPE = "circle": take the SAME cuboid — same footprint, height, painted faces and per-face shading as
 *  drawIsoTileBlock — and BEND ITS CORNERS into a smooth rounded silhouette (Alexander: "ALL I WANT WITH THE
 *  SHAPE IS TO MANIPULATE THE SIDES OF THE CUBOID, selecting circle shape should bend the corners OF THE CUBOID
 *  to form a circle … the cube/cuboid is just a tile, painted on all sides of the block/cell"). We draw the block
 *  exactly as the cube path does, then CLIP it to the INSCRIBED ellipse (`roundedBlockEllipse`) so every SILHOUETTE
 *  corner — the top apex, the mid-side vertices, and the bottom — is bent away and no straight-edge/arc kink remains.
 *  The outer clip can't reach the top face's FRONT vertex (an interior top→wall colour seam), so roundIsoTopFrontCorner
 *  bevels that last sharp point too — now EVERY corner is bent. The three shaded faces and the tile's painted art all
 *  stay: it is the cuboid with its corners rounded away, NOT a repainted sphere. There is no spherical relight and no
 *  single flat surface — those were the rejected "ball" attempts; here the ONLY change from the cube is the rounding. */
export function drawIsoRoundedBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  height: number,
  dv: DrawVisual,
  tint?: string,
): void {
  const { cx, cy, rx, ry } = roundedBlockEllipse(center, tileW, tileH, blockH, height)
  ctx.save()
  // The rounded silhouette: the block's INSCRIBED ellipse, so every corner bends away and proportions are kept.
  clipToBall(ctx, cx, cy, rx, ry)
  // The SAME cuboid — three shaded faces + painted art — drawn normally; only the clip above rounds it.
  drawIsoTileBlock(ctx, center, tileW, tileH, blockH, blockLayers(height), dv, tint)
  // Bevel the one corner the silhouette clip can't reach — the top face's interior front vertex (Image #61).
  roundIsoTopFrontCorner(ctx, center, tileW, tileH, blockH, height, tint ?? dv.tint ?? dv.color)
  ctx.restore()
}

/** ONE dispatch for "how to draw a placed tile's SOLID", keyed by its `shape` (default 'square'). The
 *  'square' drawer keeps the existing cube / single-billboard split (display setting); 'circle' builds a ball.
 *  A new shape ('oval', …) adds ONE entry here — never a new `if` at the call sites (SOLID/OCP). */
type IsoShapeDrawer = (
  ctx: CanvasRenderingContext2D, center: Pt, bw: number, bd: number, bh: number, blocks: number,
  dv: DrawVisual, tint: string | undefined, asset: GridAsset,
) => void

const ISO_SHAPE_DRAWERS: Record<TileShape, IsoShapeDrawer> = {
  square: (ctx, center, bw, bd, bh, blocks, dv, tint, asset) => {
    // DISPLAY = "single" draws ONE centered tile inside the shell; else the tile paints on all faces.
    // `transparent` drops the shell so only the billboard shows (a flower with no coloured block).
    if (asset.settings?.display === 'single') drawIsoSingleTileBlock(ctx, center, bw, bd, bh, blocks, dv, tint, asset.depth, asset.depthDir, asset.settings?.transparent)
    else drawIsoTileBlock(ctx, center, bw, bd, bh, blocks, dv, tint, undefined, asset.depth, asset.depthDir)
  },
  circle: (ctx, center, bw, bd, bh, blocks, dv, tint) => drawIsoRoundedBlock(ctx, center, bw, bd, bh, blocks, dv, tint),
}

/** Draw a placed tile's block as the SOLID its `shape` selects — the single call the asset draw sites use in
 *  place of branching on display/shape themselves. Unknown/absent shape → the square (cube) drawer. */
function drawIsoTileForShape(
  ctx: CanvasRenderingContext2D, center: Pt, bw: number, bd: number, bh: number, blocks: number,
  dv: DrawVisual, tint: string | undefined, asset: GridAsset,
): void {
  (ISO_SHAPE_DRAWERS[asset.shape ?? 'square'] ?? ISO_SHAPE_DRAWERS.square)(ctx, center, bw, bd, bh, blocks, dv, tint, asset)
}

// ── shared iso solids (raised structures + water depth) ──────────────────
// Ground tiles that get an iso DEPTH treatment (a sunken basin) instead of a flat diamond.
export const WATER_DEPTH_TILES: ReadonlySet<string> = new Set(['water', 'ice_water', 'oasis', 'koi'])


/** Fill one iso diamond centred at (cx,cy) with half-extents (hw,hh). */
function fillDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw: number, hh: number, fill: string): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(cx, cy - hh)
  ctx.lineTo(cx + hw, cy)
  ctx.lineTo(cx, cy + hh)
  ctx.lineTo(cx - hw, cy)
  ctx.closePath()
  ctx.fill()
}


/** Give a water ground cell ISO DEPTH (#50): a darker sunken bank rim + a recessed,
 *  gently-shimmering surface dropped below the lip — so a pond reads as a basin with
 *  depth, not a flat blue diamond. Render-only; (cx,cy) is the tile's top-face centre. */
function drawIsoWaterDepth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  base: string,
  time: number,
  col: number,
  row: number,
): void {
  fillDiamond(ctx, cx, cy, hw * 0.84, hh * 0.84, darkenColor(base, 0.5)) // shaded inner bank
  const sink = hh * 0.42
  const shimmer = 0.5 + 0.5 * Math.sin(time * 0.0018 + col * 0.7 + row * 0.5)
  fillDiamond(ctx, cx, cy + sink, hw * 0.64, hh * 0.64, lightenColor(base, 0.1 + 0.14 * shimmer)) // recessed surface
}




/** The screen silhouette of a drawn iso BLOCK/column: a directional-depth box when the asset extrudes along a
 *  diagonal (depth>1 + depthDir), else the plain stacked cube. Pose (x/y/rotate/flip) is folded in through
 *  poseMapper exactly as the draw applies it, so the geom matches whether or not the block is posed. */
function blockGeom(x: number, y: number, halfW: number, halfD: number, blockH: number, blocks: number, asset: GridAsset, unit: number): TileGeom {
  const xf = poseMapper({ x, y }, asset.pose, unit)
  if (asset.depthDir && (asset.depth ?? 1) > 1) return depthBoxGeom(halfW, halfD, blockH, blocks, asset.depth ?? 1, asset.depthDir, xf)
  return cubeGeom(halfW, halfD, blockH, blocks, xf)
}

/** Per-type ASCII sprite silhouette: [half-width as a MULTIPLE of tileW, layer count]. A prop with no entry
 *  is a one-layer sprite 0.6·tileW wide. Keyed lookup (not a switch) so a type maps to its bounds directly. */
const ISO_ASCII_STACK: Readonly<Record<string, readonly [halfWMul: number, layers: number]>> = {
  tree: [1.1, 5],
  lamp: [0.5, 3],
  lantern: [0.5, 3],
  npc: [0.55, 3],
  bush: [0.6, 2],
}

/** Half-width + layer count of a per-type ASCII sprite (tree/lamp/npc/…), which draws a STACK of glyph layers
 *  rising from the cell. Drives the recorded pick silhouette so a click hugs the visible sprite, not the cell. */
function perTypeStackBounds(type: string, tileW: number): [halfW: number, layers: number] {
  const [mul, layers] = ISO_ASCII_STACK[type] ?? [0.6, 1]
  return [tileW * mul, layers]
}

// ── Legacy per-type ASCII prop art (tree/lamp/bush/npc/flower/rock/…) ─────────────────────────────────────
// FALLBACK glyph art invented in the frontend, drawn ONLY when NO baked tile resolves for the asset's kind —
// i.e. the ASCII style, whose kind catalog has no prop tiles (public/tiles has emoji/ only). Under emoji every
// one of these types resolves a baked tile in drawIsoAssetAscii's `adv.image` branch and never reaches here.
// To DE-HARDCODE a type, add its backend ASCII TileSource (→ tiles.json → bake → seed) so the image path
// catches it upstream; until then these drawers keep the exact legacy pixels. Routed by a dispatch map, not an
// `if type===` chain, so each type is one small, named, testable unit.

/** Inputs every per-type ASCII drawer reads — all derived from the drawIsoAssetAscii call. */
interface IsoAsciiParams {
  x: number
  y: number
  tileW: number
  tileH: number
  fontSize: number
  lineHeight: number
  time: number
  flicker: number
  groundContact: boolean
}

type IsoAsciiDrawer = (ctx: CanvasRenderingContext2D, asset: GridAsset, p: IsoAsciiParams) => void

/** One glyph layer of a stacked ASCII prop: coloured text over a bg plate so it reads on any ground. */
interface AsciiStackLayer { text: string; color: string; bg: string }

/** Draw a bottom-up STACK of glyph layers rising from (x,y): layer i sits i line-heights up, each on its own
 *  measured bg plate. `fontFor` sizes layer i (uniform, or tapering for a tree/head); `shadow` drops a 1px
 *  black offset behind the glyph (the npc figure). The shared body of the tree/lamp/bush/npc sprites. */
function drawIsoGlyphStack(
  ctx: CanvasRenderingContext2D, x: number, y: number, layers: readonly AsciiStackLayer[],
  lineHeight: number, fontFor: (i: number) => number, shadow = false,
): void {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const layerY = y - i * lineHeight - lineHeight * 0.5
    ctx.font = `bold ${fontFor(i)}px ${ASCII_FONT}`
    const textWidth = ctx.measureText(layer.text).width
    ctx.fillStyle = layer.bg
    ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
    if (shadow) { ctx.fillStyle = '#000000'; ctx.fillText(layer.text, x + 1, layerY + 1) }
    ctx.fillStyle = layer.color
    ctx.fillText(layer.text, x, layerY)
  }
}

/** Tree: bark trunk + a canopy pyramid tinted to the asset's zone/theme colour (never hardcoded green); the
 *  trunk stays bark. Ground shadow only on the ground-contact cell. Wide base drawn first, apex on top. */
function drawIsoTreeAscii(ctx: CanvasRenderingContext2D, asset: GridAsset, p: IsoAsciiParams): void {
  const { x, y, tileW, tileH, fontSize, lineHeight, flicker, groundContact } = p
  const canopy = treeCanopyLayers(asset.color || '#2e8b2e', flicker)
  if (groundContact) {
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.beginPath()
    ctx.ellipse(x, y, tileW * 0.55, tileH * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const layers: AsciiStackLayer[] = [
    { text: '0', color: '#ad8621', bg: '#5a4510' },              // trunk bottom
    { text: 'W', color: '#c9a030', bg: '#6a5520' },              // trunk top
    { text: '(@&@&@)', color: canopy[0].fg, bg: canopy[0].bg },  // wide base
    { text: '(@&@)', color: canopy[1].fg, bg: canopy[1].bg },    // mid
    { text: '(&)', color: canopy[2].fg, bg: canopy[2].bg },      // narrow apex
  ]
  // Bigger font at the wide base, smaller toward the apex → a crisp upright pyramid.
  drawIsoGlyphStack(ctx, x, y, layers, lineHeight, i => (i < 2 ? fontSize * 0.9 : fontSize * (0.85 - (i - 2) * 0.05)))
}

/** Legacy single-lamp/lantern prop — a STEADY lit bulb glyph. Day/night ambience is the warm ground GLOW POOL
 *  (drawNightLighting) + a night-triggered flicker animation, NOT faked here, so this ignores dayNight. */
function drawIsoLampAscii(ctx: CanvasRenderingContext2D, _asset: GridAsset, p: IsoAsciiParams): void {
  const layers: AsciiStackLayer[] = [
    { text: '|', color: '#666666', bg: '#333333' },
    { text: '|', color: '#777777', bg: '#444444' },
    { text: 'o', color: 'rgba(255, 220, 50, 1)', bg: 'rgba(100, 80, 0, 1)' },
  ]
  drawIsoGlyphStack(ctx, p.x, p.y, layers, p.lineHeight, () => p.fontSize)
}

/** Small bush — two leafy layers that shimmer with the ambient flicker. */
function drawIsoBushAscii(ctx: CanvasRenderingContext2D, _asset: GridAsset, p: IsoAsciiParams): void {
  const { flicker } = p
  const layers: AsciiStackLayer[] = [
    { text: '*', color: `rgba(80, 200, 80, ${0.8 + 0.2 * flicker})`, bg: 'rgba(0, 100, 0, 0.85)' },
    { text: '**', color: `rgba(60, 180, 60, ${0.85 + 0.15 * flicker})`, bg: 'rgba(0, 90, 0, 0.8)' },
  ]
  drawIsoGlyphStack(ctx, p.x, p.y, layers, p.lineHeight, () => p.fontSize * 0.9)
}

/** NPC — a humanoid figure (legs / torso / head) with a 1px shadow and a slightly smaller head. */
function drawIsoNpcAscii(ctx: CanvasRenderingContext2D, _asset: GridAsset, p: IsoAsciiParams): void {
  const layers: AsciiStackLayer[] = [
    { text: '/\\', color: '#3355aa', bg: '#1a2a55' },   // legs (pants)
    { text: '[=]', color: '#4466cc', bg: '#223366' },   // body/torso
    { text: '(o)', color: '#ffccaa', bg: '#996644' },   // head with simple face
  ]
  drawIsoGlyphStack(ctx, p.x, p.y, layers, p.lineHeight, i => (i === 2 ? p.fontSize * 0.95 : p.fontSize), true)
}

/** Small flower — a single glyph swaying via the ambient animation engine (assetAnimFrame). */
function drawIsoFlowerAscii(ctx: CanvasRenderingContext2D, asset: GridAsset, p: IsoAsciiParams): void {
  ctx.font = `bold ${p.fontSize * 0.8}px ${ASCII_FONT}`
  const layerY = p.y - p.lineHeight * 0.3
  ctx.fillStyle = asset.color || '#ff88cc'
  ctx.fillText(assetAnimFrame('flower', p.time)?.[0] ?? '+', p.x, layerY)
}

/** Rock / decoration — a grey 'O' pebble on a plate the width of the cell. Fixed greys (ignores asset colour). */
function drawIsoRockAscii(ctx: CanvasRenderingContext2D, _asset: GridAsset, p: IsoAsciiParams): void {
  const { x, y, tileW, fontSize, lineHeight } = p
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  const layerY = y - lineHeight * 0.5
  ctx.fillStyle = '#555555'
  ctx.fillRect(x - tileW / 2, layerY - lineHeight / 2, tileW, lineHeight)
  ctx.fillStyle = '#999999'
  ctx.fillText('O', x, layerY)
}

/** Default prop — the asset's own art glyph on a darkened plate. Fountain/well fall through here under ASCII
 *  (their bespoke drawers are gone; the emoji reskin extrudes ⛲/🪣 into an iso basin upstream). */
function drawIsoDefaultAscii(ctx: CanvasRenderingContext2D, asset: GridAsset, p: IsoAsciiParams): void {
  const { x, y, tileW, fontSize, lineHeight } = p
  const char = asset.art[0] || '?'
  const layerY = y - lineHeight * 0.5
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.fillStyle = darkenColor(asset.color || '#888888', 0.4)
  const textWidth = ctx.measureText(char).width
  ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
  ctx.fillStyle = asset.color || '#ffffff'
  ctx.fillText(char, x, layerY)
}

/** Legacy per-type ASCII prop drawers, keyed by asset.type. Unmapped types → drawIsoDefaultAscii. */
const ISO_ASCII_DRAWERS: Readonly<Record<string, IsoAsciiDrawer>> = {
  tree: drawIsoTreeAscii,
  lamp: drawIsoLampAscii,
  lantern: drawIsoLampAscii,
  bush: drawIsoBushAscii,
  npc: drawIsoNpcAscii,
  flower: drawIsoFlowerAscii,
  rock: drawIsoRockAscii,
  decoration: drawIsoRockAscii,
}

/** Draw a placed tile in iso AND return its transform-aware screen silhouette (TileGeom) so the inverted
 *  picker + the selection/hover highlight hit-test the ACTUAL rendered tile, never the flat ground cell.
 *  The geom is built from the SAME dims/pose the draw uses, at the draw site, so it can't drift. */
export function drawIsoAssetAscii(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number,
  groundContact = false,
  dayNight: DayNight = 'day',
  style: Style = ASCII_STYLE,
): TileGeom | null {
  const lineHeight = tileH * 1.3
  const fontSize = tileH * 1.1
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // GROUND DECOR is a flat overlay tile (flowers/clover/pebbles): draw its BAKED tile image — resolved by
  // its LABEL for the ACTIVE style (groundDecorImage → labelTileImage) — SHEARED flat onto the cell's ground
  // DIAMOND (the same geometry the ground layer uses; (x,y) IS the cell's ground centre) and colour-composited
  // (tint = asset.color). `char: ''` so a not-yet-decoded PNG paints NOTHING — never the dingbat. No baked decor
  // tile for this style (a backend data gap) → fall through to the existing path (e.g. emoji's curated litter
  // tile via resolveAssetDraw), which is still an image, never a glyph.
  if (asset.type === 'ground_decor') {
    const decorImage = groundDecorImage(asset, style)
    if (decorImage) {
      fillIsoFaceWithTile(ctx, { x: x - tileW, y }, { x: tileW, y: -tileH }, { x: tileW, y: tileH }, { char: '', color: asset.color ?? '#ffffff', image: decorImage }, 1, 1, asset.color)
      return diamondGeom(tileW, tileH, poseMapper({ x, y }, undefined, tileH)) // flat ground diamond
    }
  }

  // MODEL (TILE-BACKEND-MIGRATION §7 — "resolve label→image", the migration's whole point): a labeled
  // composition cell IS its label's tile. Resolve the per-LABEL baked image for the ACTIVE style, paint it
  // on the cube faces + composite the cell's colour, and RETURN — BEFORE any kind-based art below. This is
  // why a tree's canopy/trunk cells draw their OWN leaf/trunk tile instead of the 'tree' KIND emoji, and why
  // a cell's colour setting filters the WHOLE tile (the image is recoloured — no kind emoji, no glyph that
  // would ignore the tint). Same path for every style (ascii/emoji/…) — the label is the only input.
  //
  // EVERY image-backed labeled tile is a BLOCK — a height≥1 cell extrudes into stacked cubes, a sub-block
  // (flat) labeled cell draws its own DB height as a thin partial slab (partialBlockScale), NEVER a flat
  // billboard — so Z-Width/display/shape/scale apply through
  // drawIsoTileForShape (MAP-MODEL §4, EDITOR-INTERACTION-SPEC §11). A genuinely image-LESS label (unknown /
  // not-yet-baked) still falls to the neutral glyph below (MAP-MODEL §8), unchanged.
  const labelImage = asset.label ? labelTileImage(asset.label, style) : undefined
  if (asset.label && ((asset.height ?? 0) >= 1 || labelImage)) {
    const zoom = asset.scale ?? 1
    const bw = tileW * (asset.scaleX ?? 1) * zoom       // Width  — diamond half-width
    const bd = tileH * (asset.scaleZ ?? 1) * zoom       // Depth  — diamond half-height (into-screen axis)
    // Height — the tile's OWN DB block-height turned into pixels: partialBlockScale draws a sub-block cell as a
    // partial slab and a standing cell as a full block, × the per-instance Height multiplier (scaleY). The
    // height VALUE is DATA (from the DB); nothing invented here.
    const bh = tileW * ISO_BLOCK_H_FRAC * (asset.scaleY ?? 1) * layerBlockScale(asset.height ?? 0) * zoom
    const tint = asset.color ?? '#cccccc'
    const et = style.id === 'emoji' ? EMOJI_TILESET[asset.label] : undefined
    const glyph = et ? et.char : (asset.art[0] ?? '?')
    const image = labelImage
    const recolor = labelTileRecolor(style, tint)
    const dvBlock = { char: glyph, color: tint, tint: recolor, image }
    // SHAPE + DISPLAY (per-tile settings): drawIsoTileForShape picks the solid — cube (all-faces / single) or
    // ball — so a labeled cell can render as a shaded ball just like a placed prop.
    const geom = blockGeom(x, y, bw, bd, bh, 1, asset, tileH) // the shell cube (single) / cube column — SAME dims
    // Per-asset pose (x/y/rotate/flip) transforms this labeled block too — same applyPose wrap as the generic
    // block/billboard paths, so a placed OR generated block moves/rotates. No pose → the byte-identical draw.
    if (asset.pose) {
      ctx.save(); ctx.translate(x, y); applyPose(ctx, asset.pose, 1, tileH)
      drawIsoTileForShape(ctx, { x: 0, y: 0 }, bw, bd, bh, 1, dvBlock, recolor, asset)
      if (asset.settings?.badge) drawApexBadge(ctx, 0, -bh, fontSize, asset.settings.badge)
      ctx.restore()
      return geom
    }
    drawIsoTileForShape(ctx, { x, y }, bw, bd, bh, 1, dvBlock, recolor, asset)
    if (asset.settings?.badge) drawApexBadge(ctx, x, y - bh, fontSize, asset.settings.badge)
    return geom
  }

  // Active art style: a mapped kind (or a per-element override) replaces ALL of the per-type
  // art below (labeled cells, trees, legacy buildings, props) with ONE tile. A PLACED tile's
  // override re-homes onto the active style so it RESKINS (resolveAssetDraw), never freezing to
  // the style it was picked in. ASCII + no override → adv.char '' → the byte-identical per-type draw.
  let adv = resolveAssetDraw(assetKind(asset), style, assetOverride(asset, style), '', asset.color ?? '#ffffff')
  // The tile's emoji-tileset entry: per-view size/pose + the iso block-height default. Undefined under ASCII.
  const vt = style.id === 'emoji' ? EMOJI_TILESET[assetKind(asset)] : undefined
  // The tile's OWN iso block height — DATA read from the ACTIVE style's DB tile (emoji tile OR ascii tile), the
  // SAME way in both, so a flat tile's 0.1 comes from the DB everywhere and nothing is invented here. height≥1 →
  // N stacked cubes; a sub-block (flat 0.1) tile → one partial slab (partialBlockScale below).
  const dbTile = style.id === ASCII_STYLE.id ? ASCII_TILESET.tiles[assetKind(asset)] : vt
  // A FLOOR (grass/road/water/…) resolves its baked ASCII image by KIND the SAME way emoji does via emojiStyleMap.
  // The floor is the ONE tile whose identity is its groundKind (tileKey → assetKind), NOT a label (assetKind:254),
  // and ASCII_STYLE.map is empty by design (a kind passes through to a glyph, so adv has NO image) — so without
  // this an ascii floor falls to the '?' glyph though its baked grass/road tile IS in the DB (Alexander: "we don't
  // have tiles for grass, road"). Emoji already carries the kind image in adv (its style map is populated) →
  // kindTileImage returns undefined there, so this is ASCII-only and never overrides an existing image. The
  // block/slab path below then draws the image at the floor's OWN DB height (`blocks` = 0.1), tinted by the cell
  // colour — byte-identical to how emoji floors already render. `char: ''` so a not-yet-decoded PNG paints NOTHING,
  // never the dingbat (mirrors the ground_decor/label image paths). Scoped to the floor so no per-type prop (crate
  // /pillar/…) changes render path here — those keep their glyph until given a resolvable label, like the nature
  // props (flower/rock/mushroom/crystal) now carry.
  if (!adv.image && asset.type === FLOOR_TYPE) {
    const kimg = kindTileImage(assetKind(asset), style)
    if (kimg) adv = { ...adv, image: kimg, char: '', tint: adv.tint ?? asset.color }
  }
  const blocks = resolveTileHeight(dbTile, asset)
  // Z-WIDTH (directional depth) is a 3D BLOCK operation: setting it declares the tile a block extruded N cells
  // along a diagonal, so the iso render MUST extrude it even at base height 0. Z-Width only changes how FAR a
  // block extrudes — a flat tile stays a THIN slab (see flatSlab below), just deeper.
  const hasZWidth = (asset.depth ?? 1) > 1
  // A well / fountain under a RESKIN (emoji), flat + no Z-Width, extrudes its RESOLVED TILE (⛲/🪣) into a raised
  // iso basin block (bespoke depth) — town fountains scale to their footprint. A Z-Width well, or one with its
  // own height, flows to the generic block path below (which honours depthDir). ASCII → the per-type draw.
  const reskinned = style.id !== ASCII_STYLE.id
  if (reskinned && blocks < 1 && !hasZWidth && (asset.type === 'well' || asset.type === 'fountain') && (adv.image || adv.char)) {
    const span = asset.footprint && asset.footprint > 1 ? asset.footprint : 1
    const bw = span > 1 ? tileW * span * 0.6 : tileW
    const bhScreen = span > 1 ? tileH * span * 0.6 : tileH
    const basinH = tileH * (span > 1 ? span * 0.5 : 1.4) // raised basin height in px (≈ the ASCII bodyH)
    drawIsoTileBlock(ctx, { x, y }, bw, bhScreen, basinH, 1, adv, asset.color)
    return cubeGeom(bw, bhScreen, basinH, 1, poseMapper({ x, y }, undefined, tileH))
  }
  // EVERY tile with ANY art is a BLOCK — the flat-billboard path for a placed tile is GONE (MAP-MODEL §4;
  // EDITOR-INTERACTION §11: "the old flat billboard path that silently dropped depth/depthDir + display is
  // gone"). A height≥1 tile extrudes into N cubes; a sub-block (flat) tile — a flower, a fallen leaf, floor
  // decor, the floor itself — draws its OWN DB height as a thin partial slab (partialBlockScale), so it looks
  // FLAT, not a tall cube, while Z-Width/display/shape/scaleX/scaleY/
  // scaleZ/colour ALL apply through drawIsoTileForShape. `adv.char` routes an image-LESS GLYPH tile (an ASCII
  // tile — whose override resolves to a glyph, not its baked image — or an emoji whose PNG hasn't decoded yet)
  // through the SAME slab, drawing its glyph on the faces, in exact parity with the 2D flat path (topdown.ts).
  // There is NO per-type/category/style branch: the ONE rule is "any art → a block/slab, never a billboard".
  // Only a genuinely ART-LESS tile (adv.char '' + no image — the ASCII kind-catalog fallback) drops below to
  // the per-type / labeled glyph drawers; a UNIT never reaches here (drawIsoEntity — the one billboard, §4).
  const blockCount = blocks >= 1 ? blocks : ((hasZWidth || adv.image || adv.char) ? 1 : 0)
  if (blockCount >= 1 && (adv.image || adv.char)) {
    // A block scales on ALL THREE axes (was height-only): Width (scaleX) widens the diamond, Depth (scaleZ)
    // deepens it, Height (scaleY) stretches it up, and Zoom (scale) multiplies every axis. This is what makes a
    // tile able to SPAN MANY BLOCKS (a 1×2 wall, a wide roof) instead of only growing taller.
    const zoom = asset.scale ?? 1
    const bw = tileW * (asset.scaleX ?? 1) * zoom       // Width  — diamond half-width
    const bd = tileH * (asset.scaleZ ?? 1) * zoom       // Depth  — diamond half-height (into-screen axis)
    // Height — the tile's OWN DB block-height as pixels: partialBlockScale draws a sub-block (flat 0.1) tile as a
    // thin partial slab and a standing tile as a full block, × the per-instance Height multiplier (scaleY). The
    // height VALUE is DATA (from the DB, read into `blocks`); nothing invented.
    const bh = tileW * 0.9 * (asset.scaleY ?? 1) * layerBlockScale(blocks) * zoom
    // SHAPE + DISPLAY (per-tile settings): drawIsoTileForShape picks the solid — cube (all-faces / single) or ball.
    const geom = blockGeom(x, y, bw, bd, bh, blockCount, asset, tileH)
    // Per-asset pose (x/y/rotate/flip) transforms the block around its base centre — the SAME applyPose the
    // billboard/floor paths use, so moving/rotating a placed BLOCK works too. No pose → the byte-identical draw.
    if (asset.pose) {
      ctx.save(); ctx.translate(x, y); applyPose(ctx, asset.pose, 1, tileH)
      drawIsoTileForShape(ctx, { x: 0, y: 0 }, bw, bd, bh, blockCount, adv, asset.color, asset)
      ctx.restore()
      return geom
    }
    drawIsoTileForShape(ctx, { x, y }, bw, bd, bh, blockCount, adv, asset.color, asset)
    return geom
  }
  // (The image-LESS GLYPH tile is NO LONGER a billboard: adv.char now flows into blockCount above, so a placed
  //  glyph tile — an ASCII tile or an undecoded emoji — draws its glyph on a thin SLAB / cube through the block
  //  path, never a lifted billboard. Only an ART-LESS asset (adv.char '' + no image) continues below to the
  //  labeled/cycle/per-type glyph drawers; a unit renders via drawIsoEntity — the one billboard exception, §4.)

  // (a labeled composition cell was already drawn at the TOP of this function — per-label baked image + colour.)

  // Generated multi-cell assets carry a cell-part label → draw each cell as ONE
  // glyph (the cell IS the tile). The layered art below is for legacy single-cell,
  // manually-placed assets only.
  if (asset.label) {
    drawIsoLabeledCell(ctx, x, y, asset, tileH)
    return diamondGeom(tileW, tileH, poseMapper({ x, y }, undefined, tileH)) // one glyph on the cell diamond
  }

  // Authored animation cycles (author panel) OVERRIDE static type rendering with the live
  // frame — applies to ANY asset the user animated. No cycles → normal rendering below.
  const cycleArt = assetCycleFrame(asset.cycles, time)
  if (cycleArt) {
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(cycleArt[0] ?? '?', x, layerY)
    return billboardGeom(tileW, lineHeight, poseMapper({ x, y: layerY }, undefined, tileH))
  }

  // Legacy per-type ASCII prop art: pick the drawer for this type (default → the art-glyph plate). Fires only
  // under ASCII / a kind with no baked tile — emoji resolved a tile in the `adv.image` branch above.
  const drawAscii = ISO_ASCII_DRAWERS[asset.type] ?? drawIsoDefaultAscii
  drawAscii(ctx, asset, { x, y, tileW, tileH, fontSize, lineHeight, time, flicker, groundContact })

  // Per-type ASCII sprites (tree/lamp/bush/npc/flower/rock/default) draw a STACK of glyph layers rising from
  // the cell. Record a billboard covering that stacked art so the picker + highlight hug the visible sprite,
  // not the flat ground cell under it — the same inversion the block/billboard branches above return.
  const [halfW, layers] = perTypeStackBounds(asset.type, tileW)
  return billboardGeom(halfW * 2, layers * lineHeight, poseMapper({ x, y: y - (layers * lineHeight) / 2 }, undefined, tileH))
}


// Debug overlay rendering
export function renderDebugOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  toScreen: (wx: number, wz: number) => { x: number; y: number },
  cellSize: number,
  labels = true, // false → COLLISION-ONLY overlay (red tint on blocked cells, no coords/labels/player tag)
  // Diamond half-extents. render() passes its ALREADY-ZOOMED tileW/tileH (cellSize·isoScale·zoom·…) so the
  // red diamonds fill each cell edge-to-edge at any zoom. The defaults reproduce the old UNZOOMED formula
  // (off grid.isoScale) for callers/tests that don't pass a zoom — back-compat, but they under-fill zoomed.
  tileW = cellSize * grid.isoScale * 0.71,
  tileH = cellSize * grid.isoScale * 0.36,
) {
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Per-cell TILESET LABEL: the asset caption where a cell carries a placed element, else the terrain
  // autotile label computed PER VISIBLE CELL (not a whole-grid rebuild — that was the debug perf sink).
  const assetCaps = labels ? assetCaptionByCell(grid.getVisibleAssets(Math.floor(player.x / cellSize), Math.floor(player.z / cellSize), 30, 20)) : new Map()

  // Pass 1: collision tint + per-cell coords + the cell's <TYPE> <POSITION> label (fit to the diamond)
  for (let rz = 0; rz < tilesZ; rz++) {
    for (let rx = 0; rx < tilesX; rx++) {
      const col = Math.floor(startCol + rx)
      const row = Math.floor(startRow + rz)

      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const worldX = col * cellSize
      const worldZ = row * cellSize
      const p = toScreen(worldX, worldZ)

      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) continue

      const isBlocked = grid.isBlocked(col, row)
      // tileW/tileH are the render's own (zoomed) diamond half-extents, so the tint matches the ground-tile
      // diamond + the building-footprint cube EXACTLY at any zoom — blocked cells GLUE edge-to-edge, no gaps.

      if (isBlocked) {
        // Red overlay for collision
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - tileH)
        ctx.lineTo(p.x + tileW, p.y)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x - tileW, p.y)
        ctx.closePath()
        ctx.fill()
      }

      if (!labels) continue // collision-only overlay: tint blocked cells, skip the coords + label

      // Tiny coords in the cell (top-left of the diamond), so the centred label stays readable.
      ctx.font = `${Math.max(6, tileH * 0.42)}px ${ASCII_FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = isBlocked ? 'rgba(255,150,150,0.75)' : 'rgba(150,255,150,0.55)'
      ctx.fillText(`${col},${row}`, p.x - tileW * 0.42, p.y - tileH * 0.5)

      // The cell's tileset label, centred in the diamond + shrunk to fit (never overflows).
      const ac = assetCaps.get(`${col},${row}`)
      const text = ac?.text ?? terrainLabelAt(grid.groundSlugs(), col, row)
      const lc = debugLabelColors(ac?.type ?? 'terrain')
      drawCellLabel(ctx, text, p.x, p.y, tileW * 1.7, lc.fg, lc.bg)
    }
  }

  if (!labels) return // collision-only overlay ends here — no PLAYER tag

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

import { player as playerSprite } from '@/assets/ascii'
import { GridAsset, IsometricGrid, FLOOR_TYPE } from '@/engine/IsometricGrid'
import { assetCycleFrame } from '@/engine/assetAnimations'
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
import { Connector } from '@/lib/api'
import { ASCII_FONT, COMBAT_RANGE, type DayNight, type DrawVisual, ENEMY_MOVE_MS, LIGHT, applyCellTransform, isoCameraFocus, assetCaptionByCell, terrainLabelAt, collectLampGlows, type CompositionGhost, compositionGhostColors, drawCellLabel, debugLabelColors, drawFacingGlyph, drawFigureVitals, drawGroundShadow, drawWaterStep, drawHitMarker, drawHoverRing, drawNightLighting, drawPlayerArm, drawProjectileGlyph, drawConnectorMarker, drawAttackAnimFrame, drawQuestMarker, drawRangeRing, drawSelectionRing, drawStyledImage, clipToBall, clipToCone, SINGLE_TILE_FRAC, enemyInAttackReach, entityAnimFrame, entityMotion, entityRenderCell, frameImage, getPlayerArt, fillTintedGlyph, idleNow, isDeadEnemy, isDebugMode, isShowCollisions, resolveDraw, resolveAssetDraw, resolveEntityDraw, assetOverride, assetTileImage, styleTileImage, labelTileRecolor, groundDecorImage, tileImage, tintedImage, tintedGlyphSprite, treeCellSet } from './shared'
import { drawWeather, type WeatherId } from './weather'
import { resolveAssetDrawSize } from './assetDimensions'
import { resolveAssetAnimation, spriteFrame } from './assetAnimation'
import { assetDrawsSingle, assetIsTransparent, getStack, assetStackIndexer, unitStandLevel, type TileSource } from '@/engine/cellStack'
import { DEPTH_CELL_STEP, isoBlockFaces, isoDepthBox, depthCells, depthFrontExtent, isoZOffset, rotateDepthDir, spanBackmost, normalizeSpan, assetRectExtents, reachGroundQuad, rotateThicknessReach, spansCells, thicknessThins, turnFaceTexture, textureTurnForHeading, type BlockFace, type IsoDiagonal, type ThicknessReach } from './isoBlock'
import { type Orientation } from './isoOrientation'
import { cellOrienterFor, orientCellTurn, deorientCellTurn, orientedDimsForTurn, facingForTurn, wrapTurn } from './isoTurn'
import { resolveTileHeight, blockLayers, layerBlockScale } from '@/engine/tileset/tileHeight'
import { applyPose, poseDeviates } from '@/engine/tileset/pose'
import { isWaterSetLabel } from '../waterBody'
import { cubeGeom, depthBoxGeom, rectBoxGeom, billboardGeom, diamondGeom, pointInTileGeom, outlineSegments, poseMapper, tileGeomCentroid, tilesInScreenRect, type TileGeom } from './tileHit'
import { revealedRoofs, revealedShell, revealAlpha } from './roofReveal'
import { resolveTileSize, resolveTilePose } from '@/engine/tileset/tileViewSettings'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, personVariantTileId, styleTileArt, type ElementKind, type ImageVisual, type Style } from '@/game/artStyle'
import { DEFAULT_CHARACTER_ANIMATIONS, activeFrame } from '@/game/runtime/entityAnimation'


/** Per-face brightness from the global light: a face whose outward screen normal points toward the
 *  sun is brighter, one facing away dimmer. Returns a darken factor in [0.6, 1.0]. */
export function faceLight(nx: number, ny: number): number {
  const len = Math.hypot(nx, ny) || 1
  const d = (nx / len) * LIGHT.dir.x + (ny / len) * LIGHT.dir.y // -1 (away) .. 1 (toward)
  return 0.6 + 0.4 * (d * 0.5 + 0.5)
}


// ════════════════════════════════════════════════════════════════════════════
// INVERTED TILE PICK, record the geometry of every drawn tile, then hit-test IT
// The selector picks the TILE the user visually points at (transform-aware) and cascades to its cell, // NOT the flat ground cell. render() RECORDS each drawn asset's real screen silhouette (tileHit geoms,
// computed at the draw site so they can NEVER drift from the draw) into this per-frame list, in draw order
// (back→front). The picker walks it front→back (topmost first) so the tile you SEE on top wins an overlap.
// ════════════════════════════════════════════════════════════════════════════

/** One recorded rendered tile: its cell, its `level` (heightLevel, used by internal anchors like the lamp
 *  glow), its `stackIndex` (its slot in the cell's ordered stack, the per-tile identity the SELECTION uses so
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
   *  any other, it records its billboard silhouette here so a click on the figure selects the unit (not the
   *  floor under it). Absent for asset/floor tiles. */
  entityId?: string
}

// The tiles drawn by the LAST render(), in draw order. The RAF loop refreshes this every frame, so a pick on
// mousemove/mousedown reads current geometry. Reset at the top of the asset loop.
let isoTileHits: TileHit[] = []

/** EVERY recorded tile whose silhouette contains (x,y), TOPMOST (last-drawn) FIRST, the frontmost is the
 *  pick; the rest are occluded behind it (click-to-cycle reaches them). Canvas-internal pixels. */
export function pickIsoTilesAt(x: number, y: number): TileHit[] {
  const hits: TileHit[] = []
  for (let i = isoTileHits.length - 1; i >= 0; i--) {
    if (pointInTileGeom(x, y, isoTileHits[i].geom)) hits.push(isoTileHits[i])
  }
  return hits
}

/**
 * Draw something WITHOUT letting it disturb the hit record the map's picker reads back.
 *
 * `render` resets `isoTileHits` and repopulates it as it draws, and `pickIsoTilesAt` / `renderedTilesInRect`
 * read that array to turn a mouse position into a tile. So anything that renders a DIFFERENT grid through
 * the same function, a preview thumbnail, most obviously, leaves the picker pointing at a grid the user
 * cannot see, and the next click on the map resolves against it. This restores the array afterwards, which
 * is enough because `render` REPLACES it rather than mutating in place.
 *
 * A preview is a picture, not a surface you can click, so it has no business owning the hit record.
 */
export function withoutIsoRecording<T>(draw: () => T): T {
  const saved = isoTileHits
  try {
    return draw()
  } finally {
    isoTileHits = saved
  }
}

/** The frontmost recorded tile under (x,y), or null (the caller then falls back to the flat ground cell). */
export function pickIsoTileAt(x: number, y: number): TileHit | null {
  return pickIsoTilesAt(x, y)[0] ?? null
}

/** Every recorded tile whose silhouette centroid is inside the screen rect, the block-aware MARQUEE query
 *  (the shift+drag box's tiles), de-duped, topmost first. Canvas-internal pixels, like pickIsoTilesAt. */
export function renderedTilesInRect(x0: number, y0: number, x1: number, y1: number): TileHit[] {
  return tilesInScreenRect(isoTileHits, x0, y0, x1, y1)
}

/** The recorded silhouette of the tile at (col,row,level) drawn this frame, TOPMOST first, so an internal
 *  anchor (the lamp glow) outlines the ACTUAL rendered tile by its heightLevel. null = not drawn. */
export function isoRecordedGeom(col: number, row: number, level: number): TileGeom | null {
  for (let i = isoTileHits.length - 1; i >= 0; i--) {
    const t = isoTileHits[i]
    if (t.col === col && t.row === row && t.level === level) return t.geom
  }
  return null
}

/** The recorded silhouette of the tile at (col,row) that sits at STACK INDEX `stackIndex`, the per-tile
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
// CAMERA TURN, HORIZONTAL rotation of the iso camera, continuous, settling on the 4 corners (#75)
// / "we can rotate the corners, 4 corners, 4 rotation options, all faces of the map are visible", because "tiles
// that aren't in the front side from the camera perspective are hard to select, specially with collisions on", and
// then: "when rotating i want to see the animation of the world rotating … Ideally, I should have a controller that
// allows me to rotate more accurately, with the current 4 options as the quick turnarounds".
//
// So the camera carries a TURN in quarter-turns (isoTurn), not just a corner: a WHOLE turn IS an `Orientation`
// and runs today's exact integer maths; a fractional turn is the transient a drag/settle animation passes
// through. The iso PROJECTION is untouched, a turned camera rotates the WORLD coord into the VIEW FRAME first
// (isoTurn.cellOrienterFor) and then projects it, which is what swings a different map corner to the front.
// Turn 0 short-circuits everywhere, so an un-turned frame is byte-identical.
// ════════════════════════════════════════════════════════════════════════════

/** The turn a render() uses when its params omit `cameraTurn`/`cameraFacing`, driven by the `__setCameraTurn`
 *  debug seam until the editor UI owns it in React state and passes the param (an explicit param always wins).
 *  ONE source of truth: the facing accessors below are just this value read at its nearest corner. */
let currentCameraTurn = 0

/** The camera turn (quarter-turns, 0..4) a param-less render() will use. */
export function isoCameraTurn(): number {
  return currentCameraTurn
}

/** Turn the camera to `turn` quarter-turns (any real; wrapped onto 0..4). The editor's RAF loop redraws every
 *  frame, so the next frame shows it, driving this from an animation frame IS the rotation animation.
 *  Returns the wrapped turn so a caller/seam can echo it. */
export function setIsoCameraTurn(turn: number): number {
  currentCameraTurn = wrapTurn(turn)
  return currentCameraTurn
}

/**
 * QUARTER-TURNS FROM A PICTURE'S OWN FRAME TO THE GRID'S.
 *
 * A tile is authored as a flat top-down square: +x east, +y south. The iso top face is handed to the texture
 * as `eA` (the a→b edge, pointing NORTH) and `eB` (the a→d edge, pointing EAST), so the two frames differ by
 * one quarter-turn and any art that names a grid direction has to carry it. `textureTurnForHeading` already
 * does, as the `+ 1` in it.
 */
const PICTURE_TO_GRID = 1

/** The camera CORNER a param-less render() is at/nearest, a whole turn is exactly its facing. */
export function isoCameraFacing(): Orientation {
  return facingForTurn(currentCameraTurn)
}

/** Turn the camera to `facing` (quarter-turns CW, 0-3), the instant 4-way jump the nav buttons drive today.
 *  A facing IS a whole turn, so this writes the same state the continuous turn does. */
export function setIsoCameraFacing(facing: Orientation): Orientation {
  setIsoCameraTurn(facing)
  return isoCameraFacing()
}

/** Window debug/validation seam, the `__setDepth` / `__setShape` family, installed from the render itself
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
 *  map dims, an odd corner SWAPS cols/rows, so clamping a turned non-square map with the world dims would
 *  throw the camera clean off it. Turn 0 → exactly today's `clampCamera ? isoCameraFocus(…) : raw`.
 *  Exported so the editor's screen→cell inverse can reuse the SAME focus the render draws with (one source of
 *  truth, the click and the pixels must not drift apart).
 *
 *  MID-TURN the clamp dims follow the NEAREST corner (`orientedDimsForTurn`): the map's on-screen silhouette
 *  between corners is a rotated rectangle, which `isoCameraFocus`'s diamond clamp doesn't model. The cost is a
 *  small camera shift at the 45° crossover on a NON-SQUARE map in clamped (game) mode only, the editor, where
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
  // any facing). The drag PAN (`panCol`/`panRow`) is a SCREEN-fixed gesture, the camera rotates the map, not
  // the controls, so it is applied AFTER, UN-rotated: a drag pans the map the same direction at every facing.
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

/**
 * THE PROJECTION'S LATTICE, in whole pixels, derived once.
 *
 * Stepping one column moves the screen point by exactly `tileW` and one row by exactly `tileH`, so these two
 * numbers ARE the grid. They are rounded because a 1:1 `drawImage` onto whole pixels is a straight copy while
 * a fractional destination resamples every pixel, which measured as a third of the frame (docs/PERFORMANCE.md
 * §4.1). The camera's own contribution is rounded ONCE into the origin, which is what leaves the per-cell part
 * whole: a cell's offset from any other cell is an integer multiple of the lattice.
 *
 * ONE DEFINITION, because the render and the click both project. Snapping only the render moved the pixels
 * off the unsnapped projection by ~0.2px per cell, which is invisible next to the hero and about ten pixels
 * out at the far corner of a 100-wide map, and the selection outline is drawn from the other one.
 */
export function isoLattice(cam: IsoFlatCamera): { tileW: number; tileH: number; originX: number; originY: number } {
  const tileW = Math.max(1, Math.round(cam.cellSize * cam.isoScale * 0.71))
  const tileH = Math.max(1, Math.round(cam.cellSize * cam.isoScale * 0.36))
  return {
    tileW,
    tileH,
    originX: Math.round(cam.w / 2 - (cam.fc - cam.fr) * tileW),
    originY: Math.round(cam.h / 2 - (cam.fc + cam.fr) * tileH),
  }
}

/** WORLD cell → the screen point the render draws its diamond CENTRE at, the forward flat projection, kept
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
  const { tileW, tileH, originX, originY } = isoLattice(cam)
  return { x: originX + (v.col - v.row) * tileW, y: originY + (v.col + v.row) * tileH }
}

/** Screen (canvas-internal px) → the WORLD cell under it, the EXACT inverse of isoWorldCellToScreen: invert
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
  // The EXACT inverse of the snapped forward projection above. Inverting the unrounded formula instead would
  // put a click a fraction of a cell off, growing with distance from the camera, and land on the neighbour.
  const { tileW, tileH, originX, originY } = isoLattice(cam)
  const a = (x - originX) / tileW
  const b = (y - originY) / tileH
  const viewCol = (a + b) / 2
  const viewRow = (b - a) / 2
  if (Number.isInteger(turn)) return deorientCellTurn(Math.floor(viewCol), Math.floor(viewRow), cols, rows, turn)
  const world = deorientCellTurn(viewCol, viewRow, cols, rows, turn)
  return { col: Math.floor(world.col), row: Math.floor(world.row) }
}

/** A WORLD depth axis as the rotated view sees it. `DEPTH_CELL_STEP` maps every IsoDiagonal to a grid step
 *  (dc,dr), and one camera quarter-turn carries a grid step the same way it carries a coord, so the two use
 *  the identical rotation and can never disagree. Facing 0 → the same dir (no lookup).
 *  A IsoDiagonal is one of 4 discrete diagonals with no continuous form, so mid-turn it follows the NEAREST
 *  corner, see `isoDepthComparatorFor` for what that quantisation costs. */
function viewDepthDir(dir: IsoDiagonal, facing: Orientation): IsoDiagonal {
  return facing === 0 ? dir : rotateDepthDir(dir, facing)
}

/** The asset AS THE ROTATED VIEW SEES IT: its directional axes, `spanAxis` (z-width span) and `zDir`
 *  (z-position slide), are WORLD grid axes, so a rotated camera must carry them CW by the same quarter-turns
 *  the coords take, or a spanned/slid tile would point off-grid the moment you rotate. This is general to
 *  EVERY depth-box asset (a roof is just the common one). Facing 0, or no axes → the SAME object, untouched. */
function orientAssetForView(asset: GridAsset, facing: Orientation): GridAsset {
  // Nothing to turn: no span axis, no slide direction, and no face pulled in. Asked of the VALUES, so a
  // reach map that states four untouched faces is still nothing to turn.
  if (facing === 0 || (!asset.spanAxis && !asset.zDir && !thicknessThins(asset.thickness))) return asset
  return {
    ...asset,
    spanAxis: asset.spanAxis && rotateDepthDir(asset.spanAxis, facing),
    zDir: asset.zDir && rotateDepthDir(asset.zDir, facing),
    // THICKNESS reaches are world axes too: a door thin toward its wall must stay thin toward THAT wall when
    // the camera turns. Without this it would thin toward whatever the viewer currently calls "front", the
    // exact defect the directional thickness exists to fix.
    thickness: asset.thickness && rotateThicknessReach(asset.thickness, facing),
  }
}

/** Everything render() needs to draw one iso frame. Required: the ctx, the viewport (w, h), the grid,
 *  the player, and the clock. Everything else is optional and defaults to an empty/neutral value, a bare
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
  /** Weather laid over the frame after the night pass (render/weather.ts). Absent → clear. */
  weather?: WeatherId
  attackReach?: number
  style?: Style
  clampCamera?: boolean
  targetId?: string | null
  hoverId?: string | null
  selectedCells?: ReadonlySet<string>
  hoveredCell?: { col: number; row: number; stackIndex?: number } | null
  /** Armed Tile-composition placement ghost, a translucent footprint drawn at the hover cell before the click. */
  ghost?: CompositionGhost | null
  /** PLAYER-CAMERA RANGE (radius in cells): when set, only elements within this many cells of the player
   *  render, and a ring is drawn around the player at that edge. Undefined/≤0 = off (today's full window). */
  playerViewRange?: number
  /** Which of the map's 4 corners the camera looks from, quarter-turns CW. 0 (the default) is the historical
   *  iso view and renders identically to before; 1/2/3 swing the map horizontally so a different side faces
   *  the camera. A facing IS a whole `cameraTurn`; this is the instant-jump shorthand the 4 nav buttons use. */
  cameraFacing?: Orientation
  /** The camera's CONTINUOUS turn in quarter-turns (0..4, wrapping), what a drag controller animates. A WHOLE
   *  value is exactly `cameraFacing` and renders the identical frame; between corners the world visibly
   *  rotates. Wins over `cameraFacing` when both are given. Omitted → `cameraFacing`, else the
   *  `__setCameraTurn` debug seam's current value (0 until it's called). */
  cameraTurn?: number
  /**
   * Draw the renderer's own on-screen text, the `Pos:` / `Grid:` readout and the debug banner.
   *
   * True (the default) is the editor and the game. False is for anywhere this render is a PICTURE of the
   * world rather than the world itself: a preview thumbnail, a minimap. `renderTopView` has carried this
   * flag since the minimap needed it; without the same flag here, every isometric preview came out with
   * "Pos: 84, 84" burned across it.
   */
  chrome?: boolean
  /**
   * Draw the hero, or only USE them as the camera. Default true.
   *
   * Every renderer frames on `player`, so a caller that wants a camera position has had to invent a
   * player, and got one DRAWN into the picture. That is why every tile, object and preset preview had
   * the hero standing in the middle of it. Where the camera looks and what gets drawn are two
   * questions, so they are two parameters.
   */
  showPlayer?: boolean
}

/** Draw the composition-placement GHOST in ISO: each occupied cell gets a translucent tinted diamond on the
 *  ground (the footprint = "how many blocks"), a faded top diamond raised by the composition's height, and
 *  the vertical edges between them, a see-through massing box so you sense the volume before you click.
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
    // Ground footprint diamond, filled + crisp outline (the primary "these cells" read).
    ctx.fillStyle = fill
    ctx.strokeStyle = edge
    ctx.beginPath(); ctx.moveTo(gt.x, gt.y); ctx.lineTo(gr.x, gr.y); ctx.lineTo(gb.x, gb.y); ctx.lineTo(gl.x, gl.y); ctx.closePath(); ctx.fill(); ctx.stroke()
    // Raised top diamond + vertical edges, a faded wireframe volume so you sense the massing/height.
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
    weather = 'clear',
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
    chrome = true,
    showPlayer = true,
  } = params
  installCameraSeams() // __setCameraTurn / __setCameraFacing …, idempotent, no draw side effects
  // The camera's continuous turn, and the CORNER it is nearest. Everything positional reads `turn`; the few
  // decisions with no continuous form (a span's diagonal axis, the clamp dims) read `facing`.
  const turn = wrapTurn(cameraTurn)
  const facing = facingForTurn(turn)
  const __isoT0 = perfNow() // perf probe, rolling avg of render() ms, exposed on window.__isoRenderMs
  // QA seam, like `__isoRenderMs` and `__cameraFacing`: the live grid, so a Playwright probe can read what
  // the renderer is ACTUALLY holding (a cell's flow, a tile's height) instead of inferring it from a
  // screenshot., this is what makes the analysis conclusive.
  ;(globalThis as unknown as { __nebulithGrid?: unknown }).__nebulithGrid = grid
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
  // way to the top/bottom corners, the old combined (pPad+qPad)/2 col/row clamp kept the whole
  // rect inside the diamond but stopped the camera pPad short of the bottom/top rows (#38). p is
  // then clamped to the diamond's width AT THAT HEIGHT so the sides stay inside it.
  // Clamp the camera to the map ONLY in game mode (predefined zooms, no drag). In dev mode the clamp
  // fought drag-to-pan, the system couldn't decide when to limit, so there the camera pans freely.
  // The focus is resolved IN THE VIEW FRAME (isoViewFocus): rotated by `facing`, then clamped against the
  // ORIENTED dims, so a rotated non-square map still clamps to its real on-screen extent. Facing 0 collapses
  // to exactly the previous `clampCamera ? isoCameraFocus(…) : raw` line.
  // Player focus is oriented/clamped; the drag PAN (camOffset) is applied un-rotated so drag is screen-fixed.
  const { fc, fr } = isoViewFocus(player.x / cellSize, player.z / cellSize, camOffset.x / cellSize, camOffset.y / cellSize, pPad, qPad, grid.cols, grid.rows, turn, clampCamera)
  const camX = fc * cellSize
  const camZ = fr * cellSize

  // The diamond's half-width and half-height, and the camera's rounded origin: the whole projection, in whole
  // pixels, from the ONE definition the click and the selection outline also use (`isoLattice`).
  //
  // SNAP THE LATTICE, NOT EACH TILE. Rounding each tile's own destination buys the same fast blit, but
  // adjacent tiles then cross their rounding boundaries at different moments as the camera pans, so the seam
  // between two cells opens and closes by a pixel and the ground shimmers while you walk. Rounding the
  // lattice constants keeps every relative distance exact, so nothing moves relative to anything else.
  const { tileW, tileH, originX, originY } = isoLattice({ w, h, cellSize, isoScale, fc, fr })
  const heightStep = Math.max(1, Math.round(cellSize * isoScale * 0.4))  // Height per elevation level

  // The FIXED iso projection of a VIEW-frame coord (center of diamond tile), unchanged by rotation.
  // A tile asks with WHOLE col/row and lands on a whole pixel; the hero asks with a fractional one and keeps
  // moving smoothly, which is the half of this that must NOT be snapped.
  const viewToScreen = (col: number, row: number) => ({
    x: originX + (col - row) * tileW,
    y: originY + (col + row) * tileH,
  })
  // Convert WORLD to screen. A rotated camera turns the world coord into the view frame first, that ONE hook
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
  // QA seam beside `__nebulithGrid`: the frame's cell->pixel projection and its tile size. A probe that finds
  // an undrawn pixel can then name the CELL responsible instead of guessing from the picture.
  ;(globalThis as unknown as { __nebulithProject?: unknown }).__nebulithProject = { toScreen, tileW, tileH, heightStep }
  // …AND WHAT WAS ACTUALLY DRAWN, which is already recorded for the picker.
  //
  // A probe that reads PIXELS has to tell a canopy from a lawn by hue, and both are green: measured, a
  // crown's "lowest pixel" came back as the grass under the tree and a floating canopy reported a
  // healthy overlap. This is the draw's own geometry, the same list the selector hit-tests against, so
  // it can never drift from what was drawn and needs no colour guessing at all.
  ;(globalThis as unknown as { __nebulithDrawn?: unknown }).__nebulithDrawn = isoTileHits

  // ─── GROUND: nothing special here anymore ──────────────────────────
  // Floors are ordinary level-0 tiles in grid.assets (thin colored slabs), they flow through the SAME
  // per-asset draw loop below as every wall/prop. There is NO separate ground layer / offscreen cache.

  // Zoom-aware visible range: derive the half-span from the ACTUAL (zoomed) tile size, so we iterate
  // exactly the cells (and thus floor/prop assets) the camera can see, fewer zoomed in, more zoomed out.
  const halfSpan = Math.ceil((w / tileW + h / tileH) / 2) + 4

  ctx.globalAlpha = 1

  // ─── THE GRID'S OWN BODY, the thick RPG base ─────────────────────
  //
  // The map's thickness belongs to the GRID, not to each floor tile. That is the whole point of the split: a
  // floor is a flat skin with no side faces (so it never occludes and never needs a turn in the depth sort),
  // and the volume you see under the map is drawn once, here, underneath everything.
  //
  // ONLY THE SKIRT IS DRAWN. A solid slab's interior walls are each hidden by the cell in front of them, so
  // the only ones that can ever be seen are at the map's outer edge (and around any hole). That is ~400 edge
  // cells on a 100x100 instead of 10,000 cubes, which is why this costs nothing while a cube per cell cost
  // everything. Each wall takes its own cell's floor colour, darkened, so the earth under grass reads as
  // earth and the bed under a river reads as riverbed, with no new backend data.
  // ─── ASSETS + PLAYER (ASCII art stacked in isometric space) ────────

  // Zoom-aware cull: use the SAME span the camera can see (matches the ground tiles above),
  // so zooming OUT reveals more of the map's elements instead of a fixed 30×20 window, at
  // full zoom-out the span covers the whole map, so every element shows.
  // camX/camZ are the camera in the VIEW frame, but the grid indexes WORLD cells, so turn the focus back
  // (deorientCell) before asking what's visible, or a rotated camera would cull the wrong corner of the map.
  // The window is a square centred on it, so rotating the CENTRE is all it takes. Facing 0 → today's floor().
  const camCell = turn === 0
    ? { col: camX / cellSize, row: camZ / cellSize }
    : deorientCellTurn(fc, fr, grid.cols, grid.rows, turn)
  // THE RANGE, before the skirt: the map body has to obey it too, or the cull only hides the things ON the
  // map and leaves the map itself. `pcol`/`prow` are read below for the asset cull; they are the same numbers.
  const skirtRange = typeof playerViewRange === 'number' && playerViewRange > 0
    ? { col: player.x / cellSize, row: player.z / cellSize, cells: playerViewRange }
    : undefined
  drawGridSkirt(ctx, grid, toScreen, tileW, tileH, Math.floor(camCell.col), Math.floor(camCell.row), halfSpan, heightStep, facing, w, h, skirtRange)

  const rectAssets = grid.getVisibleAssets(
    Math.floor(camCell.col),
    Math.floor(camCell.row),
    halfSpan * 2, halfSpan * 2
  )
  // PLAYER-CAMERA RANGE: when set, only elements within `playerViewRange` cells of the PLAYER render, a
  // radial cull (measured from the hero, so it matches the ring drawn around them), restoring the old fixed
  // render window as a controllable setting. Undefined/≤0 = off → today's zoom-derived window, byte-identical.
  const pcol = player.x / cellSize, prow = player.z / cellSize
  const rangeOn = typeof playerViewRange === 'number' && playerViewRange > 0
  // RANGE IS A GRID TEST, NOT A PER-TILE ONE.
  // A tile is in range when ANY GRID CELL IT COVERS is, so a long road/grass run stays visible while the ring
  // crosses it, instead of vanishing whenever its anchor happens to sit outside. ONE rule for every tile: a
  // depth-less tile covers just its own cell, so this is the plain cell test for everything else.
  // THE CELLS A TILE COVERS, all of them.
  //
  // This used to expand a tile with `depth` + `spanAxis` only, which is ONE of the four pathways a tile spans: it
  // ignored `spanBack` (cells behind the anchor), `spanPerp` and `spanPerpBack` (the perpendicular axis). So
  // a 2-axis tile was range-tested on a line through the middle of itself and vanished whenever that line fell
  // outside while the rest of it did not. His words: *"my guess is that the range is cutting at the cell level
  // only not at the tile level, and some cell have tiles that spand multiple cells"*.
  //
  // `assetRectExtents` already folds all four into one rectangle and is unit-tested, so this asks it rather
  // than growing a second model of the same thing.
  const coveredCells = (a: GridAsset): { col: number; row: number }[] => {
    const { colMinus, colPlus, rowMinus, rowPlus } = assetRectExtents(a)
    if (colMinus === 0 && colPlus === 0 && rowMinus === 0 && rowPlus === 0) return [{ col: a.col, row: a.row }]
    const out: { col: number; row: number }[] = []
    for (let c = a.col - colMinus; c <= a.col + colPlus; c++) {
      for (let r = a.row - rowMinus; r <= a.row + rowPlus; r++) out.push({ col: c, row: r })
    }
    return out
  }
  const tileInRange = (a: GridAsset): boolean =>
    coveredCells(a).some(c => withinPlayerRange(c.col, c.row, pcol, prow, playerViewRange!))

  /**
   * THE RANGE DECIDES THE GRID, so a tile that only PARTLY reaches into it is CUT DOWN to the part that does.
   *
   * *"range should determine the grid, whatever is on range, defined the cells from the grid we care about,
   * anything outside of that we don't care, we shouldn't see ANYTHING nor render ANYTHING not in range"*.
   *
   * `tileInRange` keeps a tile when ANY cell of it is in range, and the renderer then draws the WHOLE tile. A
   * floor is not one asset per cell: measured, 161 of 172 floors on a forest are `depth` runs and the longest
   * covers 33 cells. So one run touching the ring painted a green band clear across the map, which is exactly
   * what he photographed.
   *
   * Keeping a tile whole is right for the SCREEN cull, where a long run genuinely is visible. It is wrong for
   * the range, which is a statement about what exists. So a spanning tile is shortened here: the anchor moves
   * to the first covered cell inside the range and the span is trimmed to the last one. A single-cell tile is
   * untouched, and with no range on nothing is cloned at all.
   */
  const clipToRange = (a: GridAsset): GridAsset => clipAssetToRange(a, pcol, prow, playerViewRange!)
  // GLOBAL RANGE, the browser's visible area, always on. and
  //
  // That was right that something was off, though not where it looked. The rectangle above IS derived from the
  // viewport, but as a SQUARE in cell space sized by a mixed average, `(w/tileW + h/tileH)/2 + 4`. On a
  // 1500x950 canvas that is a half-span of 58, i.e. 116x116 = 13,456 cells, while the screen actually shows an
  // iso DIAMOND of roughly 2,800. So for any map up to 116x116 the "cull" removed nothing at all and every
  // tile was sorted and drawn, on screen or not.
  //
  // This is the real one: project the cells a tile covers and keep it only if any of them can land on the
  // canvas. Written as the SAME per-tile shape as the player range, so a long z-width run stays visible while
  // any part of it is on screen, the rule set for the other range ("the range should actually work
  // on per cell … on roads we use 1 block with lots of z-width").
  // The margins are the CELL'S OWN EXTENT, not a chosen multiple of it: a cell's diamond reaches exactly
  // ±tileW horizontally and ±tileH vertically from its centre, so a cell further out than that cannot put a
  // pixel on screen. Derived, so there is no number here anyone has to justify or tune.
  const marginX = tileW
  const marginTop = tileH
  const onScreen = (a: GridAsset): boolean => {
    // A tile draws UPWARD from its cell, so one below the bottom edge is visible when it is tall enough to
    // reach back into view, its own rise is the exact margin, no guessing at a worst case.
    const rise = isoStackLift(tileW, a.heightLevel) + assetBlockRise(a) * tileW * ISO_BLOCK_H_FRAC
    return coveredCells(a).some(c => {
      const pt = toScreen(c.col, c.row)
      if (pt.x < -marginX || pt.x > w + marginX) return false
      return pt.y - rise <= h + tileH && pt.y >= -marginTop
    })
  }
  const __isoTCull = perfNow()
  const onScreenAssets = rectAssets.filter(onScreen)
  const visibleAssets = rangeOn ? onScreenAssets.filter(tileInRange).map(clipToRange) : onScreenAssets
  // WHAT EACH CULL THREW AWAY, published like `__isoRenderMs`.
  //
  // *"sometimes maps would stop showing the floor, specially when zoomed in"*. A floor that is missing was
  // either never fetched, culled, or drawn as nothing, and those are four different bugs that look identical on
  // screen. Counting them separately is what names it, the same way instrumenting the DRAW found the navy hole
  // after five pixel detectors had each been wrong differently.
  ;(globalThis as unknown as { __isoCull?: Record<string, number> }).__isoCull = {
    halfSpan,
    inGrid: grid.assets.length,
    inGridFloors: grid.assets.reduce((n, a) => n + (a.type === FLOOR_TYPE ? 1 : 0), 0),
    inRect: rectAssets.length,
    inRectFloors: rectAssets.reduce((n, a) => n + (a.type === FLOOR_TYPE ? 1 : 0), 0),
    onScreen: onScreenAssets.length,
    onScreenFloors: onScreenAssets.reduce((n, a) => n + (a.type === FLOOR_TYPE ? 1 : 0), 0),
    visible: visibleAssets.length,
    visibleFloors: visibleAssets.reduce((n, a) => n + (a.type === FLOOR_TYPE ? 1 : 0), 0),
  }
  // Ground shadow goes ONLY on a tree's bottom (ground-contact) cell, see isGroundContact. The
  // tree-cell Set is memoized (treeCellSet) so we don't rescan every asset + realloc each frame.
  const treeCells = treeCellSet(grid)
  const isTreeCell = (c: number, r: number): boolean => treeCells.has(`${c},${r}`)

  // Sort all objects by depth (back to front). Placed entities depth-sort with
  // assets/player and draw as glyphs on top of their cell.
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  // A BUILDING is just TILES: a pre-built building is stamped as its composition's per-cell assets (like a
  // tree cell), so its walls/windows/door/roof flow into the draw list through the SAME `asset` path as any
  // stacked tile, no building-specific collect/filter/drawer, and no grouped-building array to read.
  // Cells that carry STANDING content, a non-floor tile (prop/wall/tree/rock) or a unit. A raised z-width FLOOR
  // run must NOT front-extent over these: they sit ON the run, so the run has to stay BEHIND them (a floor is the
  // ground under everything). Built once per frame; a run then suppresses its extent if its span touches one.
  const standingCells = new Set<string>()
  for (const a of visibleAssets) if (a.type !== FLOOR_TYPE) standingCells.add(`${a.col},${a.row}`)
  for (const e of entities) standingCells.add(`${e.col},${e.row}`)
  // A raised FLOOR run takes the front-extent ONLY when it is BARE. A run that carries a prop/unit on its span
  // keeps its anchor sort (like before) so the thing on top stays drawn over it, trading a little of the run's
  // own completeness for never occluding what sits on it. A bare run still draws complete.
  const runFrontExtentRise = (a: GridAsset): number | undefined => {
    if (!(a.spanForward > 1 && a.spanAxis)) return undefined
    const rise = assetBlockRise(a)
    if (rise < 1) return rise // a flat run, front-extent gate is off anyway; report the true rise
    const bare = !depthCells(a.col, a.row, a.spanForward!, a.spanAxis).some(c => standingCells.has(`${c.col},${c.row}`))
    return bare ? rise : 0 // carries something on top → sort by anchor (rise 0 = no front-extent)
  }
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset; blockRise?: number; entity?: Entity; moving?: boolean; inRange?: boolean }[] = [
    // blockRise = the run's SORT-EFFECTIVE rise, resolved ONLY for a z-width box (the one tile the depth-sort
    // front-extent reads). A height-1 meadow/water FLOOR run reads rise ≥ 1 → takes the front-extent so a BARE
    // raised curb draws complete; a flat town road run reads < 1 → keeps its anchor. A raised
    // run that CARRIES a prop/unit on its span reports 0 here so it stays behind that content (see runFrontExtentRise).
    // The raw asset rides untouched so the draw + identity-keyed stack index are unchanged.
    ...visibleAssets.map(a => ({
      col: a.col, row: a.row, asset: a,
      blockRise: runFrontExtentRise(a),
    })),
    // The player ENTITY is drawn as the live sprite below (isPlayer), so skip it here
    // to avoid a ghost double at the spawn cell. (Top view keeps it, see renderTopView.)
    // A non-player unit is an element too, so the player-camera range culls it like any tile (the player
    // themselves is always drawn, they are the centre of the range).
    ...entities.filter(e => e.kind !== 'player')
      .filter(e => !rangeOn || withinPlayerRange(e.col, e.row, pcol, prow, playerViewRange!))
      .map(e => {
        const pos = entityRenderCell(e, now) // smooth, deterministic interpolation (motionPos)
        const mot = entityMotion.get(e.id)
        const moving = !!mot && now < mot.startMs + ENEMY_MOVE_MS // mid-interpolation → walk anim
        const inRange = e.kind === 'enemy' && Math.hypot(e.col - pCol, e.row - pRow) <= COMBAT_RANGE
        return { col: pos.col, row: pos.row, entity: e, moving, inRange }
      }),
    // The hero, unless the caller only wanted the camera (see `showPlayer`).
    ...(showPlayer
      ? [{
          col: player.x / cellSize,
          row: player.z / cellSize,
          isPlayer: true,
        }]
      : []),
  ]
  // back-to-front, then bottom-up within a stacked cell (higher blocks over lower), keyed on the ORIENTED
  // coord so occlusion stays correct from whichever corner the camera looks. Turn 0 → isoDepthCompare itself.
  const __isoTSort = perfNow()
  allObjects.sort(isoDepthComparatorFor(allObjects, grid.cols, grid.rows, turn))
  const __isoTDraw = perfNow()

  // Render each object with ASCII art style
  const playerIsTarget = !!targetId && entities.some(e => e.kind === 'player' && e.id === targetId)
  const playerIsHover = !!hoverId && entities.some(e => e.kind === 'player' && e.id === hoverId)
  // Proximity reveal is a GENERIC per-tile behavior now, NO building special case, no grouped-building read.
  // Any asset whose tile opted into settings.fadeNear eases translucent as the hero closes in, and
  // settings.cutawayRoof lifts the tile off entirely, each computed from the asset's OWN cell distance in the
  // draw loop below (fadeNearAlpha / cutawayAlpha). So a tree-leaf tile carrying fadeNear fades exactly like a wall.
  isoTileHits = [] // fresh per-frame record of every drawn tile's silhouette, the inverted picker reads it
  const stackIndexOf = assetStackIndexer(grid) // per-frame memo: an asset → its slot in its cell's stack (0 = base/floor)
  // ROOF REVEAL (Diablo / Path of Exile), POSITIONAL, not proximity: the hero is under a roof or they are not.
  // Every `cutawayRoof` tile offers its covered footprint; the CONNECTED roof over the hero's cell comes off as
  // ONE piece (a roof is many z-width column blocks, lifting just the one overhead would punch a hole), and the
  // walls/windows/doors of that same shell (`fadeNear`) ease translucent so the interior actually reads.
  // OUTSIDE a building nothing fades: the old distance ease ghosted every wall the hero walked past while the
  // roof stayed solid.
  const roofTiles = visibleAssets.filter(a => a.settings?.cutawayRoof)
  const roofFootprints = roofTiles.map(a => grid.rectCoveredCells(a).map(c => `${c.col},${c.row}`))
  // NO HERO, NO REVEAL. The Diablo-style cutaway exists because the player walked INSIDE a building; a
  // preview has no player, only a camera parked on the subject, and treating that as "standing inside"
  // faded every wall it was asked to show.
  const liftedRoofs = showPlayer ? revealedRoofs(Math.floor(pCol), Math.floor(pRow), roofFootprints) : new Set<number>()
  const roofsOff = new Set<GridAsset>(Array.from(liftedRoofs, i => roofTiles[i]))
  const shellCells = revealedShell(roofFootprints, liftedRoofs)
  // The player is drawn from PlayerState (no id); its selectable id lives on the player ENTITY in `entities`.
  const playerEntityId = entities.find(e => e.kind === 'player')?.id
  // A UNIT is just a tile the picker returns: record the figure's billboard silhouette so a click ANYWHERE on
  // the sprite (feet to head) selects the unit (source 'entity'), instead of the floor under it. `cx` = sprite
  // centre-x, `footY` = the sprite's base. The silhouette spans a touch below the feet up to the head, a
  // generous, uniform box so both the hero and NPCs are fully clickable. stackIndex -1 = "not a cell-stack slot".
  const recordUnitHit = (col: number, row: number, cx: number, footY: number, entityId: string): void => {
    const bottom = footY + tileH * 0.6      // just under the feet
    const top = footY - tileH * 4.8         // up past the head of a standing figure
    // A unit's position is CONTINUOUS (`player.x / cellSize`, or the interpolated `entityRenderCell` while it
    // walks) but a tile hit is keyed by CELL INDEX, and the pick's col/row becomes the selection KEY, which
    // later frames re-parse into the cell-indexed grid APIs. Convert at this boundary so no fraction escapes.
    isoTileHits.push({ col: Math.floor(col), row: Math.floor(row), level: 0, stackIndex: -1, source: 'entity', entityId, geom: billboardGeom(tileW * 1.7, bottom - top, poseMapper({ x: cx, y: (bottom + top) / 2 }, undefined, tileH)) })
  }
  // Draw ONE unit (hero / npc / enemy): its figure + its pick silhouette. Called in PASS 2 below, so a unit
  // renders ON TOP of the map tiles (never hidden behind one, z-index: the unit is the interactive focus) and
  // its recorded silhouette lands LAST, so a click on the figure always wins the pick.
  const drawUnit = (obj: { col: number; row: number; isPlayer?: boolean; entity?: Entity; moving?: boolean; inRange?: boolean }, p: { x: number; y: number }, heightOffset: number): void => {
    if (obj.isPlayer) {
      const inHandSlash = attackAnims.find(a => a.inHand && now - a.start < a.durationMs)
      const swingP = inHandSlash ? Math.min(1, (now - inHandSlash.start) / inHandSlash.durationMs) : null
      const footY = p.y - heightOffset - (player.jumpHeight ?? 0)
      // IS HE STANDING IN WATER? Asked of the FLOOR it is on, by its tile, which is the same way every other
      // reader answers a question about a cell. A puddle and a wadeable shallow both count: they are the two
      // places you can be on foot and still be in water.
      const underfoot = grid.floorAt(obj.col, obj.row)?.tileKey ?? ''
      const feetWet = underfoot.includes('water')
      drawIsoPlayer(ctx, p.x, footY, tileW, tileH, player, time, swingP, inHandSlash?.tint, style, playerIsTarget, playerIsHover, feetWet)
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
  // ONE PASS, tiles AND units, in the single depth order `allObjects` already carries. A unit is a tile, so
  // perspective decides what covers what: a wall nearer the camera hides the figure behind it, and the figure
  // hides what stands behind IT. (Units used to draw in a separate later pass, which painted them over every
  // tile, the hero standing on a roof it was actually behind.) A unit that wants to sit above its
  // surroundings does it the same way any tile does: with a higher z-index, not with a privileged pass.
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer || obj.entity) {
      // A UNIT stands on the cell's GROUND (`unitStandLevel`), not on the top of everything in it. Raising the
      // ground still lifts it, a height-1 meadow or a walk-over road carries the hero up, the same lego math
      // every tile reads (so the #28 "walks THROUGH the floor" bug stays fixed). What it does NOT do is lift a
      // unit onto STRUCTURE: a doorway cell holds the whole facade column above the doorstep, and taking the
      // stack top there drew the hero on the ROOF instead of inside the house.
      const floorLift = isoStackLift(tileW, unitStandLevel(grid, Math.floor(obj.col), Math.floor(obj.row)))
      drawUnit(obj, p, heightOffset + floorLift)
      continue
    }

    if (obj.asset) {
      // A BUILDING is JUST tiles: walls, windows, doors AND the roof all render per-cell through this one
      // generic path. The roof is a STACK of roof blocks forming a peaked gable (buildingCellTiles →
      // gableRoofLevels), so it needs no special cap drawer, the SAME stacked tiles project to a triangle
      // (2D front), a 3D gable (iso), and the footprint rectangle (top), like any other stacked tile.
      // Live TILE ANIMATION overrides for THIS frame (settings tweens), scoped to the iso view + active style.
      // null when the asset has no animations / none in scope → the effective asset IS obj.asset (byte-identical).
      const anim = resolveAssetAnimation(obj.asset, time, style, 'iso', dayNight)
      // colour/zoom/width/height overlaid onto the draw, then the asset's WORLD depth axes turned into the
      // view frame so a z-width span (a roof) rotates WITH the grid instead of pointing off it.
      const drawAsset = orientAssetForView(anim ? anim.asset : obj.asset, facing)
      let op = obj.asset.opacity // per-asset opacity for contrast/depth
      // GENERIC reveal behavior: ANY asset whose tile opted into cutawayRoof/fadeNear answers to the hero's
      // POSITION, not their distance. Inside the building: its roof is skipped entirely and its shell eases to
      // INTERIOR_SHELL_ALPHA. Outside: both draw at full opacity.
      const fx = obj.asset.settings
      // …and ONLY when there is a hero to be near. Both behaviours answer to the hero's position, so with
      // no hero they have no question to answer: a preview parks a camera on the subject, and reading that
      // as "the hero is standing right here" faded every wall the preview existed to show.
      if (showPlayer && (fx?.cutawayRoof || fx?.fadeNear)) {
        // INSIDE = the hero is under this roof, or this shell tile belongs to the revealed building. A revealed
        // ROOF is skipped outright; everything else eases by `revealAlpha`, solid far away, translucent as the
        // hero closes in (so the facade and its door read), and dropped right back once inside.
        const inside = fx.cutawayRoof ? roofsOff.has(obj.asset) : shellCells.has(`${obj.asset.col},${obj.asset.row}`)
        if (fx.cutawayRoof && inside) continue
        const dist = Math.hypot(pCol - obj.asset.col, pRow - obj.asset.row)
        op = Math.min(op, revealAlpha({ dist, inside, minAlpha: fx.minAlpha }))
      }
      if (anim) op *= anim.opacity // animated opacity fades the drawn tile (multiplies base + proximity alpha)
      if (op < 1) ctx.globalAlpha = op
      // STACK: lift this tile `heightLevel` blocks up so the pile climbs in iso. This is the WHOLE lift, // there is no floor-shaped extra term and no "floor stack lift". A tile's level
      // already accounts for everything beneath it, floor included, because `stackTop` (cellStack) assigns it
      // as `level + own height` over the cell's tiles, so raising a floor tile lifts what sits on it for free.
      const stackLift = isoStackLift(tileW, obj.asset.heightLevel)
      // "z position" (per-asset zOffset): SLIDE the tile along an ISO DIAGONAL, NOT a vertical lift. zOffset is
      // the magnitude in cells; zDir picks the diagonal (default right-up), so +z slides TOWARD it (right-up =
      // up-right toward the back) and −z toward its opposite, landing on the neighbouring diamond exactly like
      // z-width's per-cell step. 0 (every generated/existing asset) → no-op.
      // The slide axis is a WORLD diagonal, so it turns with the camera, a slid tile stays on the cell it slid to.
          // A TILE WITH NO SLIDE DIRECTION DOES NOT SLIDE. `slide_direction` is nullable with no default, so
      // absence is its value; naming one here was the renderer deciding which way a tile leans.
      const zMove = obj.asset.zDir
        ? isoZOffset(obj.asset.zOffset ?? 0, viewDepthDir(obj.asset.zDir, facing), tileW, tileH)
        : { dx: 0, dy: 0 }
      // Animated screen shift: `x` slides right, `y` LIFTS up (screen-space up is −Y), in tile fractions. 0 when
      // not animated → the anchor is unchanged.
      // A CELL'S CURRENT IS NOT AN OFFSET. I first projected the flow onto the screen axes here, on the
      // belief that the drift was a draw offset. It is not: `animShiftX` moves the tile's ANCHOR, so an offset
      // slides the water off its own cell. `fillIsoFaceWithTile` draws a floor through `ctx.transform(eA, eB)`,
      // so a shift inside the TEXTURE already lands along an iso axis, and the four headings are just ±x and
      // ±y in texture space. The direction is therefore chosen by picking the animation, in `tileAnimations`,
      // not by moving anything here.
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
        // ONE selector system for EVERY tile, floors included, no special case: record the tile's ACTUAL drawn
        // silhouette (`geom`) at its cell/level/stack-slot, exactly like the trunk/wall/prop. A z-width run floor
        // is ONE tile, so it records ONE box (its drawn depth-box) and selects/hovers as that box, the SAME
        // validated selector, not a parallel per-cell floor path.
        isoTileHits.push({ col: obj.asset.col, row: obj.asset.row, level: obj.asset.heightLevel, stackIndex: stackIndexOf(obj.asset), source: 'asset', geom })
      }
    }
  }

  ctx.globalAlpha = 1
  // (Units are drawn in the single depth-sorted loop above, no separate later pass, so perspective governs
  //  them like every other tile. No post-loop roof CAP either: the roof is per-cell stacked tiles.)

  // PLAYER-CAMERA RANGE RING, the visible edge of the render range, drawn around the player. A circle of
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

  // Travelling projectiles (arrow/bullet/bolt), lerp along their path in iso space. The
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
    // so use its OWN recorded silhouette centroid (this frame's draw), the pool then sits ON the glowing bulb
    // instead of `tileH*1.5` off the ground. Off-screen / not-drawn bulb → null → the old cellCenter-lift anchor.
    const bulbAnchor = (a: GridAsset) => {
      const g = isoRecordedGeom(a.col, a.row, a.heightLevel)
      return g ? tileGeomCentroid(g) : null
    }
    const lamps = collectLampGlows(grid, (c, r) => toScreen(c, r), tileW, tileH * 1.5, w, h, { time, style, view: 'iso' }, bulbAnchor, entities)
    drawNightLighting(ctx, w, h, lamps)
  }

  // ─── WEATHER, on the MAP's own floor, over everything the night pass left.
  // So the view hands over the four
  //     drawn corners of the ground plane, and the rain falls on THAT instead of over the whole canvas.
  //     In iso the map is a diamond and `toScreen` lands on a cell's centre, so its corners are the four corner
  //     CELLS. Through `toScreen` they follow the camera's turn, so rain stays on the map however it is spun.
  drawWeather(ctx, w, h, weather, time, {
    corners: [
      toScreen(0, 0),
      toScreen(grid.cols - 1, 0),
      toScreen(grid.cols - 1, grid.rows - 1),
      toScreen(0, grid.rows - 1),
    ],
  })

  // ─── DEBUG MODE ────────────────────────────────────────────────────

  if (isDebugMode()) {
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, true, tileW, tileH, heightStep)
  } else if (isShowCollisions()) {
    // Collision-only overlay: same red diamonds as debug, no coords/labels. Pass the render's ZOOMED
    // tileW/tileH so the diamonds fill each cell edge-to-edge (not the unzoomed grid.isoScale default).
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize, false, tileW, tileH, heightStep)
  }

  // ─── CONNECTOR MARKERS, ON TOP OF THE MAP ───────────────────────────
  //
  // *"whenever there's a RULE or a trigger or something similar on a given cell/tile, show visual indicators,
  // right now thre's nothing that tells me the exits have the template go to triggers/rule"*.
  //
  // They were drawn BEFORE the grid body and before every asset, so the map and everything standing on it
  // painted straight over them. A marker under the floor is not a marker. They belong with the other
  // overlays, after the world and before the highlight, which is where they are now.
  //
  // A connector with NO TARGET reads differently: every exit is born wired but unaimed, so an amber ring says
  // "this leads somewhere, you have not said where" while a solid purple one says it is pointed at a level.
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col, pcell.row)
      const drawY = p.y - grid.getHeight(pcell.col, pcell.row) * heightStep
      // UNAIMED READS DIFFERENTLY. Every exit arrives with a connector and no target, because the target is
      // the one thing that cannot be inferred, so amber means "this leads somewhere, you have not said where"
      // and purple means it is pointed at a level.
      const aimed = !!connector.targetTemplateId
      ctx.fillStyle = aimed ? 'rgba(180, 80, 255, 0.6)' : 'rgba(255, 176, 32, 0.5)'
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()
      // And an outline, so a marker still reads against a busy floor.
      ctx.strokeStyle = aimed ? 'rgba(210, 140, 255, 0.95)' : 'rgba(255, 208, 96, 0.95)'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.font = `bold ${tileH * 1.1}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      // Portal marker is a TILE now: 🌀 under a reskin, ◊ under ASCII, over the purple diamond backing.
      drawConnectorMarker(ctx, style, p.x, drawY, tileH * 2)
    }
  }


  // ─── Hover + selection HIGHLIGHT, INVERTED: outline the ACTUAL rendered TILE (its transformed cube /
  //     billboard, from the frame's recorded geometry, resolved by the tile's STACK INDEX so same-level tiles
  //     hug their OWN silhouettes) so the ring hugs what the user points at, never the flat ground cell. A bare
  //     cell region (no stack index), or a tile not drawn this frame, falls back to the flat ground cell cube.
  const strokeCellOrTile = (col: number, row: number, stackIndex: number | undefined): void => {
    const geom = stackIndex !== undefined ? isoRecordedTileGeom(col, row, stackIndex) : null
    if (geom) { strokeTileOutline(ctx, geom); return } // the real tile silhouette (scaleY/pose/zOffset/depth-aware)
    // Fallback: the flat ground cell cube (a bare cell region, or a selected tile not drawn this frame, the
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

  // Cell/tile-hover outline, a DIM ring on the tile under the cursor, drawn UNDER the yellow selection.
  if (hoveredCell) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1.5
    strokeCellOrTile(hoveredCell.col, hoveredCell.row, hoveredCell.stackIndex)
  }

  // Selection outline (property-editor multi-select), a yellow ring hugging each selected tile/cell.
  if (selectedCells.size > 0) {
    ctx.strokeStyle = '#ffff00'
    ctx.lineWidth = 2
    for (const key of selectedCells) {
      // "col,row,stackIndex" = a recorded TILE (hug its silhouette); "col,row" = a bare cell region (flat fallback).
      const [col, row, stackIndex] = key.split(',').map(Number)
      strokeCellOrTile(col, row, Number.isFinite(stackIndex) ? stackIndex : undefined)
    }
  }

  // Armed-composition GHOST, a translucent footprint at the hover cell (drawn last so it reads over the scene).
  if (ghost) drawCompositionGhostIso(ctx, ghost, toScreen, tileW, tileH, heightStep)

  // ─── UI ───────────────────────────────────────────────────────────

  if (chrome) {
    ctx.fillStyle = '#ffffff'
    ctx.font = `14px ${ASCII_FONT}`
    ctx.textAlign = 'left'
    ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
    ctx.fillText(`Grid: ${Math.floor(player.x / cellSize)}, ${Math.floor(player.z / cellSize)}`, 10, 50)

    if (isDebugMode()) {
      ctx.fillStyle = '#ff4444'
      ctx.fillText('DEBUG MODE', 10, 70)
    }
  }

  const __isoMs = perfNow() - __isoT0
  isoRenderMsEMA = isoRenderMsEMA === 0 ? __isoMs : isoRenderMsEMA * 0.9 + __isoMs * 0.1
  // WHERE THE FRAME WENT, beside the total. "Rendering is slow" is three different problems: deciding
  // what is visible, ordering it, and actually painting it, and they have nothing in common. Published
  // as a rolling average like the total, so a probe reads a settled number rather than one frame's noise.
  if (typeof window !== 'undefined') {
    const phases = (window as unknown as { __isoPhases?: Record<string, number> }).__isoPhases ?? {}
    const ease = (was: number | undefined, now: number): number => (was === undefined ? now : was * 0.9 + now * 0.1)
    ;(window as unknown as { __isoPhases?: Record<string, number> }).__isoPhases = {
      setup: ease(phases.setup, __isoTCull - __isoT0),
      cull: ease(phases.cull, __isoTSort - __isoTCull),
      sort: ease(phases.sort, __isoTDraw - __isoTSort),
      draw: ease(phases.draw, perfNow() - __isoTDraw),
      objects: allObjects.length,
    }
  }
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
    const start = line.length - line.trimStart().length // skip leading spaces, block hugs the glyphs
    const end = line.trimEnd().length
    if (end > start) {
      const blockH = lineHeight * 0.78 // skinnier than the full line, the backing hugs the glyph row
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
  /** The feet are in water (ticket 14): steps ripple and the shadow distorts. Off → unchanged. */
  inWater: boolean = false,
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // The hero does NOT bob: the old sin() breathe made the figure loop up-and-down and read as FLOATING
  // (NPCs never bobbed, so it also made the hero inconsistent with them). Kept as a named 0 so the body,
  // weapon and vitals still share one anchor origin, re-enabling is a one-line change.
  const breathe = 0

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // Armor tint: steel-blue when wearing gear, warm yellow otherwise, the figure visibly
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
  // Ground shadow sized to the player figure (always reads; fixed, doesn't bob).
  drawGroundShadow(ctx, x, groundY, pHalf, inWater ? time : undefined)
  if (inWater) drawWaterStep(ctx, x, groundY, pHalf, time) // rings spreading from the feet
  if (isTarget) drawSelectionRing(ctx, x, groundY, pHalf * 0.8) // red target reticle at the feet
  else if (isHover) drawHoverRing(ctx, x, groundY, pHalf * 0.8) // dim white hover reticle

  // Robust block figure, same recipe as entities + trees; `breathe` bobs the whole figure. When
  // attacking, HIDE the static arm on the swinging side (the animated swing-arm below replaces it) so
  // we never draw two arms (#47/#39).
  const swingArmDir = player.facing === 'left' ? -1 : 1
  // During a swing, base the figure on the IDLE pose (predictable arm) and HIDE the facing-side arm
  // bracket, the swing-arm below (the SAME bracket glyph, just rotated) replaces it. (#47/#67)
  const figArt = swingP == null
    ? playerArt
    : playerSprite.idle.map(row => (swingArmDir > 0 ? row.replace('>', ' ') : row.replace('<', ' ')))
  const pdv = resolveDraw('player', style, personVariantTileId(player.variant, style), '', bodyColor)
  // Under an emoji/image style the ACTIVE animation frame drives what's drawn (idle/walk/run), data, not
  // hardcoded. The frame resolves to a baked image (the base tile or an override tile) OR a glyph, honouring
  // its flipX, so the authored walk/idle actually PLAYS instead of freezing on the static base image. ASCII
  // (no image, empty char) keeps its block-figure sprite below (which animates via getPlayerArt).
  // The drawn figure's HEAD (top edge in screen y), set by whichever branch draws, so the vitals bar hugs
  // the REAL sprite top (emoji billboard vs ascii block figure differ) instead of a phantom ascii-height lift.
  let headY: number
  if (pdv.image || pdv.char) {
    const pf = activeFrame(player.animations ?? DEFAULT_CHARACTER_ANIMATIONS, { char: pdv.char }, { moving: player.moving, facing: player.facing, running: player.running ?? false }, time)
    const pfImg = frameImage(pf, pdv.char, pdv.image, style)
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
      // NO INK, NO GLYPH. A figure whose draw resolved no colour is not painted in a colour chosen
      // here; the callers below hand this one a real role colour, so the branch is unreachable, and an
      // unreachable literal is still a literal.
      if (pdv.color) {
        ctx.fillStyle = pdv.color
        drawFacingGlyph(ctx, genderize(pf.char ?? pdv.char, player.variant), x, cy, pf.flipX)
      }
      ctx.textAlign = 'left'
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      headY = cy - glyphPx * 0.5
    }
  } else {
    drawBlockFigure(ctx, figArt, x - pHalf, baseY - breathe, lineHeight, charW, bodyColor, bodyBg)
    // Block figure stacks rows UP from baseY; the top row's centre sits (len-1) rows up, its top edge a half
    // row higher, that edge is the head the bar hugs (matching the emoji billboard's top).
    headY = baseY - breathe - (playerArt.length - 1) * lineHeight - lineHeight * 0.5
  }

  // The held weapon + the shield, both at the ARM row. The weapon sits on the FACING hand; the
  // shield on the OFF-hand (the side OPPOSITE the weapon) at the SAME arm height, so they never
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

  // Life bar + name above the head, the SAME treatment enemies get (drawFigureVitals), so the
  // player reads identically. Drawn only once HP is mirrored onto the struct (see the game loop).
  if (player.maxHp != null) {
    const barWidth = Math.max(28, tileH * 2.2)
    const nameSize = Math.max(9, tileH * 0.95)
    drawFigureVitals(ctx, x, headY, barWidth, 7, nameSize, barFraction(player.hp ?? player.maxHp, player.maxHp), playerDisplayName(player.name))
  }
}


/** Apex signage (a "STORE" marquee, a "HOSPITAL" word) drawn above a cell's apex at (x, apexY). GENERIC:
 *  driven by the tile's own `settings.badge` ({text,color}), NOT a buildingType lookup, so any tile that
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
  // measureText(), the canvas-2D layout call that tanked iso FPS on dense (forest) stages.
  const w = char.length * fontSize * 0.6
  // A cell carrying apex signage FILLS solid (its darkened tint) so the word reads over it; every other
  // labeled cell keeps the plain dark backing behind its glyph. No `type:'building'` special case.
  // Signage fills with the cell's own darkened colour so the word reads over it; a cell with no colour
  // keeps the plain dark backing rather than one invented here.
  ctx.fillStyle = asset.settings?.badge && asset.color ? darkenColor(asset.color, 0.28) : 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x - w / 2 - 2, cy - fontSize * 0.55, w + 4, fontSize * 1.1)
  if (!asset.color) return // no ink, no glyph
  ctx.fillStyle = asset.color
  ctx.fillText(char, x, cy)

  // Apex signage, driven GENERICALLY by settings.badge (not buildingType). Only the one apex tile per
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
  // cadence when the player is in range, built on top of the existing base/alt art.
  const art = entityAnimFrame(entity, now, moving, inRange)
  // Same scale as drawIsoPlayer, so NPCs/monsters stand as tall as the player
  // (a 3-row figure ≈ 2 cells tall), not a squished 1×1.
  const fontSize = tileH * 1.2
  const lineHeight = tileH * 1.4
  const baseY = y - lineHeight * 0.5
  // LEFT-align all rows on a shared origin (monospace advance ≈ 0.6em) so the figure's
  // shape holds together, centering each row independently mangles real ASCII art.
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
  // (male→🧍‍♂️, old→🧓, …), both baked images. A brush-placed unit's manual `tileOverride` RE-HOMES onto
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
  // OR a glyph, honouring flipX, so a moving person actually animates instead of freezing on the base
  // image. ASCII (no image, empty char) keeps its block-figure sprite below.
  const anims = entity.animations ?? (isEnemy ? undefined : DEFAULT_CHARACTER_ANIMATIONS)
  // The drawn figure's HEAD (top edge in screen y), set by whichever branch draws, so the vitals bar +
  // quest marker hug the REAL sprite top (emoji billboard vs ascii block figure differ) instead of the
  // phantom ascii-height lift that floated the bar cells above the emoji.
  let figureTop: number
  if (edv.image || edv.char) {
    const ef = activeFrame(anims, { char: edv.char }, { moving, facing: 'down', running: false }, now)
    const efImg = frameImage(ef, edv.char, edv.image, style)
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
      // NO INK, NO GLYPH. A figure whose draw resolved no colour is not painted in a colour chosen
      // here; the callers below hand this one a real role colour, so the branch is unreachable, and an
      // unreachable literal is still a literal.
      if (edv.color) {
        ctx.fillStyle = edv.color
        drawFacingGlyph(ctx, genderize(ef.char ?? edv.char, entity.variant), x, cy, ef.flipX)
      }
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
  // DAMAGED; an idle distant enemy is just its self-identifying glyph (💀/🦇/🕷️), click it for the
  // Inspector. Standard action-RPG behaviour: bars appear on engagement/damage, not always-on.
  const frac = hpFraction(entity, combat)
  if (frac >= 0.999 && !inRange && !attackable) return { x, y: figureTop - lineHeight * 0.5 }
  const barWidth = Math.max(28, tileH * 2.2)
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, tileH * 0.95)
  return drawFigureVitals(ctx, x, figureTop, barWidth, 7, nameSize, frac, label)
}


// Interior reveal (Diablo / Path of Exile), a GENERIC per-tile behavior driven by settings.cutawayRoof /
// settings.fadeNear, not building-only. The bands and the alpha maths live in ./roofReveal (`revealAlpha`):
// solid far away, easing translucent as the hero approaches so the facade and its door read, and the roof off
// with the shell dropped right back once the hero is inside. Re-exported here because this is the render seam
// the tests and the page read.
export { INTERIOR_SHELL_ALPHA, APPROACH_ALPHA, APPROACH_RADIUS } from './roofReveal'


// ISO facing. Each building stands inside its plot RECT, cols [col, col+L] × the clear headroom
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
 * Fill an iso FACE by tiling a TILE across it, SHEARED to the face, the ONE place a tile
 * (an emoji glyph now, an image sprite later) becomes an iso-angled texture. The face is the
 * parallelogram `origin + [0,1]·eA + [0,1]·eB` (eA = the bottom edge vector, eB = the up/side
 * edge vector). We push a CTM built from (eA, eB, origin) scaled into a 64×64 work box, so a
 * unit tile maps onto the parallelogram and every glyph/image inherits the shear, clip to the
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
  // `color` is the GLYPH's ink and is optional: a tile that states none draws its image, and a tile with
  // neither an image nor ink draws nothing rather than a colour this renderer picked.
  tv: { char?: string; color?: string; image?: ImageVisual; tintTo?: string; turns?: number }, // tintTo → recolour a colour-emoji GLYPH; turns → quarter-turn the TEXTURE
  na: number,
  nb: number,
  tint?: string, // an editor floor-colour override → recolour the tile image (#80)
): void {
  const S = 64 // work-box side; keeps font px normal under the shear CTM (no sub-pixel fonts)
  const cols = Math.max(1, Math.round(na))
  const rows = Math.max(1, Math.round(nb))
  const cw = S / cols
  const ch = S / rows
  // TURN THE PICTURE, NOT THE FACE. `turns` permutes the two basis vectors (turnFaceTexture), so the same
  // four corners are covered and only what the texture SHOWS rotates. This is how a river's current follows
  // its channel with ONE baked frame set instead of four (see turnFaceTexture's note). 0 → byte-identical.
  const t = tv.turns ? turnFaceTexture(origin, eA, eB, tv.turns) : { origin, eA, eB }
  // THE SHEAR ITSELF. Each branch below sets up its own state, so the face that needs no clip does not pay
  // for one, and a tile with neither an image nor a glyph pushes nothing at all.
  const shear = (into: CanvasRenderingContext2D, ox: number, oy: number) =>
    into.transform(t.eA.x / S, t.eA.y / S, t.eB.x / S, t.eB.y / S, ox, oy)
  // Image tile if its raster is ready; otherwise fall back to the glyph so the face is NEVER blank. This is
  // NO LONGER a pre-load placeholder, the loader gate decodes every baked image before the first frame
  // (tilesetLoader → preloadTileImages), so on a fresh load this always takes the image path; the glyph only
  // covers a genuinely failed/missing raster AFTER load (graceful degradation, a backend data gap).
  const img = tv.image ? tileImage(tv.image.src) : null
  if (img) {
    // PERF: an image scaled to (0,0,S,S) fills the sheared box EXACTLY, i.e. this face, so it can never
    // spill past it. The per-face ctx.clip() (a real hotspot at ~thousands of building-cube faces/frame) is
    // therefore redundant for the image path and is skipped; only the overfilling GLYPH path still clips.
    const drawSrc = tint ? tintedImage(img, tv.image!.src, tint) : img
    const sx = tv.image!.sx ?? 0
    const sy = tv.image!.sy ?? 0
    const sw = tv.image!.sw ?? img.naturalWidth
    const sh = tv.image!.sh ?? img.naturalHeight
    ctx.save()
    shear(ctx, t.origin.x, t.origin.y)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(drawSrc, sx, sy, sw, sh, i * cw, j * ch, cw, ch)
    ctx.restore()
    return
  }
  if (tv.char) {
    ctx.save()
    shear(ctx, t.origin.x, t.origin.y)
    ctx.beginPath()
    ctx.rect(0, 0, S, S)
    ctx.clip()
    // A colour-emoji ignores fillStyle, so a per-building roof colour can't be applied with fillText, when
    // `tintTo` is set (the roof), shear a RECOLOURED sprite instead so the roof 🟥 reads the roof's own hue.
    const sprite = tv.tintTo ? tintedGlyphSprite(tv.char, Math.max(cw, ch), tv.tintTo) : null
    if (sprite) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.drawImage(sprite, 0, 0, sprite.width, sprite.height, i * cw, j * ch, cw, ch)
    } else {
      if (!tv.color) { ctx.restore(); return } // no ink: the image path above already drew, or there is nothing to draw
      ctx.fillStyle = tv.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `${Math.min(cw, ch) * 1.16}px ${ASCII_FONT}` // slight overfill; the clip trims the excess
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ctx.fillText(tv.char, (i + 0.5) * cw, (j + 0.5) * ch)
    }
    ctx.restore()
  }
}




// The default iso BLOCK height (screen px) of ONE stack level, one cube tall. drawIsoTileBlock draws
// a default-dim cube exactly this tall (its `bh` base is tileW * 0.9), so lifting a stacked asset by
// this per level makes the pile climb in lockstep with the cubes (and with the 2D raised stack).
/**
 * THE GRID'S BODY, the thick base under the whole map.
 *
 * The
 * resolution that unblocked everything:
 *
 * The map's THICKNESS is the grid's, not each tile's. A floor tile is a flat skin (height 0) so it has no side
 * faces, occludes nothing, and needs no place in the depth sort, which is what lets ground merge into z-width
 * runs at all. The volume you see under the map is this, drawn once, under everything.
 *
 * ONLY THE SKIRT EXISTS. A solid slab's interior walls are each hidden by the cell in front of them, so the
 * only walls that can ever be seen are where the map STOPS, its outer edge, and the rim of any hole. So this
 * draws a wall only where the neighbour it would face is missing: ~400 edge cells on a 100x100 rather than
 * 10,000 cubes, which is the difference between free and ruinous.
 *
 * Which neighbour faces which wall follows the projection: +col steps right-down and +row steps left-down, so
 * the RIGHT wall is hidden by (col+1, row) and the LEFT wall by (col, row+1).
 */
export function drawGridSkirt(
  ctx: CanvasRenderingContext2D,
  grid: IsometricGrid,
  toScreen: (col: number, row: number) => { x: number; y: number },
  tileW: number,
  tileH: number,
  camCol: number,
  camRow: number,
  halfSpan: number,
  /**
   * On-screen height of ONE elevation level, `cellSize * isoScale * 0.4`, the same number the tile draw lifts
   * a cell by. It is NOT this function's `blockH` (`tileW * ISO_BLOCK_H_FRAC`, which works out ~1.6x larger):
   * a cliff drawn at the block scale would not meet the ground tile it holds up, and every step would show a
   * seam. The slab keeps `blockH`, because that is the body's own look and it is unchanged.
   */
  heightStep: number,
  /** Which corner the camera is at. Every face below is drawn on a FIXED SCREEN edge, so the grid neighbour
   *  it has to ask about turns with the camera. Without this the skirt closed the wrong two sides of every
   *  step and the real ones were left open to the background. */
  facing: Orientation = 0,
  /**
   * THE CANVAS, so a cell that cannot put a pixel on it is skipped before it is measured.
   *
   * The loop walks the camera's SQUARE window, which on a map smaller than that square is the whole map, so
   * every cell paid for its neighbour lookups every frame whether or not it was anywhere near the screen.
   * Measured on a 100x60 city at maximum zoom out: 6,000 cells walked per frame, about 2,300 of them on
   * screen, and only the map's rim and its cliffs drawing anything at all.
   *
   * Omitted (0) means no screen cull, which is what every existing caller and test gets.
   */
  canvasW = 0,
  canvasH = 0,
  /**
   * THE PLAYER RANGE, when one is on. The skirt is the map's BODY: the earth slab under the ground and the
   * walls at its edges. It was drawn for every cell in the camera window and never asked about the range, so
   * with the range on the elements vanished and the whole map body stayed, which is exactly what he saw:
   * *"it looks like it's fake, like it only hides stuff that it's there, instead of actually conditionally
   * rendering when inside range"*. The body IS the map, so leaving it drawn is what made the cull look like
   * a mask laid over a finished picture.
   *
   * Undefined or <= 0 means no range, and every cell in the window draws exactly as before.
   */
  range?: { col: number; row: number; cells: number },
): void {
  // The grid step that currently PROJECTS toward a given screen diagonal. At facing 0 down-right is +col and
  // down-left is +row; a quarter turn of the camera turns all four, so the base step turns the opposite way.
  const stepAt = (base: readonly [number, number]): readonly [number, number] => {
    let [dc, dr] = base
    for (let i = 0; i < ((facing % 4) + 4) % 4; i++) [dc, dr] = [dr, -dc]
    return [dc, dr]
  }
  const [frc, frr] = stepAt([1, 0]) // the neighbour under the screen-RIGHT face (B→R)
  const [flc, flr] = stepAt([0, 1]) // the neighbour under the screen-LEFT face (L→B)
  const [brc, brr] = stepAt([-1, 0]) // behind the screen up-LEFT edge (L→T)
  const [buc, bur] = stepAt([0, -1]) // behind the screen up-RIGHT edge (T→R)
  const off = (c: number, r: number): boolean => c < 0 || r < 0 || c >= grid.cols || r >= grid.rows

  // THE THICKNESS IS MAP DATA, `grid.slabBlocks`, served with the level and saved with it. It was a module
  // constant (`GRID_SLAB_BLOCKS = 1`) for exactly one day, which was one day too long:
  //, no, and that is the same mistake as pinning a
  // floor's height in a factory, one layer up. Zero means no body at all, and nothing draws.
  const slab = grid.slabBlocks
  const blockH = tileW * ISO_BLOCK_H_FRAC
  // NO EARLY RETURN on a missing slab any more. A map with no body still has RELIEF, and returning here would
  // have silently switched every cliff off along with it.
  const slabDrop = slab * blockH
  const c0 = Math.max(0, camCol - halfSpan)
  const c1 = Math.min(grid.cols - 1, camCol + halfSpan)
  const r0 = Math.max(0, camRow - halfSpan)
  const r1 = Math.min(grid.rows - 1, camRow + halfSpan)

  /**
   * Can this cell put a pixel on the canvas?
   *
   * The reach is DERIVED, not guessed. Sideways a cell never draws past its own diamond, so `tileW` is the
   * exact margin. Upward it can be lifted by its elevation, at most the map's tallest (`maxGroundHeight`),
   * and downward its walls hang by the slab plus the deepest cliff, which cannot exceed that same tallest
   * elevation. So the vertical margins bound every face the loop below can draw.
   */
  const reachUp = grid.maxGroundHeight() * heightStep + tileH
  const reachDown = slabDrop + grid.maxGroundHeight() * heightStep + tileH
  const offCanvas = (col: number, row: number): boolean => {
    if (canvasW <= 0 || canvasH <= 0) return false // no canvas given → no cull, exactly as before
    const p = toScreen(col, row)
    if (p.x < -tileW || p.x > canvasW + tileW) return true
    return p.y + reachDown < 0 || p.y - reachUp > canvasH
  }

  const wall = (p: { x: number; y: number }, side: 'left' | 'right', color: string, drop: number): void => {
    // The two front faces of the cell's diamond, dropped by the slab thickness. LEFT is the L→B edge
    // (facing +row), RIGHT is the B→R edge (facing +col), the same corners isoBlockFaces uses.
    const l = { x: p.x - tileW, y: p.y }
    const b = { x: p.x, y: p.y + tileH }
    const r = { x: p.x + tileW, y: p.y }
    const [from, to] = side === 'left' ? [l, b] : [b, r]
    if (drop <= 0) return
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.lineTo(to.x, to.y + drop)
    ctx.lineTo(from.x, from.y + drop)
    ctx.closePath()
    ctx.fill()
  }

  /** The two BACK faces, rising from this cell's top up to a taller neighbour behind it. `col` is the -col
   *  boundary (the L to T edge), `row` the -row one (T to R). The mirror of `wall`, which drops from the
   *  two front faces; together they close a step from either side. */
  const backWall = (p: { x: number; y: number }, side: 'col' | 'row', color: string, rise: number): void => {
    if (rise <= 0) return
    const l = { x: p.x - tileW, y: p.y }
    const t = { x: p.x, y: p.y - tileH }
    const r = { x: p.x + tileW, y: p.y }
    const [from, to] = side === 'col' ? [l, t] : [t, r]
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.lineTo(to.x, to.y - rise)
    ctx.lineTo(from.x, from.y - rise)
    ctx.closePath()
    ctx.fill()
  }

  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      // Outside the player's range the map body is not drawn at all, so what is beyond it is genuinely absent
      // rather than covered over.
      if (range && Math.hypot(col - range.col, row - range.row) > range.cells) continue
      if (offCanvas(col, row)) continue // cannot reach the screen: skip before the neighbour lookups
      const floor = grid.floorAt(col, row)
      if (!floor) continue // no ground here → nothing to hold up
      // ONLY THE MAP'S OUTER EDGE. This first asked "is the neighbouring FLOOR missing", which fired all over
      // the interior, a town's roads and plots are separate floors, so every plot edge grew a wall and the
      // grass appeared to stand a block above the road. That is the raised ground in report #29, and it was
      // this skirt, not the tile heights. The map's boundary is the grid's bounds.
      const openRight = off(col + frc, row + frr) // the neighbour under the right face is off the map
      const openLeft = off(col + flc, row + flr) // and the one under the left face

      // RELIEF. Where this cell stands ABOVE the neighbour in front of it, that difference is a CLIFF, and
      // it is visible: the note above about interior walls is true of a flat slab, where the cell in front
      // hides them, and false the moment two cells sit at different levels.
      //
      // The condition is the ELEVATION differing, never the FLOOR differing. Keying on the floor is precisely
      // what grew a wall at every plot edge and made the grass look raised above the road, which is the
      // artefact it reported in Image #29 and which the comment above records.
      const here = grid.getHeight(col, row)
      const cliffRight = openRight ? 0 : here - grid.getHeight(col + frc, row + frr)
      const cliffLeft = openLeft ? 0 : here - grid.getHeight(col + flc, row + flr)

      if (!openRight && !openLeft && cliffRight <= 0 && cliffLeft <= 0) continue // flat and interior: nothing shows
      // READ the body colour the floor was born with, never shade one here. Deriving a colour at draw time is
      // forbidden (and would recompute for every visible edge cell, every frame). A floor without one is a data
      // gap, and the rule for a gap is to draw nothing rather than invent something.
      const body = floor.sideColor
      if (!body) continue
      const p = toScreen(col, row)
      // The faces start at the cell's DRAWN top, which a raised cell reaches by its own elevation. At level 0
      // this is p exactly, so every flat map is byte-identical.
      const top = { x: p.x, y: p.y - here * heightStep }
      if (cliffLeft > 0) wall(top, 'left', body, cliffLeft * heightStep)
      if (cliffRight > 0) wall(top, 'right', body, cliffRight * heightStep)
      if (openLeft) wall(top, 'left', body, slabDrop)
      if (openRight) wall(top, 'right', body, slabDrop)

      // THE FAR SIDE OF A TRENCH.
      //
      // They are not a colour and not a tile: they are the CANVAS. `#1a1a2e` is what `render` clears with,
      // and it was showing through the map. Measured on a woodland with a two-block channel: 124,260 clear
      // pixels INSIDE the drawn map, and 173 dug cells every one of which is water, so the data was right
      // and nothing was drawing the hole shut.
      //
      // The cliffs above only face +col and +row, the two sides the camera sees on a cell that stands ABOVE
      // its neighbour. A trench is the opposite case: you are looking INTO it, and the wall you see is the
      // FAR bank's back face, on -col and -row. Nothing ever drew those, because on a flat map they are
      // hidden by the neighbour itself and it costs nothing to skip them. Dig a channel and they are the
      // only thing between you and the background.
      //
      // The wall wears the colour of the bank it belongs to, read from that neighbour's own floor, never
      // shaded here: a bank with no colour draws nothing rather than inventing one.
      const backWallTo = (dc: number, dr: number, side: 'col' | 'row'): void => {
        const nCol = col + dc
        const nRow = row + dr
        if (off(nCol, nRow)) return
        const rise = grid.getHeight(nCol, nRow) - here
        if (rise <= 0) return
        const bankBody = grid.floorAt(nCol, nRow)?.sideColor
        if (!bankBody) return
        backWall(top, side, bankBody, rise * heightStep)
      }
      backWallTo(brc, brr, 'col')
      backWallTo(buc, bur, 'row')
    }
  }
}

export const ISO_BLOCK_H_FRAC = 0.9

/** Iso screen-space RISE for a stacked asset: `heightLevel` cubes up (one ISO_BLOCK_H per level). The
 *  new brush stacks assets on a cell with heightLevel 0,1,2,… so the render lifts each entry by this, *  a 3-tall stack reads as 3 items climbing. heightLevel absent/0 (every generated/existing asset) → 0,
 *  so this is a pure no-op for non-stacked maps. Matches topdown.ts's 2D `heightLevel * tileH * 0.9`. */
export function isoStackLift(tileW: number, heightLevel: number | undefined): number {
  // Rounded PER LEVEL, so a stacked tile stays on the same whole-pixel lattice its cell sits on (see the
  // note by tileW). Rounding the total instead would put level 3 a fraction off level 1.
  return (heightLevel ?? 0) * Math.round(tileW * ISO_BLOCK_H_FRAC)
}

/** An asset's rendered RISE in blocks, `resolveTileHeight × scaleY`, resolved by the asset's KIND the SAME way
 *  the draw does (assetKind → groundKind for a floor). A generated FLOOR pins no per-instance `height`, so its
 *  rise lives on its tile: a height-1 meadow/water floor reads 1 here even though `asset.height` is undefined,
 *  which is exactly what the depth sort needs to tell a raised curb from a flat slab. Heights are style-identical
 *  (MAP-MODEL §4), so either tileset answers. Used only for the depth-sort front-extent gate. */
function assetBlockRise(a: GridAsset): number {
  // resolveTileHeight reads the PLACED block, never the art tile (heights are placement data, not art), so
  // there is nothing style-dependent to look up here, and the per-asset tileset probe this used to do ran
  // on every item of the depth sort, every frame, for a value the resolver discards.
  return resolveTileHeight(a)
}

/** Depth order for the merged iso draw list: back-to-front by the iso key (col + row), then, for two
 *  ASSETS on the SAME cell, bottom-up by heightLevel so a brush STACK composites higher blocks OVER
 *  lower ones (matching the isoStackLift rise). A non-asset tie (entity/player/building) returns 0 to
 *  keep the array's stable insertion order, so nothing but same-cell asset stacks is reordered, the
 *  no-stack case is byte-identical to the old `(a.col+a.row)-(b.col+b.row)` sort. */
export function isoDepthCompare(
  a: { col: number; row: number; blockRise?: number; asset?: { heightLevel: number; height: number; spanForward: number; spanAxis?: IsoDiagonal; spanBack: number; spanPerp: number; spanPerpBack: number; zIndex: number } },
  b: { col: number; row: number; blockRise?: number; asset?: { heightLevel: number; height: number; spanForward: number; spanAxis?: IsoDiagonal; spanBack: number; spanPerp: number; spanPerpBack: number; zIndex: number } },
): number {
  // DRAW-PRIORITY first (CSS z-index): a HIGHER zIndex draws LATER (on top / in front), overriding the
  // positional key below, a cell authored with a higher zIndex sits in front of one behind it no matter where
  // it is (a capability for composition optimization). Every cell currently defaults to 0, so `0 - 0 = 0` falls
  // straight through to the positional sort → every map (all zIndex 0) orders BYTE-IDENTICALLY to before.
  const dz = (a.asset?.zIndex ?? 0) - (b.asset?.zIndex ?? 0)
  if (dz !== 0) return dz
  // A directional-depth box reaches `depthFrontExtent` cells toward the camera past its anchor, so it sorts by
  // its FRONTMOST covered cell, a box extending toward the camera draws in front of what it overlaps. A
  // depth-less asset (every existing tile) adds 0, so the no-depth case is byte-identical to (col+row).
  const key = (o: { col: number; row: number; blockRise?: number; asset?: { spanForward: number; spanAxis?: IsoDiagonal; spanBack: number; spanPerp: number; spanPerpBack: number; heightLevel: number; height: number } }): number => {
    const dir = o.asset?.spanAxis
    // A SPAN OF ONE IS NOT A SPAN. This read `!o.asset?.spanForward`, which was a fair question while a
    // tile that spanned nothing said nothing; once every placement states its span, 1 is truthy and the
    // cheap branch became unreachable, so the whole map paid for the depth-box maths every frame.
    // Two questions, asked separately: is there an asset at all, and does it reach past its own cell.
    // The old `!o.asset?.spanForward` answered both at once, which is how the second one came to be
    // asked of a field's presence rather than its value.
    if (!dir || !o.asset || !spansCells(o.asset)) return o.col + o.row
    // Fold a BIDIRECTIONAL span into its one-way equivalent, then
    // key on the TRUE backmost cell + total length (spanBack 0/absent → unchanged). The front-extent (sort by the
    // FRONTMOST covered cell) is only correct for a box that OVERHANGS what it covers, a STACKED asset
    // (heightLevel ≥ 1: a roof / upper level). The GROUND (heightLevel 0) never overhangs, so it sorts by its
    // anchor and stays BEHIND the standing tiles along its span.
    const box = normalizeSpan(o.col, o.row, o.asset.spanForward, o.asset.spanBack, dir)
    const extend = Math.floor(box.span) > 1 && (o.asset?.heightLevel ?? 0) >= 1
    return box.col + box.row + (extend ? depthFrontExtent(box.span, dir) : 0)
  }
  const d = key(a) - key(b)
  if (d !== 0) return d
  if (a.asset && b.asset) return a.asset.heightLevel - b.asset.heightLevel
  return 0
}

/**
 * A SPANNING TILE, CUT DOWN TO THE PART OF IT THAT IS IN RANGE.
 *
 * *"range should determine the grid, whatever is on range, defined the cells from the grid we care about,
 * anything outside of that we don't care"*. The range test keeps a tile when ANY of its cells is in range, and
 * the renderer then draws the WHOLE tile. A floor is not one asset per cell: measured, 161 of 172 floors on a
 * forest are `depth` runs and the longest covers 33 cells, so one run touching the ring painted a green band
 * clear across the map.
 *
 * Keeping a tile whole is right for the SCREEN cull, where a long run genuinely is visible. It is wrong for
 * the range, which is a statement about what EXISTS.
 *
 * Returns the asset itself when nothing needs cutting, so a map with no spans allocates nothing.
 */
export function clipAssetToRange(a: GridAsset, pcol: number, prow: number, range: number): GridAsset {
  const dir = a.spanAxis
  if (!dir) return a
  const span = normalizeSpan(a.col, a.row, a.spanForward, a.spanBack, dir)
  if (span.span <= 1) return a
  const { dc, dr } = DEPTH_CELL_STEP[dir]
  let first = -1
  let last = -1
  for (let k = 0; k < span.span; k++) {
    if (!withinPlayerRange(span.col + k * dc, span.row + k * dr, pcol, prow, range)) continue
    if (first < 0) first = k
    last = k
  }
  if (first < 0) return a // nothing of it is in range; the range filter has already dropped it
  if (first === 0 && last === span.span - 1 && !a.spanPerp && !a.spanPerpBack) return a // wholly inside
  // The PERPENDICULAR span is dropped rather than trimmed: a 2-axis tile is a rectangle, and cutting one axis
  // while keeping the other whole leaves a strip sticking out sideways past the ring, which is the same leak
  // in a different direction. That axis is rare on ground runs and always small.
  return {
    ...a,
    col: span.col + first * dc,
    row: span.row + first * dr,
    spanForward: last - first + 1,
    spanBack: 0,
    spanPerp: 0,
    spanPerpBack: 0,
  }
}

/** Is (col,row) within `range` cells of the player, measured RADIALLY (straight-line distance, not a box)?
 *  The player-camera render cull uses this so what's drawn matches the circular ring drawn around the hero. */
export function withinPlayerRange(col: number, row: number, playerCol: number, playerRow: number, range: number): boolean {
  return Math.hypot(col - playerCol, row - playerRow) <= range
}

/** One item the iso painter sorts, the structural shape isoDepthCompare reads. */
type IsoDepthItem = Parameters<typeof isoDepthCompare>[0]

/** One sortable item AS THE TURNED VIEW SEES IT: its cell oriented, its span axis carried round with it, and
 * , the part that bites, a multi-cell span RE-ANCHORED to its backmost end. A quarter-turn can flip a span
 *  to run backward from its stored anchor, and `isoDepthCompare` assumes the anchor IS the backmost cell, so
 *  without this a merged ground run sorts as the nearest thing on screen and paints over what stands behind it. */
function orientDepthItem(
  item: IsoDepthItem,
  orient: (col: number, row: number) => { col: number; row: number },
  facing: Orientation,
): IsoDepthItem {
  // The block's RISE is turn-invariant (rotating the camera never flattens a raised block), so carry blockRise
  // through untouched, otherwise the front-extent gate would read it as flat at any facing but 0 and a raised
  // z-width floor run would occlude again the moment the camera turns.
  const { col, row } = orient(item.col, item.row)
  if (!item.asset) return { col, row, blockRise: item.blockRise, asset: item.asset }

  const dir = item.asset.spanAxis && rotateDepthDir(item.asset.spanAxis, facing)
  // Same question, same answer: one cell forward is what a tile that spans nothing occupies.
  if (!dir || !spansCells(item.asset)) return { col, row, blockRise: item.blockRise, asset: { ...item.asset, spanAxis: dir } }

  // Fold the bidirectional span (#58) in the ORIENTED frame, THEN re-anchor to the backmost for this turn. The
  // folded item carries the TOTAL depth with spanBack cleared, so isoDepthCompare's own fold is a no-op on it.
  const norm = normalizeSpan(col, row, item.asset.spanForward, item.asset.spanBack, dir)
  const back = spanBackmost(norm.col, norm.row, norm.span, dir)
  return { col: back.col, row: back.row, blockRise: item.blockRise, asset: { ...item.asset, spanForward: norm.span, spanBack: 0, spanAxis: back.dir } }
}

/** The back-to-front comparator for a camera at `turn`: isoDepthCompare's key is (col + row), which is a
 *  VIEW-frame quantity, so under rotation it must be fed the ORIENTED coord and the ORIENTED depth axis, or
 *  the painter would occlude by the old front corner and the rotated map would draw inside-out. Each item is
 *  mapped ONCE (not per comparison, which sort calls O(n log n) times) and the mapped pair is handed to the
 *  UNCHANGED isoDepthCompare, so every rule in it (z-index priority, depth front-extent, stack tie-break) keeps
 *  working. Turn 0 returns isoDepthCompare ITSELF, same function, same sort, byte-identical frame.
 *
 *  ── MID-TURN, the deliberate choice ────────────────────────────────────────────────────────────────────
 *  `col + row` is only a valid depth ORDER at a whole quarter-turn, but it is valid for a CONTINUOUS reason:
 *  the projection puts screen-y ∝ (viewCol + viewRow), so that sum IS the camera-depth of a cell at ANY angle.
 *  So mid-turn we feed isoDepthCompare the FRACTIONAL oriented coords and its key becomes exactly the
 *  continuous projected depth, the painter stays correct through the whole spin and the order flips where two
 *  tiles genuinely reach the same screen depth, not at an arbitrary threshold.
 *
 *  LIMITATION: the two DISCRETE parts have no continuous form and follow the NEAREST corner, a span's
 *  `spanAxis` (one of 4 diagonals) and therefore its backmost re-anchor + `depthFrontExtent` bonus. So while a
 *  MULTI-CELL span (a roof/merged ground run) is between corners, it is sorted by the end that will be its
 *  backmost at the corner it is heading for. It can therefore occlude wrongly against something it overlaps
 *  for at most half a quarter-turn of the transient. Single-cell tiles, every ordinary tile, are exact. */
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




/** The camera/zoom/viewport the iso projection needs, the SAME numbers render() computes:
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
  /** which store this block came from (floor/asset/building/entity), carried straight through to the
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
 *  (isoStackLift) resolves to the ground cell under that pixel, the bottom, never the block. This mirrors
 *  render()'s projection + lift to hit-test each block's on-screen footprint (its iso diamond at its lifted
 *  height) and returns the FIRST one the point falls inside, NEAREST the camera first, the draw order
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
  // THE SAME LATTICE THE RENDER DRAWS ON. This re-derived the projection unrounded, and the render's is
  // snapped to whole pixels, so the two drifted by a fraction of a pixel per cell: nothing next to the hero,
  // and enough at the far corner of a wide map to hit-test the neighbouring block.
  const { tileW, tileH, originX, originY } = isoLattice({ w, h, cellSize, isoScale, fc: camX / cellSize, fr: camZ / cellSize })
  const heightStep = Math.max(1, Math.round(cellSize * isoScale * 0.4))
  if (tileW <= 0 || tileH <= 0) return []
  // Nearest-camera-first = the reverse of render's back-to-front sort (isoDepthCompare): a higher (col+row)
  // is drawn later / on top, then a higher level within the same cell. Collect hits IN that order, so the
  // topmost VISIBLE block is first and the ones it occludes follow (front→back), the order click-to-cycle
  // walks to reach a hidden block. Hit-test EVERY provided block, including level 0, a ground-floor wall is
  // a 0-based CUBE seated on the floor and must be selectable. The CALLER decides what counts as a block (the
  // flat floor is excluded upstream); this pure fn just projects + hit-tests whatever it's given.
  const ordered = blocks
    .slice()
    .sort((a, b) => {
      const d = (b.col + b.row) - (a.col + a.row)
      if (d !== 0) return d
      return b.heightLevel - a.heightLevel
    })
  const hits: IsoPickResult[] = []
  for (const b of ordered) {
    const px = originX + (b.col - b.row) * tileW
    const py = originY + (b.col + b.row) * tileH
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

/** Screen → the frontmost RAISED block under the pointer (nearest-camera), or null, the block the render
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
 *  px) resets to the frontmost (0). Pure, the caller holds the {x,y,index} of the previous pick. */
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


/** Render a height≥1 tile/asset as an iso CUBE, the 3D half of the 2D+3D tileset model. The cell's
 *  flat diamond extrudes into `height` stacked blocks (isoBlockFaces); each block fills its two
 *  camera-visible side faces + the top face gets the final cap, and the tile is SHEARED onto every
 *  face via fillIsoFaceWithTile (auto-extrude, one image on all faces; per-face art is a later phase).
 *  Side faces are shaded by the global LIGHT (top brightest, the two front walls dimmer) so the block
 *  reads 3D even when the tile has no per-face detail. `tint` = a per-instance colour override that
 *  recolours the whole cube (the colour-as-data rule). Impure canvas glue; the corner math is the pure,
 *  unit-tested isoBlockFaces. `dv.char`/`dv.image` come from resolveDraw, ASCII passthrough never
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
  depth = 1, // directional-depth: >1 (with spanAxis) extrudes into a long iso box spanning `depth` cells
  spanAxis?: IsoDiagonal,
  /** THICKNESS: how far the block reaches toward each WORLD direction inside its own cell. Present → the
   *  footprint shrinks to those reaches; absent → the untouched unit cell. */
  thickness?: ThicknessReach,
): void {
  const n = blockLayers(height)
  const faceColor = tint ?? dv.tint ?? dv.color
  // The ground footprint every face is built from. Thinned along a WORLD diagonal when the tile asks for it
  // (a door flush in its wall); otherwise the full cell, so every existing block draws byte-identically.
  const quad = thickness && thicknessThins(thickness) ? reachGroundQuad(tileW, tileH, thickness) : undefined
  // Per-face brightness from the sun (outward screen normals of the two FRONT walls). Constant per
  // block → hoisted out of the stacking loop. Same faceLight shading the peaked roof uses.
  const leftShade = faceColor ? darkenColor(faceColor, faceLight(-tileH, tileW)) : undefined // front-left wall
  const rightShade = faceColor ? darkenColor(faceColor, faceLight(tileH, tileW)) : undefined // front-right wall
  // Fill a face as a shaded solid quad, then overlay ITS tile sheared onto it (the auto-extrude).
  //
  // NO COLOUR, NO SHELL. A block whose tile states no colour is not a grey block, it is a block with
  // nothing painted on its faces, and the tile's own art still draws over them. That is the same thing
  // `transparent` asks for, arrived at from the other side. The alternative is a literal here, which is
  // this renderer deciding what a tile looks like when the database did not.
  const fillFace = (f: BlockFace, colour: string | undefined, fdv: DrawVisual, ftint?: string): void => {
    if (colour) {
      ctx.fillStyle = colour
      fillQuad(ctx, f.a, f.b, f.c, f.d)
    }
    if (fdv.image || fdv.char) {
      fillIsoFaceWithTile(ctx, f.a, { x: f.b.x - f.a.x, y: f.b.y - f.a.y }, { x: f.d.x - f.a.x, y: f.d.y - f.a.y }, { char: fdv.char, color: fdv.color, image: fdv.image, turns: fdv.turns }, 1, 1, ftint)
    }
  }

  // DIRECTIONAL-DEPTH path (depth>1 + a direction): draw the extruded long-box HULL instead of a unit cube.
  // Guarded so a depth-less block (every existing tree/wall/terrain) never reaches here → byte-identical render.
  if (spanAxis && Math.floor(depth) > 1) {
    const shade = (role: 'left' | 'right') => (role === 'left' ? leftShade : rightShade)
    // Stack bottom→top exactly like the cube path; each level is one long box, higher levels composite over lower.
    for (let k = 0; k < n; k++) {
      const box = isoDepthBox(center, tileW, tileH, blockH, depth, spanAxis, k, quad)
      fillFace(box.long, shade(box.longShade), dv, tint)
      fillFace(box.cap, shade(box.capShade), dv, tint)
    }
    const boxTop = isoDepthBox(center, tileW, tileH, blockH, depth, spanAxis, n - 1, quad).top
    if (topDv) fillFace(boxTop, topDv.tint ?? topDv.color ?? faceColor, topDv)
    else fillFace(boxTop, faceColor, dv, tint)
    return
  }

  // Stack bottom→top so higher blocks composite over lower ones; the TOP face is capped last (full-bright).
  for (let k = 0; k < n; k++) {
    const faces = isoBlockFaces(center, tileW, tileH, blockH, k, quad)
    fillFace(faces.left, leftShade, dv, tint)
    fillFace(faces.right, rightShade, dv, tint)
  }
  const top = isoBlockFaces(center, tileW, tileH, blockH, n - 1, quad).top
  if (topDv) fillFace(top, topDv.tint ?? topDv.color ?? faceColor, topDv) // a ROOF tile capping a wall block
  else fillFace(top, faceColor, dv, tint)
}

/** A SOLID rectangular iso block, a 2-axis
 *  z-width tile drawn as ONE body: a single parallelogram TOP + the two OUTER walls, no internal seams. `ext` is
 *  the grid span in cells in each of ±col/±row from the anchor (assetRectExtents). Degenerate (a 1-wide line, or
 *  a single cell at ext 0) it matches the unit cube / isoDepthBox. `layers` blocks tall; the tile shears onto
 *  every face like the cube. Pure-ish (canvas glue), same conventions as drawIsoTileBlockLive. */
function drawIsoRectBlock(
  ctx: CanvasRenderingContext2D,
  center: Pt,
  tileW: number,
  tileH: number,
  blockH: number,
  layers: number,
  dv: DrawVisual,
  tint: string | undefined,
  ext: { colMinus: number; colPlus: number; rowMinus: number; rowPlus: number },
  topDv?: DrawVisual,
  /** THICKNESS: how far the block reaches toward each world direction inside the cells it spans. A z-width
   *  tile used to ignore this outright, because only the non-rect branch was ever handed it, so a tile asking
   *  for both a span and a thickness got the span and drew full width. */
  thickness?: ThicknessReach,
): void {
  const px = center.x
  const H = blockH * Math.max(1, layers) // total rise; the walls drop this far from the top face
  const ty = center.y - H // top-face reference (the block rises H above its ground base)
  const { colMinus: cm, colPlus: cp, rowMinus: rm, rowPlus: rp } = ext
  // The rectangle in CELL space: `a` runs along +col, `b` along +row, both measured from the anchor cell's
  // back corner. The outer faces sit at the cell boundaries, and thickness pulls each one inward by however
  // much of its own cell that side gives up, the same rule `reachGroundQuad` applies to a single cell.
  const reach = (dir: IsoDiagonal): number => {
    const raw = thickness?.[dir]
    return typeof raw === 'number' && raw > 0 && raw < 1 ? raw : 1
  }
  // The far faces sit one cell PAST the last cell (a rect of n cells spans n+1 boundaries), and thickness
  // pulls each face back into its own cell. At reach 1 these are exactly -cm, cp+1, -rm, rp+1, the numbers
  // the corners were written with before.
  const a0 = -cm + (1 - reach('left-up'))
  const a1 = cp + reach('right-down')
  const b0 = -rm + (1 - reach('right-up'))
  const b1 = rp + reach('left-down')
  const at = (a: number, b: number): Pt => ({ x: px + (a - b) * tileW, y: ty + (a + b - 1) * tileH })
  // The four OUTER corners of the rectangle's top parallelogram (dir1/dir2 are the two grid axes → 4 corners).
  const T = at(a0, b0) // back (min col, min row) → top vertex
  const R = at(a1, b0) // right (max col, min row)
  const B = at(a1, b1) // front (max col, max row) → bottom vertex
  const L = at(a0, b1) // left (min col, max row)
  const dn = (p: Pt): Pt => ({ x: p.x, y: p.y + H })
  const faceColor = tint ?? dv.tint ?? dv.color
  // NO COLOUR, NO SHELL, exactly as the cube path above.
  const leftShade = faceColor ? darkenColor(faceColor, faceLight(-tileH, tileW)) : undefined // +row wall
  const rightShade = faceColor ? darkenColor(faceColor, faceLight(tileH, tileW)) : undefined // +col wall
  const fillFace = (f: BlockFace, colour: string | undefined, fdv: DrawVisual, ftint?: string): void => {
    if (colour) {
      ctx.fillStyle = colour
      fillQuad(ctx, f.a, f.b, f.c, f.d)
    }
    if (fdv.image || fdv.char) fillIsoFaceWithTile(ctx, f.a, { x: f.b.x - f.a.x, y: f.b.y - f.a.y }, { x: f.d.x - f.a.x, y: f.d.y - f.a.y }, { char: fdv.char, color: fdv.color, image: fdv.image, turns: fdv.turns }, 1, 1, ftint)
  }
  fillFace({ a: dn(L), b: dn(B), c: B, d: L }, leftShade, dv, tint) // +row (front-left) wall
  fillFace({ a: dn(B), b: dn(R), c: R, d: B }, rightShade, dv, tint) // +col (front-right) wall
  const top: BlockFace = { a: L, b: T, c: R, d: B } // one solid top parallelogram → no column seams
  if (topDv) fillFace(top, topDv.tint ?? topDv.color ?? faceColor, topDv)
  else fillFace(top, faceColor, dv, tint)
}

// ── Single-block cube SPRITE CACHE (the building-cell hotspot) ────────────────────────────────────────
// A building cell is a height-1 image cube (drawIsoTileBlock(..., 1, ...)). It is pixel-identical for every
// cell of the same (tile image, face colour, tint, top-cap, dims), a city has THOUSANDS (every wall / roof /
// window cell). Bake that cube ONCE to an offscreen canvas and blit it per cell, exactly like the ground
// sprite cache, instead of re-drawing 3 faces (each a fillQuad + a save/transform/drawImage) per cell/frame.
const _cubeSpriteCache = new Map<string, { canvas: HTMLCanvasElement; ox: number; oy: number } | null>()

function cubeBlockSprite(dv: DrawVisual, tileW: number, tileH: number, blockH: number, tint?: string, topDv?: DrawVisual) {
  if (typeof document === 'undefined') return null
  // Don't bake until the image raster(s) decoded, else the sprite would freeze the glyph fallback.
  if (dv.image && !tileImage(dv.image.src)) return null
  if (topDv?.image && !tileImage(topDv.image.src)) return null
  const faceColor = tint ?? dv.tint ?? dv.color
  const key = `${dv.image?.src ?? dv.char}|${faceColor}|${tint ?? ''}|${topDv?.image?.src ?? ''}|${topDv?.tint ?? topDv?.color ?? ''}|${Math.round(tileW)}|${Math.round(tileH)}|${Math.round(blockH)}`
  const hit = _cubeSpriteCache.get(key)
  if (hit !== undefined) return hit
  const m = 1 // 1px margin so edge anti-aliasing never clips
  // WHOLE PIXELS, for the same reason the lattice is (see tileW): the blit lands at `centre - anchor`, so a
  // fractional anchor puts an on-lattice cell back onto a fractional destination and costs the resample.
  const ox = Math.round(tileW) + m // local centre-x
  const oy = Math.round(blockH) + Math.round(tileH) + m // local centre-y: room above for the block top diamond, below for the base
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(2 * tileW + 2 * m)
  cv.height = Math.ceil(blockH + 2 * tileH + 2 * m)
  const c = cv.getContext('2d')
  // A real browser ctx supports the full path API; jsdom's stub canvas (jest) does not, fall through to the
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
 *  fast path, the big city hotspot); taller stacks, fading/cutaway cubes (globalAlpha < 1) and glyph-only
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
  depth = 1, // directional-depth (with spanAxis) → a long iso box; default 1 = the unmodified cube
  spanAxis?: IsoDiagonal,
  /** THICKNESS reaches → the footprint shrinks inside its own cell (a door flush in its wall). */
  thickness?: ThicknessReach,
): void {
  const isDepthBox = !!spanAxis && Math.floor(depth) > 1
  // The cube-sprite cache bakes a UNIT cube, never a directional box, and never a THINNED one; skip it for
  // both so the live builder draws the real footprint.
  if (!isDepthBox && !thickness && Math.floor(height) === 1 && ctx.globalAlpha === 1 && dv.image) {
    const spr = cubeBlockSprite(dv, tileW, tileH, blockH, tint, topDv)
    if (spr) {
      ctx.drawImage(spr.canvas, center.x - spr.ox, center.y - spr.oy)
      return
    }
  }
  drawIsoTileBlockLive(ctx, center, tileW, tileH, blockH, height, dv, tint, topDv, depth, spanAxis, thickness)
}

/** DISPLAY = "single" (per-tile `settings.display`): draw the block as a PLAIN, shaded SHELL, the SAME cube
 *  geometry as drawIsoTileBlock, but a dv with NO tile image/char, so the faces are just the block's colour,
 *  shaded per face, then draw ONE centered instance of the tile INSIDE the block volume: a billboard at the
 *  block's screen-space centre, colour-composited the SAME way the faces would be (tintedImage, via
 *  drawStyledImage). This is the per-tile alternative to the 3-face paint, one water droplet floating inside
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
  spanAxis?: IsoDiagonal,
  transparent = false,
): void {
  // 1) The plain block SHELL, same cube, but no image/char on the faces (fillFace only fills the shaded quad).
  //    SKIPPED when the tile is transparent: only the billboard (step 2) shows, so a flower stands with NO
  //    coloured block around it, "style the flower without colouring the whole block".
  if (!transparent) drawIsoTileBlock(ctx, center, tileW, tileH, blockH, height, { char: '', color: dv.color, tint: dv.tint }, tint, undefined, depth, spanAxis)
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

/** The rounding-clip ellipse for a circle-shape block, the INSCRIBED ellipse of the block's projected
 *  hexagon silhouette. A stacked iso block draws as a 6-vertex hexagon: the top-diamond apex, the two upper
 *  side vertices, the two mid (base-diamond) side vertices, and the bottom apex. The OLD ellipse
 *  (`ry = stack/2 + tileH`) passed exactly THROUGH the apex + bottom and CUT ACROSS the slanted top/bottom
 *  faces, so three things stayed angular: the top point poked out sharp, the bottom point poked out sharp, and
 *  where the straight slant edge met the ellipse arc there was a visible KINK at the mid-right corner.
 *  To bend EVERY corner we shrink `ry` just enough that the ellipse is TANGENT to the four slanted
 *  faces (and to the vertical sides at `rx = tileW`), i.e. fully INSCRIBED. Tangency to the slant edge
 *  (slope tileH/tileW through the apex) solves to `ry² = (stack/2)² + stack·tileH`, a hair below the old
 *  `stack/2 + tileH` (they differ only by the `tileH²` term). Now every hexagon vertex sits OUTSIDE the
 *  ellipse (so the clip rounds it away) and the ellipse never crosses an edge (so there is no straight-edge/arc
 *  kink): the whole outline is one smooth oval. Still PROPORTIONAL, a tall block → a tall oval, a unit cube →
 *  a rounder blob, with the top/bottom domes at radius-of-curvature `rx²/ry` (visibly bent, not a point) and
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
 *  the outer SILHOUETTE, but where the bright top diamond's front point meets the two front walls is an INTERIOR
 *  colour seam (a sharp downward V), so no outer clip reaches it (Image #61: the last angular corner). We overpaint
 *  that sharp tip with the front-wall shades up to a smooth arc, so the bright top RECEDES to a rounded front edge
 *  instead of a point, left half → leftShade, right half → rightShade, matching the walls beneath so the bevel
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
  const fx = center.x, fy = ty + tileH // F, the top face's front vertex (where its two front edges meet)
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

/** SHAPE = "circle": take the SAME cuboid, same footprint, height, painted faces and per-face shading as
 * drawIsoTileBlock, and BEND ITS CORNERS into a smooth rounded silhouette. We draw the block
 *  exactly as the cube path does, then CLIP it to the INSCRIBED ellipse (`roundedBlockEllipse`) so every SILHOUETTE
 *  corner, the top apex, the mid-side vertices, and the bottom, is bent away and no straight-edge/arc kink remains.
 *  The outer clip can't reach the top face's FRONT vertex (an interior top→wall colour seam), so roundIsoTopFrontCorner
 *  bevels that last sharp point too, now EVERY corner is bent. The three shaded faces and the tile's painted art all
 *  stay: it is the cuboid with its corners rounded away, NOT a repainted sphere. There is no spherical relight and no
 *  single flat surface, those were the rejected "ball" attempts; here the ONLY change from the cube is the rounding. */
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
  // The SAME cuboid, three shaded faces + painted art, drawn normally; only the clip above rounds it.
  drawIsoTileBlock(ctx, center, tileW, tileH, blockH, blockLayers(height), dv, tint)
  // Bevel the one corner the silhouette clip can't reach, the top face's interior front vertex (Image #61).
  const bevel = tint ?? dv.tint ?? dv.color
  if (bevel) roundIsoTopFrontCorner(ctx, center, tileW, tileH, blockH, height, bevel)
  ctx.restore()
}

/**
 * A CONE: the same cuboid, tapered to a point.
 *
 * Built exactly the way the ball is, because the principle is the same one: the tile draws normally and a
 * CLIP decides its outline, so the art and the per-face shading survive and no shape needs its own lighting.
 * A conifer is a cone, not a ball and not a box, and the catalogue had no way to say so.
 */
export function drawIsoConeBlock(
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
  clipToCone(ctx, cx, cy, rx, ry)
  drawIsoTileBlock(ctx, center, tileW, tileH, blockH, blockLayers(height), dv, tint)
  ctx.restore()
}

/** ONE dispatch for "how to draw a placed tile's SOLID", keyed by its `shape` (default 'square'). The
 *  'square' drawer keeps the existing cube / single-billboard split (display setting); 'circle' builds a ball.
 *  A new shape ('oval', …) adds ONE entry here, never a new `if` at the call sites (SOLID/OCP). */
type IsoShapeDrawer = (
  ctx: CanvasRenderingContext2D, center: Pt, bw: number, bd: number, bh: number, blocks: number,
  dv: DrawVisual, tint: string | undefined, asset: GridAsset,
) => void

/** The tile's DIRECTIONAL thickness, or undefined when it does not actually thin anything.
 *
 *  A map of all 1s reaches the whole cell every way, which is the same shape as no map at all, so it answers
 *  undefined for that too. It used to answer the map, and the call site reads "has thickness" as "scaleZ is
 *  no longer in charge", so a tile with four 1s silently lost its squash and came out a fat cube. */
function assetThickness(asset: GridAsset): ThicknessReach | undefined {
  return thicknessThins(asset.thickness) ? asset.thickness : undefined
}

const ISO_SHAPE_DRAWERS: Record<TileShape, IsoShapeDrawer> = {
  square: (ctx, center, bw, bd, bh, blocks, dv, tint, asset) => {
    // `transparent` drops the coloured block so it reads SEE-THROUGH, and it applies to EVERY tile, not just a
    // 'single' one.
    // DISPLAY = "single" still draws ONE centered billboard inside the (here dropped) shell; an all-faces tile
    // with transparent draws NOTHING (see-through), same as single drops its shell.
    const transparent = assetIsTransparent(asset)
    // Z-WIDTH RECTANGLE: a square tile spanning ≥2 cells, along ONE axis (depth/spanBack)
    // or TWO (spanPerp/spanPerpBack too), draws as ONE SOLID block: one parallelogram top + two outer walls,
    // NO column seams. This lives HERE (the shape drawer) so EVERY tile gets it, not just label-backed ones, a
    // painted/override roof (label:null) reaches this same drawer, so "all settings apply to every tile" holds.
    // `assetRectExtents` is all-zeros for a non-z-width tile → isRect false → the byte-identical cube below.
    const ext = assetRectExtents(asset)
    const isRect = ext.colMinus + ext.colPlus + ext.rowMinus + ext.rowPlus > 0
    if (assetDrawsSingle(asset)) drawIsoSingleTileBlock(ctx, center, bw, bd, bh, blocks, dv, tint, asset.spanForward, asset.spanAxis, transparent)
    else if (transparent) return // see-through: no coloured block (whether a rect deck or a plain cube)
    else if (isRect) drawIsoRectBlock(ctx, center, bw, bd, bh, blocks, dv, tint, ext, undefined, assetThickness(asset))
    else drawIsoTileBlock(ctx, center, bw, bd, bh, blocks, dv, tint, undefined, asset.spanForward, asset.spanAxis, assetThickness(asset))
  },
  circle: (ctx, center, bw, bd, bh, blocks, dv, tint, asset) => {
    if (assetIsTransparent(asset)) return // transparent applies to circles too, see-through, no coloured ball
    drawIsoRoundedBlock(ctx, center, bw, bd, bh, blocks, dv, tint)
  },
  cone: (ctx, center, bw, bd, bh, blocks, dv, tint, asset) => {
    if (assetIsTransparent(asset)) return // and to cones, for the same reason
    drawIsoConeBlock(ctx, center, bw, bd, bh, blocks, dv, tint)
  },
}

/** Draw a placed tile's block as the SOLID its `shape` selects, the single call the asset draw sites use in
 *  place of branching on display/shape themselves. Unknown/absent shape → the square (cube) drawer. */
export function drawIsoTileForShape(
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
 *  gently-shimmering surface dropped below the lip, so a pond reads as a basin with
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
 *  diagonal (depth>1 + spanAxis), else the plain stacked cube. Pose (x/y/rotate/flip) is folded in through
 *  poseMapper exactly as the draw applies it, so the geom matches whether or not the block is posed. */
function blockGeom(x: number, y: number, halfW: number, halfD: number, blockH: number, blocks: number, asset: GridAsset, unit: number): TileGeom {
  const xf = poseMapper({ x, y }, asset.pose, unit)
  // A z-widthed tile (1-axis line OR 2-axis rectangle) → the SOLID block's full hull, so the pick + outline hug
  // the WHOLE element, not the anchor cell.
  const ext = assetRectExtents(asset)
  if (ext.colMinus + ext.colPlus + ext.rowMinus + ext.rowPlus > 0) return rectBoxGeom(halfW, halfD, blockH, blocks, ext, xf)
  return cubeGeom(halfW, halfD, blockH, blocks, xf)
}

// ── The LAST-RESORT glyph plate (no baked tile at all) ────────────────────────────────────────────────────
// EVERY seeded tile is image-backed in EVERY style (MAP-MODEL §8, a tile row must never be `image_url: nil`),
// so a tile resolves its baked picture through `styleTileImage` and draws as a cached block, identically in
// ascii and emoji. The whole family of frontend-invented per-type ASCII sprites this file used to carry
// (ISO_ASCII_DRAWERS → drawIsoTreeAscii / Lamp / Bush / Npc / Flower / Rock, each a stack of measureText'd
// glyph plates redrawn EVERY frame) is DELETED: with the kind→image resolution ungated, nothing reached them,
// and the `ctx.measureText` per asset per frame they ran was a top cost of the ASCII render (TILE-BACKEND-
// MIGRATION §11, "de-hardcoding is per-type … add a tile, drop the drawer").
//
// What remains is the ONE genuine last resort: an asset whose KIND has no tile in the active tileset at all
// (`assetKind` → the unmapped `'ground'`) and which carries no label. It draws the asset's own art glyph on a
// darkened plate so the cell is never blank. It is NOT style-specific, ascii and emoji reach it under exactly
// the same condition, which is the point: there is no ASCII path any more, only a no-tile path.

/** Half-width + layer count of the last-resort glyph plate, one layer, 0.6·tileW wide. Drives the recorded
 *  pick silhouette so a click hugs the drawn plate rather than the whole ground cell. */
function lastResortPlateBounds(tileW: number): [halfW: number, layers: number] {
  return [tileW * 0.6, 1]
}

/** The last-resort plate: the asset's own art glyph over a darkened backing, sized to the glyph. Reached only
 *  by a tile-less, label-less asset (see the note above), never by a seeded tile in any style. */
function drawIsoLastResortGlyph(
  ctx: CanvasRenderingContext2D, asset: GridAsset,
  x: number, y: number, fontSize: number, lineHeight: number,
): void {
  // NEVER '?'. A tile with no art is a DATA gap, and painting a question mark over it invents a picture
  // the catalog does not have, the reported "fake ascii tiles" were literal '?' plates drawn
  // here. Missing stays missing (the tile draws its backing and nothing else), so a gap is visible as an
  // absence and gets fixed in the backend rather than papered over in the renderer.
  const char = asset.art[0] ?? ''
  const layerY = y - lineHeight * 0.5
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.fillStyle = darkenColor(asset.color || '#888888', 0.4)
  const textWidth = ctx.measureText(char).width
  ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
  ctx.fillStyle = asset.color || '#ffffff'
  ctx.fillText(char, x, layerY)
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

  // GROUND DECOR is a flat overlay tile (flowers/clover/pebbles): draw its BAKED tile image, resolved by
  // its LABEL for the ACTIVE style (groundDecorImage → styleTileImage), SHEARED flat onto the cell's ground
  // DIAMOND (the same geometry the ground layer uses; (x,y) IS the cell's ground centre) and colour-composited
  // (tint = asset.color). `char: ''` so a not-yet-decoded PNG paints NOTHING, never the dingbat. No baked decor
  // tile for this style (a backend data gap) → fall through to the existing path (e.g. emoji's curated litter
  // tile via resolveAssetDraw), which is still an image, never a glyph.
  if (asset.type === 'ground_decor') {
    const decorImage = groundDecorImage(asset, style)
    if (decorImage) {
      fillIsoFaceWithTile(ctx, { x: x - tileW, y }, { x: tileW, y: -tileH }, { x: tileW, y: tileH }, { char: '', color: asset.color ?? '#ffffff', image: decorImage }, 1, 1, asset.color)
      return diamondGeom(tileW, tileH, poseMapper({ x, y }, undefined, tileH)) // flat ground diamond
    }
  }

  // MODEL (TILE-BACKEND-MIGRATION §7, "resolve label→image", the migration's whole point): a labeled
  // composition cell IS its label's tile. Resolve the per-LABEL baked image for the ACTIVE style, paint it
  // on the cube faces + composite the cell's colour, and RETURN, BEFORE any kind-based art below. This is
  // why a tree's canopy/trunk cells draw their OWN leaf/trunk tile instead of the 'tree' KIND emoji, and why
  // a cell's colour setting filters the WHOLE tile (the image is recoloured, no kind emoji, no glyph that
  // would ignore the tint). Same path for every style (ascii/emoji/…), the label is the only input.
  //
  // EVERY image-backed labeled tile is a BLOCK, a height≥1 cell extrudes into stacked cubes, a sub-block
  // (flat) labeled cell draws its own DB height as a thin partial slab (partialBlockScale), NEVER a flat
  // billboard, so Z-Width/display/shape/scale apply through
  // drawIsoTileForShape (MAP-MODEL §4, EDITOR-INTERACTION-SPEC §11). A genuinely image-LESS label (unknown /
  // not-yet-baked) still falls to the neutral glyph below (MAP-MODEL §8), unchanged.
  const labelImage = asset.label ? styleTileImage(asset.label, style) : undefined
  if (asset.label && (asset.height >= 1 || labelImage)) {
    // WHOLE PIXELS, the block's half-dimensions. Its faces are drawn at `centre ± bw/bd/bh`, and the centre
    // is already on the whole-pixel lattice (see tileW), so a fractional dimension is what would put the
    // corners back off-pixel and cost the resample on every face. Measured: with the lattice snapped but
    // these left fractional, 18% of the frame's blits still landed off-pixel, all of them block faces.
    const bw = Math.max(1, Math.round(tileW * asset.width))             // Width , diamond half-width
    // DEPTH, the diamond's half-height: how far the tile reaches INTO THE SCREEN, as a share of its own
    // cell. A SIZE, applied unconditionally, which is what makes it mean the same thing here as it does
    // from above. THINNING is `thickness` alone, and it happens inside the shape drawer along a world
    // axis, so the two compose instead of one cancelling the other.
    const bd = Math.max(1, Math.round(tileH * asset.depth))
    // Height, the tile's OWN DB block-height turned into pixels: partialBlockScale draws a sub-block cell as a
    // partial slab and a standing cell as a full block, × the per-instance Height multiplier (scaleY).
    //
    // IT HAS TO ASK THE TILE. This read `asset.height ?? 0`, and the comment right here said the value comes
    // from the DB while the code read only the placed asset, so anything placed WITHOUT an explicit height
    // drew zero blocks tall. `rock` is served at height 1 and the generator sets no per-instance height, so
    // every generated rock rendered as a flat diamond on the ground: *"ROCKS ARE LOADING WITH 0 HEIGHT...
    // when I inspect them, it says 1, but they're clearly 0. And as soon as I edit them they act normal"*, // the inspector read the tile and the renderer read the asset, and editing wrote a height onto the asset
    // which is why touching one cured it.
    //
    // `resolveTileHeight` is the shared rule and it says it in one line: the asset's height when it pins one,
    // the TILE's otherwise. Resolved by LABEL, which is the only input this whole branch uses.
    const labelBlocks = resolveTileHeight(asset)
    const bh = tileW * ISO_BLOCK_H_FRAC * layerBlockScale(labelBlocks)
    // …stacked as many times as the tile is tall. This used to be hardcoded to ONE layer, so a labeled cell
    // drew a single block however tall you made it, raise it to 5 and the tiles above rose while the tile
    // itself stayed put.
    // No composition tile ships a DB height above 1, so generated maps render exactly as before.
    const layers = blockLayers(labelBlocks)
    // NO COLOUR IS AN ANSWER. `color` is nullable with no column default, and a placement is born with
  // the catalogue's colour, so a placement with none means the catalogue has none either. Measured on
  // the live catalogue: 636 of 638 tiles carry one and the other two are tinted by the generator, so
  // this is unreachable. An unreachable literal is still a literal, and it is still this renderer
  // holding an opinion about a value the database owns.
  const tint = asset.color
    // The label's own glyph in the ACTIVE style (one lookup, no style branch), the last-resort char if the
    // baked PNG is genuinely missing; falls back to the asset's authored art when the style has no such tile.
    const glyph = styleTileArt(asset.label, style.id)?.char ?? asset.art[0] ?? '?'
    const image = labelImage
    // A recolour needs a colour to recolour TO. With none, the baked picture draws as it was baked.
    const recolor = tint ? labelTileRecolor(style, tint) : undefined
    const dvBlock = { char: glyph, color: tint, tint: recolor, image }
    // A z-width tile (≥2 cells, 1 or 2 axes) draws as ONE SOLID block, a plain tile as a cube, drawIsoTileForShape
    // decides via the tile's shape drawer (the SAME solid-rect path a painted/override tile takes), so nothing
    // here has to branch on z-width. blockGeom hugs the whole hull for the pick/outline.
    const geom = blockGeom(x, y, bw, bd, bh, layers, asset, tileH)
    if (poseDeviates(asset.pose)) {
      ctx.save(); ctx.translate(x, y); applyPose(ctx, asset.pose, 1, tileH); drawIsoTileForShape(ctx, { x: 0, y: 0 }, bw, bd, bh, layers, dvBlock, recolor, asset); ctx.restore()
    } else {
      drawIsoTileForShape(ctx, { x, y }, bw, bd, bh, layers, dvBlock, recolor, asset)
    }
    if (asset.settings?.badge) drawApexBadge(ctx, x, y - bh * layers, fontSize, asset.settings.badge)
    return geom
  }

  // Active art style: a mapped kind (or a per-element override) replaces ALL of the per-type
  // art below (labeled cells, trees, legacy buildings, props) with ONE tile. A PLACED tile's
  // override re-homes onto the active style so it RESKINS (resolveAssetDraw), never freezing to
  // the style it was picked in. ASCII + no override → adv.char '' → the byte-identical per-type draw.
  let adv = resolveAssetDraw(assetKind(asset), style, assetOverride(asset, style), '', asset.color ?? '#ffffff')
  // The tile's ACTIVE-STYLE entry: per-view size/pose + the iso block-height default. ONE lookup for every
  // style (styleTileArt), reading it only for emoji made an ascii tile ignore its own authored data.
  const dbTile = styleTileArt(assetKind(asset), style.id)
  // ANY tile identified by its KIND rather than a label resolves its baked image here, the floor
  // (grass/road/water: its identity IS its groundKind, `tileKey` → assetKind, never a label) and every prop
  // whose kind carries a tile. `ASCII_STYLE.map` is empty by design, so ASCII's `adv` never arrives with an
  // image and without this the tile fell through to the legacy per-type glyph drawers, the '?' plates on
  // grass/road AND the per-frame `measureText` that made ASCII ~2.5× slower than emoji on the same map. This
  // is NOT style- or type-scoped: emoji already carries the kind image in `adv` (its style map is populated),
  // so `!adv.image` is simply false there and nothing changes. `char: ''` so a not-yet-decoded PNG paints
  // NOTHING, never the dingbat (mirrors the ground_decor/label image paths). A kind with no baked tile in the
  // active style still resolves undefined and keeps its glyph, the documented last resort (MAP-MODEL §8).
  if (!adv.image) {
    const kimg = assetTileImage(asset, style)
    if (kimg) adv = { ...adv, image: kimg, char: '', tint: adv.tint ?? asset.color }
  }
  // A LIVE SPRITE FRAME wins over the tile's resting picture, in every style.
  //
  // This is the playback `resolveAssetAnimation` documents as stubbed: `spriteFrameIndex` was real and tested
  // and nothing consumed it, so a tile carrying a frame-swap animation animated nothing. It lands HERE, where
  // a tile's picture is chosen, so it reaches a FLOOR too: a floor is an ordinary level-0 asset whose identity
  // is its `tileKey` (never a label), which is why animating water could not work through the label seam above.
  //
  // AFTER the `!adv.image` block on purpose: under emoji the style map already filled `adv.image`, so a frame
  // that only applied when the image was missing would never play.
  const liveFrame = spriteFrame(asset, time, style, 'iso', dayNight)
  const framed = liveFrame ? frameImage(liveFrame, adv.char, adv.image, style) : undefined
  if (framed && framed !== adv.image) adv = { ...adv, image: framed, char: '', tint: adv.tint ?? asset.color }
  // WHICH WAY THIS CELL'S PICTURE RUNS. A cell's heading is DATA on the cell (`flow`, written by the generator), and
  // it
  // turns the TEXTURE, not the tile: the face keeps its corners, the waves rotate inside it. This is the whole
  // of the direction system now, no per-heading art, no per-heading animation.
  // `!== undefined`, NOT truthiness. HEADING 0 IS A HEADING (+col), and `if (asset.flow)` skipped every one
  // of those cells, so they drew unturned and came out a quarter turn wrong while their neighbours were
  // right. That is the "not consistent, not aligned" it kept seeing, and no amount of fixing the FIELD could
  // have cured it: the data was already correct. Measured through Playwright on a ring river, 10 cells at
  // flow 0 and not one `turns=1` draw in the whole frame.
  //
  // AND THE CAMERA TURNS IT TOO. A heading is a WORLD direction and a border piece names a WORLD side (`_t` is
  // the grid's north edge, and its rim is painted along the top of its own image). The face this texture lands
  // on is built from `orientCell`, which turns the coordinate into the VIEW frame before the fixed projection,
  // so at any facing but 0 the two frames disagree by exactly the camera's quarter-turns: the picture keeps
  // pointing at the screen edge it pointed at before the map moved under it. Adding the facing turns the
  // picture with the map, which is the tile-art half of what `orientCell` does for position.
  //
  // Sound rather than a nudge, because the nine-piece family is CLOSED under a quarter-turn: tl→tr→br→bl,
  // t→r→b→l, and the interior maps to itself. Turning a piece's texture is the same answer as relabelling the
  // cell for the rotated grid, so no piece can rotate into art that does not exist.
  // ASK THE LABEL, NOT THE KIND. This passed `assetKind(asset)`, and `assetKind` FOLDS a label onto a coarse
  // kind: every water piece comes back as the single kind `water`. `isWaterSetLabel` tests membership in the
  // set of PIECE labels (`water_smooth_river_tl` and its siblings), so it was being asked whether the string
  // "water" is one of them, which it is not and never was. The condition was constant false, so the whole
  // correction below has never once run for a border piece: every rim has been drawn a quarter-turn off its
  // own cell, at every facing, which is exactly *"none is on the edge of any water body"*.
  //
  // A floor carries its piece label on `tileKey`, a placed asset on `label`, so both are asked.
  const bordersWater = isWaterSetLabel(asset.tileKey) || isWaterSetLabel(asset.label)
  if (asset.flow !== undefined || bordersWater) {
    // A PICTURE'S OWN FRAME IS NOT THE GRID'S. The top face hands the texture `eA = top.b - top.a`, which
    // points NORTH, and `eB = top.d - top.a`, which points EAST. A tile is drawn as an ordinary top-down
    // square, x toward east and y toward south, so its frame sits one quarter-turn off the face it lands on.
    // `PICTURE_TO_GRID` is that turn, and it is not a new claim: `textureTurnForHeading` is `heading + 1` and
    // the 1 in it is this same correction, which is why a river's current has always run the right way while
    // the border pieces, which never turned at all, did not.
    //
    // Measured on the face geometry (`waterRimFacesItsBank`): at 0 turns `_t` lays its rim on the cell's WEST
    // edge while its label says its land is NORTH, and on a river running north to south that puts the white
    // water straight across the channel.
    const heading = asset.flow !== undefined ? textureTurnForHeading(asset.flow) : PICTURE_TO_GRID
    adv = { ...adv, turns: heading + isoCameraFacing() }
  }
  const blocks = resolveTileHeight(asset)
  // Z-WIDTH (directional depth) is a 3D BLOCK operation: setting it declares the tile a block extruded N cells
  // along a diagonal, so the iso render MUST extrude it even at base height 0. Z-Width only changes how FAR a
  // block extrudes, a flat tile stays a THIN slab (see flatSlab below), just deeper.
  const hasZWidth = asset.spanForward > 1
  // A well / fountain under a RESKIN (emoji), flat + no Z-Width, extrudes its RESOLVED TILE (⛲/🪣) into a raised
  // iso basin block (bespoke depth), town fountains scale to their footprint. A Z-Width well, or one with its
  // own height, flows to the generic block path below (which honours spanAxis). ASCII → the per-type draw.
  const reskinned = style.id !== ASCII_STYLE.id
  if (reskinned && blocks < 1 && !hasZWidth && (asset.type === 'well' || asset.type === 'fountain') && (adv.image || adv.char)) {
    const span = asset.footprint && asset.footprint > 1 ? asset.footprint : 1
    const bw = span > 1 ? tileW * span * 0.6 : tileW
    const bhScreen = span > 1 ? tileH * span * 0.6 : tileH
    const basinH = tileH * (span > 1 ? span * 0.5 : 1.4) // raised basin height in px (≈ the ASCII bodyH)
    drawIsoTileBlock(ctx, { x, y }, bw, bhScreen, basinH, 1, adv, asset.color)
    return cubeGeom(bw, bhScreen, basinH, 1, poseMapper({ x, y }, undefined, tileH))
  }
  // EVERY tile with ANY art is a BLOCK, the flat-billboard path for a placed tile is GONE (MAP-MODEL §4;
  // EDITOR-INTERACTION §11: "the old flat billboard path that silently dropped depth/spanAxis + display is
  // gone"). A height≥1 tile extrudes into N cubes; a sub-block (flat) tile, a flower, a fallen leaf, floor
  // decor, the floor itself, draws its OWN DB height as a thin partial slab (partialBlockScale), so it looks
  // FLAT, not a tall cube, while Z-Width/display/shape/scaleX/scaleY/
  // scaleZ/colour ALL apply through drawIsoTileForShape. `adv.char` routes an image-LESS GLYPH tile (an ASCII
  // tile, whose override resolves to a glyph, not its baked image, or an emoji whose PNG hasn't decoded yet)
  // through the SAME slab, drawing its glyph on the faces, in exact parity with the 2D flat path (topdown.ts).
  // There is NO per-type/category/style branch: the ONE rule is "any art → a block/slab, never a billboard".
  // Only a genuinely ART-LESS tile (adv.char '' + no image, the ASCII kind-catalog fallback) drops below to
  // the per-type / labeled glyph drawers; a UNIT never reaches here (drawIsoEntity, the one billboard, §4).
  // A FLOOR IS THE MAP'S SURFACE, so it draws even with no picture and no glyph. Every other tile obeys
  // "no art, no block", a missing prop leaves the ground it stood on, which is a gap you can live with.
  // A missing floor leaves the CANVAS, and `#1a1a2e` is what the frame is cleared with, so the map reads as a
  // hole punched through to the background. Its `color` is data the tile already carries (the same colour the
  // skirt shades its side faces from), so the slab has everything it needs to draw without inventing a thing.
  const floorSolid = asset.type === FLOOR_TYPE && !!asset.color
  const blockCount = blocks >= 1 ? blocks : ((hasZWidth || adv.image || adv.char || floorSolid) ? 1 : 0)
  if (blockCount >= 1 && (adv.image || adv.char || floorSolid)) {
    // A block sizes on THREE axes and only three: Width widens the diamond, Depth deepens it, Height
    // stretches it up. There is no fourth multiplier. This is what makes a tile able to SPAN MANY BLOCKS
    // (a 1x2 wall, a wide roof) instead of only growing taller.
    // WHOLE PIXELS, the block's half-dimensions. Its faces are drawn at `centre ± bw/bd/bh`, and the centre
    // is already on the whole-pixel lattice (see tileW), so a fractional dimension is what would put the
    // corners back off-pixel and cost the resample on every face. Measured: with the lattice snapped but
    // these left fractional, 18% of the frame's blits still landed off-pixel, all of them block faces.
    const bw = Math.max(1, Math.round(tileW * asset.width))             // Width , diamond half-width
    // DEPTH, diamond half-height (into-screen axis). A size, applied unconditionally, the same way its
    // sibling above applies it. Thinning belongs to `thickness` and happens in the shape drawer.
    const bd = Math.max(1, Math.round(tileH * asset.depth))
    // Height, the tile's OWN DB block-height as pixels: partialBlockScale draws a sub-block (flat 0.1) tile as a
    // thin partial slab and a standing tile as a full block, × the per-instance Height multiplier (scaleY). The
    // height VALUE is DATA (from the DB, read into `blocks`); nothing invented.
    const bh = tileW * 0.9 * layerBlockScale(blocks)
    // SHAPE + DISPLAY (per-tile settings): drawIsoTileForShape picks the solid, cube (all-faces / single) or ball.
    const geom = blockGeom(x, y, bw, bd, bh, blockCount, asset, tileH)
    // Per-asset pose (x/y/rotate/flip) transforms the block around its base centre, the SAME applyPose the
    // billboard/floor paths use, so moving/rotating a placed BLOCK works too. No pose → the byte-identical draw.
    if (poseDeviates(asset.pose)) {
      ctx.save(); ctx.translate(x, y); applyPose(ctx, asset.pose, 1, tileH)
      drawIsoTileForShape(ctx, { x: 0, y: 0 }, bw, bd, bh, blockCount, adv, asset.color, asset)
      ctx.restore()
      return geom
    }
    drawIsoTileForShape(ctx, { x, y }, bw, bd, bh, blockCount, adv, asset.color, asset)
    return geom
  }
  // (The image-LESS GLYPH tile is NO LONGER a billboard: adv.char now flows into blockCount above, so a placed
  //  glyph tile, an ASCII tile or an undecoded emoji, draws its glyph on a thin SLAB / cube through the block
  //  path, never a lifted billboard. Only an ART-LESS asset (adv.char '' + no image) continues below to the
  //  labeled/cycle/per-type glyph drawers; a unit renders via drawIsoEntity, the one billboard exception, §4.)

  // (a labeled composition cell was already drawn at the TOP of this function, per-label baked image + colour.)

  // Generated multi-cell assets carry a cell-part label → draw each cell as ONE
  // glyph (the cell IS the tile). The layered art below is for legacy single-cell,
  // manually-placed assets only.
  if (asset.label) {
    drawIsoLabeledCell(ctx, x, y, asset, tileH)
    return diamondGeom(tileW, tileH, poseMapper({ x, y }, undefined, tileH)) // one glyph on the cell diamond
  }

  // Authored animation cycles (author panel) OVERRIDE static type rendering with the live
  // frame, applies to ANY asset the user animated. No cycles → normal rendering below.
  const cycleArt = assetCycleFrame(asset.cycles, time)
  if (cycleArt) {
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(cycleArt[0] ?? '?', x, layerY)
    return billboardGeom(tileW, lineHeight, poseMapper({ x, y: layerY }, undefined, tileH))
  }

  // LAST RESORT, the asset has no label, no cycle art, and its KIND has no tile in the ACTIVE tileset, so
  // there is genuinely no picture to draw. Same condition in every style (see the note by the drawer): the
  // per-type ASCII sprite family is gone, so this is not "the ASCII path", it is "the no-tile path".
  drawIsoLastResortGlyph(ctx, asset, x, y, fontSize, lineHeight)
  const [halfW, layers] = lastResortPlateBounds(tileW)
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
  // (off grid.isoScale) for callers/tests that don't pass a zoom, back-compat, but they under-fill zoomed.
  tileW = cellSize * grid.isoScale * 0.71,
  tileH = cellSize * grid.isoScale * 0.36,
  // The per-elevation lift the render uses (`cellSize * isoScale * 0.4`). Defaulted so callers/tests that
  // don't pass it keep the old flat behaviour, but render() passes its own so the tint lands where the cell is.
  heightStep = cellSize * grid.isoScale * 0.4,
) {
  // The collision map means "a unit walking HERE is stopped", so the tint has to be painted on the surface
  // that unit would stand on, not on the raw ground plane. It was painted flat, so on any cell whose walk
  // surface is lifted (terrain elevation, or a floor the building's ground course sits on) the red diamond
  // landed a block BELOW the structure and spilled out from under it onto the grass: "collissions don't match
  // structures". Measured before the fix: cell 6,1 tinted at y=-129.6 while its surface was at y=-155.2, a full
  // block adrift. `isoStackLift` is the SAME lift the render puts a unit on, so the tint and the thing it describes
  // can never drift apart.
  const surfaceLift = (col: number, row: number): number =>
    grid.getHeight(col, row) * heightStep + isoStackLift(tileW, unitStandLevel(grid, col, row))
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Per-cell TILESET LABEL: the asset caption where a cell carries a placed element, else the terrain
  // autotile label computed PER VISIBLE CELL (not a whole-grid rebuild, that was the debug perf sink).
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
      // diamond + the building-footprint cube EXACTLY at any zoom, blocked cells GLUE edge-to-edge, no gaps.

      if (isBlocked) {
        // Red overlay for collision, ON the cell's walk surface (see surfaceLift).
        const cy = p.y - surfaceLift(col, row)
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
        ctx.beginPath()
        ctx.moveTo(p.x, cy - tileH)
        ctx.lineTo(p.x + tileW, cy)
        ctx.lineTo(p.x, cy + tileH)
        ctx.lineTo(p.x - tileW, cy)
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

  if (!labels) return // collision-only overlay ends here, no PLAYER tag

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

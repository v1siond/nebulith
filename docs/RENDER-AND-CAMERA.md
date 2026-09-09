# Nebulith — Rendering & Camera (the ISO projection, the 4-way + continuous rotation, screen-fixed input)

> **The source of truth for how a world coordinate becomes a screen pixel, and how the camera moves and turns.**
> Read this before touching the iso projection, the camera focus/clamp/pan, the 4-way rotation, or the
> screen-fixed movement/drag rules. It documents the MATH; it does not change it.
>
> Companion to [`MAP-MODEL.md`](MAP-MODEL.md) (the cell/block/tile model + the three views) and
> [`ANIMATION-SYSTEM.md`](ANIMATION-SYSTEM.md) (the z-index draw priority). MAP-MODEL owns the *model*; this
> doc owns the *projection + camera arithmetic* underneath the ISO view.
>
> **Where the code lives.** The PURE, unit-tested math is in `src/engine/render/isoOrientation.ts`,
> `isoTurn.ts`, `isoBlock.ts`, and `src/engine/tileset/tileHeight.ts`. The impure canvas glue that *uses* it
> is `src/engine/render/iso.ts` (ISO), `topdown.ts` (TOP), `birdseye.ts`/`frontElevation.ts` (2D). The editor
> camera seam is `src/game/editor/isoEditorCamera.ts`; screen-fixed input is `src/game/runtime/cameraMovement.ts`.

---

## 1. The isometric projection — world `(col, row)` → screen `(x, y)`

There is ONE fixed iso projection. Everything else (rotation, zoom, pan) feeds *different inputs* into it;
the projection formula itself never changes. It lives in `iso.ts` `isoWorldCellToScreen`:

```
wx = (viewCol - fc) · cellSize          // world offset from the camera focus, in world units
wz = (viewRow - fr) · cellSize
x  = w/2 + (wx - wz) · isoScale · 0.71   // screen x ∝ (col − row)
y  = h/2 + (wx + wz) · isoScale · 0.36   // screen y ∝ (col + row)
```

- `(fc, fr)` is the camera focus in cell units (§3); `w, h` the viewport; `isoScale` the zoomed scale
  (`grid.isoScale · zoom`).
- **`x ∝ (col − row)`** and **`y ∝ (col + row)`.** So:
  - **+col** → screen **down-right** `(+0.71, +0.36)`, **+row** → screen **down-left** `(−0.71, +0.36)`.
  - World origin `(0,0)` is the **BACK / top** corner; a higher `(col + row)` is **nearer** the camera
    (the **FRONT / bottom**). This is why the painter sorts back-to-front on `(col + row)` — see §5.

### The 2:1 squash — `0.71` and `0.36`

A diamond cell's on-screen half-extents are

```
tileW = cellSize · isoScale · 0.71   // half-width  of the ground diamond
tileH = cellSize · isoScale · 0.36   // half-height of the ground diamond
```

- `0.71 ≈ cos 45° = √2⁄2` — projecting the square grid rotated 45°.
- `tileH / tileW = 0.36 / 0.71 ≈ 0.507` — the classic **~2:1 iso squash** (a cell is drawn about twice as
  wide as tall). It is a *near*-2:1 dimetric, not exactly 2:1; both constants are baked literals in
  `iso.ts` (there is no separate `SQUASH` constant).

### Two independent VERTICAL scales

Height moves a point **up** on screen (subtracts from `y`). There are **two** distinct vertical units, and
mixing them up is a real bug source:

| What | Formula | Where |
|------|---------|-------|
| **Terrain elevation** — one `grid.getHeight` level | `heightStep = cellSize · isoScale · 0.4` per level | cliffs/hills raised ground |
| **Tile-stack block** — one stacked block (a cube) | `blockH = tileW · ISO_BLOCK_H_FRAC`, `ISO_BLOCK_H_FRAC = 0.9`; `isoStackLift = heightLevel · tileW · 0.9` | a stacked/extruded tile |

A stacked asset is lifted by **both**: `y − terrainHeight·heightStep − isoStackLift(tileW, heightLevel)`
(see `iso.ts` pick math and `isoStackLift`). The 2D top view mirrors the block unit as `heightLevel · tileH · 0.9`.

### The inverse — screen `(x, y)` → world `(col, row)`

`iso.ts` `isoScreenToWorldCell` is the exact algebraic inverse (so a click and the pixels can't drift):

```
a = (x - w/2) / (isoScale · 0.71)        //  a = wx - wz
b = (y - h/2) / (isoScale · 0.36)        //  b = wx + wz
viewCol = (a + b)/2 / cellSize + fc      //  wx = (a + b)/2  →  col
viewRow = (b - a)/2 / cellSize + fr      //  wz = (b - a)/2  →  row
```

then it **de-turns** the view coord back to world (§2). Without the de-turn a rotated camera would pick a
mirrored/transposed cell. At a whole turn the view coord is floored to a cell *first* (the corner math maps
index→index); mid-turn it is de-turned first and floored in world space (the axes are diagonal to the grid).

---

## 2. The 4-way camera rotation — `isoOrientation.ts`

The projection is fixed, so to rotate the *view* we rotate the grid coordinate **before** projecting it.
Feed the renderer `orientCell(worldCol, worldRow, cols, rows, o)` and the whole map appears rotated by `o`
quarter-turns. This is a turntable spin about the vertical axis: the ground plane IS the `(col,row)` plane,
height is a separate vertical offset, so rotating `(col,row)` and leaving height alone is exactly a spin seen
through the unchanged iso projection.

- **`Orientation = 0 | 1 | 2 | 3`** — quarter-turns **clockwise**. `0` is the historical default view; each
  `+1` rotates the rendered map CW by 90°.

### The one geometric primitive — `quarterTurnCW`

```
quarterTurnCW(col, row, w, h) = { col: h − 1 − row,  row: col,  w: h,  h: w }
```

One 90° CW turn of a coord in a `w×h` grid, landing in the **swapped** `h×w` grid. Everything else is built
from this, so the inverse is provably exact (four turns = identity).

**Worked example** (5×3 grid, `w=5, h=3`): world top-left `(0,0)` → `(h−1−0, 0) = (2, 0)` in the swapped 3×5
view — the **top-right** of the view. `TL → TR` is a clockwise turn. ✓ It deliberately reuses the SAME CW
quarter-turn `buildingCatalog.rotateOffsetCW` uses, so camera rotation and building/tile *facing* compose
without a sign clash.

### The exported maps

| Function | Meaning |
|----------|---------|
| `orientedDims(cols, rows, o)` | The view-frame dims — **swap** cols/rows on an odd (`o=1,3`) corner. |
| `orientCell(col, row, cols, rows, o)` | WORLD → VIEW: apply `o` CW quarter-turns. |
| `deorientCell(col, row, cols, rows, o)` | VIEW → WORLD (exact inverse): apply `(4 − o) % 4` more CW turns, starting from the VIEW dims. |
| `orientedDrawKey(...)` | The back-to-front key in the view frame = `orientCell().col + orientCell().row`. |
| `combineFacing(tileFacing, camera)` | `(tileFacing + camera) % 4` — the on-screen facing to draw a tile whose fixed world-facing is `tileFacing`. |

**Why `combineFacing` ADDs.** A tile's world-facing never changes as the camera turns (a door points the
same world direction always); rotating the camera only changes which screen-side you view it from. `orientCell`
carries the world CW by `camera` quarter-turns, so a fixed direction is carried CW by the same amount, and one
CW turn is `+1` in the facing index (south=0 → west=1 → north=2 → east=3). A full 4-turn cycle returns to start.

---

## 3. The camera — focus, clamp, pan (`iso.ts` `isoViewFocus` / `isoCameraFocus`)

The camera **follows the player** and can be **panned** by drag. `isoViewFocus` composes the two, in the
rotated view frame:

```
view  = orientCellTurn(playerFc, playerFr, cols, rows, turn)     // player focus, rotated into the view
focus = clamp ? isoCameraFocus(view, pPad, qPad, orientedDims…)  // game mode: keep viewport on the map
              : view                                             // editor: free pan, unclamped
return { fc: focus.fc − panCol, fr: focus.fr − panRow }          // pan applied UN-rotated (screen-fixed, §6)
```

Two deliberate splits:
1. **The player focus is oriented + clamped** — so the camera centres on the hero at any facing.
2. **The drag pan is applied AFTER, un-rotated** — a drag pans the map the same screen direction at every
   facing (the camera rotates the map, not the controls). See §6.

### The clamp — `isoCameraFocus`, in diamond `(p, q)` space

Game mode keeps the viewport on the map by clamping in the iso axes, not in `(col,row)`:

```
p = col − row  (horizontal screen axis)      q = col + row  (vertical screen axis)
pPad = w / (2·Kx),  qPad = h / (2·Ky)         Kx = cellSize·isoScale·0.71,  Ky = cellSize·isoScale·0.36
```

The diamond spans `q ∈ [0, cols + rows]`; at a given height `q` its four edges bound `p`:

```
fq = clampCameraSpan(fc + fr, qPad, 0, cols + rows)
pLo = max(−fq, fq − 2·rows)      // row ≥ 0 and row ≤ rows edges
pHi = min( fq, 2·cols − fq)      // col ≥ 0 and col ≤ cols edges
fp = clampCameraSpan(fc − fr, pPad, pLo, pHi)
fc = (fp + fq) / 2 ,  fr = (fq − fp) / 2      // back to (col,row)
```

`clampCameraSpan(focus, pad, lo, hi)`:
- **Map SMALLER than the viewport** (`hi − lo ≤ 2·pad`) → **re-centre** it: `(lo + hi) / 2`.
- Otherwise **clamp the focus to the map extent `[lo, hi]`** — so ANY cell (including the corners) can be
  dragged to centre (free pan). (The old `[lo+pad, hi−pad]` kept the whole viewport inside the map, which
  pinned the camera on a viewport-sized map; expect a little void past an edge now — intended.)

**Clamp only in game mode.** The editor renders **unclamped** (`clampCamera = false`) so drag-to-pan is free;
clamping fought the drag. `isoEditorCamera.ts` reuses this SAME `isoViewFocus`, so the editor's click→cell
inverse and the render draw with one camera and cannot drift.

---

## 4. Continuous rotation — `isoTurn.ts` (the animated spin between corners)

`isoOrientation` owns the four **corners** (exact integer math). `isoTurn` owns the animated spin **between**
them, and **delegates straight back to `isoOrientation` at every whole turn**, so a settled camera never
touches a float path and renders the bit-identical corner frame.

- **`CameraTurn`** is a real number on a `0..4` circle. A **whole** value IS an `Orientation` corner.
- `wrapTurn` returns an in-range turn **untouched** (no modulo → no float drift into the projection);
  `isWholeTurn = Number.isInteger`; `facingForTurn = round(wrapTurn) % 4` (the nearest corner).

### The mid-turn rotation — standard 2D rotation about the grid centre

`cellOrienterFor(cols, rows, turn)` builds a per-frame WORLD→VIEW mapper. At a whole turn it *is* `orientCell`.
Between corners, with `θ = turn · π/2`:

```
cu = col − worldMidCol,  cv = row − worldMidRow      // offset from the grid centre
viewCol = cu·cosθ − cv·sinθ + viewMidCol             // rotate, then re-centre into the (maybe-swapped) view
viewRow = cu·sinθ + cv·cosθ + viewMidRow
```

This is the standard 2D rotation matrix. **Sanity check at `turn = 1`** (`cosθ=0, sinθ=1`): `(cu, cv) → (−cv, cu)`
— exactly `quarterTurnCW`'s clockwise turn, so the continuous path agrees with the integer path at every corner.

`deorientCellTurn` is the inverse (a rotation by `−θ`, i.e. the transpose): `viewCol → world` uses
`+sin` on the row term and `−sin` on the col term. At a whole turn it *is* `deorientCell`. Mid-turn it returns a
**fractional** world coord that the caller floors to a cell.

### The one quantisation

The **view dims** swap on an odd corner, so mid-turn they follow the **nearest** corner
(`orientedDimsForTurn`). That term is a re-centring constant: the renderer projects a cell's offset FROM THE
FOCUS and both go through this module, so the constant **cancels** and the pixels stay smooth across the 45°
crossover. It only shows where a consumer uses the dims alone — the game-mode camera **clamp**. The editor
(where the drag controller lives) renders unclamped, so its spin is perfectly smooth.

### Settle / spin / ease

| Function | Meaning |
|----------|---------|
| `settleTarget(turn) = round(turn)` | Where a released drag rests — the nearest corner, in the SAME unwrapped frame (3.7 → 4, not back to 0), so it keeps turning forward. |
| `spinTarget(from, quarters)` | The 4 quick-turn buttons: `settleTarget(from) + quarters` — a button pressed mid-spin still lands square on a corner. |
| `easeOutCubic(p)` | Decelerating ease — fast off the mark, gentle into the corner. Injectable (`TurnEasing`). |
| `turnAt(from, to, p, ease)` | The turn to render at progress `p`. At `p ≥ 1` it lands on `wrapTurn(to)` **exactly** — a whole turn is what restores the bit-identical corner frame, so no float residue is left behind. |

---

## 5. Depth sorting — back-to-front, rotation-aware (`iso.ts`)

The iso painter draws a single merged list of tiles/units/blocks **back-to-front**. The order comes from
`isoDepthCompare`, wrapped by `isoDepthComparatorFor` for rotation.

### `isoDepthCompare` — the key

For a camera at facing 0, the key is the view-frame **`(col + row)`** — a higher key draws **later** (in
front), because §1 showed screen-`y ∝ (col + row)`. Precedence:

1. **Draw priority (`zIndex`, CSS-style) first.** `dz = (a.zIndex ?? 0) − (b.zIndex ?? 0)`; a higher zIndex
   draws later regardless of position. **Every cell currently defaults to `0`**, so `0 − 0 = 0` falls straight
   through and every existing map sorts byte-identically. (The capability is reserved for the composition-
   optimization pass — see MAP-MODEL §4 and ANIMATION-SYSTEM.)
2. **Positional key = `col + row + frontExtent`.** A directional-depth box (a roof / entrance apron / raised
   ground run spanning `depth` cells along a diagonal) reaches `depthFrontExtent(depth, dir)` cells toward the
   camera past its anchor, so it sorts by its **frontmost** covered cell and draws in front of what it overlaps.
   The bonus is added for a box that **RISES and so overhangs** — either it is **STACKED** (`heightLevel ≥ 1`: a
   roof / upper level) **or it is a full-block box sitting on the ground** (its rendered rise ≥ 1 — a **height-1
   meadow/water FLOOR run**, a raised curb, NOT a thin slab). A truly **FLAT** slab (rise < 1 — a merged town
   grass/road z-width tile) occludes nothing, so it sorts by its **anchor** and stays behind standing tiles (else
   a long road paints over a house in front of it). A depth-less tile adds `0` → byte-identical to plain
   `(col + row)`. **Watch the two heights:** `heightLevel` is the STACK level (0 for a ground block); the *rise*
   is the block's rendered **height** — a height-1 floor is a raised box at stack level 0, so gating on
   `heightLevel` alone (the old bug) left it flat-sorted and an adjacent block painted over its front. The rise
   is resolved by KIND (`iso.ts` `assetBlockRise` → `resolveTileHeight × scaleY`), because a generated floor pins
   no per-instance `height` — its height lives on its tile.

   **One exception keeps the ground under everything — a raised FLOOR run front-extends only when BARE.** If a
   standing tile or a unit sits on any cell the run covers, the run reports rise `0` to the comparator
   (`iso.ts` `runFrontExtentRise`, from a per-frame `standingCells` set) and keeps its **anchor** sort, so that
   content draws **over** it — a raised curb never paints over the rock / tree / hero standing on it. The trade
   is a little of the run's own completeness where it is occupied; a **bare** run (Alexander's raised road) still
   draws complete. This keeps the fix a pure perspective sort at z-index 0 — no z-index override required.
3. **Tie-break:** two assets on the SAME cell sort **bottom-up by `heightLevel`** so a brush stack composites
   higher blocks over lower ones. A non-asset tie returns `0` (stable insertion order).

### `isoDepthComparatorFor` — under rotation

`(col + row)` is a **view-frame** quantity, so under rotation each item must be fed its **oriented** coord and
its **oriented** depth axis. `isoDepthComparatorFor(items, cols, rows, turn)`:
- **Turn 0 → returns `isoDepthCompare` itself** (byte-identical frame).
- Otherwise it maps each item **once** (not per comparison) via `orientDepthItem`: orient the cell, rotate
  `depthDir` by the facing, and **re-anchor the span to its backmost cell** (`spanBackmost`), then hands the
  mapped pair to the unchanged `isoDepthCompare`.
- **Mid-turn it is valid for a continuous reason:** screen-`y ∝ (viewCol + viewRow)`, so that sum IS the
  camera-depth at ANY angle — feeding the fractional oriented coords makes the key the exact projected depth,
  and the order flips where two tiles genuinely reach the same screen depth.

### `spanBackmost` — why re-anchoring is needed

The depth sort rests on one invariant: **the anchor is the backmost cell.** Authoring holds to it
(`right-down`/`left-down` both step *toward* the camera). But a rotated camera can turn a span's axis to
`left-up`/`right-up`, which runs **backward** from the anchor — now the anchor is the span's *front* end, the
sort treats it as the back, and a merged run paints over the trunks it should sit behind. `spanBackmost`
restates the same cells from the far end (`col + dc·(n−1), row + dr·(n−1)`, direction reversed) so the
invariant holds again — instead of teaching every sort rule about a second case.

**Limitation (honest):** a `depthDir` is one of 4 discrete diagonals with no continuous form, so mid-turn the
re-anchor + front-extent follow the **nearest** corner. A multi-cell span can therefore occlude wrongly for at
most half a quarter-turn of the transient. **Single-cell tiles — every ordinary tile — are exact throughout.**

---

## 6. Screen-fixed input under rotation — `cameraMovement.ts` (+ the pan)

**Rule: the camera rotates the VIEW only. Movement and drag are SCREEN-fixed** — "up" always moves toward the
top of the screen, a drag always pans the map the same screen direction, at every facing. The map turns; the
controls don't.

### Movement — `moveWorldDelta`

The base deltas are authored at facing 0 (`ISO0`: `up=[−1,−1]`, `down=[1,1]`, `left=[−1,1]`, `right=[1,−1]`;
the flat 2D/top view is axis-aligned, `FLAT0`, and ignores facing). To keep a key pinned to its screen
direction, the input is rotated by the **inverse** of the camera:

```
rotateDeltaCCW([dc, dr]) = [dr, −dc]      // ONE CCW quarter-turn, the inverse of the camera's CW orient
moveWorldDelta(dir, facing, iso) = iso ? rotateDeltaCCW(ISO0[dir], facing)  // applied `facing` times
                                       : FLAT0[dir]
```

**Why the inverse.** The camera's `orientCell` rotates the world **CW** by `facing` to make it *look* rotated.
If the raw key delta went through unchanged, "up" would follow the map around. Pre-rotating the delta **CCW**
by `facing` cancels the camera's CW turn on screen, so the same key produces the same *screen* motion at every
facing.

### Drag pan — the same rule, in `isoViewFocus`

The drag pan (`panCol`/`panRow`) is subtracted from the focus **after** the player focus is oriented (§3), i.e.
**un-rotated**. So a horizontal drag pans the map horizontally on screen whatever the facing — the pan is
screen-fixed for the identical reason movement is.

---

## 7. Tiles, height & compositions in the render (pointers into MAP-MODEL)

The render draws DATA; it invents nothing. For the full model see MAP-MODEL; the render-relevant essentials:

- **A tile is a baked IMAGE resolved by KEY** from the Postgres tileset (never a glyph fallback pre-load) —
  its `label` for a composition cell, its `kind` for a label-less tile such as a FLOOR (whose identity is its
  ground `tileKey`). The renderer resolves a stacked cell by its own `label` first, then falls back to the
  coarse kind. **Both go through the one `styleTileImage(key, style)`, in EVERY art style** — the key picks the
  tile, the style picks only which tileset supplies the PNG (MAP-MODEL §5, §8; ENGINE-ARCHITECTURE §3). The
  kind lookup used to be gated to floors and to ASCII, which left every other label-less ascii tile image-less:
  it missed the cube-sprite cache and fell into the per-face `clip + fillText` path — the reason ASCII rendered
  ~2× slower than emoji on the same map.
- **Height is per-tile DATA, read uniformly** (`tileHeight.ts`). `resolveTileHeight = asset.height ?? tile.height ?? 0`
  (an explicit `0`/negative clamps to flat). A **flat** tile (a fractional block height, e.g. `0.1` — floor,
  road, flower) draws as ONE partial layer at that fraction via `partialBlockScale`; a **standing** tile
  (`≥ 1`) stacks whole blocks and the count carries the height. The 2D/top views ignore height (a flat square
  there). **Collision is a separate per-cell SETTING**, never derived from height (MAP-MODEL §4).
- **Compositions stamp as per-cell tiles** (`game/runtime/composition.ts`), the SAME per-cell path a single
  tile uses — no special building drawer. A vertical RUN of the same tile collapses to ONE block sized
  `scaleY = run length` (perf); a **roof** is authored as ONE depth-spanned block per column
  (`settings.depth` along `settings.depthDir`, `settings.scaleY` = its gable-step height); the **entrance
  apron** uses the same z-width mechanism on the facade axis and, being a floor tile, lies flat. On save,
  `compositionCellRender` is the ONE mapping shared by the live stamp and the reload, so a generated stage
  reloads exactly as stamped. A turned building's `depthDir` is rotated by `rotateDepthDir` so its roof spans
  the right grid axis (see `isoBlock.ts` §below).

### The 3D extrusion primitives — `isoBlock.ts`

- `isoBlockFaces` extrudes a cell's flat diamond into a unit cube — its TOP face + the two camera-visible
  side walls (front-left `L→B`, front-right `B→R`); the far walls + bottom are never emitted.
- `DepthDir` (4 iso diagonals) with `DEPTH_STEP` (screen offsets in `tileW/tileH` units) and `DEPTH_CELL_STEP`
  (grid steps). `isoDepthBox` sweeps the unit cube `(D−1)` steps along `dir` into ONE long box (a
  length-spanning parallelogram top + one full-length wall + one single-cell end cap) — NOT `D` separate cubes.
- `rotateDepthDir(dir, k)` turns a direction by `k` CW quarter-turns (grid step `(dc,dr) → (−dr,dc)`), the SAME
  rotation the coords take — so a span authored south-facing follows its building when it is rotated, and a
  rotated camera carries the span axis correctly.
- `isoZOffset(z, dir, tileW, tileH)` slides a tile `z` cells along an iso diagonal (a screen offset, not a
  vertical lift).

### The 2D / TOP projections (for contrast)

- **TOP** (`topdown.ts`): `x = w/2 + (col − camCol)·tileW`, `y = h/2 + (row − camRow)·tileH` — a plain
  Width×Depth footprint, height hidden.
- **2D** (`frontElevation.ts`): a true Width×Height front elevation — horizontal axis is `col`, vertical is
  `heightLevel` (stack up), **depth collapsed**: per `(col, heightLevel)` the cells overlap, and one is hidden
  only when a cell **in front of it** (nearer the camera / higher row) is **at least as TALL** — real
  occlusion, not row alone. Equal-height rows (a wall column, a back wall behind a door) collapse to the
  front-most exactly as before, so a 4-deep × 5-tall house still reads 5 tall (not ~9); but a cell **taller
  than everything in front of it survives** and draws its extra height above the front face. That is what keeps
  a FLAT composition (fountain, well — all cells at level 0 but spanning depth) visible: its rim is 1 block, its
  interior water grows to ~4, so the water peeks over the front rim instead of being dropped behind it
  (MAP-MODEL §5 — a composition cell resolves by its LABEL in EVERY view). Every kept cell anchors its stack at
  the structure's front row; a cell's max height reads its base height×scaleY AND any height-grow animation peak.

---

## Keeping this current

Update this doc whenever the projection constants, the camera focus/clamp/pan, the rotation math, the depth
sort, or the screen-fixed input rule change. The pure modules it documents are unit-tested — if a formula
here and a test disagree, the test + code win; fix the doc. Cross-check against MAP-MODEL so the model and the
math stay aligned.

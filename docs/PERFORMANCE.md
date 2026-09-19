# PERFORMANCE, the framework

The frame budget, what a layer is allowed to spend, and how to prove a change helped rather than assume it.

Written 2026-09-19, after a session that moved a 100x60 city at maximum zoom out from about 25 fps to about
50. Nearly everything in here was learned by being wrong first, so the measurement rules come before the
optimisation rules on purpose.

---

## 1. The budget

One frame is **16.7ms** at 60 fps. That is the target he set: *"make all you can to get the fps up to 60+"*.

The worst case this engine is judged on is the one he named: **a 100x60 map at maximum zoom out, walked with
WASD in the editor**. Zoomed out is the worst case because the viewport cull stops helping: at 50% zoom a cell
is 14x7 px, so roughly 4,800 cells fit on a 1230x770 canvas and a 6,000-cell map is nearly all on screen.

Read `window.__isoRenderMs` for the renderer's own cost and count `requestAnimationFrame` callbacks for the
delivered rate. They answer different questions and you need both: a 40ms frame with a 12ms render is not a
rendering problem.

---

## 2. Measure first, and distrust the first number

Five ways a performance measurement lied during one session. Every one of them produced a confident wrong
conclusion that survived until the next check.

### 2.1 The bundle was stale

The engine's esbuild watcher **dies silently** and leaves the last good `priv/static/assets/js/game/game.js`
behind. Three separate changes measured as "no effect" because none of them were in the bundle. A fourth
measured as "no effect" and genuinely had none, which is indistinguishable without checking.

**Always run `mix esbuild game` before measuring, and grep the bundle for a token from your change.**

### 2.2 No warm-up

Sprite caches are cold for the first frames and the JIT has not settled. The opening seconds read several fps
low. Throw away six seconds of walking before counting anything.

### 2.3 One sample

Back-to-back runs of the SAME build differed by 6 fps, which is wider than most changes worth making. Take at
least three samples and report the median.

### 2.4 The map is random

Every generated world is different, so two runs are two different workloads. Cross-run comparison can only see
large effects. **To measure a small change, A/B it inside ONE page session behind a temporary global flag**
(`window.__something`), alternating conditions, then delete the flag.

### 2.5 The experiment did not take

A flag that never reached the code reads exactly like a change that did nothing. Assert the mechanism moved:
if you are skipping floors, the draw count must fall. It did not, which is how the stale bundle was found.

The same rule applies to the scene itself. `halfSpan` implied the harness was at 64% zoom when it believed it
was at the 50% clamp; `e2e/perf.mjs` now prints the live zoom and tile size so the run proves its own setup.

---

## 3. What actually costs, measured

On the 100x60 worst case. Percentages are self time from the CPU profiler.

| Cost | Share | What it is |
|---|---|---|
| `drawImage` | 30-38% | One blit per visible asset, ~1,700-2,400 per frame |
| `(program)` | 14-19% | V8 and browser internals |
| `fill` | 3-7% | `fillQuad` on uncached blocks, and the grid skirt |
| `render` + `drawIsoAssetAscii` | 10-12% | The draw loop's own JS |
| React element creation | 7% (now 0) | The editor re-rendering while you walk |

**The count of draws was never the problem.** Skipping 72% of the tiles changed nothing measurable, because a
whole-pixel blit is already cheap. The COST PER DRAW was the problem.

---

## 4. The rules

### 4.1 The lattice is whole pixels

**This was worth a third of the frame.** 36.9 fps to 45.8 with the draw counts held identical.

A 1:1 `drawImage` onto whole-pixel coordinates is a straight copy. A fractional destination makes the
rasterizer resample every pixel through a bilinear filter, the same slow path a sheared draw takes. It is not
a small constant: measured, fractional blits cost several times a whole-pixel one.

In this projection, stepping one column moves the screen point by exactly `tileW` and one row by exactly
`tileH` (expand `viewToScreen` and `cellSize` and `isoScale` cancel). So those two numbers ARE the lattice:

- Round `tileW`, `tileH` and `heightStep` to integers.
- Round the camera's contribution ONCE (`originX`/`originY`), not per cell.
- Round a block's half-dimensions (`bw`, `bd`, `bh`), because a face is drawn at `centre ± bw`, so a
  fractional dimension puts the corners back off-pixel. Snapping the lattice alone left 18% of blits
  fractional, all of them block faces. Snapping the dimensions too took it to 4%.
- Round a sprite's anchor (`cubeBlockSprite`'s `ox`/`oy`), since the blit lands at `centre - anchor`.

**Snap the LATTICE, not each tile.** Rounding each tile's own destination buys the same fast blit, but
adjacent tiles then cross their rounding boundaries at different moments as the camera pans, so the seam
between two cells opens and closes by a pixel and the ground shimmers while you walk. Rounding the lattice
constants keeps every relative distance exact.

The hero keeps asking with a fractional cell, so they still move smoothly. Only whole col/row land on whole
pixels, which is exactly the set of things that should.

### 4.2 Nothing re-renders React per frame

A full render of the editor component measures about **16ms of element creation**, a whole 60fps frame.

`syncCombatHud` built a fresh `PlayerHud` object every 100ms and committed it. A new object is never `===` the
last one, so React re-rendered the entire 7,000-line component **8.4 times a second while standing still**,
for six numbers that had not changed. That is the *"the whole app is just stupidly slow in editor mode"*
complaint, and it is now 0 per second, idle and walking.

**A value the CANVAS draws belongs in a ref, not in state.** State is for what a PANEL shows, and it is
committed only when the panel would differ. `setEntities` already had the rule written beside it; the HUD did
not follow it.

### 4.3 Cull before the work, not after

The viewport cull is per-tile and derived: a cell further out than its own extent (`±tileW`, `±tileH`) cannot
put a pixel on screen. It takes 8,400 assets down to about 3,000.

The grid skirt walked the camera's SQUARE window, which on a map smaller than that square is every cell, doing
neighbour lookups for all 6,000 to draw the rim and the cliffs. It now asks whether a cell can reach the
canvas first, with the vertical margin bounded by `grid.maxGroundHeight()` rather than a guessed constant.

### 4.4 Bake what repeats, at the right granularity

`cubeBlockSprite` bakes one cube per distinct (image, colour, tint, cap, dims) and blits it, which is why a
city of thousands of wall cells costs one drawImage each.

A cache at the WRONG granularity is worthless. A face-level bake was added on the theory that the shear was
the cost, and measured **exactly zero** because cubes were already baked and every face was one cell. It was
deleted. Prove a cache's hit rate matters before keeping it.

---

## 5. The harness

- `assets/e2e/perf.mjs` — the worst case, warmed up, sampled, printing zoom and tile size so the run proves
  its own setup. `node e2e/perf.mjs "Woodland city" city 100 60 3`
- `assets/e2e/bigprofile.mjs` — the same scene under the CPU profiler, top 25 by self time.
- `assets/e2e/fractionalBlits.mjs` — whole-pixel vs fractional blits, with the top offenders by stack. The
  check for §4.1.
- `assets/e2e/drawcalls.mjs`, `cull.mjs` — per-canvas op counts and what each cull threw away.
- `assets/e2e/bigmap.mjs` — the worst case with per-canvas op counts, no warm-up (prefer `perf.mjs`).

## 6. How a new layer proves it can afford itself

1. Measure the worst case before it (median of 3, warmed up, bundle rebuilt).
2. Add the layer behind a flag you can toggle in one page session.
3. A/B it in that session and report both numbers and the mechanism count (draws, fills) that moved.
4. If it costs more than ~1ms of a 16.7ms frame, it needs a cull, a cache, or a reason.
5. Delete the flag.

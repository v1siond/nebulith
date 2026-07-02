# Nebulith — Stage-Generation Algorithm Database

> **How we use this.** This is the decision record for every algorithm-heavy generator
> feature. **Trigger the Algorithm Advisor (this doc) before building any generation step**
> — maze, cave, connectivity, prop scatter, pathfinding, room layout, or noise — so we pick
> the *principled* algorithm instead of hand-rolling another one-off (the current forest is a
> hand-rolled tree-cluster + protected-trail hack we want to retire). Each entry gives the
> **recommended algorithm**, **complexity**, **when-to-use / tradeoffs**, a **concrete
> TypeScript-on-a-2D-grid approach** matching our guard-clause / SRP / no-deep-nesting coding
> standard, and **authoritative references**. End of doc: priority order + the exact calls for
> the next two builds (cave variant, forest improvement).
>
> **Context (from `GENERATION-SPEC.md`):** Nebulith stages are 2D grids, identity =
> `(zone × variant)` — zones `{lava, frozen}`, variants `{village, forest, cave, temple,
> boss-stage}`. The grid carries `ground[][]`, `collision[][]` (**blocks = logical collision,
> NOT elevation** — see `project-nebulith-collision-model`), `props[]`, and a `spawn`. **Every
> stage must be fully navigable: entrance → exit reachable.** Generation is *archetype-driven*,
> not pure RNG — algorithms supply the controlled randomness *inside* a coherent skeleton.

**Shared grid conventions used by every snippet below**

```ts
// Matches src/engine/stageGenerator.ts. col = x, row = y. collision[row][col] = true ⇒ blocked.
type Cell = { col: number; row: number }
const inBounds = (c: number, r: number, cols: number, rows: number) =>
  c >= 0 && c < cols && r >= 0 && r < rows
// 4-neighbourhood for navigation/connectivity (movement is orthogonal in the engine loop).
const N4: ReadonlyArray<[number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]]
const key = (c: number, r: number) => `${c},${r}` // stable Set/Map key
```

We treat `Math.random()` as the entropy source today; every generator should accept a seedable
RNG later (a small mulberry32 closure) so `(zone, variant, seed)` reproduces a stage — important
for the spec's "cave randomized per run, reproducible from inputs" goal. Keep the RNG **injected**,
never a module global (coding-standard: no module-level mutable state).

---

## 1. Maze / forest layout — *winding clearings, not a tight perfect maze*

**Recommended: a Drunkard's-Walk / random-walk carve for the trail + clearings, NOT a perfect-maze
algorithm.** For the forest specifically, reach for **Prim's** only if you want a true branching
maze; reach for **recursive backtracker** if you want long serpentine corridors. But the target
("Viridian-Forest style — clearings joined by winding corridors, *not* a tight 1-cell maze") is an
**open/organic carve**, which the perfect-maze family does *not* give you.

### Why not the perfect-maze family here

A "perfect maze" (recursive backtracker, Prim's, Kruskal's, growing-tree, Eller's) carves on a
**half-resolution lattice** — cells on even coordinates, walls on odd — and produces a graph with
**exactly one path between any two cells, no loops, 1-cell-wide corridors, walls everywhere else.**
That is the opposite of a forest: no clearings, no loops, every step is a wall decision. Their
*bias* (well documented) is about corridor texture, not openness:

| Algorithm | Texture / bias | Best for |
|---|---|---|
| **Recursive backtracker (DFS)** | Long, winding corridors, few dead-ends, low branching — feels like exploring one big snake. | Cave-corridor temples; "get-lost" mazes. |
| **Prim's (randomized)** | Many short dead-ends, bushy/organic, frequent decision points (edges near the start are effectively lighter-weight). | Branchy hedge mazes. |
| **Kruskal's (randomized)** | Uniform, "even" maze; merges disjoint sets via union-find until one tree. | Texturally neutral baseline. |
| **Growing-tree** | *Tunable*: pick-newest ⇒ backtracker; pick-random ⇒ Prim-like; mix the two for a blend. | One implementation, dial the bias. |
| **Cellular automata** | Open blobby caverns, **loops allowed**, no guaranteed single solution. | Caves (see §2), open forests. |

**The forest we want = open carve, with loops, with clearings.** That is structurally a *cave with
trees as the walls*, plus a guaranteed trail. So the principled forest is:

### Recommended forest approach (retire the hand-rolled version)

1. **Carve a guaranteed spine** with a **biased drunkard's walk** from entrance → exit. A single
   drunkard's walk is *guaranteed connected* and naturally mixes narrow paths with wider rooms —
   exactly the winding-trail look. Bias the step toward the exit so it makes progress instead of
   meandering forever.
2. **Open a few clearings** by widening the walk at random points (carve a small disk).
3. **Fill the rest with trees** (the "walls") via §4 Poisson-disk scatter so the canopy looks
   organic, not gridded.
4. **Validate + repair** with §3 (flood fill from spawn; any walkable pocket the player can't reach
   gets either connected or planted over).

This replaces `carveForestTrail` (a deterministic sine-ish sweep) + `plantTreeClusters` (rectangular
clusters with `isRaggedEdge`) with one principled pipeline whose openness, loopiness, and clearing
count are tunable knobs.

- **Complexity:** Drunkard's walk to cover a target open-fraction *f* of an `N = cols·rows` grid is
  **O(N)**-ish in practice (steps ≈ proportional to area covered; coupon-collector overhead means
  budget ~`k·N` steps and stop at target fill). **Space O(N)** for the grid + an O(walk-length) set.
- **Tradeoffs:** Drunkard's walk = trivial, fast, connectivity *free*, but shape control is loose —
  cap step budget and bias toward exit, else it sprawls. Prim's/backtracker = strong structure but
  wrong *feel* for a forest (use them for dungeon corridors in §6). Cellular automata = best organic
  blobs but needs the §3 connectivity repair pass.

### Concrete TS (biased drunkard's walk spine)

```ts
function carveForestSpine(
  collision: boolean[][], cols: number, rows: number,
  entrance: Cell, exit: Cell, rng: () => number,
): Set<string> {
  const open = new Set<string>()
  const carve = (c: number, r: number) => {
    if (!inBounds(c, r, cols, rows)) return
    collision[r][c] = false
    open.add(key(c, r))
  }
  let { col, row } = entrance
  const budget = cols * rows * 2 // safety cap — never loop unbounded
  for (let step = 0; step < budget; step++) {
    carve(col, row)
    if (col === exit.col && row === exit.row) break
    const [dc, dr] = nextStep(col, row, exit, rng) // biased toward exit (helper below)
    col = clamp(col + dc, 1, cols - 2)
    row = clamp(row + dr, 1, rows - 2)
  }
  return open
}

// 60% drift toward the exit, 40% pure random ⇒ winding but always progressing.
function nextStep(col: number, row: number, exit: Cell, rng: () => number): [number, number] {
  if (rng() < 0.6) return [Math.sign(exit.col - col) || pickAxis(rng), 0] // toward exit on one axis
  const dir = N4[Math.floor(rng() * N4.length)]
  return [dir[0], dir[1]]
}
```

`widenClearings(open, ...)` then picks a few `open` cells and carves a radius-1..2 disk around each.
Trees fill `!open` cells via §4. Each helper is a single-responsibility named function (no nested
for/if-else blocks) — per coding standard.

**References**
- Drunkard's Walk maps (guaranteed-connected, mixed corridors+rooms): <https://bfnightly.bracketproductions.com/rustbook/chapter_28.html>
- Random Walk Cave Generation (RogueBasin): <https://www.roguebasin.com/index.php/Random_Walk_Cave_Generation>
- Maze-algorithm bias reference (backtracker / Prim / Kruskal / growing-tree texture): Jamis Buck, <https://weblog.jamisbuck.org/2010/12/27/maze-generation-recursive-backtracking> and Wikipedia, <https://en.wikipedia.org/wiki/Maze_generation_algorithm>

---

## 2. Cave generation — *cellular automata (the 4-5 rule)*

**Recommended: 4-5-rule cellular automata, then §3 connectivity repair.** This is the genre-standard
for organic caverns and exactly what the `cave` variant ("randomized per run for replays") needs.

### Confirmed parameters (tune in-engine, these are the well-attested defaults)

| Parameter | Value | Note |
|---|---|---|
| **Initial wall fill** | **45 %** (range 40–50 %) | Each cell random-seeded `wall` with p ≈ 0.45. <45 % → too open/sparse; >50 % → walls merge into one mass. |
| **Iterations** | **4–5** for crisp caves; **up to ~12** for very smooth walls | Diminishing returns past ~5; pick by look. |
| **Rule (the "4-5 rule")** | `wall` if it is a wall **and** ≥ **4** of its 8 neighbours are walls; **or** it is floor **and** ≥ **5** neighbours are walls. | i.e. **birth-limit 5, death/survival uses 4** on the Moore (8) neighbourhood. |
| **Edge treatment** | Out-of-bounds counts as **wall** | Guarantees a closed border so the cave never leaks off-grid. |
| **Open-area target** | Keep largest region if it is **≥ ~45 %** open, else reroll | Combined with §3 flood fill. |

A common refinement: in early iterations also force `wall` when a wider (radius-2) neighbourhood is
nearly empty — this fills lonely floor specks. Optional; start with the plain 4-5 rule.

- **Complexity:** **O(iterations · N)** time (each pass scans every cell, counts 8 neighbours =
  constant). **Space O(N)** — needs a **double buffer** (read from grid A, write to grid B, swap)
  so a cell's update can't see this-pass results. Never update in place.
- **Tradeoffs vs. drunkard's walk:** CA gives the best *natural-looking* cavern (varied chambers,
  rough walls) but **does not guarantee connectivity** — output can be 3 separate chambers; §3 is
  mandatory. Drunkard's walk guarantees connectivity but looks more "tunnelly." **Hybrid (best of
  both):** seed with a drunkard's walk, then run 2–3 CA smoothing passes — connectivity from the
  walk, organic walls from CA. Recommend the **plain CA + §3 repair** first; adopt the hybrid if
  rerolls get expensive.

### Concrete TS (double-buffered 4-5 rule)

```ts
function generateCave(cols: number, rows: number, rng: () => number, opts = { fill: 0.45, iters: 5 }) {
  let grid = makeGrid(cols, rows, () => rng() < opts.fill) // true = wall
  for (let i = 0; i < opts.iters; i++) grid = caStep(grid, cols, rows)
  return grid
}

function caStep(grid: boolean[][], cols: number, rows: number): boolean[][] {
  const next = makeGrid(cols, rows, () => false)
  forEachCell(cols, rows, (col, row) => {
    next[row][col] = nextWallState(grid, col, row, cols, rows)
  })
  return next
}

function nextWallState(grid: boolean[][], col: number, row: number, cols: number, rows: number): boolean {
  const walls = countWallNeighbours(grid, col, row, cols, rows)
  if (grid[row][col]) return walls >= 4 // stays wall if it has ≥4 wall neighbours
  return walls >= 5                     // floor becomes wall if ≥5 wall neighbours
}

function countWallNeighbours(grid: boolean[][], col: number, row: number, cols: number, rows: number): number {
  let n = 0
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue
      const c = col + dc, r = row + dr
      if (!inBounds(c, r, cols, rows) || grid[r][c]) n++ // OOB counts as wall
    }
  }
  return n
}
```

Then write `!wall` cells as walkable into `collision[][]`, scatter zone props (§4) on floor cells,
and run §3 to keep only the reachable region.

**References**
- Cellular Automata Method for Generating Random Cave-Like Levels (RogueBasin — canonical, 45 % fill, 4-5 rule, OOB=wall): <https://www.roguebasin.com/index.php/Cellular_Automata_Method_for_Generating_Random_Cave-Like_Levels>
- jrheard, *Procedural Dungeon Generation: Cellular Automata* (iteration counts, connectivity caveats): <https://blog.jrheard.com/procedural-dungeon-generation-cellular-automata>
- Jeremy Kun, *The Cellular Automaton Method for Cave Generation* (math + double-buffer rationale): <https://www.jeremykun.com/2012/07/29/the-cellular-automaton-method-for-cave-generation/>

---

## 3. Connectivity validation + repair — *flood fill (BFS) from spawn; union-find for region census*

**Recommended:**
- **Validation / "is the exit reachable from spawn?":** single **BFS/flood fill** from spawn over
  4-neighbour walkable cells; check the exit cell is marked. This *is* the navigability guarantee
  the spec demands.
- **Region census + repair ("connect or cull all pockets"):** **union-find (disjoint-set)** to label
  every connected walkable region in one pass, then repair.

### Repair strategy (the part most generators skip)

1. Label all walkable regions (union-find, or repeated flood fills).
2. **Pick the region containing `spawn` as the "main" region** (not merely the largest — spawn must
   be in it, and the exit must join it).
3. For every *other* region, choose: **connect** it (carve the shortest tunnel from its nearest cell
   to the main region — a straight/L corridor, or an A* path §5 through walls with a high cost) **or
   cull** it (fill it back to wall / plant trees over it). **Rule of thumb:** connect a region if it
   is large enough to be worth visiting; cull tiny specks.
4. **Force the exit in:** if the exit cell is unreachable after that, carve a guaranteed corridor
   spawn → exit (the §1 drunkard's-walk spine already provides this for forest/cave). Re-run BFS to
   confirm. This is the hard guarantee — never ship a stage where BFS(spawn) ∌ exit.

- **Complexity:** BFS reachability = **O(N)** time, **O(N)** space (visited grid + queue). Union-find
  with path-compression + union-by-rank = **O(N · α(N)) ≈ O(N)**, and it computes *all* components in
  one pass with better cache behaviour than repeated flood fills. Tunnel carving per pocket = O(path
  length) via A* / straight line.
- **When to use which:** **BFS** when you only need *one* question answered (reachable? distance
  field from spawn?) — simplest, and a BFS distance field doubles as a spawn-distance/difficulty map.
  **Union-find** when you need *every* region at once (census, "keep largest", merge-all). DFS works
  too but BFS's queue avoids deep recursion stack-overflow on big open caves — prefer iterative BFS.

### Concrete TS (BFS reachability — the ship-gate)

```ts
function reachableFrom(collision: boolean[][], cols: number, rows: number, start: Cell): Set<string> {
  const seen = new Set<string>()
  if (collision[start.row][start.col]) return seen // spawn must itself be walkable
  const queue: Cell[] = [start]
  seen.add(key(start.col, start.row))
  while (queue.length > 0) {
    const { col, row } = queue.shift()!
    for (const [dc, dr] of N4) visitNeighbour(col + dc, row + dr, collision, cols, rows, seen, queue)
  }
  return seen
}

function visitNeighbour(
  c: number, r: number, collision: boolean[][], cols: number, rows: number,
  seen: Set<string>, queue: Cell[],
): void {
  if (!inBounds(c, r, cols, rows)) return
  if (collision[r][c]) return
  const k = key(c, r)
  if (seen.has(k)) return
  seen.add(k)
  queue.push({ col: c, row: r })
}

// Ship-gate every generated stage must pass:
const ok = (stage: StageData, exit: Cell) =>
  reachableFrom(stage.collision, stage.cols, stage.rows, stage.spawn).has(key(exit.col, exit.row))
```

**References**
- Flood-fill region identification + connect-closest-room repair (procedural caves): <https://frothzon.itch.io/generating-procedural-caves-in-gamemaker-studio>
- Union-find for connected-component labelling (faster/simpler than repeated flood fill): <https://github.com/hughsk/flood-scan/issues/1> and <https://usaco.guide/silver/flood-fill>
- Flood fill (algorithm + complexity): <https://en.wikipedia.org/wiki/Flood_fill>

---

## 4. Natural prop / tree distribution — *Poisson-disk (blue-noise) sampling*

**Recommended: Bridson's Poisson-disk sampling.** Uniform `Math.random()` placement (what
`scatterClearingCover` does now) clumps and leaves bald patches — the eye reads it as noise.
Poisson-disk (blue-noise) gives **random *and* evenly spaced**: no two props within radius `r`, no
visible clumps or voids. This is the standard for organic object placement (trees, rocks, flowers).

- **Algorithm (Bridson, O(N)):** maintain an **active list** of placed points; for each, throw up to
  `k` (≈30) candidates in the annulus `[r, 2r]`; accept a candidate only if no existing point lies
  within `r`, checked in **O(1)** against a background grid of cell size `r/√2` (so each cell holds
  ≤1 sample). Accepted points join the active list; exhausted points leave it. Terminates when the
  active list empties.
- **Complexity:** **O(N)** time in the number of points produced, **O(grid)** space — fast enough to
  run per-stage every generation.
- **Tradeoffs:** Poisson-disk = best organic look, single density knob (`r`). Larger `r` = sparser.
  **Vary `r` by zone/variant** (dense forest = small `r`; sparse lava field = large `r`) and even by
  prop type (trees far apart, flowers close). For *clustered* features (tree groves, ore veins) layer
  two passes: Poisson-disk for grove *centres*, then a tighter scatter within each grove. Cheaper
  fallback if ever needed: **jittered grid** (place on a grid, jitter each point inside its cell) —
  ~80 % of the look for ~20 % of the code, but with mild grid regularity.

### Concrete TS (Bridson core, grid-accelerated)

```ts
function poissonDisk(cols: number, rows: number, r: number, rng: () => number, k = 30): Cell[] {
  const cell = r / Math.SQRT2
  const gw = Math.ceil(cols / cell), gh = Math.ceil(rows / cell)
  const bg: (Cell | null)[] = Array(gw * gh).fill(null)
  const gi = (c: number, rw: number) => Math.floor(rw / cell) * gw + Math.floor(c / cell)
  const samples: Cell[] = [], active: Cell[] = []
  const seed = { col: rng() * cols, row: rng() * rows }
  active.push(seed); samples.push(seed); bg[gi(seed.col, seed.row)] = seed

  while (active.length > 0) {
    const i = Math.floor(rng() * active.length)
    const p = active[i]
    const found = tryCandidate(p, r, k, cols, rows, rng, bg, gw, gh, cell, gi)
    if (!found) { active.splice(i, 1); continue } // exhausted — retire this point
    active.push(found); samples.push(found); bg[gi(found.col, found.row)] = found
  }
  return samples.map(s => ({ col: Math.floor(s.col), row: Math.floor(s.row) }))
}
```

`tryCandidate` throws up to `k` annulus points and returns the first that is in-bounds and ≥ `r` from
every neighbour in the 3×3 block of background cells around it (the O(1) check), else `null`. Then
only keep samples whose cell is walkable + not on the trail/road — reusing the §1 `treePlanter` guard
clause.

**References**
- Robert Bridson, *Fast Poisson Disk Sampling in Arbitrary Dimensions* (SIGGRAPH 2007 — the O(N) algorithm): <https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf>
- Improved Bridson variant + blue-noise rationale (annulus, k samples, r/√2 grid): <https://extremelearning.com.au/an-improved-version-of-bridsons-algorithm-n-for-poisson-disc-sampling/>
- Reference implementation (header-only C++, easy to port): <https://github.com/martynafford/poisson-disc-distribution-bridson>

---

## 5. Pathfinding — *A\* for routing, BFS for reachability, Dijkstra for weighted fields*

**One rule of thumb (Red Blob Games):**
- **A\*** — finding **one** path between **two** points, *fast*. Use for **connector routing**
  (carve a corridor from room A's door to room B's door) and **player navigation**. Heuristic =
  **Manhattan distance** on our 4-connected grid (admissible ⇒ optimal path). When the heuristic is
  0, A\* degrades to Dijkstra; an admissible-but-tight Manhattan heuristic gives the speed-up.
- **BFS (flood fill)** — **reachability** and **distance-from-one-source over the whole map** when
  every step costs the same (our case). Use it for §3 navigability validation and for a
  **distance-from-spawn field** (difficulty ramp, "place boss/exit far from spawn"). Simpler than
  Dijkstra; pick it whenever weights are uniform.
- **Dijkstra** — only if movement cost **varies** (e.g. lava-edge = expensive, road = cheap so
  generated paths *prefer roads and avoid hazards*). Same as A\* with a 0 heuristic; reach for it
  when you want a full weighted distance field rather than a single path. This is the right tool when
  we later want connector corridors to **route around the zone hazard** (`lava` / `ice_water`).

| Need | Algorithm | Why |
|---|---|---|
| Corridor A→B, fast, uniform cost | **A\*** + Manhattan heuristic | one path, optimal, goal-directed |
| "Is exit reachable?" / spawn-distance field | **BFS** | uniform cost, no heuristic needed |
| Path that prefers roads / avoids hazard tiles | **Dijkstra** (or **weighted A\***) | costs vary per tile |

- **Complexity (grid, V cells, E ≈ 4V edges):** BFS **O(V)**. Dijkstra with a binary heap **O(E log
  V) = O(V log V)**. A\* same worst case but explores far fewer nodes with a good heuristic. **Space
  O(V)** for all three (frontier + came-from + cost-so-far).
- **Tradeoffs:** Don't pay for Dijkstra/A\* when BFS answers the question — uniform-cost reachability
  is BFS's job. Don't use BFS for a *single* long route when A\* would expand a fraction of the
  nodes. For connector routing we usually want the path to *carve through walls cheaply* (cost-to-dig
  low) but *prefer existing floor* — that's weighted A\* / Dijkstra with a per-tile dig cost.

### Concrete TS (A\* core, Manhattan heuristic)

```ts
const manhattan = (a: Cell, b: Cell) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row)

function aStar(
  start: Cell, goal: Cell, cols: number, rows: number,
  cost: (c: number, r: number) => number, // Infinity = impassable; >1 = expensive (hazard/dig)
): Cell[] | null {
  const open = new MinHeap<Cell>()            // priority = g + h
  const g = new Map<string, number>()         // cost-so-far
  const came = new Map<string, string>()      // for path reconstruction
  open.push(start, manhattan(start, goal)); g.set(key(start.col, start.row), 0)

  while (!open.isEmpty()) {
    const cur = open.pop()
    if (cur.col === goal.col && cur.row === goal.row) return rebuild(came, cur)
    for (const [dc, dr] of N4) relax(cur, dc, dr, cols, rows, cost, goal, g, came, open)
  }
  return null // no path — caller must carve a guaranteed corridor (§3 repair)
}
```

`relax` computes a neighbour's tentative `g = g(cur) + cost(neighbour)`, skips out-of-bounds /
`Infinity` cost, and pushes with priority `g + manhattan(neighbour, goal)` if it improves. (`MinHeap`
is a small binary-heap helper — extract it once, reuse across A\*/Dijkstra.)

**References**
- Red Blob Games (Amit Patel), *Introduction to A\** (when BFS vs Dijkstra vs A\*, heuristic = 0 ⇒ Dijkstra): <https://www.redblobgames.com/pathfinding/a-star/introduction.html>
- Red Blob Games, *Grid pathfinding optimizations* (grid-specific heuristics, tie-breaking, jump points): <https://www.redblobgames.com/pathfinding/grids/algorithms.html>
- Red Blob Games, *Implementation of A\** (heap, came-from, cost-so-far — port directly): <https://www.redblobgames.com/pathfinding/a-star/implementation.html>

---

## 6. Room / dungeon layout — *BSP partitioning for temple interiors*

**Recommended: Binary Space Partitioning (BSP).** For the `temple` variant (and any
rooms-and-corridors dungeon interior), BSP is the canonical, controllable choice — it produces the
classic Rogue/NetHack "rectangular rooms joined by orthogonal corridors" feel and, crucially,
**connectivity falls out of the tree for free** (connect each leaf to its sibling, walk up the tree).

### Approach

1. **Partition:** start with the whole interior rectangle; recursively split each node H or V at a
   random position constrained to avoid too-thin slices (e.g. split ratio in `[0.35, 0.65]`; stop
   when a node is below a min size or at max depth). Result: a binary tree of leaf rectangles.
2. **Carve rooms:** in each **leaf**, place a room **smaller than the leaf** (random padding inside),
   so rooms don't tile the whole map — gives spacing and corridor room. Each room respects the
   §1 building minimums where it represents a structure (temple ≥ 16×8, 4×3 gate).
3. **Connect:** post-order walk; for each internal node, carve a corridor between a point in its
   **left** subtree's room and a point in its **right** subtree's room (straight if walls face each
   other, else an L/Z corridor). This guarantees a fully connected dungeon (a tree of rooms).
4. **Doors / connectors:** drop interaction connectors where corridors meet rooms and at the temple
   gate; validate with §3.

- **Complexity:** **O(N)** to build the tree and carve (each cell touched O(1) times across splits +
  carves). **Space O(N)** for the grid + O(leaves) tree.
- **Tradeoffs vs. alternatives:** BSP = **predictable, tunable, always-connected, rectangular** — perfect
  for built interiors (temples, castles, stores) and aligns with our archetype-driven philosophy.
  *Not* organic — for caves use §2; for hand-feeling forests use §1. Alternatives: **random room
  placement + Delaunay/MST corridors** (more naturalistic room scatter, more code); **grid/template
  rooms** (most authored control, least variety). For Nebulith's "coherent archetype skeleton" goal,
  BSP is the sweet spot for interiors — *use the archetype to seed the split (e.g. force a central
  nave for a temple), then BSP the wings.*

### Concrete TS (recursive partition — guard-clause, no deep nesting)

```ts
interface Rect { col: number; row: number; w: number; h: number }

function bspSplit(rect: Rect, depth: number, rng: () => number, minSize = 6): Rect[] {
  if (depth === 0 || !canSplit(rect, minSize)) return [rect]    // leaf — guard clause
  const [a, b] = splitOnce(rect, rng, minSize)
  return [...bspSplit(a, depth - 1, rng, minSize), ...bspSplit(b, depth - 1, rng, minSize)]
}

function splitOnce(rect: Rect, rng: () => number, minSize: number): [Rect, Rect] {
  const horizontal = chooseSplitAxis(rect, rng)                 // prefer splitting the longer side
  const span = horizontal ? rect.h : rect.w
  const at = minSize + Math.floor(rng() * (span - 2 * minSize)) // keep both halves ≥ minSize
  return horizontal
    ? [{ ...rect, h: at }, { col: rect.col, row: rect.row + at, w: rect.w, h: rect.h - at }]
    : [{ ...rect, w: at }, { col: rect.col + at, row: rect.row, w: rect.w - at, h: rect.h }]
}
```

`carveRoom(leaf)` insets a room inside each leaf; `connectSiblings(tree)` walks the tree carving
corridors (route with §5 A\*). Each is one named, single-responsibility helper.

**References**
- *Basic BSP Dungeon generation* (RogueBasin — split, room-per-leaf, connect-siblings): <https://www.roguebasin.com/index.php/Basic_BSP_Dungeon_generation>
- *Dungeon generation using BSP trees* (eskerda — clear tree + corridor walk-up): <https://eskerda.com/bsp-dungeon-generation/>
- *BSP Room Dungeons* (Roguelike Tutorial in Rust — tunable splits, guaranteed connectivity): <https://bfnightly.bracketproductions.com/chapter_25.html>

---

## 7. Terrain / biome noise — *Simplex (OpenSimplex2) for ground variation*

**Recommended: Simplex noise (use an open-licensed implementation — OpenSimplex2).** For
ground-texture variation (which `groundType` a cell gets — `ash`/`rock`/`basalt`,
`snow`/`ice`/`frost`) we want a smooth, *grid-artifact-free* scalar field, thresholded into bands.

- **Why Simplex over Perlin:** classic Perlin shows **visible directional artifacts** — patterns
  aligning with the grid axes — because it samples a square lattice. Simplex uses a **triangular
  lattice (2D)**, which removes most of that directional bias and is cheaper in higher dimensions
  (O(n²) vs Perlin's O(n·2ⁿ)); in 2D the perf gap is small, so the **artifact reduction** is the
  real reason. **Value noise** (interpolate random values per grid point) is cheapest but
  lowest-quality (more grid-aligned blockiness) — skip it for hero terrain; fine for cheap detail.
- **License note:** Ken Perlin's *Simplex* has patent history around the 3D+ gradient selection;
  prefer **OpenSimplex2 / OpenSimplex noise**, the open, artifact-reduced, drop-in alternative.

### Approach (thresholded bands)

1. Sample `n = simplex2(col / scale, row / scale)` ∈ `[-1, 1]` per cell. `scale` (≈ 8–16 cells) sets
   blob size — bigger = larger smooth regions.
2. Map `n` to a zone `groundType` by **thresholds** (e.g. `n < -0.2 → ash`, `< 0.3 → rock`,
   `else → basalt`) — coherent patches, not per-cell noise.
3. Optional second octave (sum `simplex(x/scale) + 0.5·simplex(x/(scale/2))`) for fractal detail.
4. Hazard pools (`lava` / `ice_water`) = a separate low-frequency noise mask thresholded high, so
   they form a few coherent pools — then **§3 ensures hazards never wall off the spawn→exit path.**

- **Complexity:** **O(N)** for one octave (O(1) per cell), **O(octaves·N)** for fractal. **Space O(N)**.
- **Tradeoffs:** Simplex = smooth, organic, artifact-free, the right default. Perlin = fine and
  ubiquitous if a library's already in hand; watch for axis streaks at low octaves. Value noise =
  only for cheap, non-hero detail. Keep `scale` a **per-zone token**, not a magic number (coding
  standard), so frozen vs lava can read at different granularities.

### Concrete TS (banding a noise field; `simplex2` from a library)

```ts
function paintGroundBands(
  ground: string[][], cols: number, rows: number,
  bands: string[], scale: number, simplex2: (x: number, y: number) => number,
): void {
  forEachCell(cols, rows, (col, row) => {
    const n = simplex2(col / scale, row / scale)      // [-1, 1]
    ground[row][col] = bands[bandIndex(n, bands.length)]
  })
}

// n∈[-1,1] → index∈[0, count-1]; pure + testable, no magic thresholds sprinkled around.
const bandIndex = (n: number, count: number) =>
  Math.min(count - 1, Math.floor(((n + 1) / 2) * count))
```

Feed `bands = ZONE_PALETTES[zone].groundTypes`. This replaces the flat single-`groundType` fill in
`generateStage` with coherent themed patches.

**References**
- *Perlin noise* (Wikipedia — directional-artifact discussion, gradient vs value): <https://en.wikipedia.org/wiki/Perlin_noise>
- *Simplex noise demystified* (Stefan Gustavson — the canonical Simplex explainer + reference code): <https://weber.itn.liu.se/~stegu/simplexnoise/simplexnoise.pdf>
- OpenSimplex2 (open-licensed, artifact-reduced Simplex implementations to port): <https://github.com/KdotJPG/OpenSimplex2>

---

## Priority order — applying these to our generator

Order by **leverage on the navigability guarantee and on retiring hand-rolled hacks**, cheapest-first:

1. **§3 Connectivity (BFS reachability ship-gate) — FIRST, foundational.** Every variant needs the
   "spawn → exit reachable" guarantee. Build `reachableFrom` + the `ok(stage, exit)` gate now; wire
   it into a generator test so no stage ships disconnected. This unblocks/derisks everything below.
2. **§2 Cave variant (cellular automata + §3 repair).** It's the next build, it's genuinely
   randomized-per-run, and it exercises the §3 repair path end-to-end.
3. **§1 Forest improvement (drunkard's-walk spine + §4 Poisson trees).** Retires the hand-rolled
   `carveForestTrail` + `plantTreeClusters`; reuses §3 and §4.
4. **§4 Poisson-disk prop scatter — shared.** Drop into forest first, then reuse for village/temple
   props and §2 cave decoration. Replaces `scatterClearingCover`'s uniform random.
5. **§7 Simplex ground bands — shared, low-risk polish.** Themed ground patches for all variants.
6. **§5 A\* / Dijkstra connector routing.** Needed once we route corridors between buildings/doors
   (village roads, temple corridors) and want hazard-avoiding paths.
7. **§6 BSP temple interiors.** The most structured variant; do it after the organic ones validate
   the §3/§5 plumbing it depends on.

## The next two builds — exact calls

- **Cave variant →** **§2 Cellular Automata, the 4-5 rule**, init **45 % wall fill**, **4–5
  iterations**, OOB-counts-as-wall, **double-buffered**, then **§3 union-find census → keep the
  region containing spawn → carve a guaranteed spawn→exit corridor → BFS-confirm**. Scatter zone
  props with **§4 Poisson-disk** on floor cells. (Adopt the drunkard's-walk-seed → CA-smooth hybrid
  only if rerolls become costly.)
- **Forest improvement →** **§1 biased Drunkard's-Walk spine** (entrance→exit, ~60 % drift toward
  exit) for a guaranteed winding trail + a few **widened clearings**, fill the remainder with trees
  via **§4 Poisson-disk** (small `r` for dense canopy), then **§3 BFS-validate and plant-over any
  unreachable pocket**. This replaces the protected-trail + rectangular-cluster hack with one
  principled, tunable pipeline.

---
*Advisor note: regenerate/extend this doc before introducing a new generation step or a new
zone/variant whose layout isn't covered above — keep it the single source of truth for "which
algorithm, and why."*

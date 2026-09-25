# Rendering

How the isometric view gets onto the screen, what a frame costs, and what to do when it costs too
much.

## The honest ceiling, first

**120 frames a second with 8,000 individually drawn objects is not reachable on a canvas 2D context.**
That is not pessimism, it is arithmetic: 120fps is 8.3ms a frame, which leaves about one microsecond
per object for argument validation, state application, op recording and rasterisation together. Canvas
2D does not have that headroom, and this engine's objects are worse than one operation each: a block
that misses the sprite cache draws three filled quads plus a per-face image, so it is four to six
operations, not one.

The closest public measurement at this exact object count, 8,000 moving boxes on a 2019 MacBook Pro:

| Renderer | Chrome | Firefox | Safari |
|---|---|---|---|
| Pixi (WebGL) | 60 | 48 | 24 |
| Raw canvas 2D | 19 | 19 | 39 |

Source: https://github.com/slaylines/canvas-engines-comparison. The harness caps at 60, so Pixi's real
headroom is hidden, and the boxes are plain rectangles with no depth sort. Read it as: 8,000 objects
is exactly where canvas 2D stops being comfortable.

**So the target is not "make 8,000 draws faster". It is "stop making 8,000 draws."**

| What you want | What it takes |
|---|---|
| 60fps at 8,000 objects | every object one opaque cached blit, and not fill-rate bound |
| 120fps | roughly 1,000 to 2,000 draw operations a frame, which means compositing the static map into big pre-baked chunks |
| more than that | a different renderer |

## Measure before touching anything

The two regimes have OPPOSITE fixes and the profiler will not tell them apart:

* **Call bound.** Thousands of small blits. Fix by merging into fewer, larger images.
* **Fill bound.** Heavy overdraw. Fix by covering fewer pixels.

Do the arithmetic for the scene: 8,000 tiles at a 64x64 sprite box is 32.7 million destination pixels
a frame. Against a 1920x1080 viewport that is about 16x overdraw, alpha blended, which is roughly
2 Gpx/s at 60fps.

**Do not plan off `(program)` in the Chrome profiler.** It is time in the renderer process not
attributed to a JavaScript frame, and it covers browser internals and idle as well as raster replay.
The DevTools reference does not define it. Use the Rendering tab's Frame Rendering Stats overlay,
which states whether GPU rasterisation is on, and check `about:gpu`: page content can veto GPU raster,
and software raster would explain a bad number entirely.

This repo measures with `bin/e2e test/e2e/performance_test.exs --include perf`, which drives signup,
the editor and the generator at three sizes, counts the app's OWN `requestAnimationFrame` callbacks,
and reads `window.__isoPhases` for the split between setup, cull, sort and draw.

**A frame rate is only a number about a scene.** This harness once reported 120fps at 0.37ms a frame,
and 0.37ms cannot draw five thousand tiles: the run had not built a world, and an empty canvas redraws
very fast. Every measurement asserts the scene has tiles in it before it believes the number.

## The measured baseline, 2026-09-22

At MAX ZOOM OUT (50%), which is the case worth measuring: at the default the camera shows a window, so
the drawn count stays flat however large the map is. Software rasteriser (SwiftShader), so the
milliseconds are about this machine and the COUNTS are about the engine.

| | 40x40 wilderness | 100x60 city |
|---|---|---|
| tiles on the map | 2,846 | 9,062 |
| objects drawn a frame | 2,766 | 4,135 |
| …of which GROUND | 1,566 | 2,773 |
| …of that ground, BAKEABLE | **1,566 (all of it)** | **2,773 (all of it)** |
| draw operations a frame | 2,192 | 3,873 (budget 1,500) |
| cached blits / drawn live | 1,647 / 545 | 3,139 / 734 |
| why live | stacked 257, thickness 264, faded 24 | stacked 434, thickness 246, faded 54 |
| setup + cull + sort | 3.4ms | **8.1ms (budget 2.0ms)** |
| draw | 82.3ms | 104.9ms |

### After closing the sprite cache holes and de-allocating the cull

Same harness, same sizes, same afternoon. The generator builds a different world each run, so tile
counts differ slightly and ±1ms on a phase is noise; the draw column is not noise.

| | 40x40 | 40x40 after | 100x60 | 100x60 after |
|---|---|---|---|---|
| draw operations | 2,192 | 1,982 | 3,873 | 3,893 |
| …drawn LIVE | 545 | **0** | 734 | **0** |
| draw time | 82.3ms | **14.7ms** | 104.9ms | **57.3ms** |
| render, walking | 89.6ms | **17.6ms** | 104.8ms | **54.3ms** |
| frames a second | 16.0 | **57.5** | 15.0 | **30.6** |

**5.1x on the wilderness and 1.9x on the city, from two contained changes.** Every live draw is gone:
`stacked`, `thickness` and `faded` were the whole of it, and each was three filled quads plus a
per-face image per layer where a cached sprite is one blit. Note the draw COUNT barely moved while
the draw TIME collapsed, which is the clearest possible statement that the count under-reports a live
draw: it counts one, and it costs four to six.

**It is not enough on its own.** Both sizes still miss the 1,500 draw budget, and what is left is
ground: 1,495 of 2,316 objects at 40x40 and 2,707 of 4,149 at 100x60, all of it bakeable. Chunking it
leaves roughly 500 and 1,200, which is the budget. That is the next change and the arithmetic says it
is the last one needed.

**Three things the first measurement settled.**

1. **Every drawn ground object is bakeable.** `substrate` equals `floors` exactly, at both sizes. The
   worry that most ground is long `depth` runs which a chunk canvas would clip is real for the
   IMPLEMENTATION, but it does not reduce the prize: chunking removes 2,773 of 3,873 draws on the
   city, leaving roughly 1,100 plus a few dozen chunk blits. That is under the budget on its own, and
   it is the only change on the list that gets there.
2. **The JavaScript budget is missed by 4x, and it is machine-independent.** 8.1ms before a pixel is
   drawn, against 2.0ms. `cull` alone is 3.6ms, and it is the one the framework already names:
   technique 3, iterate the visible column and row range instead of filtering every placed tile and
   allocating a small array per tile to do it.
3. **The draw is 95% of the frame and the cache misses are named.** 734 live draws on the city, each
   three filled quads plus a per-face image rather than one blit. `thickness` and `stacked` are three
   quarters of them, and they are exactly the two the cube sprite cache refuses.

### Measured again, 2026-09-23, at the DEFAULT camera

The 2026-09-22 table above is zoomed all the way out, which is the worst case and the one the performance
scenario asserts. This is the same two worlds at the camera a person actually plays at, taken by
`test/e2e/what_the_frame_is_made_of_test.exs`, which exists to answer one question: how much of the frame
is ground a substrate could absorb.

| | 40x40 wilderness | 100x60 city |
|---|---|---|
| tiles on the map | 2,624 | 8,467 |
| objects drawn a frame | 959 | 1,206 |
| …of which FLOORS | 558 | 687 |
| …of that, BAKEABLE | **558 (all of it)** | **687 (all of it)** |
| left after a chunk | 401 | 519 |
| setup / cull / sort | 0.62 / 0.50 / 0.42ms | 1.86 / 1.34 / 0.72ms |
| draw | 12.36ms | 10.22ms |

**57 to 58 percent of every frame is bakeable ground, at both sizes, at both cameras.** The first
measurement said the same thing zoomed out and this says it at the camera people use, so the prize is not
an artefact of one viewpoint. Chunking takes the zoomed-out city from 3,657 draw operations to about
1,570, which is the budget, and the default camera from 1,206 to 519.

**The JavaScript is still over budget on the city**: 3.92ms of setup, cull and sort against 2.0ms.

### What the substrate chunk has to do, written down

The design, so it is a plan rather than a memory:

1. A chunk is a fixed square of cells. Its canvas holds every `bakeableGround` asset ANCHORED in it,
   drawn through the same `drawIsoAssetAscii` the main loop uses, at the chunk's own origin.
2. The canvas needs BLEED, because a z-width run anchored in one chunk reaches into the next. Size it
   from the chunk's screen box plus the largest overhang of the assets in it.
3. The key is the chunk's coordinates plus everything that changes the picture: facing, tile size, art
   style, and a version bumped when any cell in the chunk changes.
4. **The picker still has to work.** `drawIsoAssetAscii` returns the silhouette the hit test uses, so the
   substrate cannot simply stop calling it. Record each asset's geometry RELATIVE to the chunk origin
   when the chunk is built, and add the chunk's current screen origin per frame. A pan moves the origin
   and leaves the relative geometry valid; a zoom or a facing change rebuilds the chunk anyway.
5. Blit the chunks first, in one pass, before the sorted object loop. Every substrate asset is level 0
   and rises less than a block, so nothing can sort into the middle of it. That is what `bakeableGround`
   is for and why it refuses a raised curb.

### The substrate, built and measured 2026-09-24

`engine/render/groundSubstrate.ts`. A fixed 16 by 16 square of cells is drawn once into its own canvas and
blitted as one image, and the sorted loop skips what a chunk absorbed.

**What it takes out of the sorted loop**, which is the number that does not move with the machine:

| World | objects drawn before | after | chunks blitted |
|---|---|---|---|
| a small wilderness, 40x40 | 1105 | 507 | 7 |
| a wide city, 100x60 | 945 | 256 | 6 |

**And the draw time on this machine**, which has no GPU and swings run to run, so it is a direction rather
than a figure: the wide city's walking frame went from 40.0ms of draw to 15.6ms with everything else equal.

Four things make it safe rather than clever:

* **The renderer supplies the draw.** The module never draws a tile itself, so a change to how ground draws
  cannot leave the substrate behind.
* **The picker is untouched.** Each silhouette is recorded relative to the chunk's anchor when it is built
  and the anchor's current screen point is added back per frame. A geom is only points, which is what makes
  that exact rather than approximate.
* **A chunk rebuilds when its own cells change**, by a signature over them, and the key carries the facing,
  the tile size, the style and the time of day. A map replaced wholesale drops every chunk.
* **A chunk is not built until its pictures are decoded**, or it would cache a blank and keep it.

**What it does NOT fix.** `performance_test.exs` still fails its javascript budget: setup, cull and sort come
to 6 to 8ms a frame against a budget of 2ms, before anything is drawn, and that was equally true before the
substrate. It is the next target, not this one.

## The techniques, ranked for this engine

**1. Close the sprite cache holes, so every object is one `drawImage`.** The cache is skipped for
blocks taller than one, blocks thinned by a thickness, directional depth boxes, anything at
`globalAlpha < 1`, and glyph tiles. Trunks are all thinned, trees are stacked, roofs are depth boxes,
so on a city most blocks take the slow path. Alpha should never be a cache miss: bake once and set
`globalAlpha` around the blit. Glyphs must be baked to images; MDN's optimisation page says to avoid
text rendering wherever possible. Watch for the cache key exploding: cap it with an LRU and count hits
and misses per frame.

**2. Chunk-cache the static map into large offscreen canvases.** MDN says it directly: split the
tilemap into big sections, pre-render each off-canvas, and treat each rendered section as one big
tile. Make the cache two tiles larger than the viewport so it is only redrawn when scrolling advances
a whole tile rather than every frame. This is the only technique on the list with an order of
magnitude in it. It splits the scene into a static substrate and a small dynamic set, and anything
that changes per frame (proximity fade, entities, anything a unit walks behind) has to leave the
substrate. Keep the cache canvases snug: an oversized one loses the gain in copying.
Source: https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps

Three things this engine in particular makes you deal with, found by reading the draw loop:

* **Only FLAT ground at level 0 is safely bakeable.** A substrate is one image drawn first, so nothing
  may sort into the middle of it. A raised floor run takes the depth sort's front extent precisely so
  it can draw over what is behind it (`runFrontExtentRise`), and baking one would put it behind
  instead. The animated water and anything with `fadeNear` or `cutawayRoof` are a different picture
  next frame and cannot be baked at all. `__isoPhases.substrate` counts what is left after those
  exclusions, which is the number to size the work from. `floors` is not: it includes all three.
* **The cache key is the camera, not just the map.** A chunk is baked in screen space, so it is only
  valid for one `tileW`/`tileH` and one facing. Key on those plus `grid.groundVersion`, which is
  already bumped by every floor and height edit including a wholesale asset swap. The camera's PAN is
  not part of the key: the projection is a linear map plus a translation, so a chunk's internal layout
  is translation-invariant and one bake serves every camera position at that zoom and facing. Blit it
  at `toScreen(anchor) - localAnchor`.
* **The turn is continuous, so bake only at rest.** `wrapTurn(cameraTurn)` is not one of four facings,
  it is an angle, and a chunk baked at one angle is wrong at the next. Keying on the angle would
  rebuild every chunk every frame of a rotation, which is worse than not caching at all. Bake only
  when the turn is settled on a corner and fall back to the live draw while it is moving: a rotation
  is a transient gesture, and being no faster than today during it costs nothing.
* **The picker reads the draw.** `isoTileHits` is rebuilt every frame from what each object actually
  drew, so ground that stops drawing stops being selectable. Whatever replaces it has to keep a cell's
  real silhouette, not a guessed diamond, or the ground stops answering the highlight and the
  inspector.

**3. Cull in GRID space, not by filtering the object list.** Derive the visible column and row range
from the camera and iterate that rectangle. The current code filters all placed tiles every frame and
allocates a small array per tile to do it.

**4. Reduce overdraw.** Same lever as chunk caching, which is why that one wins twice: fewer calls and
fewer blended pixels.

**5. Kill per-frame allocation. Worth doing, worth less than folklore says.** V8's GC blog is explicit
that the cost is proportional to surviving objects, not to allocations, so 8,000 short-lived arrays
mostly die in the nursery cheaply. Do it because it is trivial, not because it will buy milliseconds.
Source: https://v8.dev/blog/trash-talk

**6. Group state changes.** Never `save`/`translate`/`restore` per object. Write `globalAlpha` twice a
frame, not two thousand times.

**7. Context flags.** `alpha: false` lets the browser know the backdrop is opaque, valid only if every
pixel is painted. `imageSmoothingEnabled = false` affects scaled images only, so it is a correctness
switch for pixel art. **Never set `willReadFrequently: true`**: MDN states it forces software canvas.
If anything calls `getImageData` on the main canvas, that alone can be the whole problem.

**8. Layered canvases.** Useful for UI. With a panning camera the background layer still redraws every
frame unless it is a chunk cache, so this mostly overlaps with technique 2. Each accelerated canvas is
its own compositing layer, so two or three, not a dozen.

**9. Integer blit coordinates.** A fractional destination forces a resample. One line, do it, but the
magnitude is unmeasured folklore and web.dev's own note says it should stop mattering once canvas is
GPU accelerated. The stronger reason is that fractional coordinates visibly blur pixel art.

**10. Dirty rectangles: not applicable.** They pay when most of the screen is unchanged, and the camera
pans continuously. Scroll blitting is the surviving variant and it is fragile here, because tall
objects and depth boxes straddle the seam.

**11. OffscreenCanvas in a worker: zero frame-time win.** It moves work off the main thread, it does
not reduce it.

## Depth sorting: do not sort

**For a regular isometric grid, iterating row then column IS painter's order.** Tiles come out
back-to-front for free. Only moving entities need placing, and they go in the row bucket they occupy,
changing bucket only when they cross a row boundary. That turns a per-frame sort of thousands into
zero sorting and a handful of bucket moves.

"Sort only when the visible set changes" does NOT help here, because a panning camera changes the
visible set every frame. Bucketing does, because bucket contents do not change when the camera moves.

If a global sort stays, two facts. V8 uses TimSort, so a nearly-sorted array costs close to O(n) and
the sort is cheaper than it looks; measure before rewriting. And a comparison in JavaScript is about
an order of magnitude more expensive than a memory access because it calls user code, so the fix is
to remove the comparator: precompute one numeric depth key and counting-sort by depth band.
Source: https://v8.dev/blog/array-sort

**The correctness caveat.** A single scalar depth key is not a correct total order for objects of
differing footprint and height: "behind" is a partial order and is not transitive, so three boxes can
cycle. The rigorous fix is a topological sort of the behind-graph, at O(V squared) just to build the
edges. What real engines do instead is CONSTRAIN THE CONTENT so a scalar key is correct: every object
occupies whole cells, and a tall object sorts by its base cell. Ultimate Play the Game, which defined
the look, simply ignored the cases because they were rare. Constrain the content; do not build a
topological sort unless you can prove you need one.
Source: https://bannalia.blogspot.com/2008/02/filmation-math.html

## Range transparency: every number in it is a row

**What a thing near the hero draws at is decided in two places, and neither of them is the renderer.**

The GAME owns what fading MEANS, as four columns on `game_settings`:

| Column | Control | What it is |
|---|---|---|
| `fade_radius` | Starts at | beyond this many cells a thing is fully solid |
| `fade_full_radius` | Fully faded | within this many it holds FLAT at its most transparent |
| `fade_alpha` | Faded to | how opaque the close band draws, so a door on the far face still reads |
| `interior_alpha` | Inside | how opaque a shell draws while the hero is standing inside it |

The TILE owns how far it takes part, as three columns on `cell_tiles`: `fade_near` (does it answer to the
hero at all), `min_alpha` (the floor its fade may not pass) and `opacity` (what it draws at before any of
this). `min_alpha` only ever makes a tile MORE opaque, which is the whole mechanism by which a door stays
readable while its wall goes see-through, with no tile-name conditional anywhere in the renderer.

**The shape of the ease is a plateau then an ease-out, not one long ramp.** A single smoothstep across the
whole radius put a hero four cells from a wall at ~0.96 alpha, no visible change at all, and the reveal read
as broken. Inside `fade_full_radius` it sits flat at its most transparent; from there it climbs back to solid
by `fade_radius`.

**Why this is in a rendering doc at all.** All four were `export const` in `engine/render/roofReveal.ts`, and
the report was *"we have like a range transparency on the units/elements but I don't see any place to manage
or edit it"*. A number invented in the frontend has no control by construction, because there is no row for a
control to write to. That is law 7 and law 12 arriving at the same missing panel. `revealAlpha` takes the
bands as an argument and holds none; `lib/fadeBands.ts` is the one place that keeps what was served, and it
answers null before a map has landed, which every caller draws as solid.

**A growing thing is not a building.** A wall fades so you can see the room behind it, which is the feature.
A tree hides nothing worth a ghost, so `TileSource.ensure_min_alpha/0` gives every trunk, leaf, canopy and
scrub a floor above the game's close band, and gives a building none.

## The order of work, and why

1. **Measure.** Objects actually drawn, split into cached blit versus live draw. Real overdraw factor. GPU raster on or off. Grep for `getImageData` and `willReadFrequently`. Everything below is a guess until this is done, and the two regimes have opposite fixes.
2. **Close the sprite cache holes.** Biggest win that does not change the architecture, and a prerequisite for step 3: you cannot chunk-cache what you cannot bake.
3. **Cull in grid space and chunk-cache the static substrate.** Target under 1,500 draw operations a frame.
4. **Then the JavaScript cleanup**: no per-frame allocation, row buckets instead of a global sort, numeric depth keys, `alpha: false`, integer coordinates, grouped state. Individually fractions of a millisecond. Doing these first feels productive and will not move 14ms to 8ms.
5. **Re-measure against the 8.3ms gate. If still over, move the draw layer to WebGL**, and write that down as a decision with the measured number attached, so it is a conclusion and not a mood.

## If it comes to WebGL

PixiJS v8 plus `@pixi/tilemap` is the direct target. The world model, generator, camera and game logic
stay; the draw layer is replaced. The work is baking every variant to a texture atlas, rewriting the
draw loop as a scene graph, and expressing depth as a sort key. Known limits: 16,000 tiles per
tilemap unless `use32bitIndex` is on, and batching across at most 16 textures. The real risk is the
non-cacheable variants (thickness, depth boxes, directional roofs), because those are exactly what
cannot be a plain quad.

Engines worth reading: Habbo's HTML5 client (Nitro) is isometric on PixiJS. Isogenic, a twelve year
old canvas 2D isometric engine, says "WebGPU support is incoming". Excalibur.js reports 2 to 3x from
moving to a WebGL pipeline plus object pools and a sparse hash grid.

## The checklist

Before reporting any rendering change as done:

1. Was the frame measured BEFORE the change, with the object count and the phase split recorded?
2. Does the scene being measured actually have tiles in it? State the count.
3. Is the change attacking the regime the measurement named (call bound or fill bound)?
4. Was the frame measured AFTER, on the same scene and the same sizes?
5. Does it still look right? A renderer change is visual: the user's own look at the running app is the only "done", never a green test.
6. For a change affecting a FAMILY of things (every tree species, every wall material), is the evidence every member, not the one you looked at?
7. Which of these could you not verify? Say so.

## Sources

- MDN: [Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas), [Tilemaps](https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps), [Scrolling tilemaps](https://developer.mozilla.org/en-US/docs/Games/Techniques/Tilemaps/Square_tilemaps_implementation:_Scrolling_maps), [getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext), [ImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap)
- web.dev: [Improving canvas performance](https://web.dev/articles/canvas-performance), [OffscreenCanvas](https://web.dev/articles/offscreen-canvas)
- Chromium: [How to get GPU rasterization](https://www.chromium.org/developers/design-documents/chromium-graphics/how-to-get-gpu-rasterization/), [GPU accelerated compositing](https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/)
- Chrome DevTools: [Rendering panel](https://developer.chrome.com/docs/devtools/rendering/performance)
- V8: [Getting things sorted](https://v8.dev/blog/array-sort), [Trash talk](https://v8.dev/blog/trash-talk)
- [canvas-engines-comparison](https://github.com/slaylines/canvas-engines-comparison), [Filmation math](https://bannalia.blogspot.com/2008/02/filmation-math.html), [Painter's algorithm](https://en.wikipedia.org/wiki/Painter%27s_algorithm)
- [PixiJS performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips), [@pixi/tilemap](https://github.com/pixijs/tilemap), [Nitro renderer](https://github.com/billsonnn/nitro-renderer), [Isogenic](https://github.com/irrelon/ige), [Excalibur 2025](https://excaliburjs.com/blog/happy-new-year-excalibur-2025)
- [Sprite tile maps on the GPU](https://blog.tojicode.com/2012/07/sprite-tile-maps-on-gpu.html), [MotionMark methodology](https://browserbench.org/MotionMark1.3/about.html)

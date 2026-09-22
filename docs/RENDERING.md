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

# Nebulith — Gaps & Roadmap

Synthesized from the five-front audit (2026-06-21). Cross-reference
[`ARCHITECTURE.md`](ARCHITECTURE.md) and [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md).

**MVP priority (Alexander):** harden the **engine + editor product** first (all templates, actions,
connectors, views, exporters genuinely working) + finish **one** art style. The AI generator is the
biggest gap but is **deferred** behind product hardening.

---

## 1. Vision vs. reality

| Claim (the vision) | Reality (audit) |
|--------------------|-----------------|
| "All templates are fully playable — move, interact, jump" | **`move` + collision + JUMP** are wired in the play loop — Space fires `beginJump` (`game/runtime/movement.ts`) and the `jumpHeight` sine arc renders in iso + 2D (`templates.tsx` play loop, `iso.ts`/`topdown.ts`). **Interact / attack / touch trigger-actions still don't fire** in the editor loop. |
| "Templates are connected; connector triggers work" | Connectors are **authored, persisted, visualized** — but **no teleport ever fires in play.** Functionally inert. |
| "3 views: 2D top-down, isometric, 2D horizontal" | All three render. But editing is locked to TOP/DEBUG; view state is split across module globals **and** React state (fragile). |
| "All exporters working" | The layers JSON exporter works **but corrupts themed/generated maps** (partial charMap → everything non-basic exports as grass). |
| "Sprite generator handles all asset types" | **Image generation is a placeholder** (stick figure). Nothing is trained. |
| "Sprite generator labels output to match the engine" | **Unbuilt.** Parser emits 4 coarse labels; engine needs hundreds; no translation. |
| "Tileset parser understands different tileset layouts" | It parses **character/battler sheets**, not terrain tilesets. The tile half is unbuilt. |

The honest takeaway: the **foundation is real and impressive** (editor, presets, generator pipeline,
3 renderers, persistence, a real extracted dataset, rich AI docs), but several **headline features
are authored-but-not-wired** rather than just needing polish. The good news: the missing pieces are
small, well-scoped builds, and in several cases the code already exists and just isn't connected.

---

## 2. Product hardening — the MVP track (do this first)

### P0 — Make the product's promise literally true
1. **Implement connector teleport in the game loop.** On each frame (or on the relevant action),
   check `player cell == connector.col,row`; on match, load `targetTemplateId` and spawn at
   `spawnCol/spawnRow`. Handle `interaction`: `walk`/`auto` = on-enter, `interact` = on key press.
   *This single change turns the entire authored-but-dead connector feature live — the highest-
   leverage work on the board.* (`templates.tsx` game loop ~`:3120`; lift trigger ideas from the
   orphaned `buildingComponents.ts` `DoorTrigger`.)
2. **Add a spawn-point UI for connectors.** `spawnCol/spawnRow` are hardcoded `25,25` with no
   editor — every teleport lands at the same (often out-of-bounds) cell. Add inputs / click-to-set.
3. **Build the `interact` and `jump` actions.** Extend `PlayerState` with the needed fields; reuse
   the working jump in `src/engine/Player.ts` rather than reinventing. Decide what `interact` does
   (talk to NPC / activate connector / open door).

### P1 — Structural fixes that unblock everything else
4. **Collapse the dual view-state model.** Replace the module-level globals (`debugMode`,
   `topViewMode`, `flowViewMode`) with a single React state machine (`viewMode`). This fragility
   will fight every UI change; fix it before polishing UI.
5. **Allow editing/saving in ISO & 2D views** (or make the mode switch obvious). Today the
   "playable" views are read-only and connectors are invisible in them.
6. **Fix the themed-ground export charMap.** `exportLayers()` only maps ~5 ground types; snow/sand/
   stone/`road_center`/`road_edge`/themed water fall through to `'.'`. Drive the map from the full
   `TILES` registry (ideally from the canonical vocabulary file).
7. **Decompose `templates.tsx` (~5,600 lines, down from ~6,900 after the 2026-09-06 dead-generator deletion).** Split the runtime (game loop + renderers) from the
   editor UI from the generators. Prerequisite for sustainable feature work. Do it incrementally.

### P2 — Correctness bugs (from the audits)
- `getPlayerArt()` has no `default` return → `.length` can throw if `facing` is ever undefined.
- Iso depth-sort mixes **float** player col/row with integer asset col/row → player can sort to the
  wrong layer at cell boundaries.
- Shared-mutable-inner-array trap `Array(n).fill(Array(m).fill(x))` across `asciiComponents.ts`,
  `buildingComponents.ts`, `MapComposer.ts` (latent today; fix to `.map(() => Array(m).fill(x))`).
- `BUSH_LARGE` declared `width:5` but sprite lines are 4 chars (and similar component width/blocking
  mismatches).
- Duplicated `parseColor` in `legacyAdapter.ts` and `GameEngine.ts`.

### P3 — UX friction
- `resizeGrid()` wipes the map to grass with **no confirmation** (easy data loss).
- Delete uses blocking `window.confirm()` instead of the app's `useToast`.
- ~~23 themes advertised, ~13 render nothing~~ — RESOLVED 2026-09-06 by deletion: that catalog belonged
  to `generateRandomMap`, a SECOND generator reachable only from `?new=1`. It, its 35-preset catalog
  (`game/presets`) and its 21 hardcoded colour themes (`getThemeColors`) are gone; `?new=1` now runs the
  real `generateStage` engine like every other generate.
- ISO/2D toggle is buried in the TOP-view sidebar, not next to the view buttons.

### Dead code to remove (reduces the surface before refactor)
- ~~`applyTemplate()`~~, ~~`generateRandomMap()`~~, ~~`getThemeColors()`~~, ~~`game/presets`~~,
  ~~`createVillageLevel()`~~, ~~`QuickActionToolbar`~~ — all DELETED 2026-09-06 (~1,900 lines).
- `MapComposer.ts` (imported nowhere) — or revive it and wire into the barrel.
- Re-export or delete the orphaned `tileVocabulary`, `asciiComponents`, `buildingComponents` (the
  `index.ts` barrel omits them).
- Unreachable `pixellab.ts` functions (`generateBitforge`, `rotate`, `inpaint`) — expose or drop.

---

## 3. AI track — the keystone, then the model (DEFERRED behind §2)

The user is "stuck on parsing." The real blocker is the **tile-vocabulary contract**, not training.

1. **Freeze the canonical tile vocabulary** (see [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md)) — adopt 9-piece descriptive edge naming; produce one `tile-vocabulary.json`.
2. **Implement terrain-tile parsing** in `sprite_extractor` against that contract: edge/autotile
   detection so a tileset yields `grass_c`, `water_tl`, … (today `categorize_cell` returns one flat
   `TILE_DECORATION` for tilesets — net-new logic). Add tileset grid shapes to `detect_grid`. Add
   tests for the tile path (none exist).
3. **Replace the coarse `SpriteCategory` tiles** with a free-form canonical `tile_name`; update
   captions to emit canonical labels.
4. **Fix the training scripts** (missing `scripts/train_lora.py`, non-existent dataset path) and the
   frontend's non-existent `/api/generate-sync`; replace the placeholder generation with real
   SD1.5+LoRA inference.
5. **Train one art style end-to-end** (Fantasy Dreamland — dataset already extracted, ~1.2GB).
6. **Wire the website to the in-house backend** (replace/augment the interim Pixellab integration).

Doc cleanup along the way: reconcile the aspirational `sprite-generator` docs with code (dedup
"Layer 5" and per-sprite JSON metadata don't exist; FLUX-SDXL vs SD1.5; conflicting sprite counts;
undefined `get_largest_size_in_pack`; stale `.pyc`).

---

## 4. Restructure & repo hygiene (light, mostly deferred)

- **Light restructure (planned, not executed):** group + rename the two repos under `nebulith/`
  (`nebulith-website`, `nebulith-sprite-generator`). **Do not** split the engine/parser into their
  own repos yet — deferred until they're independent products. Outward-facing GitHub renames need
  explicit go-ahead.
- **Remove `sprite-generator`'s repo `.claude/` folder** (same no-repo-`.claude/` rule;
  `game-website`'s was removed 2026-06-21).
- Add `/.claude/` to both repos' `.gitignore` to prevent recurrence.

---

## 6. PERFORMANCE, raised 2026-09-17. Both are worked during ticket 2

Measured on his own screen, not inferred. An 80 x 80 map, which is 6,400 cells:

| where | his screenshot | reading |
|---|---|---|
| editor, panels open, just after a build | mid-build capture | **FPS 7, 44.2 ms a frame** |
| editor, panels closed | Image #154 | FPS 50, 10.9 ms |
| play mode, full screen | Image #153 | FPS 38, 18.4 ms |

The editor costs more than the game does for the same map, and with a panel open it costs six times more.
That is the shape of the two tickets below: one is the React tree, one is the renderer.

### T-PERF-1. Split the editor UI off the map renderer, and find the leak

> *"we need to separate the editor UI from the actual MAP renderer/visual UI. we have lots of performance
> issues right and I think one of the main reasons is that we have both in the same layer/layout with
> re-renders happening at the top level everytime something changes on the UI it re-renders the map to,
> making it slow."*

> *"also, we most likely have some memory leaks, because the editor gets progresively slower the more time
> it's open, when that shouldn't happen, my guess is we accumulate 'somnething' which eventually consumed
> available resources."*

Two claims, and both are checkable before anything is designed:

1. **Does a UI state change re-render the map?** `templates.tsx` holds the canvas AND the editor state in one
   component, so every `useState` in it re-runs the whole tree. Count the renders per keystroke before
   deciding the split.
2. **What accumulates?** *"my guess is we accumulate something"*. Take a heap snapshot on load and another
   after twenty minutes of editing and diff them, rather than guessing at listeners. The window seams
   (`__setHero`, `__cellScreen` and the rest) are installed in an effect with a cleanup, so they are a
   candidate but not an accusation. Tile image caches, the undo stack (now unlimited, by his request) and
   per-frame sprite caches are the others.

The fix is stated by him and should not be re-derived: the map renderer is its own layer, the editor chrome is
another, and editor state does not reach the renderer's render path.

### T-PERF-2. Cull and degrade by camera, in both modes

> *"we need to add a new ticket to deal with performance on the maps themselves. for example, NOT rendering or
> rendering low quality assets based of camera distance and camera view area, right now if I make a 100 rows x
> 100 columns map, everything isn rendered and with the same level of quality even when it's not viewable in
> my screen."*

> Image #153, play mode full screen, and Image #154, editor mode: *"nothing outside red square should render
> nor show, OR should be rendered with super low quality"*.

> *"as I zoom in / zoom out, things are hidden or visible based of the same camera area"*

So two things, and they are separate:

- **Cull**: anything outside the camera's view area is not drawn at all. `__isoCull` already exists as a seam,
  so measure what it currently excludes before adding anything.
- **Degrade**: what is far away but still in view draws at lower quality rather than at full detail.

And it is **both modes**, stated separately for play and for the editor, because he sent one image of each.
The red square in both is the view area, and it is the same rule in both.


### T-PERF-3. The tile COUNT, and the dual-grid system

His source, 2026-09-17: [Dual-grid tilesets](https://www.youtube.com/watch?v=jEWFSv3ivTg&t=77s), jess::codes,
6:15. Timestamped transcript in the workspace at `references/method/dual-grid-video-transcript.txt`.

> *"optimization for tiles usage -> add to the optimization ticket"*

**What it says.** Eight neighbours means 256 possible tiles if every combination is unique, and nobody draws
256. So there are three usual compromises and one alternative:

| tileset | tiles | the compromise |
|---|---|---|
| 15-piece | 15 | edges are drawn through the MIDDLE of a tile, so they do not line up with the world grid. Ambiguous tiles, and placing one tile changes a bigger area than you pointed at `[00:46]` |
| 47-piece | 47 | edges sit at the grid edge so it aligns, but it is 47 tiles `[01:14]` |
| 16-piece subset | 16 | quick and aligned, but broken inner corners, and not every art style survives it `[01:33]` |
| **dual-grid** | **16** | two grids, the DISPLAY one offset by half a tile, each tile reading its 4 overlapping neighbours. 16 configurations instead of 256, aligned, and rounded inner AND outer corners `[02:26]` |

For dual-grid the art WANTS its edges drawn halfway through the tile, which is the thing that is wrong for a
single grid; the half-tile offset is what squares it up `[02:55]`. He measured 155 tiles instead of 507 for an
11-frame animated shoreline `[05:06]`.

**What that is worth HERE, measured rather than assumed.** Our catalog is 719 labels, 301 of them hand drawn.
Inside autotile families there are 288 tiles, and **216 of those are water**: 6 families (`smooth`/`lined` x
`river`/`lake`/`beach`) x 9 pieces x 4 frames. Water alone is 30 per cent of the entire catalog.

Two honest conclusions, and the first one is not the flattering one:

1. **Dual-grid would not cut our piece count.** We already use a NINE piece family, and `cellLabels` folds all
   sixteen orthogonal signatures onto those nine. Nine is fewer than dual-grid's sixteen, so on count alone we
   are already past it.
2. **Our multiplier is not the pieces, it is the FAMILIES.** 9 pieces is fine; 6 families x 4 frames is what
   makes 216. A `lined` river and a `smooth` river differ by their art, and a river, a lake and a beach differ
   only by their RIM. That is the 30 per cent to attack, and it is a data question, not an autotiling one.

**What dual-grid does offer us, and it is not size.** Quality: perfect grid alignment with rounded inner and
outer corners, which the nine-piece subset cannot do. The folding in `SLOT_BY_SIGNATURE` is exactly the
compromise `[01:33]` names, and it is already visible in our code as a comment: two opposite open sides have no
dedicated slot and collapse onto a cap piece. Worth weighing if the water edges are ever redrawn.

**And one thing that is already true**: *"at least using a tool like this one to help generate the full set of
tiles"* `[05:18]`. We have that, `priv/tilegen/tiles.json` plus `bake.mjs`, which is why adding a family costs
an entry rather than nine drawings.

Further reading he points at: the Oskar Stalberg talk and the ThinMatrix devlog, plus demo projects for Godot
and Unity.


## 5. Suggested sequence

```
NOW ─► §2 P0 (connector teleport + spawn UI + interact/jump)   ← makes "a game in minutes" true
      └► §2 P1 (view-state machine, edit-in-all-views, export charMap, begin templates.tsx split)
      └► §2 P2/P3 (correctness bugs + UX friction) — fold in opportunistically
      └► one art style POC: §3.1–§3.2 (freeze vocabulary, build terrain parsing)   ← MVP-ready gate
THEN ─► §3.3–§3.6 (train + wire in-house model)   ← deferred
      └► §4 restructure + hygiene   ← do when convenient
```

**MVP-ready = product hardening (§2 P0/P1) + one art style fully parsed & trained (§3.1–§3.5).**

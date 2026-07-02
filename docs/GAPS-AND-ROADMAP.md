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
| "All templates are fully playable — move, interact, jump" | **Only `move` + collision** is implemented in the editor loop. Interact/jump/attack/touch don't exist there (though `Player.ts` has a working jump, unused). |
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
7. **Decompose `templates.tsx` (~5,272 lines).** Split the runtime (game loop + renderers) from the
   editor UI from the generators. Prerequisite for sustainable feature work. Do it incrementally.

### P2 — Correctness bugs (from the audits)
- `getPlayerArt()` has no `default` return → `.length` can throw if `facing` is ever undefined.
- Iso depth-sort mixes **float** player col/row with integer asset col/row → player can sort to the
  wrong layer at cell boundaries.
- `generateRandomMap` size range is exclusive of max → presets never reach stated max dimensions.
- Shared-mutable-inner-array trap `Array(n).fill(Array(m).fill(x))` across `asciiComponents.ts`,
  `buildingComponents.ts`, `MapComposer.ts` (latent today; fix to `.map(() => Array(m).fill(x))`).
- `BUSH_LARGE` declared `width:5` but sprite lines are 4 chars (and similar component width/blocking
  mismatches).
- Duplicated `parseColor` in `legacyAdapter.ts` and `GameEngine.ts`.

### P3 — UX friction
- `resizeGrid()` wipes the map to grass with **no confirmation** (easy data loss).
- Delete uses blocking `window.confirm()` instead of the app's `useToast`.
- **23 themes advertised, ~13 render nothing** (cultural-theme categories have no presets) — the
  generator UI over-promises.
- ISO/2D toggle is buried in the TOP-view sidebar, not next to the view buttons.

### Dead code to remove (reduces the surface before refactor)
- `applyTemplate()` (~300 lines, never called; superseded by `generateRandomMap`).
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

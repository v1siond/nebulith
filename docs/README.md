# Nebulith docs — index

The spec set for the Nebulith game engine, and the only copy. The engine used to live in the
`game-website` repo and these docs were mirrored there; that mirror is gone, because it had drifted in
ways nobody could see (its `GENERATION-SPEC.md` was missing the entire layer-model section that
`FRAMEWORKS.md` points at). One copy, in the repo that owns the code.

Working rule: **check docs → understand → do the work**, and update the relevant doc in the same
change that alters the model or a feature.

Working rule: **open [`FRAMEWORKS.md`](FRAMEWORKS.md) first**, follow the framework it names for
whatever is being worked on, and if there is no framework for it, research and write one before starting.
Then: check docs, understand, do the work, and update the relevant doc in the same change.

## Read first — the model

- [`FRAMEWORKS.md`](FRAMEWORKS.md) — **the index of every framework and every missing one, and the rule that binds them.** Open this before anything else.

- [`MAP-MODEL.md`](MAP-MODEL.md) — the cell/block/tile model, the three views (ISO/2D/TOP), how
  height derives collision, the `shape` setting, and the tile pipeline. **Start here.**
- [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md) — the `<base>_<edge>` tile naming and
  the vocabularies that must converge (the keystone for the AI track).
- [`TILESET-AUTHORING.md`](TILESET-AUTHORING.md) — authoring tiles, autotiling pieces, and
  compositions (buildings, fountains, trees, walls) the right way.
- [`TILE-BACKEND-MIGRATION.md`](TILE-BACKEND-MIGRATION.md) — why/how the Elixir backend owns all tile
  data; the Ecto model, the bake pipeline, and the `/api/tilesets` contract.

## Authoring objects

- [`OBJECT-CONSTRUCTION.md`](OBJECT-CONSTRUCTION.md), how an object (a tile composition) is built so it looks like the thing it is named after: the reference-first process, the engine facts sheet, the six patterns, the checklist. Read it before authoring any composition.
- [`HITBOXES-AND-ELEVATION.md`](HITBOXES-AND-ELEVATION.md), the hitbox and elevation implementation spec.
- [`DESIGN-ENTRANCES.md`](DESIGN-ENTRANCES.md), the design for the four map entrances, with the honest render comparison.
- [`references/SOURCES.md`](references/SOURCES.md), the isometric reference art every object is modelled against, with sources and licences.

## Systems & features

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — end-to-end technical architecture of the system.
- [`ENGINE-ARCHITECTURE.md`](ENGINE-ARCHITECTURE.md) — the engine's data flow (one grid → three renders).
- [`RENDER-AND-CAMERA.md`](RENDER-AND-CAMERA.md) — the ISO projection math (the 2:1 squash), the camera
  (focus/clamp/pan), the 4-way + continuous rotation, depth sorting, and the screen-fixed-input rule.
- [`FEATURES.md`](FEATURES.md) — per-feature flows and where they live in the code.
- [`EDITOR-INTERACTION-SPEC.md`](EDITOR-INTERACTION-SPEC.md) — the editor interaction model.
- [`ANIMATION-SYSTEM.md`](ANIMATION-SYSTEM.md) — the tile animation envelope + z-index draw priority.
- [`LIGHTING.md`](LIGHTING.md) — the day/night lighting model.
- [`WATER.md`](WATER.md) — the water layer stack: bed, depth tint, caustics, animated surface, reflections, shoreline.
- [`GENERATION-SPEC.md`](GENERATION-SPEC.md) — the layer-pass stage/town generator + scoped randomize.
- [`ALGORITHMS.md`](ALGORITHMS.md) — the algorithm decision database for generator problems.
- [`COMBAT-AND-SYSTEMS-SPEC.md`](COMBAT-AND-SYSTEMS-SPEC.md) — the game layer (entities, combat, stats, quests).
- [`TRIGGERS-SPEC.md`](TRIGGERS-SPEC.md) — the generalized trigger/action system.

## Vision & roadmap

- [`NEBULITH-SOURCE-OF-TRUTH.md`](NEBULITH-SOURCE-OF-TRUTH.md) — the wider system map and pitch.
  Predates the backend split (describes an older game-website + sprite-generator layout) — read it
  for vision, not for the current repo layout.
- [`GAPS-AND-ROADMAP.md`](GAPS-AND-ROADMAP.md) — current state vs. the vision and the MVP path.

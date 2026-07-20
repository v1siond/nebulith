# Nebulith docs — index

The canonical spec set for the Nebulith game engine. The `game-website` frontend repo mirrors the
model docs; **these are the source of truth**. Working rule: **check docs → understand → do the work**,
and update the relevant doc in the same change that alters the model or a feature.

## Read first — the model

- [`MAP-MODEL.md`](MAP-MODEL.md) — the cell/block/tile model, the three views (ISO/2D/TOP), how
  height derives collision, the `shape` setting, and the tile pipeline. **Start here.**
- [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md) — the `<base>_<edge>` tile naming and
  the vocabularies that must converge (the keystone for the AI track).
- [`TILESET-AUTHORING.md`](TILESET-AUTHORING.md) — authoring tiles, autotiling pieces, and
  compositions (buildings, fountains, trees, walls) the right way.
- [`TILE-BACKEND-MIGRATION.md`](TILE-BACKEND-MIGRATION.md) — why/how the Elixir backend owns all tile
  data; the Ecto model, the bake pipeline, and the `/api/tilesets` contract.

## Systems & features

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — end-to-end technical architecture of the system.
- [`ENGINE-ARCHITECTURE.md`](ENGINE-ARCHITECTURE.md) — the engine's data flow (one grid → three renders).
- [`FEATURES.md`](FEATURES.md) — per-feature flows and where they live in the code.
- [`EDITOR-INTERACTION-SPEC.md`](EDITOR-INTERACTION-SPEC.md) — the editor interaction model.
- [`ANIMATION-SYSTEM.md`](ANIMATION-SYSTEM.md) — the tile animation envelope + z-index draw priority.
- [`LIGHTING.md`](LIGHTING.md) — the day/night lighting model.
- [`GENERATION-SPEC.md`](GENERATION-SPEC.md) — the layer-pass stage/town generator + scoped randomize.
- [`ALGORITHMS.md`](ALGORITHMS.md) — the algorithm decision database for generator problems.
- [`COMBAT-AND-SYSTEMS-SPEC.md`](COMBAT-AND-SYSTEMS-SPEC.md) — the game layer (entities, combat, stats, quests).
- [`TRIGGERS-SPEC.md`](TRIGGERS-SPEC.md) — the generalized trigger/action system.

## Vision & roadmap

- [`NEBULITH-SOURCE-OF-TRUTH.md`](NEBULITH-SOURCE-OF-TRUTH.md) — the wider system map and pitch.
  Predates the backend split (describes an older game-website + sprite-generator layout) — read it
  for vision, not for the current repo layout.
- [`GAPS-AND-ROADMAP.md`](GAPS-AND-ROADMAP.md) — current state vs. the vision and the MVP path.

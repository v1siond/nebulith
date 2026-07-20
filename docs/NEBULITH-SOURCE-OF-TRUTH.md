# Nebulith

**An AI-powered level-templating game engine — build a playable game prototype in minutes.**

Nebulith lets you lay out game levels from reusable templates, connect those levels
together with in-game triggers, and (soon) fill the grid with real tileset art generated
by an in-house AI model trained per art style. Levels are **playable on the platform** and
**exportable** so the work can be rebuilt in a real engine (Unity, Godot, etc.) — Nebulith
exports the *data* (layouts, layers, collision), not the *functionality*.

> **Who it's for:** new devs who want an easy on-ramp to game development that translates to
> real engines, and anyone who wants to demo/prototype a game idea (e.g. to raise funding)
> before committing to a full build.

This folder is the **single source of truth** for the whole system. Start here.

---

## The pitch, in one paragraph

Designing a level, figuring out the grid, sourcing the right tilesets, and assembling them
is an art that takes real time, money, and expertise — and it's the part that stalls most
prototypes. Nebulith optimizes that with engineering: pre-built, fully-playable level
**templates** you can randomize and **connect**, plus an AI **sprite generator** (the
expensive part, paid for once) that produces tileset art in a chosen style and labels it so
it drops straight into the grid. It is **not** a prompt-free builder — the system controls
most of what the AI receives (art style + asset type + view + variables); your prompt only
refines within that frame, so results stay accurate to the style you picked.

---

## System map — 4 systems, 2 repos (today)

Four conceptual systems currently live in **two** git repos. (See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture and
[`docs/GAPS-AND-ROADMAP.md`](docs/GAPS-AND-ROADMAP.md) for current state vs. vision.)

| # | System | What it does | Lives in | Status |
|---|--------|--------------|----------|--------|
| 1 | **Engine + Editor** ("Nebulith") | Template editor, 3 view modes, playable runtime, connectors, exporters | `game-website` (`src/engine/*`, `src/pages/personal-projects/game-engine/*`) | Core works; connectors + actions partly unbuilt |
| 2 | **Website / demo host** | CV site that hosts the engine demo + sprite tool | `game-website` | Works |
| 3 | **Sprite generator** | AI model (planned SD1.5 + LoRA) that generates game assets per art style | `sprite-generator` (`backend/`, `frontend/`, `training/`) | **Not trained** — generation is a placeholder |
| 4 | **Tileset parser** | Ingests existing tilesets, extracts sprites, labels them to build training data | `sprite-generator` (`training/extract.py`, `training/sprite_extractor/`) | Character extractor works; **terrain-tile parsing unbuilt** |

```
                ┌─────────────────────────────────────────────┐
                │  game-website  (github: v1siond/game-website)│
                │  ┌───────────────┐   ┌─────────────────────┐ │
   you ───────► │  │ Editor /      │   │ Engine core         │ │
   author a     │  │ templates.tsx │──►│ src/engine/*        │ │
   level        │  │ (runtime too!)│   │ (geometry + legacy) │ │
                │  └──────┬────────┘   └─────────────────────┘ │
                │         │ save/load (Prisma → Postgres)       │
                │         ▼                                     │
                │  ┌───────────────┐   ┌─────────────────────┐ │
                │  │ /api/templates│   │ /api/pixellab (AI)   │─┼──► Pixellab.ai
                │  └───────────────┘   └─────────────────────┘ │    (INTERIM 3rd-party,
                └───────────────────────────────────────────────┘    until in-house model)
                                                                          ▲
                ┌─────────────────────────────────────────────┐         ╎ (NOT wired yet)
                │ sprite-generator (github: v1siond/sprite-…)  │         ╎
                │  training/extract.py ──► dataset + captions  │         ╎
                │  training/ (LoRA, configs) ──► [model] ──────┼─ ─ ─ ─ ─┘ (target integration)
                │  backend/main.py (FastAPI, placeholder gen)  │
                └─────────────────────────────────────────────┘
```

**Two integration seams that are not yet connected** (the heart of the roadmap):
1. The website's AI calls go to **Pixellab.ai (third-party), as a temporary stand-in** — it
   does *not* talk to the in-house `sprite-generator` backend yet.
2. The **tile-label vocabulary** that the parser emits, the generator should train on, and the
   engine grid uses are **three different, incompatible vocabularies**. See
   [`docs/TILE-VOCABULARY-CONTRACT.md`](docs/TILE-VOCABULARY-CONTRACT.md) — this is the keystone.

---

## Documentation index

| Doc | Read it for |
|-----|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The real, end-to-end technical architecture of all 4 systems, the two rendering stacks, the data model, and the integration seams. |
| [`docs/TILE-VOCABULARY-CONTRACT.md`](docs/TILE-VOCABULARY-CONTRACT.md) | **The keystone.** The 5 places "tiles" are defined today, why they conflict, and the proposed single canonical contract all systems converge on. |
| [`docs/GAPS-AND-ROADMAP.md`](docs/GAPS-AND-ROADMAP.md) | Current state vs. the vision, the full prioritized gap list, and the MVP path. |
| [`docs/GENERATION-SPEC.md`](docs/GENERATION-SPEC.md) | Building-architecture sizing rules (locked base: house 8×4, door 2×2) + proposed structure formula and themed stage-generation pipeline (e.g. frozen/lava castle). |
| [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) | The algorithm decision database — the optimal approach (complexity + references) for each generator problem (maze/forest, cave CA, BFS connectivity, Poisson distribution, pathfinding, BSP, noise). Trigger the advisor before any algorithm-heavy generator feature. |
| [`docs/COMBAT-AND-SYSTEMS-SPEC.md`](docs/COMBAT-AND-SYSTEMS-SPEC.md) | The game layer: entities/enemies, combat (HP, melee/ranged, physical/magical, regular/special, rage/mana), stats + armor + weapons + warrior/magician talents, inventory, quests/missions, and the structure collision rule. |
| [`docs/TRIGGERS-SPEC.md`](docs/TRIGGERS-SPEC.md) | The generalized trigger system (rename of "connectors"): activation + a typed action union (goto_level/goto_region/content/collect). Unified table, not per-action tables. |
| [`docs/EDITOR-INTERACTION-SPEC.md`](docs/EDITOR-INTERACTION-SPEC.md) | Editor interaction model: selection-driven config (click → right-panel options), entity roles + movement patterns, asset/structure actions + animations, the UI reorg (top-nav export/save, expandable assets, right-side connectors/entities), composite-asset scaling, art styles + zone decorations. |
| [`docs/ASCII-TILESET.md`](docs/ASCII-TILESET.md) | The canonical ASCII art tileset — one consistent glyph per cell label, the placeholder "art style" used everywhere until real tilesets replace it (the ASCII side of the tile-vocabulary contract). |
| [`docs/MAP-MODEL.md`](docs/MAP-MODEL.md) | The cell/block/tile model + the tile-data ownership rule: the **frontend holds NO tile art and NO tile data**. The holders start EMPTY; runtime tiles come ONLY from `/api/tilesets`; a **loader gates the render** until a tileset installs; on failure an error/retry shows — there is **no fallback** to frontend tiles (so no wrong-style flash). |
| [`docs/TILE-BACKEND-MIGRATION.md`](docs/TILE-BACKEND-MIGRATION.md) | How tile DATA moved to the nebulith backend (real DB rows + baked images) and the frontend became a pure renderer. Records the deletion of the bundled frontend tilesets and the loader gate that replaced the first-frame-flash risk. |
| `sprite-generator/training/docs/INDEX.md` | The (rich, pre-existing) deep docs for the AI model + parser. Accurate for the extractor; aspirational ahead of code for the model and tile grammar. |

> **MVP priority (set by Alexander):** harden the **engine + editor product** first — make all
> templates, actions, connectors, views and exporters genuinely work — then finish **one** art
> style end-to-end in the AI generator. That combination = MVP-ready. The AI generator is the
> biggest gap but is **deferred** until the product side is solid.

---

## Repository layout

**Today** (two independent repos under `~/projects/`):
- `game-website` — branch `main` — engine, editor, website, persistence, exporters
- `sprite-generator` — branch `master` — AI model, training, tileset parser

**Target** (light restructure — group + rename under this `nebulith/` umbrella; *not yet executed*):
```
nebulith/
├── README.md                 ← this file (source of truth)
├── docs/                     ← cross-system docs
├── nebulith-website/         ← (was game-website)
└── nebulith-sprite-generator/← (was sprite-generator; contains the tileset parser)
```
The engine and the parser are **not** being split into their own repos yet — that's
deferred until they're genuinely independent products. See `docs/GAPS-AND-ROADMAP.md`.

---

*This source-of-truth set was synthesized 2026-06-21 from a five-front code+docs audit. Where a
claim cites `file:line`, it was verified against the source at audit time — verify against current
code before relying on a specific line number.*

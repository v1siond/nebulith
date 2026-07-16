# Nebulith — Editor Interaction & Behavior Spec

Status: **design captured 2026-06-21** (Alexander). How the editor lets a non-dev select things
and configure their behavior, plus the UI reorg and art-style requirements.

## 1. Selection-driven configuration (the core interaction)
Clicking a placed thing **selects** it and opens its config on the **right sidebar** — stats/options
appear *only when selected*, never cluttering the left sidebar.
- **Click an entity** → selected → right panel shows: its **stats** (for combatants), and options to
  add **attacks**, **quests** (NPC), **movement patterns**, **actions/animations**.
- **Click a structure/asset** → selected → right panel shows its options (actions, animations,
  movement if applicable).
- **Important:** character/enemy stats must NOT show on the sidebar by default — only on selection.

## 2. Entity model (expanded)
An entity has a **type/role**: `decoration` · `enemy` · `npc` · `player` · and hit-behavior flags
`hittable` / `non_hittable` (and more as needed). Per entity, configurable:
- **Stats** (combatants): HP + the combat stats.
- **Attacks**: which attacks it can use.
- **Quests** (NPC quest-givers).
- **Movement patterns** (see §3).
- **Actions / animations** (see §4).

## 3. Movement patterns
- An entity (esp. an enemy) can have **many movement patterns**.
- Patterns run **sequential** (one after another) or **randomized** (pick at random).
- A pattern is a path/behavior (patrol a route, chase, wander a region, idle). Authored on the
  entity's right-panel config; the play loop drives the entity along the active pattern.

## 4. Asset / structure actions & animations
Some assets/structures carry **timed actions** and **looping animations**:
- A **cannon** fires every X seconds (a timed action → spawns a projectile / triggers an attack).
- A **lamp** runs a looping light animation (a visual loop, no gameplay effect).
- Same select→configure pattern: select the asset → set its action interval / animation on the right.
- Model: an asset can hold `actions[]` (timed/triggered) and `animation` (loop spec). The renderer
  plays the animation; the loop fires the actions on their interval.

## 5. UI reorg (reduce scrolling)
Current editor has TOO MUCH vertical scrolling. Target:
- **TOP NAV BAR:** **Export** + **Save / Load template** move here (out of the right sidebar).
- **LEFT sidebar:** Views + grid · Stage presets · **Assets — EXPANDABLE/collapsible** groups
  (Ground/Nature/Building/Decorations/Composite) so they don't all scroll at once.
- **RIGHT sidebar:** **Connectors** + **Entities** + the **selection config** panel (§1).
- Net: left = "what to place", right = "configure what's placed", top = file/export ops.

## 6. Composite/structure asset SCALING (bug → requirement)
**Bug:** selecting N cells then clicking e.g. "Well" stamps a **fixed 4-cell** `COMPOSITE_ASSETS`
shape (`placeCompositeAsset`), ignoring the selection — and it's not persisted to the template nor
visible in iso/2D. **Requirement:** a composite/structure must **scale to the selected cells** (40
selected → a 40-cell well), like a building stamped from its backend composition, be added as real grid assets
(labeled, per the keystone), persist in the template, and render in all three views.

## 7. Art styles
- **Default (regular) art style** in addition to lava + frozen → so we can generate a **regular
  forest**. The `verdant` zone already exists in the engine — expose it in the UI zone selector as
  the default ("Regular"/"Default"). Default zone = verdant.
- **Zone-styled trees** must match the selected style: lava → charred, frozen → frosted (done in the
  generator via TREE_PALETTES; verify they render per the selected zone).
- **Lava must look like lava:** the lava-zone floor (ash/rock/basalt) is now dark charred ground with
  ember glow (was neutral gray). Keep pushing the molten read.
- **Zone decorations:** **volcanoes** for lava, **mountains** for frozen — large multi-cell labeled
  decorations (render per-cell via the keystone path; emit from the generator + a label set).

## Build order (after the current quest/inventory wiring)
1. Composite asset scaling + persistence/render (§6) — concrete bug.
2. UI reorg (§5) — top nav + expandable assets + right-side connectors/entities/selection.
3. Selection-driven config panel (§1) — the interaction backbone.
4. Entity types + movement patterns (§2,§3).
5. Asset/structure actions + animations (§4) — cannon/lamp.
6. Default art-style in UI + volcanoes/mountains decorations (§7).

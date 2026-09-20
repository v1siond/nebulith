# FRONTEND DATA AUDIT. What the frontend is still deciding for itself.

## The rule

**The backend decides VALUES. The frontend renders them and invents nothing.**

A generator writes tiles and settings into cells; a renderer reads a tile and draws it. Neither gets to
hold a number or a colour that decides what a map IS. `MAP-MODEL.md` §8 states the other half: a value the
backend does not serve is ABSENT, and the frontend paints nothing rather than falling back to one of its own.

A fallback is the dangerous case, not the missing value. A missing value shows up as a gap somebody reports;
a fallback shows up as a map that looks fine and is wrong, which is how a season nobody had described came
out looking like summer for months.

## Why this file exists

Asked for directly: *"I DON'T WANT ANY FUCKING HARDCODED SETTING OR VALUE THAT SHOULD BE A SIMPLE DATA THING
ANYWHERE IN THE FRONTEND, AUDIT EVERYTHING. FIX EVERYTHING."*

This is the inventory, so the work is countable and nothing is "fixed" by having looked at one file. It is
not finished. Each row says what is left.

---

## 1. What it is NOT about

Three kinds of constant are legitimate and are not counted here. Naming them keeps the audit honest, because
an audit that flags everything gets ignored.

| Kind | Example | Why it stays |
|---|---|---|
| **Algorithm tuning** | `AXIS_VOTE = 2`, `RUN_REACH = 12` (`riverNetwork`) | How the search runs, not what the map contains. Changing it changes the same map's shape, not its description. |
| **Geometry the engine owns** | `pathwayCeiling`, `exitCeiling` (`pathNetwork`) | A measurement OF served data (`pathway.width`), and the builder and the panel must share exactly one. |
| **UI chrome** | the palette of `games.tsx`, `spriteGenerator.tsx` | The editor's own appearance, not the game world's. |

The test is one question: **would a designer ever want this different for one template and not another?**
If yes, it is data.

---

## 2. Closed

| What | Was | Now |
|---|---|---|
| The meadow's seasonal colours | `MEADOW_PALETTES`, a table of 7 seasons x 8 colours in `stageGenerator.ts`: the row gradient, grass and earth patches, cobble, river, bank, plot | `ZoneSource`, `palette.meadow`, served per season. Read through `zoneMeadow()`, and a season that serves none paints no meadow rather than borrowing summer's. |
| How much of the map a picked region claims | `REGION_LEAD = 5`, a multiplier in `stageGenerator.ts` | Gone. Picking a region makes the map that region; how much each claims otherwise is the generator's served `weight`. |
| How many ways across a map, and ways out | A hand-written list of four choices in the seeder, filtered down | Measured by the engine (`pathwayCeiling`, `exitCeiling`) off the served `pathway.width`; the option says which measurement it lives by (`countBy`, `countPer`). |
| Whether a tile stops you | `tiles.blocking`, a second switch beside `settings.collision` | The column is gone. The box list is the only answer, and the generator states it like any other tile setting. |

---

## 3. Open, in the order they matter

### 3.1 Renderers holding colours (72 sites)

| File | Sites | What they are |
|---|---|---|
| `engine/render/shared.ts` | 24 | shared draw colours: shadow, outline, water sheen |
| `engine/render/iso.ts` | 17 | face shading, cliff tones |
| `engine/render/birdseye.ts` | 17 | the overview map's own palette |
| `engine/render/topdown.ts` | 14 | the top view's |

**Verdict: mostly SHADING, some DATA.** A face's shading factor is the renderer's business. A *tone* a
material wears is the tile's. These have to be read one at a time; a blanket move would put the lighting
model in the database.

### 3.2 `engine/entityArt.ts` (25 sites)

**Verdict: DATA.** A unit's colours belong on its tile row, like every other tile's. Blocked on nothing but
the work: the rows exist and already carry `settings.color`.

### 3.3 `engine/stageGenerator.ts`, 42 numeric constants

Examples: `RUIN_FALLEN = 0.3`, `RUIN_RUBBLE = 0.14`, `SWAMP_POOL_PATCH = 5`, `BARE_CANOPY = 0.1`,
`JUNGLE_MAX_POCKET = 40`, `MEADOW_PATCH = 7`, `GATEWAY_RUN = 11`.

**Verdict: DATA, nearly all of it.** Every one answers "how much of this does a map of this kind have",
which is the definition of a template value. They belong beside `nature`, `formation` and `pathway` in the
generator's served config. Four remaining colours in this file (`makeKey`, `ember`, the lava prop) are the
same.

### 3.4 `villageLayout.ts`: `SETBACK = 1`, `ROAD_W = 4`

**Verdict: NOT a violation, checked.** Both read `served?.setback ?? SETBACK`, so the catalog wins wherever
it answers and the constant is the documented default for a `planVillage` call made before
`/api/generators` returns. Listed here so the next audit does not re-flag them.

The open question they raise is the general one, and it is worth settling once: a default that only ever
applies before the catalog loads is harmless; a default that applies when the backend simply never described
the thing is the fallback the law is about. These are the first kind. `§3.3`'s constants are the second.

### 3.5 `lib/gridCodec.ts` (6 colours)

**Verdict: check first.** Likely encoding defaults rather than appearance.

---

## 4. Checklist

- [ ] Every value that decides what a map CONTAINS is served, not written in the frontend
- [ ] Nothing falls back to a frontend value when the backend serves none: absent means absent
- [ ] A constant that stays is one of the three kinds in §1, and says which in a comment
- [ ] A frontend default covers only the moment before the catalog loads, never a value the backend never described (§3.4)
- [ ] Judged at :3000

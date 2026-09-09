# Nebulith — Combat, Progression & Game Systems Spec

Status: **design captured 2026-06-21** (Alexander). The game layer on top of the stage engine.
Build incrementally; MVP game can ship with just **forest + temple** stages. Keep it simple first,
expand the formulas as we go. Cross-ref `TILE-VOCABULARY-CONTRACT.md` (cell labels/collision) and
`project-nebulith-collision-model` memory.

---

## 1. Entities & placement
- The editor needs an **entity placement section**: insert **characters** (the player/spawn) and
  **enemies** onto stage cells (alongside the tile/asset palette).
- Entities are stage data: `{ type: 'player'|'enemy', col, row, stats... }`.

## 2. Combat — keep it simple
- **HP:** each enemy has X HP; the character has Y HP.
- **Attack ranges:** **melee** and **distance (ranged)**.
- **Attack schools:** **physical** and **magical**.
- **Attack tiers:** **regular** (free) and **special** (costs a resource):
  - physical special → consumes **rage**
  - magical special → consumes **mana**
- **Damage** is computed from the attacker's stats + weapon + the defender's stats (see §5).

## 3. Stats
| Stat | Effects |
|------|---------|
| **Strength** | ↑ physical damage, ↑ rage limit |
| **Intelligence (int)** | ↑ magical damage, ↑ mana limit |
| **Defense** | ↓ melee (physical) damage taken |
| **Rage** | resource for physical specials (cap scales with strength) |
| **Mana** | resource for magical specials (cap scales with int) |

## 4. Equipment
**Armor** (↑ defense; biased to a build):
- **Iron** → grants **strength**
- **Leather** → grants **int**

**Weapons** (define the two playstyles):
- **Sword / Axe / Shield** → ↑ defense &/or strength; base **defense** + **damage** stats. (warrior)
- **Staff** → ↑ int; base **magic damage** stat. (magician)

## 5. Damage model (starting formula — tune later)
```
physicalDmg = (weaponBaseDmg + strength) * regularOrSpecialMult
magicalDmg  = (staffBaseMagic + intelligence) * regularOrSpecialMult
meleeTaken  = max(1, incomingPhysical - defense)      // armor/defense reduces melee
magicalTaken = incomingMagical                         // (magic vs defense: TBD)
specialMult > regularMult; special also consumes rage (physical) / mana (magical)
```
The system reads attacker stats + weapon + defender stats/armor and resolves the number. Exact
coefficients are TBD — start trivial (X/Y HP, flat numbers) and refine.

## 6. Talent tree (small)
- Two paths: **Warrior** and **Magician**.
- Talents bias stats/abilities toward the path (warrior → strength/defense/physical specials;
  magician → int/mana/magical specials). Weapons + armor reinforce the chosen path.

## 7. Inventory system
- The character has an inventory (weapons, armor, consumables). Equipping changes stats per §3–4.

## 8. Movement abilities (settings — see collision-model memory)
- **Jump:** clear up to N collision cells in the facing direction (default 1, configurable). Being
  re-added to the 2D + iso game loops now (it was deferred/missing). NOT the platformer `Player.ts`
  jump — it's grid traversal.
- **Climb / swim:** later — tied to per-cell terrain physics (ice walkable+accel/decel, water
  collision unless swim, lava collision).

## 9. Structure collision rule (extends the keystone)
Same pattern as trees: **a building/house/structure blocks on every cell EXCEPT its DOORWAY** —
the doorway column on the FRONT row, which you walk through to get in, and the interior floor it
opens onto. Each structure cell is **labeled** (`roof_top`, `roof_left`, `wall`, `door`, `window`…)
for tileset replacement, and the label drives collision.

**A ROOF BLOCKS** (Alexander 2026-09-06: *"roof should have collissions"*). It is not a floor and
nothing stands on it — `roof`, `roof_top`, `flat_roof`, `parapet` and `rooftop_unit` are all
authored `walkable: false`. The earlier rule ("`roof_top` = walkable, the wall beneath carries the
collision") is GONE: it made "walkable" claim you may stand on a roof, and the hero did.

**Only the front-row doorway is an opening.** `BuildingCompositions.assemble` keys walkability on
`dx in doors AND dy == h - 1`. Keying it on the column alone left the BACK wall opposite every door
walkable too, so you could walk straight through a building and out the other side (Alexander
2026-09-06: *"I can leave the houses from the back, following the doors street line, which is bad.
I should only be able to navigate and leave buildings through actual pathways, like doors or
stairs"*).

**A unit stands on the GROUND, never on the structure above it.** The iso renderer lifts a unit by
`unitStandLevel` (the top of the cell's floor tiles), not by `cellStackTop` (the top of everything
in the cell). A doorway cell holds the whole facade column above the doorstep, so taking the stack
top there drew the hero on the ROOF instead of inside the house. Raising the GROUND still lifts the
unit — the same lego math every tile reads.

## 9b. Interior reveal (Diablo / Path of Exile)

The reveal is **POSITIONAL**, not proximity-based: the hero is under a roof or they are not.

- Every tile carrying `settings.cutawayRoof` offers its covered footprint (z-width included).
- The **connected** roof over the hero's cell is skipped entirely — a roof is many z-width column
  blocks, so lifting only the one overhead would punch a hole instead of removing the roof.
  Connectivity stops at the next building, so the neighbour across the street keeps its roof.
- Tiles carrying `settings.fadeNear` **inside that revealed shell** (its footprint + the ring of
  walls around it) ease to `INTERIOR_SHELL_ALPHA`, so the interior actually reads.
- **Outside a building nothing fades.** The old distance ease (`fadeNearAlpha` / `cutawayAlpha`,
  now deleted) ghosted every wall the hero merely walked past while the roof stayed solid
  (Alexander 2026-09-06, Image #1: *"not transparent enough and is not applied correctly … it
  should be like diablo likes games, or path of exile, where roof gets transparent when user enters
  the building and we can see the inside of the thing"*).

Logic: `src/engine/render/roofReveal.ts` (`revealedRoofs` / `revealedShell`), applied in `iso.ts`.


---

## 10. Quests / Missions
- Mark any NPC (character) as a **quest giver** in the editor and connect it to a quest.
- **Quest** = `{ id, title, description, objectives[], rewards[], state }`.
- **Objective types:** `kill` (X of enemy type Y), `travel` (reach a place/cell/stage), `find`
  (locate a person/NPC). Each objective tracks `{ current, target, done }`.
- **Auto progress:** the system tracks objective progress automatically (kills counted, location
  reached, NPC found) and surfaces progress toward completion (e.g. "3/5 slain").
- **Rewards:** items / stats / xp granted on completion.
- **Enemies** are placed with a **respawn time** (kill-quests stay farmable/repeatable).
- **Full flow (the target):** add quest-giver NPC → configure its quest (kill X of enemy Y) →
  place the Y enemies (with respawn) → player interacts with the giver to accept → travels to the
  enemies → kills them (progress auto-tracked) → returns to the giver → progress validated → reward
  granted. This is the headline game loop the editor must let a non-dev assemble.
- **Editor:** a quest-config panel on the quest-giver entity (objectives + rewards); builds on
  entity placement (§1).

## Build order (this layer — after the keystone + a usable editor)
1. Entity placement (player/enemy) in the editor.
2. Stats + HP + a trivial melee regular-attack loop (X vs Y HP).
3. Equipment (armor/weapons) → stat modifiers → damage model.
4. Resources (rage/mana) + special attacks; ranged + magical.
5. Inventory.
6. Talent tree (warrior/magician).
MVP playable game target: **forest + temple stages + basic combat + one of each weapon type.**

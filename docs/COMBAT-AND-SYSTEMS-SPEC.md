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
Same pattern as trees: **a building/house/structure blocks on every cell EXCEPT the top-most roof
tile and the door cells** (doors are walkable to enter). This needs the structure dimensions/
implementation defined first (building composer: 8×4 min, 2×2 door) — hence starting with forest +
easy archetypes. Each structure cell is **labeled** (`roof_top`, `roof_left`, `wall`, `door`,
`window`…) for tileset replacement, and the label drives collision (`roof_top` = walkable, rest
block; doors walkable).

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

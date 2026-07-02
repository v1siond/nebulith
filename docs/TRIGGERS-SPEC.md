# Nebulith — Triggers (generalized action triggers)

Status: **design, 2026-06-21** (Alexander). Reframe of "connectors". Needs a nod on the
unified-vs-separate-table question (§3) before the rename refactor.

## 1. Why rename "connector" → "trigger"
"Connector" was named when the *only* action was **go to a place** (a region of the current
stage, or another level). The thing is really a **TRIGGER**: an activation condition + a typed
**action**. Actions are growing — go-to-place, reveal-content (CV section), collect-item
(inventory) — so "connector" no longer fits. Rename to **trigger** (or "action trigger").

## 2. Model
```
Trigger = {
  id
  cells | region        // where it fires (a cell, set of cells, or rect)
  event: 'enter' | 'interact' | 'attack' | 'touch'   // how it fires (already in connectors.ts)
  action: Action        // what it does — a DISCRIMINATED UNION on `type`
}
```
**Action** — discriminated union, **Open/Closed**: add a type = add a union member + one handler,
never edit the existing ones (matches our coding standards' dispatch-map rule):
- `goto_level`   `{ templateId, spawn }`  — teleport to another template (the old connector)
- `goto_region`  `{ col, row }`           — move within the current stage
- `content`      `{ sectionId }`          — reveal a CV section (the game-CV payoff)
- `collect`      `{ itemId, qty }`        — add an item to the inventory (inventory action)
- *(future: `dialogue`, `quest_give`, `spawn`, `toggle`, …)*

Runtime: `findTrigger(cell, event)` (pure — generalize today's `findTriggeredConnector`) →
`resolveAction(action)` dispatched through a **handler map** keyed by `action.type`. Pure decision
logic in `triggers.ts` (TDD); side effects (teleport, reveal, inventory add) in the play loop.

## 3. "Separate table for inventory actions?" — recommendation: **NO, keep ONE triggers table.**
- A discriminated `action` union keeps everything Open/Closed and avoids fragmenting the trigger
  concept across tables. The runtime already has to dispatch on action type either way; one table +
  one union is simpler than N parallel tables.
- What *may* be a separate concept is the **collectible item placement**, not a separate trigger
  table. A collectible is an **entity/prop** placed on a cell (an `item` entity carrying `itemId`);
  the `collect` trigger just references that `itemId` and calls `inventory.addItem`. So:
  **triggers (unified)** + **item definitions** (from `src/game/types.ts` / inventory) + **placed
  collectibles** (entities). No second trigger table.
- If real divergence shows up later (e.g. loot tables with drop rates), that's a *loot* concept that
  feeds the `collect` action — still not a parallel trigger table.

## 4. Migration (when the design is locked)
- `Connector` → `Trigger` across `lib/api.ts`, `engine/connectors.ts` → `engine/triggers.ts`,
  `templates.tsx`. Existing teleport becomes `action: goto_level | goto_region`.
- `findTriggeredConnector` → `findTrigger`; add `resolveAction` dispatch map.
- Keep `triggers.ts` pure + TDD; wire effects in the loop. The connector authoring UI becomes a
  trigger editor: pick event + action type → action-specific fields.

## 5. Open question for Alexander
Confirm **unified triggers table + discriminated action union** (my recommendation) vs. a separate
inventory-action table. Everything else follows from that.

/**
 * GAME ENGINE - Template Editor
 * Isometric level editor with ASCII tiles
 *
 * URL Params:
 * - ?new=1  - Start with random map
 * - ?id=xxx - Load existing template
 *
 * VIEW MODES (buttons in top-right):
 * - ISO: Isometric 3D game view
 * - TOP: 2D bird's-eye blueprint (no height)
 * - DEBUG: Isometric + collision overlay, asset labels
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { createVillageLevel, VILLAGE_CONFIG, GROUND_COLORS } from '@/levels/village'
import { IsometricGrid, GridAsset, GridBuilding } from '@/engine/IsometricGrid'
import { player as playerSprite } from '@/assets/ascii'
import { TILES, COMPOSITE_ASSETS, getTilesByCategory, getAssetsByCategory, TileDef, CompositeAsset } from '@/engine/Tileset'
import { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, serializeGrid, deserializeToGrid, TemplateListItem, Connector } from '@/lib/api'
import { findTriggeredConnector, normalizeConnector } from '@/engine/connectors'
import { resolveAction, type Action as TriggerAction } from '@/engine/triggers'
import { generateStage, stagePaint, StageData, VariantId, buildingCellColor } from '@/engine/stageGenerator'
import { ZoneId, ZONE_PALETTES } from '@/engine/zones'
import { cellTile } from '@/engine/cellTileset'
import { type BuildingType } from '@/engine/buildingComposer'
import type { Facing } from '@/engine/villageLayout'
import {
  buildingFootprintCells,
  footprintContains,
  canPlaceBuilding,
  moveBuilding,
  rotateBuilding,
  makeBuilding,
  gridBuildingFacing,
  facadeLength,
  doorCellFor,
  buildingRect,
  type PlacementEnv,
} from '@/engine/buildingEditor'
import { darkenColor, lightenColor, withAlpha, varyIntensity } from '@/engine/colors'
import { scaleCompositeToRegion } from '@/engine/compositeFill'
import { MULTI_CELL_ASSETS, stampAsset, assetFootprint, multiCellAssetById } from '@/engine/multiCellAssets'
import {
  stepMover,
  initMover,
  stepRunPatrol,
  initRunState,
  stepStepList,
  initStepList,
  STEP_LIST_DELAY_MS,
  RUN_PATROL_DELAY_MS,
  motionPos,
  type MoverState,
  type RunState,
  type StepListState,
} from '@/engine/movement'
import { isGroundContact } from '@/engine/cellLabels'
import { type CycleMode } from '@/engine/animationCycles'
import { entityAnimState, entityFrameIndex } from '@/engine/entityAnim'
import { assetAnimFrame, assetCycleFrame, animationOptions, ANIMATION_LIBRARY } from '@/engine/assetAnimations'
import { makeCycle, makeTrigger, validateCycle, describeCycle, CYCLE_MODES } from '@/engine/animationAuthoring'
import { shouldFire, lampPulse } from '@/engine/behaviors'
import { weaponAnimKind, animFrame, isAnimDone, ATTACK_ANIM_MS, type AttackAnim, type AttackAnimKind } from '@/engine/attackAnimations'
import { entityArtFrame, weaponGlyph, entityPalette, topRoleColor } from '@/engine/entityArt'
import { entityQuestMarker, type QuestMarker } from '@/engine/entityQuestMarker'
import { isoFacingIndex, isoFacadeOnBack, buildingFadeAlpha } from '@/engine/isoBuilding'
import { appendWaypoint, setMovementMode, clearWaypoints, buildStepList, addMovementStep, removeMovementStep, updateMovementStep, setStepDelay, makeAttackPattern, defaultAttackPattern } from '@/game/patterns'
import type { Direction } from '@/game/types'
import { useToast } from '@/components/Toast'
import {
  makePlayer,
  makeEnemy,
  makeNpc,
  canPlaceEntity,
  placeEntity,
  removeEntity,
  entityAt,
  entityAtFootprint,
  entityOccupiedCells,
  isRespawned,
  DEFAULT_PLAYER_STATS,
} from '@/game/entities'
import {
  deriveStats,
  startingCombatState,
  resolveAttack,
  isDead,
} from '@/game/combat'
import { isRanged, weaponReach } from '@/game/weapons'
import {
  projectileCellAt,
  projectileArrived,
  resolveImpact,
  type Projectile,
} from '@/game/projectiles'
import {
  acceptQuest,
  recordEvent,
  progress,
  turnIn,
  isComplete,
  type QuestEvent,
} from '@/game/quests'
import type { ObjectiveKind, TalentPath } from '@/game/types'
import type {
  Entity,
  EntityKind,
  Attack,
  CombatState,
  Weapon,
  Armor,
  Stats,
  Quest,
  Objective,
  Reward,
  Item,
  Inventory,
  Loadout,
  EquipSlot,
  MovementPattern,
  AttackMode,
} from '@/game/types'
import { EQUIP_SLOTS } from '@/game/types'
import { createInventory, addItem, equipWeapon, equipArmor, useConsumable } from '@/game/inventory'
import { createLoadout, equip as equipToSlot, unequip as unequipSlot, addToBag, setSpecial, setShortcut, allowedSlots, loadoutBonuses } from '@/game/loadout'
import { GEAR_CATALOG, starterWarriorGear } from '@/game/gear'
import { scatterEntities, ENEMY_TYPES } from '@/game/spawner'

const ASCII_FONT = '"JetBrains Mono", "Fira Code", "Consolas", monospace'

// Block-based sizing: each block is 16x16x16 (width x depth x height)
const BLOCK_SIZE = 16

// Character dimensions in blocks
const CHAR_WIDTH = 1   // 1 block wide
const CHAR_DEPTH = 1   // 1 block deep
const CHAR_HEIGHT = 3  // 3 blocks tall (legs, body, head)

// View mode states (global for game loop access)
let debugMode = false
let topViewMode = false
let flowViewMode = false

// Template limits
const MAX_TEMPLATES_PROD = 1

// ═══════════════════════════════════════════════════════════════════
// ENTITY PLACEMENT (player / enemies / NPCs)
// Glyph + colour vocabulary, id minting, and the save/load codec that
// piggybacks entities onto the template's assetsData (api.ts has no
// `entities` field and is read-only here). Pure + module-level so they
// aren't re-allocated per render and stay unit-testable.
// ═══════════════════════════════════════════════════════════════════

/** Which tool the Entities card has armed. `erase` removes; `null` = off. */
type EntityTool = EntityKind | 'erase' | 'collision' | null

// ═══════════════════════════════════════════════════════════════════
// MANUAL BUILDING EDITOR (select / move / rotate / delete / place)
// The pure geometry + validity live in engine/buildingEditor.ts; this is the
// LIVE stamp that mirrors stageGenerator.placeBuilding onto the running grid so
// the three views (which all read grid.buildings + collision + assets) update
// together. The invariant: footprint cells BLOCK except the walkable door cell.
// ═══════════════════════════════════════════════════════════════════

/** Which building tool is armed. Place-<type> drops a fresh building; select picks
 *  one to move/rotate/delete; delete removes the one under the click; null = off. */
type BuildingTool = 'select' | 'place-house' | 'place-store' | 'place-hospital' | 'delete' | null

/** Map a Place-<type> tool to the BuildingType it authors. */
const BUILDING_TOOL_TYPE: Partial<Record<NonNullable<BuildingTool>, BuildingType>> = {
  'place-house': 'house',
  'place-store': 'store',
  'place-hospital': 'hospital',
}

/** Ground a building footprint may NOT cover: roads (the door faces a road from one
 *  cell away — the footprint never sits on it) and water/lava. */
const BLOCKED_GROUND_FOR_BUILDING: ReadonlySet<string> = new Set([
  'path_stone', 'water', 'ice_water', 'oasis', 'koi', 'lava', 'magma',
])

/**
 * LIVE stamp: write a building's footprint onto the grid — a 'building' asset +
 * collision per cell (door walkable, every other cell blocking) + clean base
 * ground under it. Mirrors stageGenerator.stampFootprintCell. Does NOT touch
 * grid.buildings; the caller owns that array so indices stay stable across edits.
 */
function stampBuildingCells(grid: IsometricGrid, b: GridBuilding, zone: ZoneId): void {
  const { cells, door } = buildingFootprintCells(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    const isDoor = c.col === door.col && c.row === door.row
    const label = isDoor ? 'door' : 'roof'
    const tile = cellTile(zone, label)
    const color = buildingCellColor(b.type as BuildingType, label, b.col)
    grid.assets.push({
      art: [tile.char],
      col: c.col,
      row: c.row,
      type: 'building',
      blocking: !isDoor,
      color,
      label,
      buildingType: b.type,
    })
    grid.collision[c.row][c.col] = isDoor ? 0 : 1
    grid.ground[c.row][c.col] = base
  }
}

/**
 * LIVE unstamp (inverse of stampBuildingCells): drop the building assets on the
 * footprint, free collision back to walkable, and reset the ground to the zone
 * base (grass) — so a deleted/moved building leaves walkable grass behind.
 */
function unstampBuildingCells(grid: IsometricGrid, b: GridBuilding, zone: ZoneId): void {
  const { cells } = buildingFootprintCells(b)
  const base = ZONE_PALETTES[zone]?.groundTypes[0] ?? 'grass'
  const keys = new Set(cells.map(c => `${c.col},${c.row}`))
  grid.assets = grid.assets.filter(a => !(a.type === 'building' && keys.has(`${a.col},${a.row}`)))
  for (const c of cells) {
    if (c.col < 0 || c.row < 0 || c.col >= grid.cols || c.row >= grid.rows) continue
    grid.collision[c.row][c.col] = 0
    grid.ground[c.row][c.col] = base
  }
}

/**
 * The placement environment for the editor: every cell occupied by ANOTHER
 * building, by blocking terrain, or by a road counts as blocked — except the
 * cells in `ignore` (the moving/rotating building's current footprint, which is
 * about to be vacated). Pure-ish reader over the live grid.
 */
function buildingPlacementEnv(grid: IsometricGrid, ignoreIndex: number, ignore: ReadonlySet<string>): PlacementEnv {
  const others = new Set<string>()
  grid.buildings.forEach((b, i) => {
    if (i === ignoreIndex) return
    for (const c of buildingFootprintCells(b).cells) others.add(`${c.col},${c.row}`)
  })
  return {
    cols: grid.cols,
    rows: grid.rows,
    blocked: (col, row) => {
      const key = `${col},${row}`
      if (ignore.has(key)) return false
      if (others.has(key)) return true // another building's footprint (incl. its door)
      if (grid.collision[row]?.[col] === 1) return true // trees / water / features
      return BLOCKED_GROUND_FOR_BUILDING.has(grid.ground[row]?.[col] ?? '')
    },
  }
}

/** The cardinal direction from (col,row) toward the NEAREST road cell (path_stone),
 *  so a manually-placed building fronts a street like a generated one. Defaults to
 *  south when the map has no roads. */
function nearestRoadFacing(grid: IsometricGrid, col: number, row: number): Facing {
  let best: { d: number; facing: Facing } | null = null
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.ground[r]?.[c] !== 'path_stone') continue
      const d = Math.abs(c - col) + Math.abs(r - row)
      if (best && d >= best.d) continue
      const facing: Facing =
        Math.abs(c - col) > Math.abs(r - row) ? (c > col ? 'east' : 'west') : (r >= row ? 'south' : 'north')
      best = { d, facing }
    }
  }
  return best?.facing ?? 'south'
}

/** Glyph drawn for each entity kind, over a dark backing (spec §1). */
const ENTITY_GLYPH: Record<EntityKind, string> = {
  player: '☻',
  enemy: 'E', // enemies fall back to this; a typed enemy uses its first letter
  npc: '☺',
}

/** Distinct colours so kinds read at a glance: player yellow, enemy red, npc cyan. */
const ENTITY_COLOR: Record<EntityKind, string> = {
  player: '#ffdd00',
  enemy: '#ff4d4d',
  npc: '#33d6ff',
}

/** The glyph an entity renders as — enemies use their type's first letter. */
function entityGlyph(entity: Entity): string {
  if (entity.kind !== 'enemy') return ENTITY_GLYPH[entity.kind]
  const first = entity.enemyType?.trim()?.[0]
  return first ? first.toUpperCase() : ENTITY_GLYPH.enemy
}

/** A short, unique-enough id for an entity minted in the editor session. */
function mintEntityId(kind: EntityKind): string {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** A short, unique-enough id for a minted item (quest rewards, etc.). */
function mintItemId(): string {
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ── persistence codec ────────────────────────────────────────────────
// Entities ride inside the existing `assetsData` array as marked records so
// they round-trip through createTemplate/updateTemplate without touching
// api.ts. The marker type keeps them out of the visible asset renderers.

const ENTITY_ASSET_TYPE = 'nebulith:entity'

/** Serialize entities into asset-shaped records appended to assetsData. */
function entitiesToAssets(entities: readonly Entity[]): GridAsset[] {
  return entities.map(entity => ({
    art: [entityGlyph(entity)],
    col: entity.col,
    row: entity.row,
    type: ENTITY_ASSET_TYPE,
    blocking: false, // entities are not terrain collision
    color: ENTITY_COLOR[entity.kind],
    label: JSON.stringify(entity), // the round-trip payload
  }))
}

/** True for the marker records produced by entitiesToAssets. */
function isEntityAsset(asset: GridAsset): boolean {
  return asset.type === ENTITY_ASSET_TYPE
}

/** Decode one marker asset back into an Entity, or null if malformed. */
function entityFromAsset(asset: GridAsset): Entity | null {
  if (!asset.label) return null
  try {
    const parsed = JSON.parse(asset.label) as Entity
    if (parsed?.kind && typeof parsed.col === 'number' && typeof parsed.row === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/** Pull every entity back out of a loaded asset list (drops malformed ones). */
function entitiesFromAssets(assets: readonly GridAsset[]): Entity[] {
  const out: Entity[] = []
  for (const asset of assets) {
    if (!isEntityAsset(asset)) continue
    const entity = entityFromAsset(asset)
    if (entity) out.push(entity)
  }
  return out
}

// ── quest persistence codec ──────────────────────────────────────────
// Quests ride the same assetsData channel as entities (api.ts has no quest
// field and is read-only here). Each quest becomes one off-grid marker asset so
// the set round-trips through create/updateTemplate; load splits them back out.
// The NPC↔quest link survives independently via the entity's own questId field.

const QUEST_ASSET_TYPE = 'nebulith:quest'

/** Serialize quests into off-grid asset-shaped marker records. */
function questsToAssets(quests: readonly Quest[]): GridAsset[] {
  return quests.map(quest => ({
    art: [' '],
    col: -1, // off-grid: never drawn by the tile/asset renderers
    row: -1,
    type: QUEST_ASSET_TYPE,
    blocking: false,
    color: '#000000',
    label: JSON.stringify(quest), // the round-trip payload
  }))
}

/** True for the marker records produced by questsToAssets. */
function isQuestAsset(asset: GridAsset): boolean {
  return asset.type === QUEST_ASSET_TYPE
}

/** Decode one marker asset back into a Quest, or null if malformed. */
function questFromAsset(asset: GridAsset): Quest | null {
  if (!asset.label) return null
  try {
    const parsed = JSON.parse(asset.label) as Quest
    if (parsed?.id && Array.isArray(parsed.objectives) && Array.isArray(parsed.rewards)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/** Pull every quest back out of a loaded asset list (drops malformed ones). */
function questsFromAssets(assets: readonly GridAsset[]): Quest[] {
  const out: Quest[] = []
  for (const asset of assets) {
    if (!isQuestAsset(asset)) continue
    const quest = questFromAsset(asset)
    if (quest) out.push(quest)
  }
  return out
}

// ── building persistence codec ───────────────────────────────────────
// The GROUPED buildings (grid.buildings) drive the upright iso/2D/top render. The template schema
// has no building field (api.ts is read-only here), so — exactly like entities + quests — each
// building rides assetsData as one OFF-GRID marker record, split back out on load. Without this,
// grid.buildings is empty after a load and every view falls back to the OLD per-cell building look.

const BUILDING_ASSET_TYPE = 'nebulith:building'

/** Serialize grouped buildings into off-grid asset-shaped marker records. */
function buildingsToAssets(buildings: readonly GridBuilding[]): GridAsset[] {
  return buildings.map(b => ({
    art: [' '],
    col: -1, // off-grid: never drawn by the tile/asset renderers
    row: -1,
    type: BUILDING_ASSET_TYPE,
    blocking: false,
    color: '#000000',
    label: JSON.stringify(b), // the round-trip payload (cells, facing, depth, facadeOnBack, …)
  }))
}

/** True for the marker records produced by buildingsToAssets. */
function isBuildingAsset(asset: GridAsset): boolean {
  return asset.type === BUILDING_ASSET_TYPE
}

/** Decode one marker asset back into a GridBuilding, or null if malformed. */
function buildingFromAsset(asset: GridAsset): GridBuilding | null {
  if (!asset.label) return null
  try {
    const parsed = JSON.parse(asset.label) as GridBuilding
    if (Array.isArray(parsed?.cells) && typeof parsed.col === 'number' && typeof parsed.row === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/** Pull every grouped building back out of a loaded asset list (drops malformed ones). */
function buildingsFromAssets(assets: readonly GridAsset[]): GridBuilding[] {
  const out: GridBuilding[] = []
  for (const asset of assets) {
    if (!isBuildingAsset(asset)) continue
    const b = buildingFromAsset(asset)
    if (b) out.push(b)
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════
// COMBAT — wiring the pure engine (src/game/combat.ts) into the play loop.
// All formulas live in the combat module; this is orchestration only:
// targeting from facing, runtime state in refs, death/respawn timing, and a
// simple enemy melee retaliation. Pure + module-level so nothing re-allocates
// per frame and the rules stay unit-testable. (spec §2–6)
// ═══════════════════════════════════════════════════════════════════

/** The player's starting weapon — a basic warrior sword (spec §4 "one of each"). */
const STARTER_SWORD: Weapon = {
  id: 'starter-sword',
  kind: 'sword',
  name: 'Worn Sword',
  baseDamage: 6,
  baseMagic: 0,
  baseDefense: 1,
  strengthBonus: 0,
  intBonus: 0,
  school: 'physical',
  range: 'melee',
  hands: 1,
  reachCells: 1,
}

/** A magician alternative the player can equip from the starting inventory.
 *  Two-handed magical melee caster (reach 2). */
const OAK_STAFF: Weapon = {
  id: 'oak-staff', kind: 'staff', name: 'Oak Staff',
  baseDamage: 0, baseMagic: 10, baseDefense: 0, strengthBonus: 0, intBonus: 4,
  school: 'magical', range: 'melee', hands: 2, reachCells: 2,
}

/** A starting inventory: sword equipped, plus a staff, light armor, and a potion
 *  to demonstrate equip/use. (Fresh objects each call.) */
function starterInventory(): Inventory {
  return createInventory(
    [
      { id: 'oak-staff', name: 'Oak Staff', slot: 'weapon', weapon: OAK_STAFF },
      {
        id: 'leather-vest', name: 'Leather Vest', slot: 'armor',
        armor: { id: 'leather-vest', kind: 'leather', name: 'Leather Vest', defenseBonus: 4, strengthBonus: 0, intBonus: 2 },
      },
      { id: 'health-potion', name: 'Health Potion', slot: 'consumable', effect: { hp: 40 } },
    ],
    STARTER_SWORD,
    null,
  )
}

/** Build a carryable item from a quest 'item' reward (no item DB yet → a small
 *  health potion tagged by the reward's itemId). */
function itemFromReward(reward: Reward, id: string): Item {
  return { id, name: reward.itemId || 'Reward Item', slot: 'consumable', effect: { hp: 25 } }
}

/** Hold-to-loop cadence for the regular attack — one swing per this interval while `f` is held
 *  (matches the swing animation so swings chain seamlessly). */
const ATTACK_LOOP_MS = 200
/** The two attacks bound to input: `f` = free regular, `g` = rage-fueled special. */
const REGULAR_MELEE: Attack = { school: 'physical', range: 'melee', tier: 'regular' }
const SPECIAL_MELEE: Attack = { school: 'physical', range: 'melee', tier: 'special' }

/** Enemy retaliation: a flat regular melee, gated by a per-enemy cooldown (ms). A
 *  ranged enemy (entity.attack.mode==='ranged') uses the ranged variant + reach. */
const ENEMY_ATTACK: Attack = REGULAR_MELEE
const ENEMY_RANGED_ATTACK: Attack = { school: 'physical', range: 'ranged', tier: 'regular' }
/** Fallback cooldown for enemies with no authored attack pattern. */
const ENEMY_ATTACK_COOLDOWN_MS = 900

/** "+dmg" hit markers float for this long before fading. */
const HIT_MARKER_MS = 650

/** A floating damage number anchored to a cell, shown briefly after a hit. */
interface HitMarker {
  col: number
  row: number
  amount: number
  bornAt: number
  /** who took the hit — colors the marker (enemy red vs player white). */
  target: 'enemy' | 'player'
}

/** Per-enemy runtime bookkeeping the loop owns, keyed by entity id. */
interface EnemyRuntime {
  combat: Map<string, CombatState>
  /** death timestamp per enemy id (drives respawn timing). */
  diedAt: Map<string, number>
  /** last time each enemy landed a retaliation hit (drives its cooldown). */
  lastAttackAt: Map<string, number>
}

const makeEnemyRuntime = (): EnemyRuntime => ({
  combat: new Map(),
  diedAt: new Map(),
  lastAttackAt: new Map(),
})

/** Read-only snapshot of player combat for the HUD (mirrored to React state). */
interface PlayerHud {
  hp: number
  maxHp: number
  rage: number
  rageCap: number
  mana: number
  manaCap: number
}

/** Is this entity a living (not currently dead/awaiting-respawn) enemy? */
function isLivingEnemy(entity: Entity, runtime: EnemyRuntime): boolean {
  if (entity.kind !== 'enemy') return false
  if (entity.hittable === false) return false // a non-hittable enemy is passive scenery
  const state = runtime.combat.get(entity.id)
  if (!state) return true // freshly placed, not yet initialized → alive
  return !isDead(state.hp)
}

/**
 * Ensure every current enemy has a runtime CombatState, and prune state for
 * enemies that no longer exist. Returns nothing — mutates the runtime maps in
 * place (the loop owns them; this is the one sync point each frame).
 */
function syncEnemyRuntime(entities: readonly Entity[], runtime: EnemyRuntime): void {
  const live = new Set<string>()
  for (const entity of entities) {
    if (entity.kind !== 'enemy') continue
    live.add(entity.id)
    if (runtime.combat.has(entity.id)) continue
    runtime.combat.set(entity.id, startingCombatState(entity.baseStats))
  }
  pruneRuntimeMaps(runtime, live)
}

/** Drop runtime entries for ids no longer present (entity erased in the editor). */
function pruneRuntimeMaps(runtime: EnemyRuntime, live: ReadonlySet<string>): void {
  for (const id of runtime.combat.keys()) {
    if (live.has(id)) continue
    runtime.combat.delete(id)
    runtime.diedAt.delete(id)
    runtime.lastAttackAt.delete(id)
  }
}

/** Respawn any dead enemy whose timer has elapsed (full HP, timers cleared). */
function respawnElapsedEnemies(entities: readonly Entity[], runtime: EnemyRuntime, now: number): void {
  for (const entity of entities) {
    if (entity.kind !== 'enemy') continue
    const diedAt = runtime.diedAt.get(entity.id)
    if (diedAt === undefined) continue
    if (!isRespawned(diedAt, entity.respawnMs, now)) continue
    runtime.combat.set(entity.id, startingCombatState(entity.baseStats))
    runtime.diedAt.delete(entity.id)
    runtime.lastAttackAt.delete(entity.id)
  }
}

/** The cell directly in front of the player, per the active view's facing delta. */
function facingCell(player: PlayerState, cellSize: number, use2D: boolean): { col: number; row: number } {
  const [dCol, dRow] = facingDelta(player.facing, use2D)
  return {
    col: Math.floor(player.x / cellSize) + dCol,
    row: Math.floor(player.z / cellSize) + dRow,
  }
}

const ADJACENT_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [0, 1], [-1, 0], [1, 0], // orthogonal first (preferred)
  [-1, -1], [1, 1], [-1, 1], [1, -1], // then diagonals (iso neighbours)
]

/**
 * Pick the enemy the player is attacking: the faced cell wins; otherwise scan down
 * the facing line up to the weapon's `reach` (melee 1–2, ranged 6–12); otherwise the
 * nearest living adjacent enemy; null if none in reach. Dead enemies are skipped.
 */
const RANGED_RANGE = 6 // default cells a ranged enemy reaches (enemy retaliation)

function findTarget(
  player: PlayerState,
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  cellSize: number,
  use2D: boolean,
  reach = 1,
): Entity | null {
  const faced = facingCell(player, cellSize, use2D)
  const facedEnemy = enemyAtCell(entities, runtime, faced.col, faced.row)
  if (facedEnemy) return facedEnemy
  // Scan further down the facing line for reach > 1 (2H melee = 2, ranged = 6–12).
  if (reach >= 2) {
    const [dCol, dRow] = facingDelta(player.facing, use2D)
    const pCol = Math.floor(player.x / cellSize)
    const pRow = Math.floor(player.z / cellSize)
    for (let d = 2; d <= reach; d++) {
      const e = enemyAtCell(entities, runtime, pCol + dCol * d, pRow + dRow * d)
      if (e) return e
    }
  }
  return nearestAdjacentEnemy(player, entities, runtime, cellSize)
}

/** A living enemy occupying (col,row), or null. */
function enemyAtCell(
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  col: number,
  row: number,
): Entity | null {
  const here = entityAt(entities, col, row)
  if (!here || !isLivingEnemy(here, runtime)) return null
  return here
}

/** First living enemy in any of the 8 cells around the player, or null. */
function nearestAdjacentEnemy(
  player: PlayerState,
  entities: readonly Entity[],
  runtime: EnemyRuntime,
  cellSize: number,
): Entity | null {
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  for (const [dCol, dRow] of ADJACENT_DELTAS) {
    const found = enemyAtCell(entities, runtime, pCol + dCol, pRow + dRow)
    if (found) return found
  }
  return null
}

/** Is the player standing adjacent (incl. diagonally) to this entity? */
function isAdjacentToPlayer(player: PlayerState, entity: Entity, cellSize: number): boolean {
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  return Math.abs(entity.col - pCol) <= 1 && Math.abs(entity.row - pRow) <= 1
}

/** Build the HUD snapshot (caps derived from effective stats) for React mirroring. */
function playerHudFrom(baseStats: Stats, weapon: Weapon, state: CombatState): PlayerHud {
  const eff = deriveStats(baseStats, weapon)
  const full = startingCombatState(eff)
  return {
    hp: state.hp,
    maxHp: eff.maxHp,
    rage: state.rage,
    rageCap: full.rage,
    mana: state.mana,
    manaCap: full.mana,
  }
}

/** Inputs the per-frame combat step reads/owns. Keeps the loop call site flat. */
interface CombatStepInput {
  player: PlayerState
  entities: readonly Entity[]
  runtime: EnemyRuntime
  playerCombat: CombatState
  playerWeapon: Weapon
  /** equipped armor folds its defense into the player when taking melee hits. */
  playerArmor: Armor | null
  /** the player's effective stats from their equipped loadout (gear str/int/defense
   *  + dodge). Drives both the player's attacks and their dodge on retaliation. */
  playerStats: Stats
  /** the player's equipped shield (if any) — gives a block% on retaliation. */
  playerShield?: Weapon
  hitMarkers: HitMarker[]
  cellSize: number
  use2D: boolean
  attack: boolean // edge-triggered: regular attack this frame
  special: boolean // edge-triggered: special attack this frame
  now: number
  /** the loop's live attack-animation list; a landed hit pushes one. */
  anims?: AttackAnim[]
  /** the loop's live projectile list; a ranged attack pushes a travelling shot here. */
  projectiles?: Projectile[]
  /** per-projectile attacker context, so impact-time damage knows who fired + with what. */
  projectileCtx?: Map<string, ProjectileContext>
}

/** The attacker side of a projectile, captured at fire so the impact (resolved later,
 *  in tickProjectiles) can run resolveAttack. The attacker's live runtime state is read
 *  at impact, not stored here. */
interface ProjectileContext {
  attackerStats: Stats
  attackerWeapon: Weapon
  attack: Attack
}

/** What the combat step produces back to the loop (player state may be replaced on death/spend). */
interface CombatStepResult {
  playerCombat: CombatState
  /** enemyType of every enemy the player killed THIS frame — feeds 'kill' quest objectives. */
  kills: string[]
}

/**
 * One combat tick: respawn timers, the player's attack (if pressed), enemy
 * retaliation, and player-death reset. Mutates `runtime`/`hitMarkers` in place
 * (the loop owns them) and returns the player's (possibly new) CombatState plus
 * the enemyTypes killed this frame so the loop can advance kill quests.
 */
function stepCombat(input: CombatStepInput): CombatStepResult {
  const { entities, runtime, hitMarkers, now } = input
  syncEnemyRuntime(entities, runtime)
  respawnElapsedEnemies(entities, runtime, now)
  prunePlayerStartedMarkers(hitMarkers, now)

  const kills: string[] = []
  let playerCombat = applyPlayerAttack(input, kills)
  playerCombat = applyEnemyRetaliation({ ...input, playerCombat })
  playerCombat = resetPlayerIfDead(playerCombat)
  return { playerCombat, kills }
}

/** Drop hit markers older than their lifetime so the array stays bounded. */
function prunePlayerStartedMarkers(markers: HitMarker[], now: number): void {
  // Filter in place to avoid per-frame allocation churn.
  let write = 0
  for (let read = 0; read < markers.length; read++) {
    const m = markers[read]
    if (now - m.bornAt >= HIT_MARKER_MS) continue
    markers[write++] = m
  }
  markers.length = write
}

/** Spawn an attack animation — the SAME call for EVERY attacker (player, enemy, turret).
 *  This is the single bridge from the attack system to the animation system; firing any
 *  attack plays its animation through here. */
// A short synthesized "swoosh" for a melee swing — decaying noise through a bandpass that sweeps
// down. No asset; lazily creates the AudioContext on the first swing (a key press = a user gesture).
let swooshCtx: AudioContext | null = null
function playSwoosh(): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    swooshCtx = swooshCtx ?? new Ctor()
    const ctx = swooshCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const dur = 0.16
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) // decaying noise
    const src = ctx.createBufferSource()
    src.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.1
    bp.frequency.setValueAtTime(1900, ctx.currentTime)
    bp.frequency.exponentialRampToValueAtTime(550, ctx.currentTime + dur) // sweep down = swoosh
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.22, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
    src.connect(bp)
    bp.connect(g)
    g.connect(ctx.destination)
    src.start()
  } catch {
    /* audio unavailable — stay silent */
  }
}

function spawnAttackAnim(
  anims: AttackAnim[] | undefined,
  fromX: number, fromZ: number, toX: number, toZ: number,
  kind: AttackAnimKind, now: number, glyph?: string, inHand?: boolean,
): void {
  if (!anims) return
  anims.push({ kind, fromX, fromZ, toX, toZ, start: now, durationMs: ATTACK_ANIM_MS[kind], glyph, inHand })
}

/** ms a projectile spends travelling per cell — slow enough that an enemy can step off
 *  the impact cell to dodge it (the core of "resolve on impact, not on fire"). */
const PROJECTILE_MS_PER_CELL = 55

/** The glyph a projectile draws, by firing weapon kind: bow → arrow, gun → bullet, else
 *  a generic bolt. (Per-weapon arrow/bullet/bolt selection.) */
const PROJECTILE_GLYPHS: Partial<Record<string, string>> = { bow: '➤', gun: '•' }
function projectileGlyph(kind: string): string {
  return PROJECTILE_GLYPHS[kind] ?? '→'
}

let projectileSeq = 0

/**
 * Resolve the player's chosen attack against the current target, if any. The equipped
 * weapon drives everything: isRanged + weaponReach decide melee-vs-ranged and reach.
 *   - MELEE  → instant strike within reach; damage resolves now. On a lethal hit, records
 *     the death timestamp (respawn) AND pushes the enemy's `enemyType` into `kills`.
 *   - RANGED → spawns a travelling Projectile and returns; NO damage now. Impact (and its
 *     kill bookkeeping) is resolved later by tickProjectiles when the shot arrives.
 */
function applyPlayerAttack(input: CombatStepInput, kills: string[]): CombatState {
  const { player, entities, runtime, playerCombat, playerWeapon, hitMarkers, cellSize, use2D, attack, special, now } = input
  if (!attack && !special) return playerCombat

  // Melee-vs-ranged + reach come from the equipped weapon, not a hardcoded mode/range.
  const ranged = isRanged(playerWeapon)
  const reach = weaponReach(playerWeapon)
  const faced = facingCell(player, cellSize, use2D)
  const target = findTarget(player, entities, runtime, cellSize, use2D, reach)
  const aimCol = target ? target.col : faced.col
  const aimRow = target ? target.row : faced.row

  // RANGED: loose a projectile aimed at the target's CURRENT cell and stop. Damage is
  // deferred to impact (tickProjectiles) — it misses if the target steps off that cell.
  if (ranged) {
    spawnProjectile(input, aimCol, aimRow, target, now)
    return playerCombat
  }

  // MELEE: resolve damage now if we hit something; the swing is shown either way below.
  let animKind = weaponAnimKind(playerWeapon.kind, playerWeapon.range)
  let nextState = playerCombat
  const targetState = target ? runtime.combat.get(target.id) : undefined
  if (target && targetState) {
    const chosen: Attack = { school: playerWeapon.school, range: playerWeapon.range, tier: special ? 'special' : 'regular' }
    const result = resolveAttack({
      attacker: input.playerStats,
      defender: target.baseStats,
      attack: chosen,
      attackerWeapon: playerWeapon,
      defenderHp: targetState.hp,
      attackerState: playerCombat,
    })
    if (result.fired) {
      runtime.combat.set(target.id, { ...targetState, hp: result.defenderHpAfter })
      pushHitMarker(hitMarkers, target.col, target.row, result.damage, 'enemy', now)
      if (result.blocked) animKind = 'block'
      if (result.lethal) recordEnemyDeath(runtime, target, kills, now)
      nextState = result.attackerStateAfter ?? playerCombat
    }
  }

  // ALWAYS show the swing — even a whiff. Shared spawn → same for every attacker.
  // melee → the single in-hand weapon swings (drawn by the player); ranged/magic keep their own anim
  spawnAttackAnim(input.anims, player.x, player.z, aimCol * cellSize + cellSize / 2, aimRow * cellSize + cellSize / 2, animKind, now, player.weaponGlyph, animKind === 'slash')
  return nextState
}

/** A killed enemy: stamp its death time (respawn) and report its type for kill quests. */
function recordEnemyDeath(runtime: EnemyRuntime, enemy: Entity, kills: string[], now: number): void {
  runtime.diedAt.set(enemy.id, now)
  kills.push(enemy.enemyType ?? 'enemy')
}

/** Loose a travelling projectile from the player toward (aimCol,aimRow). Stores the
 *  attacker context so the deferred impact (tickProjectiles) can run resolveAttack.
 *  A target-less shot (no enemy acquired) still flies — it just resolves to a miss. */
function spawnProjectile(input: CombatStepInput, aimCol: number, aimRow: number, target: Entity | null, now: number): void {
  const list = input.projectiles
  if (!list) return
  const { player, cellSize, playerWeapon, special } = input
  const fromCol = Math.floor(player.x / cellSize)
  const fromRow = Math.floor(player.z / cellSize)
  const dist = Math.max(1, Math.max(Math.abs(aimCol - fromCol), Math.abs(aimRow - fromRow)))
  const id = `proj-${now}-${projectileSeq++}`
  list.push({
    id,
    fromCol, fromRow,
    toCol: aimCol, toRow: aimRow,
    targetId: target ? target.id : '',
    startMs: now,
    durationMs: Math.round(dist * PROJECTILE_MS_PER_CELL),
    glyph: projectileGlyph(playerWeapon.kind),
    power: playerWeapon.baseDamage,
  })
  input.projectileCtx?.set(id, {
    attackerStats: input.playerStats,
    attackerWeapon: playerWeapon,
    attack: { school: playerWeapon.school, range: playerWeapon.range, tier: special ? 'special' : 'regular' },
  })
}

/** Inputs for one projectile-resolution tick (mirrors CombatStepResult bookkeeping). */
interface ProjectileTickInput {
  projectiles: Projectile[]
  ctx: Map<string, ProjectileContext>
  entities: readonly Entity[]
  runtime: EnemyRuntime
  playerCombat: CombatState
  hitMarkers: HitMarker[]
  anims?: AttackAnim[]
  cellSize: number
  now: number
  /** RNG for the impact dodge/block rolls; defaults to Math.random. */
  rng?: () => number
}

/**
 * Advance active projectiles: any that have ARRIVED resolve against the target's CURRENT
 * cell (resolveImpact → hit/missed_moved/dodged/blocked), apply damage via resolveAttack on
 * a hit, drop a flourish, and are removed. In-flight projectiles are kept (drawn by render).
 * Returns the (possibly spent) player state + enemyTypes killed this tick for kill quests.
 */
function tickProjectiles(input: ProjectileTickInput): { playerCombat: CombatState; kills: string[] } {
  const { projectiles, ctx, now } = input
  const rng = input.rng ?? Math.random
  const kills: string[] = []
  let playerCombat = input.playerCombat
  let write = 0
  for (let read = 0; read < projectiles.length; read++) {
    const p = projectiles[read]
    if (!projectileArrived(p, now)) { projectiles[write++] = p; continue }
    playerCombat = resolveProjectileImpact(p, ctx.get(p.id), input, playerCombat, kills, rng)
    ctx.delete(p.id)
  }
  projectiles.length = write
  return { playerCombat, kills }
}

/** Resolve a single arrived projectile. Returns the attacker's state (a special spends
 *  its resource on a landed hit). Pushes kills + a hit marker on damage, always a flourish. */
function resolveProjectileImpact(
  p: Projectile,
  context: ProjectileContext | undefined,
  env: ProjectileTickInput,
  playerCombat: CombatState,
  kills: string[],
  rng: () => number,
): CombatState {
  const { entities, runtime, hitMarkers, anims, cellSize, now } = env
  const target = entities.find(e => e.id === p.targetId)
  const targetState = target ? runtime.combat.get(target.id) : undefined

  // No live target (despawned / cosmetic shot) → fizzle with a flourish, no damage.
  if (!target || !targetState || !context || isDead(targetState.hp)) {
    spawnImpactFlourish(anims, p.toCol, p.toRow, cellSize, now)
    return playerCombat
  }

  const dodgeChance = (target.baseStats.dodge ?? 0) / 100
  const blockChance = (context.attackerWeapon.blockChance ?? 0) // enemies carry no shields → ~0
  const outcome = resolveImpact(p, { col: target.col, row: target.row }, blockChance, dodgeChance, rng)
  if (outcome !== 'hit') {
    spawnImpactFlourish(anims, p.toCol, p.toRow, cellSize, now)
    return playerCombat
  }

  // Confirmed hit: resolveImpact already arbitrated dodge/block, so feed resolveAttack a
  // roll that never re-triggers them (roll()*100 < pct is false at 1.0 for pct ≤ 100).
  const result = resolveAttack({
    attacker: context.attackerStats,
    defender: target.baseStats,
    attack: context.attack,
    attackerWeapon: context.attackerWeapon,
    defenderHp: targetState.hp,
    attackerState: playerCombat,
    roll: () => 1,
  })
  if (result.fired) {
    runtime.combat.set(target.id, { ...targetState, hp: result.defenderHpAfter })
    pushHitMarker(hitMarkers, target.col, target.row, result.damage, 'enemy', now)
    if (result.lethal) recordEnemyDeath(runtime, target, kills, now)
    playerCombat = result.attackerStateAfter ?? playerCombat
  }
  spawnImpactFlourish(anims, target.col, target.row, cellSize, now)
  return playerCombat
}

/** A short impact spark on a cell (reuses the 'block' burst frames; sits in place). */
function spawnImpactFlourish(anims: AttackAnim[] | undefined, col: number, row: number, cellSize: number, now: number): void {
  const x = col * cellSize + cellSize / 2
  const z = row * cellSize + cellSize / 2
  spawnAttackAnim(anims, x, z, x, z, 'block', now)
}

/** Every adjacent living enemy off its cooldown lands one melee hit on the player. */
function applyEnemyRetaliation(input: CombatStepInput & { playerCombat: CombatState }): CombatState {
  const { player, entities, runtime, playerWeapon, hitMarkers, cellSize, now } = input
  let playerCombat = input.playerCombat

  // The player's effective stats already fold in equipped gear (defense + dodge); a
  // shield adds a block%. resolveAttack rolls dodge then block before damage.
  const defenderStats: Stats = input.playerStats

  for (const entity of entities) {
    if (!isLivingEnemy(entity, runtime)) continue
    if (!withinAttackReach(player, entity, cellSize)) continue
    if (!offCooldown(runtime, entity, now)) continue

    const ranged = entity.attack?.mode === 'ranged'
    const result = resolveAttack({
      attacker: entity.baseStats,
      defender: defenderStats,
      attack: ranged ? ENEMY_RANGED_ATTACK : ENEMY_ATTACK,
      attackerWeapon: enemyFist(entity, ranged),
      defenderWeapon: input.playerShield ?? playerWeapon,
      defenderHp: playerCombat.hp,
    })
    runtime.lastAttackAt.set(entity.id, now)
    // The enemy's swing/bolt animates too — attacks trigger animations for EVERY attacker.
    spawnAttackAnim(input.anims, entity.col * cellSize + cellSize / 2, entity.row * cellSize + cellSize / 2, player.x, player.z, ranged ? 'shot' : 'slash', now)
    playerCombat = { ...playerCombat, hp: result.defenderHpAfter }
    const pCol = Math.floor(player.x / cellSize)
    const pRow = Math.floor(player.z / cellSize)
    pushHitMarker(hitMarkers, pCol, pRow, result.damage, 'player', now)
    if (isDead(playerCombat.hp)) break // dead — stop piling on this frame
  }
  return playerCombat
}

/** An enemy's "weapon" is its bare strength — a zero-base physical attack. Ranged
 *  enemies fling a bolt (range matches the attack so block/range checks line up). */
function enemyFist(entity: Entity, ranged = false): Weapon {
  return {
    id: `fist-${entity.id}`,
    kind: 'sword',
    name: ranged ? 'Bolt' : 'Claw',
    baseDamage: 0,
    baseMagic: 0,
    baseDefense: 0,
    strengthBonus: 0,
    intBonus: 0,
    school: 'physical',
    range: ranged ? 'ranged' : 'melee',
    hands: 1,
    reachCells: ranged ? 6 : 1,
  }
}

/** Can this enemy reach the player to retaliate? Melee = 8-adjacent; a ranged enemy
 *  reaches up to RANGED_RANGE cells away in any direction (chebyshev distance). */
function withinAttackReach(player: PlayerState, entity: Entity, cellSize: number): boolean {
  if (entity.attack?.mode !== 'ranged') return isAdjacentToPlayer(player, entity, cellSize)
  const pCol = Math.floor(player.x / cellSize)
  const pRow = Math.floor(player.z / cellSize)
  const dist = Math.max(Math.abs(entity.col - pCol), Math.abs(entity.row - pRow))
  return dist >= 1 && dist <= RANGED_RANGE
}

/** Has this enemy's retaliation cooldown elapsed? (first hit is always allowed) Uses
 *  the entity's authored attack cooldown when set, else the engine default. */
function offCooldown(runtime: EnemyRuntime, entity: Entity, now: number): boolean {
  const last = runtime.lastAttackAt.get(entity.id)
  if (last === undefined) return true
  return now - last >= (entity.attack?.cooldownMs ?? ENEMY_ATTACK_COOLDOWN_MS)
}

/** Append a floating "+dmg" marker (skipped when no damage was dealt). */
function pushHitMarker(
  markers: HitMarker[],
  col: number,
  row: number,
  amount: number,
  target: 'enemy' | 'player',
  now: number,
): void {
  if (amount <= 0) return
  markers.push({ col, row, amount, target, bornAt: now })
}

/** Player death → reset to full HP at spawn (placeholder until respawn/death UX). */
function resetPlayerIfDead(playerCombat: CombatState): CombatState {
  if (!isDead(playerCombat.hp)) return playerCombat
  // NOTE: trivial reset for now — full restore in place. No spawn teleport yet
  // (spec §"keep it simple first"); proper death/respawn UX comes later.
  return startingCombatState(deriveStats(DEFAULT_PLAYER_STATS, STARTER_SWORD))
}

// ═══════════════════════════════════════════════════════════════════
// QUESTS — wiring the pure quest module (src/game/quests.ts) into the editor.
// All lifecycle/progress math lives in the module; this is orchestration only:
// authoring a Quest from the editor form, finding a giver's quest, feeding kill
// events, and granting rewards on turn-in. Pure + module-level so nothing
// re-allocates per render and the rules stay unit-testable. (spec §10)
// ═══════════════════════════════════════════════════════════════════

/** Reward types the simple authoring UI can grant (subset of Reward kinds). */
type SimpleRewardKind = 'xp' | 'item'

/** The fields the Quests card collects before minting a Quest. */
interface QuestDraft {
  giverId: string
  title: string
  /** objective type: slay enemies / travel to a cell / find an NPC. */
  objectiveKind: ObjectiveKind
  /** the objective TARGET: enemyType (kill), "col,row" cell (travel), or npc id (find). */
  target: string
  count: number
  rewardKind: SimpleRewardKind
  /** xp amount (rewardKind 'xp') — ignored for items. */
  rewardXp: number
  /** itemId to grant (rewardKind 'item') — ignored for xp. */
  rewardItemId: string
}

/** A fresh, empty draft for the authoring form (no giver picked yet). */
function emptyQuestDraft(): QuestDraft {
  return { giverId: '', title: '', objectiveKind: 'kill', target: 'goblin', count: 3, rewardKind: 'xp', rewardXp: 50, rewardItemId: '' }
}

/** A short, unique-enough id for a quest minted in the editor session. */
function mintQuestId(): string {
  return `quest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Build the objective from the draft (dispatch by kind; required clamped ≥1).
 *  travel/find are single-step; kill uses the draft count. */
const OBJECTIVE_BUILDERS: Record<ObjectiveKind, (draft: QuestDraft) => Objective> = {
  kill: (d) => {
    const target = d.target.trim() || 'enemy'
    return { kind: 'kill', target, required: Math.max(1, Math.floor(d.count)), current: 0, done: false, label: `Slay ${target}` }
  },
  travel: (d) => {
    const target = d.target.trim() || '0,0'
    return { kind: 'travel', target, required: 1, current: 0, done: false, label: `Travel to ${target}` }
  },
  find: (d) => {
    const target = d.target.trim()
    return { kind: 'find', target, required: 1, current: 0, done: false, label: `Find ${target}` }
  },
}

function objectiveFrom(draft: QuestDraft): Objective {
  return OBJECTIVE_BUILDERS[draft.objectiveKind](draft)
}

/** A short human description of the drafted objective for the quest text. */
function objectiveSummary(draft: QuestDraft): string {
  if (draft.objectiveKind === 'kill') return `Defeat ${draft.count} ${draft.target.trim() || 'enemy'}`
  if (draft.objectiveKind === 'travel') return `Travel to ${draft.target.trim() || 'the marked cell'}`
  return `Find ${draft.target.trim() || 'the person'}`
}

/** Build the reward from the draft (dispatch by kind, not a branch chain). */
const REWARD_BUILDERS: Record<SimpleRewardKind, (draft: QuestDraft) => Reward> = {
  xp: (draft) => ({ kind: 'xp', amount: Math.max(0, Math.floor(draft.rewardXp)) }),
  item: (draft) => ({ kind: 'item', amount: 1, itemId: draft.rewardItemId.trim() || 'reward-item' }),
}

/**
 * Mint an `available` Quest from a validated draft. Pure: the caller links the
 * giver's `questId` and stores the quest. Returns null if the draft is unusable
 * (no giver / blank title) so the caller can surface a toast instead of saving junk.
 */
function questFromDraft(draft: QuestDraft): Quest | null {
  if (!draft.giverId) return null
  const title = draft.title.trim()
  if (!title) return null
  return {
    id: mintQuestId(),
    giverId: draft.giverId,
    title,
    description: `${objectiveSummary(draft)} for ${title}.`,
    objectives: [objectiveFrom(draft)],
    rewards: [REWARD_BUILDERS[draft.rewardKind](draft)],
    state: 'available',
  }
}

/** The quest a giver NPC offers (matched by the NPC's linked questId), or null. */
function questForGiver(quests: readonly Quest[], giver: Entity): Quest | null {
  if (!giver.questId) return null
  return quests.find((q) => q.id === giver.questId) ?? null
}

/**
 * The quest-giver NPC the player can interact with from (pCol,pRow): an NPC with
 * a linked quest on or adjacent (incl. diagonally) to the player's cell. Returns
 * the closest match (the player's own cell first), or null when none is in reach.
 */
function reachableQuestGiver(entities: readonly Entity[], pCol: number, pRow: number): Entity | null {
  for (const [dCol, dRow] of QUEST_REACH_DELTAS) {
    const giver = questGiverAt(entities, pCol + dCol, pRow + dRow)
    if (giver) return giver
  }
  return null
}

/** Player's own cell first (talk while standing on it), then the 8 neighbours. */
const QUEST_REACH_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, 1], [-1, 1], [1, -1],
]

/** A quest-giving NPC (has a linked questId) occupying (col,row), or null. */
function questGiverAt(entities: readonly Entity[], col: number, row: number): Entity | null {
  const here = entityAt(entities, col, row)
  if (!here || here.kind !== 'npc' || !here.questId) return null
  return here
}

/** The single quest currently `active` (the editor tracks one at a time for the HUD). */
function activeQuest(quests: readonly Quest[]): Quest | null {
  return quests.find((q) => q.state === 'active') ?? null
}

/** Immutably replace a quest by id in the list (no-op append if it's new). */
function upsertQuest(quests: readonly Quest[], quest: Quest): Quest[] {
  const exists = quests.some((q) => q.id === quest.id)
  if (!exists) return [...quests, quest]
  return quests.map((q) => (q.id === quest.id ? quest : q))
}

/** Feed one world event (kill / travel / find) to every active quest. Returns the
 *  SAME reference when nothing advanced, so callers can skip a state update. */
function applyQuestEvent(quests: readonly Quest[], event: QuestEvent): Quest[] {
  let changed = false
  const next = quests.map((q) => {
    if (q.state !== 'active') return q
    const advanced = recordEvent(q, event)
    if (advanced !== q) changed = true
    return advanced
  })
  return changed ? next : (quests as Quest[])
}

/** Human label for a kill objective's progress, e.g. "goblin 3/5". */
function objectiveLabel(objective: Objective): string {
  return `${objective.target} ${objective.current}/${objective.required}`
}

/** One-line reward summary for toasts, e.g. "+50 xp" or "item: sword". */
function rewardSummary(reward: Reward): string {
  if (reward.kind === 'xp') return `+${reward.amount} xp`
  if (reward.kind === 'item') return `item: ${reward.itemId ?? 'reward'}`
  return `+${reward.amount} ${reward.stat ?? 'stat'}`
}

/** Camera snapshot the quest-offer modal needs to project a giver cell to screen px. */
export interface QuestAnchorCamera {
  view: 'isometric' | '2d' | 'top'
  cellSize: number
  isoScale: number
  player: { x: number; z: number }
  camOffset: { x: number; y: number }
  isoZoom: number
  topZoom: number
  w: number
  h: number
}

// Keep-out margins (px) for the anchored panel: enough side room and headroom above
// the giver for the modal, else we hand back null and the caller centers instead.
const QUEST_ANCHOR_SIDE = 40
const QUEST_ANCHOR_TOP = 160
const QUEST_ANCHOR_BOTTOM = 20

/**
 * Screen-space point (px) of a giver cell for the offer modal, mirroring each view's
 * own `toScreen` so the modal floats above the right entity. Returns null when the
 * point is off-screen or too close to an edge to fit the panel — the caller then
 * centers the modal. Pure: every input is passed in, nothing is read from the DOM.
 */
export function questAnchorScreenPos(cam: QuestAnchorCamera, col: number, row: number): { x: number; y: number } | null {
  const { x, y } = projectCell(cam, col, row)
  const onScreen =
    x >= QUEST_ANCHOR_SIDE && x <= cam.w - QUEST_ANCHOR_SIDE &&
    y >= QUEST_ANCHOR_TOP && y <= cam.h - QUEST_ANCHOR_BOTTOM
  return onScreen ? { x, y } : null
}

/** Per-view cell→screen projection matching the render loop's entity placement. */
function projectCell(cam: QuestAnchorCamera, col: number, row: number): { x: number; y: number } {
  if (cam.view === 'top') {
    const tileSize = 16 * cam.topZoom
    const offsetX = cam.w / 2 - (cam.player.x / cam.cellSize) * tileSize + cam.camOffset.x
    const offsetY = cam.h / 2 - (cam.player.z / cam.cellSize) * tileSize + cam.camOffset.y
    return { x: offsetX + (col + 0.5) * tileSize, y: offsetY + (row + 0.5) * tileSize }
  }
  if (cam.view === '2d') {
    const tile = 24 * cam.topZoom
    const camCol = cam.player.x / cam.cellSize - cam.camOffset.x / tile
    const camRow = cam.player.z / cam.cellSize - cam.camOffset.y / tile
    return { x: cam.w / 2 + (col + 0.5 - camCol) * tile, y: cam.h / 2 + (row + 0.5 - camRow) * tile }
  }
  // isometric — iso entities are drawn at toScreen(col,row) (integer cell)
  const isoScale = cam.isoScale * cam.isoZoom
  const wx = col * cam.cellSize - (cam.player.x - cam.camOffset.x)
  const wz = row * cam.cellSize - (cam.player.z - cam.camOffset.y)
  return { x: cam.w / 2 + (wx - wz) * isoScale * 0.71, y: cam.h / 2 + (wx + wz) * isoScale * 0.36 }
}

// ═══════════════════════════════════════════════════════════════════
// TEMPLATE PRESET SYSTEM
// Categorized by: Size (S/M/L) × Theme × Type (exterior/interior)
// ═══════════════════════════════════════════════════════════════════

type TemplateSize = 'small' | 'medium' | 'large'
type TemplateTheme =
  | 'village' | 'forest' | 'castle' | 'ice' | 'desert' | 'dungeon'
  | 'volcanic' | 'cave' | 'crypt' | 'underwater' | 'temple'
  | 'italian' | 'chinese' | 'spanish' | 'russian' | 'japanese'
  | 'egyptian' | 'african' | 'venezuelan' | 'peruvian' | 'argentinian'
  | 'american' | 'mexican' | 'australian'
type TemplateType = 'exterior' | 'interior'

interface TemplatePreset {
  id: string
  name: string
  description: string
  size: TemplateSize
  theme: TemplateTheme
  type: TemplateType
  // Grid dimensions
  cols: { min: number; max: number }
  rows: { min: number; max: number }
  // Road system
  roads: {
    enabled: boolean
    pattern: 'grid' | 'cross' | 'winding' | 'single' | 'none'
    width: number // 1-3
  }
  // Water features
  water: {
    type: 'river' | 'lake' | 'ocean' | 'moat' | 'none'
    coverage: number // 0-1
  }
  // Buildings
  buildings: {
    count: { min: number; max: number }
    types: ('house' | 'shop' | 'tower' | 'castle' | 'hut')[]
    hasPlaza: boolean
  }
  // Nature
  nature: {
    treeDensity: number // 0-1
    bushDensity: number // 0-1
    flowerDensity: number // 0-1
    rockDensity: number // 0-1
  }
  // NPCs
  npcs: {
    enabled: boolean
    count: { min: number; max: number }
  }
  // Ground colors
  groundType: 'grass' | 'stone' | 'sand' | 'snow' | 'wood'
  // Walls (for interiors)
  walls?: {
    enabled: boolean
    thickness: number
  }
}

const TEMPLATE_PRESETS: Record<string, TemplatePreset> = {
  // ─── VILLAGES ─────────────────────────────────────────────────────
  'village-small': {
    id: 'village-small',
    name: 'Small Town',
    description: 'Cozy small town with a few houses',
    size: 'small',
    theme: 'village',
    type: 'exterior',
    cols: { min: 30, max: 40 },
    rows: { min: 30, max: 40 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 3, max: 5 }, types: ['house', 'shop'], hasPlaza: true },
    nature: { treeDensity: 0.25, bushDensity: 0.1, flowerDensity: 0.05, rockDensity: 0.02 },
    npcs: { enabled: true, count: { min: 2, max: 4 } },
    groundType: 'grass',
  },
  'village-medium': {
    id: 'village-medium',
    name: 'Town',
    description: 'Bustling town with markets and homes',
    size: 'medium',
    theme: 'village',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'river', coverage: 0.08 },
    buildings: { count: { min: 6, max: 10 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.2, bushDensity: 0.08, flowerDensity: 0.04, rockDensity: 0.02 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'village-large': {
    id: 'village-large',
    name: 'City',
    description: 'Large city with districts',
    size: 'large',
    theme: 'village',
    type: 'exterior',
    cols: { min: 80, max: 100 },
    rows: { min: 80, max: 100 },
    roads: { enabled: true, pattern: 'grid', width: 3 },
    water: { type: 'river', coverage: 0.1 },
    buildings: { count: { min: 12, max: 20 }, types: ['house', 'shop', 'tower', 'castle'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.05, flowerDensity: 0.03, rockDensity: 0.01 },
    npcs: { enabled: true, count: { min: 8, max: 15 } },
    groundType: 'grass',
  },

  // ─── FORESTS ──────────────────────────────────────────────────────
  'forest-small': {
    id: 'forest-small',
    name: 'Forest Clearing',
    description: 'Small woodland area',
    size: 'small',
    theme: 'forest',
    type: 'exterior',
    cols: { min: 30, max: 40 },
    rows: { min: 30, max: 40 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'lake', coverage: 0.08 },
    buildings: { count: { min: 0, max: 1 }, types: ['hut'], hasPlaza: false },
    nature: { treeDensity: 0.5, bushDensity: 0.2, flowerDensity: 0.08, rockDensity: 0.05 },
    npcs: { enabled: false, count: { min: 0, max: 1 } },
    groundType: 'grass',
  },
  'forest-large': {
    id: 'forest-large',
    name: 'Deep Woods',
    description: 'Dense forest with hidden paths',
    size: 'large',
    theme: 'forest',
    type: 'exterior',
    cols: { min: 70, max: 90 },
    rows: { min: 70, max: 90 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'river', coverage: 0.1 },
    buildings: { count: { min: 1, max: 3 }, types: ['hut', 'tower'], hasPlaza: false },
    nature: { treeDensity: 0.6, bushDensity: 0.25, flowerDensity: 0.1, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'grass',
  },

  // ─── CASTLES ──────────────────────────────────────────────────────
  'castle-exterior': {
    id: 'castle-exterior',
    name: 'Castle Grounds',
    description: 'Fortified castle with courtyard',
    size: 'large',
    theme: 'castle',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'cross', width: 3 },
    water: { type: 'moat', coverage: 0.15 },
    buildings: { count: { min: 4, max: 8 }, types: ['castle', 'tower', 'house'], hasPlaza: true },
    nature: { treeDensity: 0.1, bushDensity: 0.05, flowerDensity: 0.02, rockDensity: 0.03 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'castle-interior': {
    id: 'castle-interior',
    name: 'Castle Hall',
    description: 'Grand interior hall',
    size: 'medium',
    theme: 'castle',
    type: 'interior',
    cols: { min: 25, max: 35 },
    rows: { min: 20, max: 30 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0.02, rockDensity: 0 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },

  // ─── ICE THEME ────────────────────────────────────────────────────
  'ice-village': {
    id: 'ice-village',
    name: 'Frozen Village',
    description: 'Snow-covered settlement',
    size: 'medium',
    theme: 'ice',
    type: 'exterior',
    cols: { min: 45, max: 60 },
    rows: { min: 45, max: 60 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.1 }, // Frozen lake
    buildings: { count: { min: 4, max: 7 }, types: ['house', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.05, flowerDensity: 0, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'snow',
  },
  'ice-castle-interior': {
    id: 'ice-castle-interior',
    name: 'Ice Castle Interior',
    description: 'Frozen throne room',
    size: 'large',
    theme: 'ice',
    type: 'interior',
    cols: { min: 35, max: 50 },
    rows: { min: 30, max: 45 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 1, max: 4 } },
    groundType: 'snow',
    walls: { enabled: true, thickness: 3 },
  },

  // ─── DESERT ───────────────────────────────────────────────────────
  'desert-oasis': {
    id: 'desert-oasis',
    name: 'Desert Oasis',
    description: 'Sandy area with water source',
    size: 'medium',
    theme: 'desert',
    type: 'exterior',
    cols: { min: 45, max: 60 },
    rows: { min: 45, max: 60 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'lake', coverage: 0.12 },
    buildings: { count: { min: 2, max: 5 }, types: ['house', 'shop'], hasPlaza: true },
    nature: { treeDensity: 0.08, bushDensity: 0.1, flowerDensity: 0.02, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 2, max: 4 } },
    groundType: 'sand',
  },

  // ─── DUNGEONS ─────────────────────────────────────────────────────
  'dungeon-small': {
    id: 'dungeon-small',
    name: 'Dungeon Room',
    description: 'Single dungeon chamber',
    size: 'small',
    theme: 'dungeon',
    type: 'interior',
    cols: { min: 20, max: 25 },
    rows: { min: 20, max: 25 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.1 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'dungeon-large': {
    id: 'dungeon-large',
    name: 'Dungeon Complex',
    description: 'Multi-room dungeon',
    size: 'large',
    theme: 'dungeon',
    type: 'interior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'grid', width: 2 }, // Corridors
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 3, max: 8 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 1 },
  },

  // ─── FROZEN ENVIRONMENTS ──────────────────────────────────────────
  'frozen-forest': {
    id: 'frozen-forest',
    name: 'Frozen Forest',
    description: 'Snow-covered woods with frosted trees and ice patches',
    size: 'medium',
    theme: 'ice',
    type: 'exterior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'winding', width: 1 },
    water: { type: 'lake', coverage: 0.08 },
    buildings: { count: { min: 0, max: 2 }, types: ['hut'], hasPlaza: false },
    nature: { treeDensity: 0.4, bushDensity: 0.1, flowerDensity: 0, rockDensity: 0.1 },
    npcs: { enabled: false, count: { min: 0, max: 1 } },
    groundType: 'snow',
  },
  'frozen-cave': {
    id: 'frozen-cave',
    name: 'Frozen Cave',
    description: 'Ice walls with frozen stalactites',
    size: 'medium',
    theme: 'cave',
    type: 'interior',
    cols: { min: 35, max: 50 },
    rows: { min: 35, max: 50 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'snow',
    walls: { enabled: true, thickness: 2 },
  },

  // ─── VOLCANIC ENVIRONMENTS ────────────────────────────────────────
  'volcanic-cave': {
    id: 'volcanic-cave',
    name: 'Volcanic Cave',
    description: 'Lava flows through obsidian chambers',
    size: 'medium',
    theme: 'volcanic',
    type: 'interior',
    cols: { min: 40, max: 55 },
    rows: { min: 40, max: 55 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'river', coverage: 0.12 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.2 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'volcanic-zone': {
    id: 'volcanic-zone',
    name: 'Volcanic Zone',
    description: 'Ash-covered ground with lava rivers',
    size: 'large',
    theme: 'volcanic',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'winding', width: 2 },
    water: { type: 'river', coverage: 0.15 },
    buildings: { count: { min: 1, max: 3 }, types: ['tower'], hasPlaza: false },
    nature: { treeDensity: 0.05, bushDensity: 0.02, flowerDensity: 0, rockDensity: 0.25 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
  },
  'volcano-interior': {
    id: 'volcano-interior',
    name: 'Volcano Interior',
    description: 'Molten rock and fire-lit obsidian halls',
    size: 'large',
    theme: 'volcanic',
    type: 'interior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'cross', width: 3 },
    water: { type: 'river', coverage: 0.2 },
    buildings: { count: { min: 0, max: 1 }, types: ['tower'], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 3 },
  },

  // ─── CAVE ENVIRONMENTS ────────────────────────────────────────────
  'ancient-cave': {
    id: 'ancient-cave',
    name: 'Ancient Cave',
    description: 'Moss-covered stone with glowing runes',
    size: 'medium',
    theme: 'cave',
    type: 'interior',
    cols: { min: 40, max: 55 },
    rows: { min: 40, max: 55 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0.05, flowerDensity: 0.02, rockDensity: 0.12 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'forest-cave': {
    id: 'forest-cave',
    name: 'Forest Cave',
    description: 'Tree roots and mushrooms in earthen tunnels',
    size: 'small',
    theme: 'cave',
    type: 'interior',
    cols: { min: 25, max: 35 },
    rows: { min: 25, max: 35 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0.1, bushDensity: 0.15, flowerDensity: 0.1, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 0, max: 2 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'underground-cave': {
    id: 'underground-cave',
    name: 'Underground Cave',
    description: 'Deep caverns with crystals and rock formations',
    size: 'large',
    theme: 'cave',
    type: 'interior',
    cols: { min: 55, max: 75 },
    rows: { min: 55, max: 75 },
    roads: { enabled: true, pattern: 'winding', width: 2 },
    water: { type: 'river', coverage: 0.08 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0.02, flowerDensity: 0.05, rockDensity: 0.2 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },

  // ─── CRYPT & CEMETERY ─────────────────────────────────────────────
  'crypt': {
    id: 'crypt',
    name: 'Crypt',
    description: 'Stone floors with coffins and flickering candles',
    size: 'small',
    theme: 'crypt',
    type: 'interior',
    cols: { min: 20, max: 30 },
    rows: { min: 20, max: 30 },
    roads: { enabled: false, pattern: 'none', width: 0 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 0, max: 0 }, types: [], hasPlaza: false },
    nature: { treeDensity: 0, bushDensity: 0, flowerDensity: 0, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 1, max: 3 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'cemetery': {
    id: 'cemetery',
    name: 'Cemetery',
    description: 'Graves, dead grass, and iron fences',
    size: 'medium',
    theme: 'crypt',
    type: 'exterior',
    cols: { min: 40, max: 55 },
    rows: { min: 40, max: 55 },
    roads: { enabled: true, pattern: 'grid', width: 1 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 1, max: 3 }, types: ['hut', 'tower'], hasPlaza: false },
    nature: { treeDensity: 0.15, bushDensity: 0.05, flowerDensity: 0.02, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 1, max: 4 } },
    groundType: 'grass',
  },

  // ─── UNDERWATER & TEMPLE ──────────────────────────────────────────
  'underwater-temple': {
    id: 'underwater-temple',
    name: 'Underwater Temple',
    description: 'Coral, seaweed, and ancient submerged ruins',
    size: 'large',
    theme: 'underwater',
    type: 'interior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'none', coverage: 0 },
    buildings: { count: { min: 2, max: 5 }, types: ['tower', 'castle'], hasPlaza: true },
    nature: { treeDensity: 0.1, bushDensity: 0.2, flowerDensity: 0.15, rockDensity: 0.1 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'stone',
    walls: { enabled: true, thickness: 2 },
  },
  'forest-temple': {
    id: 'forest-temple',
    name: 'Forest Temple',
    description: 'Overgrown stone ruins with vines and moss',
    size: 'medium',
    theme: 'temple',
    type: 'exterior',
    cols: { min: 45, max: 60 },
    rows: { min: 45, max: 60 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 3, max: 6 }, types: ['tower', 'castle'], hasPlaza: true },
    nature: { treeDensity: 0.35, bushDensity: 0.2, flowerDensity: 0.1, rockDensity: 0.1 },
    npcs: { enabled: true, count: { min: 1, max: 4 } },
    groundType: 'grass',
  },

  // ─── EGYPTIAN THEME ───────────────────────────────────────────────
  'egyptian-desert': {
    id: 'egyptian-desert',
    name: 'Egyptian Desert',
    description: 'Sand dunes with pyramids and sphinx decorations',
    size: 'large',
    theme: 'egyptian',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'river', coverage: 0.08 },
    buildings: { count: { min: 4, max: 8 }, types: ['tower', 'castle'], hasPlaza: true },
    nature: { treeDensity: 0.05, bushDensity: 0.03, flowerDensity: 0.01, rockDensity: 0.12 },
    npcs: { enabled: true, count: { min: 3, max: 7 } },
    groundType: 'sand',
  },

  // ─── CULTURAL THEMES ──────────────────────────────────────────────
  'italian-village': {
    id: 'italian-village',
    name: 'Italian Village',
    description: 'Terracotta, olive trees, and Roman columns',
    size: 'medium',
    theme: 'italian',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'lake', coverage: 0.05 },
    buildings: { count: { min: 5, max: 10 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.2, bushDensity: 0.08, flowerDensity: 0.06, rockDensity: 0.03 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'chinese-village': {
    id: 'chinese-village',
    name: 'Chinese Village',
    description: 'Red and gold pagodas with lanterns',
    size: 'medium',
    theme: 'chinese',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'lake', coverage: 0.08 },
    buildings: { count: { min: 5, max: 10 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.2, bushDensity: 0.1, flowerDensity: 0.08, rockDensity: 0.04 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'spanish-village': {
    id: 'spanish-village',
    name: 'Spanish Village',
    description: 'White walls, orange roofs, and courtyards',
    size: 'medium',
    theme: 'spanish',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'lake', coverage: 0.04 },
    buildings: { count: { min: 6, max: 12 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.1, flowerDensity: 0.08, rockDensity: 0.02 },
    npcs: { enabled: true, count: { min: 5, max: 10 } },
    groundType: 'grass',
  },
  'russian-village': {
    id: 'russian-village',
    name: 'Russian Village',
    description: 'Onion domes, snow, and birch trees',
    size: 'medium',
    theme: 'russian',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.06 },
    buildings: { count: { min: 5, max: 9 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.25, bushDensity: 0.05, flowerDensity: 0.02, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 3, max: 7 } },
    groundType: 'snow',
  },
  'japanese-village': {
    id: 'japanese-village',
    name: 'Japanese Village',
    description: 'Cherry blossoms, torii gates, and bamboo',
    size: 'medium',
    theme: 'japanese',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'lake', coverage: 0.1 },
    buildings: { count: { min: 5, max: 10 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.25, bushDensity: 0.1, flowerDensity: 0.15, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'african-village': {
    id: 'african-village',
    name: 'African Village',
    description: 'Savanna grass, acacia trees, and mud huts',
    size: 'medium',
    theme: 'african',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'winding', width: 2 },
    water: { type: 'lake', coverage: 0.06 },
    buildings: { count: { min: 4, max: 8 }, types: ['hut', 'house'], hasPlaza: true },
    nature: { treeDensity: 0.15, bushDensity: 0.12, flowerDensity: 0.04, rockDensity: 0.08 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'sand',
  },
  'venezuelan-village': {
    id: 'venezuelan-village',
    name: 'Venezuelan Village',
    description: 'Tropical paradise with colorful houses and palms',
    size: 'medium',
    theme: 'venezuelan',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'river', coverage: 0.08 },
    buildings: { count: { min: 5, max: 10 }, types: ['house', 'shop'], hasPlaza: true },
    nature: { treeDensity: 0.3, bushDensity: 0.15, flowerDensity: 0.12, rockDensity: 0.03 },
    npcs: { enabled: true, count: { min: 5, max: 10 } },
    groundType: 'grass',
  },
  'peruvian-village': {
    id: 'peruvian-village',
    name: 'Peruvian Village',
    description: 'Mountain village with llamas and ancient stones',
    size: 'medium',
    theme: 'peruvian',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'winding', width: 2 },
    water: { type: 'river', coverage: 0.05 },
    buildings: { count: { min: 4, max: 8 }, types: ['hut', 'house', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.1, bushDensity: 0.1, flowerDensity: 0.05, rockDensity: 0.2 },
    npcs: { enabled: true, count: { min: 3, max: 7 } },
    groundType: 'grass',
  },
  'argentinian-village': {
    id: 'argentinian-village',
    name: 'Argentinian Estancia',
    description: 'Pampas grass and ranch buildings',
    size: 'large',
    theme: 'argentinian',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'cross', width: 2 },
    water: { type: 'lake', coverage: 0.04 },
    buildings: { count: { min: 4, max: 8 }, types: ['house', 'hut'], hasPlaza: false },
    nature: { treeDensity: 0.12, bushDensity: 0.08, flowerDensity: 0.05, rockDensity: 0.03 },
    npcs: { enabled: true, count: { min: 3, max: 6 } },
    groundType: 'grass',
  },
  'american-frontier': {
    id: 'american-frontier',
    name: 'American Frontier',
    description: 'Wooden frontier town on the prairies',
    size: 'medium',
    theme: 'american',
    type: 'exterior',
    cols: { min: 50, max: 70 },
    rows: { min: 50, max: 70 },
    roads: { enabled: true, pattern: 'single', width: 3 },
    water: { type: 'river', coverage: 0.05 },
    buildings: { count: { min: 6, max: 12 }, types: ['house', 'shop', 'tower'], hasPlaza: false },
    nature: { treeDensity: 0.08, bushDensity: 0.1, flowerDensity: 0.04, rockDensity: 0.05 },
    npcs: { enabled: true, count: { min: 4, max: 8 } },
    groundType: 'grass',
  },
  'mexican-village': {
    id: 'mexican-village',
    name: 'Mexican Village',
    description: 'Adobe buildings, cacti, and vibrant colors',
    size: 'medium',
    theme: 'mexican',
    type: 'exterior',
    cols: { min: 50, max: 65 },
    rows: { min: 50, max: 65 },
    roads: { enabled: true, pattern: 'grid', width: 2 },
    water: { type: 'lake', coverage: 0.03 },
    buildings: { count: { min: 6, max: 12 }, types: ['house', 'shop', 'tower'], hasPlaza: true },
    nature: { treeDensity: 0.08, bushDensity: 0.15, flowerDensity: 0.08, rockDensity: 0.1 },
    npcs: { enabled: true, count: { min: 5, max: 10 } },
    groundType: 'sand',
  },
  'australian-outback': {
    id: 'australian-outback',
    name: 'Australian Outback',
    description: 'Red earth, eucalyptus, and desert terrain',
    size: 'large',
    theme: 'australian',
    type: 'exterior',
    cols: { min: 60, max: 80 },
    rows: { min: 60, max: 80 },
    roads: { enabled: true, pattern: 'winding', width: 2 },
    water: { type: 'lake', coverage: 0.03 },
    buildings: { count: { min: 3, max: 6 }, types: ['hut', 'house'], hasPlaza: false },
    nature: { treeDensity: 0.12, bushDensity: 0.15, flowerDensity: 0.02, rockDensity: 0.15 },
    npcs: { enabled: true, count: { min: 2, max: 5 } },
    groundType: 'sand',
  },
}

// Group presets by theme for UI
const PRESET_CATEGORIES: Record<string, { label: string; color: string }> = {
  // Environment themes
  village: { label: 'Village/Town', color: 'bg-green-700' },
  forest: { label: 'Forest', color: 'bg-emerald-800' },
  castle: { label: 'Castle', color: 'bg-purple-700' },
  ice: { label: 'Ice/Snow', color: 'bg-cyan-700' },
  desert: { label: 'Desert', color: 'bg-amber-700' },
  dungeon: { label: 'Dungeon', color: 'bg-gray-700' },
  volcanic: { label: 'Volcanic', color: 'bg-red-800' },
  cave: { label: 'Cave', color: 'bg-stone-700' },
  crypt: { label: 'Crypt/Cemetery', color: 'bg-zinc-800' },
  underwater: { label: 'Underwater', color: 'bg-blue-800' },
  temple: { label: 'Temple', color: 'bg-teal-800' },
  // Cultural themes
  egyptian: { label: 'Egyptian', color: 'bg-yellow-700' },
  italian: { label: 'Italian', color: 'bg-orange-700' },
  chinese: { label: 'Chinese', color: 'bg-red-700' },
  spanish: { label: 'Spanish', color: 'bg-orange-600' },
  russian: { label: 'Russian', color: 'bg-red-900' },
  japanese: { label: 'Japanese', color: 'bg-pink-700' },
  african: { label: 'African', color: 'bg-amber-800' },
  venezuelan: { label: 'Venezuelan', color: 'bg-lime-700' },
  peruvian: { label: 'Peruvian', color: 'bg-stone-600' },
  argentinian: { label: 'Argentinian', color: 'bg-sky-700' },
  american: { label: 'American', color: 'bg-blue-700' },
  mexican: { label: 'Mexican', color: 'bg-rose-700' },
  australian: { label: 'Australian', color: 'bg-orange-800' },
}

// Tile swatch component for palette
function TileSwatch({
  char,
  name,
  bg,
  fg,
  onClick,
  selected,
  zoom = 1.0
}: {
  char: string
  name: string
  bg: string
  fg: string
  onClick?: () => void
  selected?: boolean
  zoom?: number
}) {
  const baseSize = 56
  const size = baseSize * zoom
  const fontSize = 20 * zoom
  const labelSize = 9 * zoom

  return (
    <button
      onClick={onClick}
      className={`rounded flex flex-col items-center justify-center transition-all flex-shrink-0 ${
        selected ? 'ring-2 ring-yellow-400' : 'hover:ring-2 hover:ring-yellow-400/50'
      }`}
      style={{
        backgroundColor: bg,
        width: size,
        height: size,
        minWidth: size,
      }}
      title={name}
    >
      <span style={{ color: fg, fontSize }} className="font-bold leading-none">{char}</span>
      <span style={{ fontSize: labelSize }} className="text-gray-300 leading-none mt-1">{name}</span>
    </button>
  )
}

/**
 * Editor sidebar card — a labelled, accent-bordered panel grouping one tool.
 * Pure presentational wrapper so every panel in the two sidebars looks the same
 * and stays readable for non-devs. Accent maps to a Tailwind border/title colour.
 */
type CardAccent = 'yellow' | 'purple' | 'orange' | 'blue' | 'cyan'

const CARD_TITLE_COLOR: Record<CardAccent, string> = {
  yellow: 'text-yellow-400',
  purple: 'text-purple-400',
  orange: 'text-orange-400',
  blue: 'text-blue-400',
  cyan: 'text-cyan-400',
}

function Card({
  title,
  accent = 'yellow',
  action,
  children,
  defaultOpen = true,
}: {
  title: string
  accent?: CardAccent
  action?: React.ReactNode
  children: React.ReactNode
  /** start collapsed by passing false — collapsible to cut sidebar scrolling. */
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg shadow-black/40">
      <header className={`flex items-center justify-between gap-2 ${open ? 'mb-3' : ''}`}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`flex flex-1 items-center gap-1.5 text-left text-sm font-bold uppercase tracking-wide ${CARD_TITLE_COLOR[accent]}`}
        >
          <span aria-hidden className="text-[10px]">{open ? '▾' : '▸'}</span>
          <h3>{title}</h3>
        </button>
        {action}
      </header>
      {open && children}
    </section>
  )
}

/** A single view-mode button in the Views card. */
function ViewButton({
  label,
  active,
  activeClass,
  onClick,
}: {
  label: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

/** A collapsible labelled group of palette swatches inside the Assets card.
 *  Each section is its own dropdown — collapsed by default so the Assets card
 *  stays expanded but isn't a wall of swatches. */
function PaletteGroup({
  label,
  color,
  children,
  defaultOpen = false,
}: {
  label: string
  color: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={`mb-1 flex w-full items-center gap-1 text-xs font-bold ${color} hover:opacity-80`}
      >
        <span className="inline-block w-3 text-[10px] text-gray-400" aria-hidden>{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && <div className="flex flex-wrap gap-1">{children}</div>}
    </div>
  )
}

/** A tool toggle in the Entities card (Player / Enemy / NPC / Erase). */
function EntityToolButton({
  label,
  glyph,
  active,
  activeClass,
  onClick,
}: {
  label: string
  glyph: string
  active: boolean
  activeClass: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-center gap-0.5 rounded px-2 py-1.5 text-xs font-bold transition-colors ${
        active ? activeClass : 'bg-gray-700 hover:bg-gray-600'
      }`}
    >
      <span className="text-base leading-none" aria-hidden>{glyph}</span>
      <span>{label}</span>
    </button>
  )
}

type PlaceTileInfo = { char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string }

/** Swatch for a single-tile asset, resolving its glyph/colours from the tileset by key. */
function AssetTileSwatch({
  tileKey,
  selectedTile,
  onPlace,
}: {
  tileKey: string
  selectedTile: PlaceTileInfo | null
  onPlace: (info: PlaceTileInfo) => void
}) {
  const tile = TILES[tileKey]
  if (!tile) return null
  return (
    <TileSwatch
      char={tile.char}
      name={tile.name ?? tileKey}
      bg={tile.bg}
      fg={tile.fg}
      onClick={() => onPlace({ char: tile.char, type: 'asset', tileKey })}
      selected={selectedTile?.type === 'asset' && selectedTile?.tileKey === tileKey}
    />
  )
}

// ── Asset palette data (drives the Assets card) ──────────────────────
// Module-level so the palette isn't re-allocated on every render and the JSX
// stays a flat map instead of dozens of near-identical hand-written swatches.
type GroundSwatch = { char: string; name: string; bg: string; fg: string; groundType: string }

const GROUND_SWATCHES: readonly GroundSwatch[] = [
  { char: '.', name: 'Grass', bg: '#1a5522', fg: '#33aa33', groundType: 'grass' },
  { char: '~', name: 'Water', bg: '#1155aa', fg: '#55bbff', groundType: 'water' },
  { char: '=', name: 'Road', bg: '#7a6644', fg: '#ccbb88', groundType: 'road' },
  { char: '#', name: 'Plaza', bg: '#aa9966', fg: '#eeddbb', groundType: 'plaza' },
  { char: '|', name: 'Bridge', bg: '#664422', fg: '#bb8844', groundType: 'bridge' },
]

const NATURE_TILE_KEYS: readonly string[] = [
  'trunk', 'trunk_thick', 'foliage', 'foliage_light', 'foliage_dark', 'stump',
]
const BUILDING_TILE_KEYS: readonly string[] = [
  'wall', 'wall_stone', 'window', 'door', 'roof_flat', 'roof_peak', 'column', 'floor', 'cannon',
]
const DECORATION_TILE_KEYS: readonly string[] = [
  'lamp', 'crate', 'barrel', 'flower', 'rock', 'fence_h', 'sign', 'npc',
]

type CompositeSwatch = { key: string; icon: string; name: string; bg: string; fg: string }
const COMPOSITE_SWATCHES: readonly CompositeSwatch[] = [
  { key: 'tree_small', icon: '@', name: 'Tree S', bg: 'bg-green-900', fg: 'text-green-400' },
  { key: 'tree_medium', icon: '@', name: 'Tree M', bg: 'bg-green-900', fg: 'text-green-500' },
  { key: 'tree_large', icon: '@', name: 'Tree L', bg: 'bg-green-900', fg: 'text-green-600' },
  { key: 'bush', icon: '*', name: 'Bush', bg: 'bg-green-900', fg: 'text-green-300' },
  { key: 'house_small', icon: '⌂', name: 'House', bg: 'bg-orange-900', fg: 'text-orange-400' },
  { key: 'tower', icon: '▓', name: 'Tower', bg: 'bg-gray-800', fg: 'text-gray-400' },
  { key: 'lamppost', icon: '!', name: 'Lamp', bg: 'bg-yellow-900', fg: 'text-yellow-400' },
  { key: 'well', icon: '◯', name: 'Well', bg: 'bg-blue-900', fg: 'text-blue-400' },
]

// Stage generator menu (zone × variant)
// Forest-only engine: 5 seasons, beach + lava removed.
const STAGE_ZONES = ['spring', 'summer', 'autumn', 'winter', 'desert'] as const
// Active-zone button tint (seasonal accent).
const SEASON_BTN: Record<(typeof STAGE_ZONES)[number], string> = {
  spring: 'bg-pink-600 ring-1 ring-pink-300',
  summer: 'bg-green-700 ring-1 ring-green-300',
  autumn: 'bg-orange-700 ring-1 ring-orange-300',
  winter: 'bg-sky-700 ring-1 ring-sky-300',
  desert: 'bg-yellow-700 ring-1 ring-yellow-300',
}
const STAGE_VARIANTS = ['forest', 'town', 'city'] as const // forest + seasonal settlements (town, then a ~4× city)

// Player state
interface PlayerState {
  x: number
  z: number
  facing: 'up' | 'down' | 'left' | 'right'
  moving: boolean
  frame: number
  /** visual hop height (px) while mid-jump; 0 on the ground. */
  jumpHeight?: number
  /** held-weapon glyph drawn beside the figure (from the equipped loadout); '' = unarmed. */
  weaponGlyph?: string
  shieldGlyph?: string
  /** wearing any armor → the figure is tinted to show the upgrade. */
  armored?: boolean
}

// Jump = clear up to this many blocked cells in the facing direction (settings later).
const JUMP_CLEAR = 1

/** Cell delta for a facing, matching how movement reads facing per view. */
function facingDelta(facing: PlayerState['facing'], use2D: boolean): [number, number] {
  if (use2D) {
    if (facing === 'up') return [0, -1]
    if (facing === 'down') return [0, 1]
    if (facing === 'left') return [-1, 0]
    return [1, 0] // right
  }
  if (facing === 'up') return [-1, -1]
  if (facing === 'down') return [1, 1]
  if (facing === 'left') return [-1, 1]
  return [1, -1] // right (isometric diagonals)
}

/** The direction currently held on WASD/arrows, or null if none. Lets a standing
 *  jump commit to the way you're pressing (facing itself is only updated while
 *  walking, which a jump skips). View-agnostic — facingDelta handles iso vs 2D. */
function facingFromKeys(keys: Record<string, boolean>): PlayerState['facing'] | null {
  if (keys['ArrowUp'] || keys['w']) return 'up'
  if (keys['ArrowDown'] || keys['s']) return 'down'
  if (keys['ArrowLeft'] || keys['a']) return 'left'
  if (keys['ArrowRight'] || keys['d']) return 'right'
  return null
}

/** A jump in flight: the loop interpolates the player from→to over JUMP_MS with a
 *  parabolic visual hop, so they travel ACROSS the intervening cell(s) and arc up,
 *  rather than teleporting. */
interface JumpState {
  active: boolean
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  start: number
}
const JUMP_MS = 380 // arc duration
const JUMP_PEAK_PX = 26 // visual hop height at mid-arc

/** Begin a jump. A MOVING jump (a direction is held) arcs (JUMP_CLEAR + 1) cells ahead IF the
 *  landing is walkable + in bounds, clearing whatever sits between (you're airborne). A STANDING
 *  jump (`forward === false`) hops straight UP on the same cell — no forward step. The loop
 *  animates the arc. No-op if already mid-jump. */
function beginJump(player: PlayerState, grid: IsometricGrid, use2D: boolean, jump: JumpState, now: number, forward: boolean): void {
  if (jump.active) return
  const [dCol, dRow] = facingDelta(player.facing, use2D)
  const dist = forward ? JUMP_CLEAR + 1 : 0 // standing jump = straight up, same cell
  const cs = grid.cellSize
  const col = Math.floor(player.x / cs) + dCol * dist
  const row = Math.floor(player.z / cs) + dRow * dist
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return
  if (grid.isBlocked(col, row)) return
  jump.active = true
  jump.fromX = player.x
  jump.fromZ = player.z
  jump.toX = col * cs + cs / 2
  jump.toZ = row * cs + cs / 2
  jump.start = now
}

// ── Combat HUD (DOM overlay; the canvas can't easily do crisp text bars) ──

/** Clamp a value/cap pair to a 0–100 percentage string for a CSS width var. */
function barPercent(value: number, cap: number): string {
  if (cap <= 0) return '0%'
  const pct = Math.max(0, Math.min(100, (value / cap) * 100))
  return `${pct}%`
}

interface CombatBarProps {
  label: string
  value: number
  cap: number
  /** Tailwind bg utility for the fill (kept out of the data shape). */
  fillClass: string
}

/** One labelled resource bar. The only dynamic value is the fill width, which
 *  rides a CSS custom property (`--fill`) — not a literal style magic number. */
function CombatBar({ label, value, cap, fillClass }: CombatBarProps) {
  const fillVar = { '--fill': barPercent(value, cap) } as React.CSSProperties
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-gray-300">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-black/70 ring-1 ring-white/10">
        <div className={`h-full w-[var(--fill)] ${fillClass} transition-[width] duration-150`} style={fillVar} />
      </div>
      <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-gray-300">
        {Math.round(value)}/{Math.round(cap)}
      </span>
    </div>
  )
}

/** Bottom-left player vitals overlay: HP, rage, mana. Reads the mirrored HUD state. */
function CombatHud({ hud }: { hud: PlayerHud }) {
  return (
    <div
      className="fixed bottom-4 left-4 z-20 w-64 rounded-md bg-black/80 p-3 font-mono text-white shadow-lg ring-1 ring-white/10"
      role="status"
      aria-label="Player vitals"
    >
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-amber-300">Vitals</div>
      <div className="flex flex-col gap-1.5">
        <CombatBar label="HP" value={hud.hp} cap={hud.maxHp} fillClass="bg-emerald-500" />
        <CombatBar label="Rage" value={hud.rage} cap={hud.rageCap} fillClass="bg-rose-500" />
        <CombatBar label="Mana" value={hud.mana} cap={hud.manaCap} fillClass="bg-sky-500" />
      </div>
      <div className="mt-2 text-[10px] text-gray-400">F attack · G special</div>
    </div>
  )
}

/**
 * Top-center active-quest tracker: title, kill progress, and a "ready to turn in"
 * cue when complete. Reads the active quest from React state (the loop mirrors
 * quests into state). Returns null when no quest is active, so it never shows
 * empty chrome.
 */
/** Objective checklist (✓/•) shared by the quest HUD, the offer modal and the quest log. */
function QuestObjectives({ quest }: { quest: Quest }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {quest.objectives.map((objective) => (
        <li key={`${objective.kind}:${objective.target}`} className="flex items-center gap-2 text-[11px]">
          <span aria-hidden className={objective.done ? 'text-emerald-400' : 'text-gray-500'}>
            {objective.done ? '✓' : '•'}
          </span>
          <span className={objective.done ? 'text-emerald-300 line-through' : 'text-gray-200'}>
            {objectiveLabel(objective)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function QuestHud({ quest }: { quest: Quest | null }) {
  if (!quest) return null
  const { completed, total } = progress(quest)
  const done = isComplete(quest)
  return (
    <div
      className="fixed left-1/2 top-20 z-20 w-72 -translate-x-1/2 rounded-md bg-black/80 p-3 font-mono text-white shadow-lg ring-1 ring-amber-400/30"
      role="status"
      aria-label="Active quest"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-amber-300">{quest.title}</span>
        <span className="ml-2 shrink-0 text-[10px] tabular-nums text-gray-400">{completed}/{total}</span>
      </div>
      <QuestObjectives quest={quest} />
      {done && (
        <div className="mt-2 rounded bg-amber-500/20 px-2 py-1 text-center text-[10px] font-bold text-amber-200">
          Return to the giver (E) to turn in
        </div>
      )}
    </div>
  )
}

// ── Quest authoring card (editor sidebar) ────────────────────────────

/** Tailwind colour for each quest state badge in the authored-quest list. */
const QUEST_STATE_BADGE: Record<Quest['state'], string> = {
  available: 'bg-gray-600 text-gray-100',
  active: 'bg-sky-600 text-white',
  completed: 'bg-amber-500 text-black',
  turned_in: 'bg-emerald-600 text-white',
}

const QUEST_FIELD_CLASS = 'w-full rounded bg-gray-800 p-1.5 text-xs'

const OBJECTIVE_TARGET_LABEL: Record<ObjectiveKind, string> = { kill: 'Enemy type', travel: 'Cell "col,row"', find: 'Target NPC' }
const OBJECTIVE_TARGET_PLACEHOLDER: Record<ObjectiveKind, string> = { kill: 'goblin', travel: '10,5', find: '' }

interface QuestAuthoringCardProps {
  npcs: Entity[]
  quests: Quest[]
  draft: QuestDraft
  playerXp: number
  onDraftChange: (next: QuestDraft) => void
  onSave: () => void
}

/**
 * Editor panel to author ONE kill-quest and link it to a placed NPC (spec §10):
 * pick a giver, set a title + kill objective (enemy type × count) + a reward
 * (xp or item). Lists already-authored quests with their lifecycle state. Purely
 * presentational — all quest logic lives in the page/module; this only edits the
 * draft and fires onSave.
 */
function QuestAuthoringCard({ npcs, quests, draft, playerXp, onDraftChange, onSave }: QuestAuthoringCardProps) {
  const patch = (partial: Partial<QuestDraft>) => onDraftChange({ ...draft, ...partial })

  return (
    <Card title="Quests" accent="orange">
      <p className="mb-2 text-[10px] text-gray-500">
        Place an NPC, link it as a quest-giver, then play: press E by the NPC to accept,
        slay the enemies, return and press E to turn in.
      </p>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs font-bold text-orange-300">Quest-giver NPC</span>
        <select
          value={draft.giverId}
          onChange={e => patch({ giverId: e.target.value })}
          aria-label="Quest-giver NPC"
          className={QUEST_FIELD_CLASS}
        >
          <option value="">— pick a placed NPC —</option>
          {npcs.map(npc => (
            <option key={npc.id} value={npc.id}>
              {npc.name?.trim() || `NPC @ ${npc.col},${npc.row}`}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs font-bold text-orange-300">Title</span>
        <input
          type="text"
          value={draft.title}
          onChange={e => patch({ title: e.target.value })}
          placeholder="Cull the goblins"
          aria-label="Quest title"
          className={QUEST_FIELD_CLASS}
        />
      </label>

      <div className="mb-2">
        <span className="mb-1 block text-xs font-bold text-orange-300">Objective</span>
        <select
          value={draft.objectiveKind}
          onChange={e => patch({ objectiveKind: e.target.value as ObjectiveKind, target: '' })}
          aria-label="Objective kind"
          className={`${QUEST_FIELD_CLASS} mb-1`}
        >
          <option value="kill">Slay enemies</option>
          <option value="travel">Travel to a cell</option>
          <option value="find">Find an NPC</option>
        </select>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] text-gray-400">{OBJECTIVE_TARGET_LABEL[draft.objectiveKind]}</span>
            {draft.objectiveKind === 'find' ? (
              <select value={draft.target} onChange={e => patch({ target: e.target.value })} aria-label="Target NPC" className={QUEST_FIELD_CLASS}>
                <option value="">— pick NPC —</option>
                {npcs.map(n => <option key={n.id} value={n.id}>{n.name?.trim() || `NPC @ ${n.col},${n.row}`}</option>)}
              </select>
            ) : (
              <input
                type="text"
                value={draft.target}
                onChange={e => patch({ target: e.target.value })}
                placeholder={OBJECTIVE_TARGET_PLACEHOLDER[draft.objectiveKind]}
                aria-label="Objective target"
                className={QUEST_FIELD_CLASS}
              />
            )}
          </label>
          {draft.objectiveKind === 'kill' && (
            <label className="block">
              <span className="mb-1 block text-[10px] text-gray-400">Count</span>
              <input
                type="number"
                min={1}
                value={draft.count}
                onChange={e => patch({ count: Number(e.target.value) })}
                aria-label="Objective count"
                className={QUEST_FIELD_CLASS}
              />
            </label>
          )}
        </div>
      </div>

      <div className="mb-2">
        <span className="mb-1 block text-xs font-bold text-orange-300">Reward</span>
        <div className="mb-2 grid grid-cols-2 gap-1">
          <RewardKindButton label="XP" active={draft.rewardKind === 'xp'} onClick={() => patch({ rewardKind: 'xp' })} />
          <RewardKindButton label="Item" active={draft.rewardKind === 'item'} onClick={() => patch({ rewardKind: 'item' })} />
        </div>
        {draft.rewardKind === 'xp' ? (
          <input
            type="number"
            min={0}
            value={draft.rewardXp}
            onChange={e => patch({ rewardXp: Number(e.target.value) })}
            aria-label="Reward XP amount"
            className={QUEST_FIELD_CLASS}
          />
        ) : (
          <input
            type="text"
            value={draft.rewardItemId}
            onChange={e => patch({ rewardItemId: e.target.value })}
            placeholder="reward-item id"
            aria-label="Reward item id"
            className={QUEST_FIELD_CLASS}
          />
        )}
      </div>

      <button
        onClick={onSave}
        className="w-full rounded bg-orange-600 px-2 py-1.5 text-xs font-bold text-black transition-colors hover:bg-orange-500"
      >
        Link quest to giver
      </button>

      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] text-gray-400">
          <span>{quests.length} quest{quests.length === 1 ? '' : 's'}</span>
          <span className="tabular-nums text-amber-300">{playerXp} XP</span>
        </div>
        <ul className="flex flex-col gap-1">
          {quests.map(quest => (
            <li key={quest.id} className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1">
              <span className="truncate text-[11px] text-gray-200">{quest.title}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${QUEST_STATE_BADGE[quest.state]}`}>
                {quest.state.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

/** A reward-kind toggle (XP / Item) in the Quests card. */
function RewardKindButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
        active ? 'bg-orange-600 text-black' : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  )
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 80

// Flow View Overlay Component - shows current template's connections
function FlowViewOverlay({
  currentTemplate,
  connectors,
  allTemplates,
  onSelectTemplate,
}: {
  currentTemplate: { id: string; name: string } | null
  connectors: Connector[]
  allTemplates: TemplateListItem[]
  onSelectTemplate: (id: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Lay EVERY saved template (+ the current one) out in a circle — the full level
  // graph, not just the current room's neighbours. x/y are node centres; each node
  // carries its own connectors (the current room's come from the live `connectors`
  // prop, since it may have unsaved edits). Shared by render + click hit-testing.
  const layoutNodes = useCallback(
    (w: number, h: number) => {
      const base = allTemplates.map(t => ({ id: t.id, name: t.name, connectors: (t.connectors as Connector[]) || [] }))
      if (currentTemplate && !base.some(t => t.id === currentTemplate.id)) {
        base.push({ id: currentTemplate.id, name: currentTemplate.name, connectors })
      }
      const radius = Math.min(w, h) * 0.32
      const single = base.length <= 1
      return base.map((t, i) => {
        const angle = (i / Math.max(1, base.length)) * Math.PI * 2 - Math.PI / 2
        return {
          id: t.id,
          name: t.name,
          connectors: t.id === currentTemplate?.id ? connectors : t.connectors,
          x: single ? w / 2 : w / 2 + Math.cos(angle) * radius,
          y: single ? h / 2 : h / 2 + Math.sin(angle) * radius,
        }
      })
    },
    [currentTemplate, connectors, allTemplates],
  )

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    // Clear with dark space background
    ctx.fillStyle = '#0a0a12'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Subtle star field
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    for (let i = 0; i < 50; i++) {
      const x = (Math.sin(i * 123.456) * 0.5 + 0.5) * canvas.width
      const y = (Math.cos(i * 78.9) * 0.5 + 0.5) * canvas.height
      ctx.beginPath()
      ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }

    // The FULL level graph: every template is a node, every connector an edge.
    const nodes = layoutNodes(canvas.width, canvas.height)
    const nodeOf = (id: string) => nodes.find(n => n.id === id)

    // Edges — one arrowed, labelled link per connector, between its two nodes.
    for (const node of nodes) {
      for (const connector of node.connectors) {
        const target = nodeOf(connector.targetTemplateId)
        if (!target) continue
        const color = connector.interaction === 'walk' ? '#aa66ff' : connector.interaction === 'interact' ? '#66aaff' : '#ffaa66'
        const gradient = ctx.createLinearGradient(node.x, node.y, target.x, target.y)
        gradient.addColorStop(0, color)
        gradient.addColorStop(1, color + '88')
        ctx.strokeStyle = gradient
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(node.x, node.y)
        ctx.lineTo(target.x, target.y)
        ctx.stroke()

        const angle = Math.atan2(target.y - node.y, target.x - node.x)
        const arrowDist = Math.hypot(target.x - node.x, target.y - node.y) - NODE_WIDTH / 2 - 8
        const arrowX = node.x + Math.cos(angle) * arrowDist
        const arrowY = node.y + Math.sin(angle) * arrowDist
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(arrowX + Math.cos(angle) * 12, arrowY + Math.sin(angle) * 12)
        ctx.lineTo(arrowX + Math.cos(angle - 0.4) * -8, arrowY + Math.sin(angle - 0.4) * -8)
        ctx.lineTo(arrowX + Math.cos(angle + 0.4) * -8, arrowY + Math.sin(angle + 0.4) * -8)
        ctx.closePath()
        ctx.fill()

        ctx.font = 'bold 11px monospace'
        ctx.fillStyle = '#fff'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(connector.interaction, (node.x + target.x) / 2, (node.y + target.y) / 2 - 10)
      }
    }

    // Nodes — the current room glows gold; the rest are blue boxes.
    for (const node of nodes) {
      const isCurrent = node.id === currentTemplate.id
      ctx.fillStyle = isCurrent ? '#2a1a3a' : '#16213a'
      ctx.beginPath()
      ctx.roundRect(node.x - NODE_WIDTH / 2, node.y - NODE_HEIGHT / 2, NODE_WIDTH, NODE_HEIGHT, 10)
      ctx.fill()
      if (isCurrent) {
        ctx.shadowColor = '#ffaa00'
        ctx.shadowBlur = 20
      }
      ctx.strokeStyle = isCurrent ? '#ffaa00' : '#5a7fd0'
      ctx.lineWidth = isCurrent ? 3 : 2
      ctx.stroke()
      ctx.shadowBlur = 0

      ctx.fillStyle = isCurrent ? '#ffdd00' : '#ffffff'
      ctx.font = 'bold 13px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.name.length > 13 ? node.name.slice(0, 12) + '…' : node.name, node.x, node.y - 4)
      ctx.fillStyle = '#888'
      ctx.font = '10px monospace'
      ctx.fillText(`${node.connectors.length} link${node.connectors.length === 1 ? '' : 's'}`, node.x, node.y + 13)
    }

    // Legend
    ctx.fillStyle = '#666'
    ctx.font = '11px monospace'
    ctx.textAlign = 'left'
    ctx.fillText('Click a room to open it · arrows = connectors', 20, canvas.height - 20)

    if (nodes.length <= 1) {
      ctx.fillStyle = '#666'
      ctx.font = '14px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('Save more templates + add connectors to see the graph', centerX, centerY + NODE_HEIGHT)
    }
  }, [currentTemplate, layoutNodes])

  useEffect(() => {
    render()
    window.addEventListener('resize', render)
    return () => window.removeEventListener('resize', render)
  }, [render])

  const handleClick = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas || !currentTemplate) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Hit-test against the same full-graph layout the render uses. Clicking any room
    // (other than the current one) opens it.
    for (const node of layoutNodes(canvas.width, canvas.height)) {
      if (node.id === currentTemplate.id) continue
      if (x >= node.x - NODE_WIDTH / 2 && x <= node.x + NODE_WIDTH / 2 && y >= node.y - NODE_HEIGHT / 2 && y <= node.y + NODE_HEIGHT / 2) {
        onSelectTemplate(node.id)
        return
      }
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 z-10 cursor-pointer"
      onClick={handleClick}
    />
  )
}

// Enemies advance one patrol cell roughly every ENEMY_MOVE_MS (throttled, so
// patrols read as steps, not a blur).
const ENEMY_MOVE_MS = 360 // one patrol cell per this interval — slower, deliberate monster pace

/** Advance every patrolling enemy ONE cell along its movement pattern, treating
 *  walls, the player's cell, and other entities as blocked. Returns a NEW entities
 *  list when something moved, else the same reference (so the loop can skip a
 *  re-render). Per-entity cursors persist across ticks in `cursors`. */
/** Newly-placed enemies (no authored pattern) patrol erratically out of the box:
 *  a step list of 5-cell runs in each direction, picked at random with pauses. */
const DEFAULT_ENEMY_PATROL: MovementPattern = {
  mode: 'random',
  waypoints: [],
  steps: [
    { dir: 'right', cells: 5 },
    { dir: 'left', cells: 5 },
    { dir: 'up', cells: 5 },
    { dir: 'down', cells: 5 },
  ],
  delayMs: 1000, // realistic patrol: walk a 5-cell run, then PAUSE/idle ~1s, then turn and walk again
                 // (smooth glide + idle-hold animation make this read as resting, not the old choppiness)
}
/** Stable empty list passed to the renderers when entities are hidden (avoids per-frame alloc). */
const EMPTY_ENTITIES: Entity[] = []
// A frozen empty key map → the player ignores movement input (e.g. while a building
// is selected for editing, when arrow keys drive the BUILDING instead).
const EMPTY_KEYS: Record<string, boolean> = {}
type Cursor = MoverState | RunState | StepListState
const isStepListState = (s: Cursor | undefined): s is StepListState => !!s && 'cellsLeft' in s
const isRunState = (s: Cursor | undefined): s is RunState => !!s && 'stepsLeft' in s
const isMoverState = (s: Cursor | undefined): s is MoverState => !!s && 'target' in s

/** Nearest walkable cell to (col,row) via bounded 4-neighbour BFS. Returns the cell
 *  itself if already walkable, or null if nothing walkable is near — used to unstick
 *  enemies embedded in terrain / out of bounds. */
function nearestWalkable(grid: IsometricGrid, col: number, row: number, maxRings = 12): { col: number; row: number } | null {
  if (!grid.isBlocked(col, row)) return { col, row }
  const seen = new Set<string>([`${col},${row}`])
  let frontier = [{ col, row }]
  for (let r = 0; r < maxRings && frontier.length > 0; r++) {
    const nextRing: { col: number; row: number }[] = []
    for (const c of frontier) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c.col + dc
        const nr = c.row + dr
        const key = `${nc},${nr}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!grid.isBlocked(nc, nr)) return { col: nc, row: nr }
        nextRing.push({ col: nc, row: nr })
      }
    }
    frontier = nextRing
  }
  return null
}

function advanceEnemyMovement(
  grid: IsometricGrid,
  entities: readonly Entity[],
  player: { x: number; z: number },
  cursors: Map<string, Cursor>,
  entityBlocked: Set<string>,
): readonly Entity[] {
  const pCol = Math.floor(player.x / grid.cellSize)
  const pRow = Math.floor(player.z / grid.cellSize)
  let moved = false
  const next = entities.map(e => {
    if (e.kind !== 'enemy') return e
    // UNSTICK: if the enemy is embedded in terrain or out of bounds (trees grew around it
    // after a regenerate, or it was dropped on a wall), relocate it to the nearest walkable
    // cell so it never sits frozen inside a tree / off the map.
    if (grid.isBlocked(e.col, e.row)) {
      const spot = nearestWalkable(grid, e.col, e.row)
      if (spot && (spot.col !== e.col || spot.row !== e.row)) {
        moved = true
        cursors.delete(e.id)
        return { ...e, col: spot.col, row: spot.row }
      }
    }
    const pattern = e.movement ?? DEFAULT_ENEMY_PATROL
    const own = entityOccupiedCells([e]) // an entity must not collide with its own footprint
    const blocked = (c: number, r: number): boolean =>
      grid.isBlocked(c, r) ||
      (c === pCol && r === pRow) ||
      (entityBlocked.has(`${c},${r}`) && !own.has(`${c},${r}`))

    // Pick the stepper: a step list ("advance N cells in a direction") takes precedence;
    // else run-patrol (axis set OR <2 waypoints); else the authored waypoint path.
    const prev = cursors.get(e.id)
    const here = { col: e.col, row: e.row }
    const delayTicks = Math.max(0, Math.round((pattern.delayMs ?? STEP_LIST_DELAY_MS) / ENEMY_MOVE_MS))
    let stepped: { pos: { col: number; row: number }; state: Cursor }
    if (pattern.waypoints.length >= 2) {
      stepped = stepMover(here, pattern, isMoverState(prev) ? prev : initMover(), blocked) // explicit click-path wins
    } else if (pattern.steps && pattern.steps.length > 0) {
      stepped = stepStepList(here, pattern, isStepListState(prev) ? prev : initStepList(), blocked, { delayTicks })
    } else if (pattern.axis) {
      stepped = stepRunPatrol(here, pattern, isRunState(prev) ? prev : initRunState(pattern), blocked, {
        delayTicks: Math.max(0, Math.round((pattern.delayMs ?? RUN_PATROL_DELAY_MS) / ENEMY_MOVE_MS)),
      })
    } else {
      stepped = stepMover(here, pattern, isMoverState(prev) ? prev : initMover(), blocked) // no-op (<2 waypoints)
    }

    cursors.set(e.id, stepped.state)
    if (stepped.pos.col === e.col && stepped.pos.row === e.row) return e
    moved = true
    return { ...e, col: stepped.pos.col, row: stepped.pos.row }
  })
  return moved ? next : entities
}

// Cannon behavior: a placed `cannon` asset auto-fires on this cadence, hitting a
// player within CANNON_RANGE cells for CANNON_DAMAGE (a simple line-of-no-sight
// turret — projectile travel is a later refinement).
const CANNON_INTERVAL_MS = 1800
const CANNON_RANGE = 4
const CANNON_DAMAGE = 6

/** Fire every ready cannon; return total damage dealt to the player this tick and
 *  push a hit marker on the player when struck. `lastFired` persists per cannon. */
function tickCannons(
  grid: IsometricGrid,
  player: { x: number; z: number },
  lastFired: Map<string, number>,
  hitMarkers: HitMarker[],
  now: number,
): number {
  const pCol = Math.floor(player.x / grid.cellSize)
  const pRow = Math.floor(player.z / grid.cellSize)
  let damage = 0
  for (const a of grid.assets) {
    if (a.tileKey !== 'cannon') continue
    const key = `${a.col},${a.row}`
    if (!shouldFire(CANNON_INTERVAL_MS, lastFired.get(key) ?? 0, now)) continue
    lastFired.set(key, now)
    if (Math.abs(a.col - pCol) + Math.abs(a.row - pRow) <= CANNON_RANGE) {
      damage += CANNON_DAMAGE
      pushHitMarker(hitMarkers, pCol, pRow, CANNON_DAMAGE, 'player', now)
    }
  }
  return damage
}

/** Right-sidebar inventory: shows the equipped weapon/armor and lets the player
 *  equip gear or use a consumable. Presentational — actions bubble to the editor. */
// ── Visual equipment panel (the per-entity inventory: equip slots + bag + specials) ──

const SLOT_LABEL: Record<EquipSlot, string> = {
  helmet: 'Helmet', chest: 'Chest', gloves: 'Gloves', boots: 'Boots',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', ring1: 'Ring 1', ring2: 'Ring 2', neck: 'Neck',
}

/** A fresh player loadout pre-stocked with the warrior starter set (in the bag). */
function seededPlayerLoadout(): Loadout {
  let l = createLoadout()
  for (const item of starterWarriorGear()) l = addToBag(l, item)
  return l
}

/** Pull a bag item out (slot nulled). */
function takeFromBag(loadout: Loadout, index: number): Loadout {
  const bag = [...loadout.bag]
  bag[index] = null
  return { ...loadout, bag }
}

/** Click a bag item → equip it (first allowed slot, swapping any occupant back to the
 *  bag), or if it's a consumable drop it in the first free special slot. */
function useBagItem(loadout: Loadout, index: number): Loadout {
  const item = loadout.bag[index]
  if (!item) return loadout
  const slots = allowedSlots(item)
  if (slots.length === 0) {
    const free = loadout.special.findIndex(s => s === null)
    if (free < 0) return loadout
    return setSpecial(takeFromBag(loadout, index), free, item)
  }
  const target = slots.find(s => !(s in loadout.equipped)) ?? slots[0]
  const displaced = loadout.equipped[target] ?? null
  let next = equipToSlot(takeFromBag(loadout, index), item, target)
  if (displaced) next = addToBag(next, displaced)
  return next
}

function EquipmentPanel({ label, loadout, onChange, onClose }: {
  label: string
  loadout: Loadout
  onChange: (l: Loadout) => void
  onClose: () => void
}) {
  const unequipToBag = (slot: EquipSlot) => {
    const item = loadout.equipped[slot]
    if (item) onChange(addToBag(unequipSlot(loadout, slot), item))
  }
  const sendSpecialToBag = (i: number) => {
    const item = loadout.special[i]
    if (item) onChange(addToBag(setSpecial(loadout, i, null), item))
  }
  const cycleShortcut = (i: number) => {
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
    const cur = keys.indexOf(loadout.shortcuts[i])
    onChange(setShortcut(loadout, i, keys[(cur + 1) % keys.length]))
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono" role="dialog" aria-label="Inventory" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-cyan-500/40 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-cyan-400">Inventory — {label}</h2>
          <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close inventory">✕ (I)</button>
        </div>

        <p className="mb-1 text-xs font-bold text-gray-400">Equipped</p>
        <div className="mb-3 grid grid-cols-3 gap-1">
          {EQUIP_SLOTS.map(slot => {
            const item = loadout.equipped[slot]
            return (
              <button key={slot} onClick={() => unequipToBag(slot)} disabled={!item}
                className={`rounded border px-2 py-1.5 text-left text-[11px] ${item ? 'border-cyan-600 bg-cyan-900/40 hover:bg-cyan-900/70' : 'border-white/10 bg-black/40 text-gray-600'}`}>
                <span className="block text-[9px] uppercase text-gray-500">{SLOT_LABEL[slot]}</span>
                <span className="block truncate">{item ? item.name : '—'}</span>
              </button>
            )
          })}
        </div>

        <p className="mb-1 text-xs font-bold text-gray-400">Special — bound to number keys</p>
        <div className="mb-3 flex gap-1">
          {loadout.special.map((item, i) => (
            <div key={i} className="flex-1 rounded border border-amber-600/40 bg-amber-900/20 p-1 text-center text-[11px]">
              <button onClick={() => cycleShortcut(i)} className="mb-0.5 rounded bg-amber-700 px-1.5 text-[10px] font-bold hover:bg-amber-600" aria-label={`Cycle shortcut key for special slot ${i + 1}`}>{loadout.shortcuts[i]}</button>
              <button onClick={() => sendSpecialToBag(i)} disabled={!item} className="block w-full truncate hover:text-amber-300">{item ? item.name : '—'}</button>
            </div>
          ))}
        </div>

        <p className="mb-1 text-xs font-bold text-gray-400">Bag ({loadout.bag.filter(Boolean).length}/{loadout.bag.length})</p>
        <div className="mb-3 grid grid-cols-6 gap-1">
          {loadout.bag.map((item, i) => (
            <button key={i} onClick={() => onChange(useBagItem(loadout, i))} disabled={!item}
              title={item ? `Equip / use ${item.name}` : ''}
              className={`aspect-square rounded border p-1 text-[9px] leading-tight ${item ? 'border-white/20 bg-gray-800 hover:bg-gray-700' : 'border-white/5 bg-black/30 text-gray-700'}`}>
              {item ? item.name.slice(0, 10) : ''}
            </button>
          ))}
        </div>

        <details>
          <summary className="cursor-pointer text-xs text-gray-400">+ Add gear to bag</summary>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {GEAR_CATALOG.map(g => (
              <button key={g.id} onClick={() => onChange(addToBag(loadout, g))} className="truncate rounded bg-gray-700 px-1 py-0.5 text-[10px] hover:bg-gray-600">{g.name}</button>
            ))}
          </div>
        </details>
      </div>
    </div>
  )
}

/** Lifecycle groups the quest log renders, in player-facing order. */
const QUEST_LOG_GROUPS: ReadonlyArray<{ state: Quest['state']; label: string; accent: string }> = [
  { state: 'available', label: 'Available', accent: 'text-gray-300' },
  { state: 'active', label: 'Active', accent: 'text-sky-300' },
  { state: 'completed', label: 'Completed', accent: 'text-amber-300' },
  { state: 'turned_in', label: 'Turned in', accent: 'text-emerald-300' },
]

/**
 * Quest LOG overlay — the player's quests grouped by lifecycle state, each with the
 * shared objective checklist + a progress count. Mirrors the inventory EquipmentPanel:
 * backdrop click or the ✕ button closes it (the page also wires Esc + the Q key).
 */
export function QuestLogPanel({ quests, onClose }: {
  quests: readonly Quest[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono" role="dialog" aria-label="Quest log" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-orange-500/40 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-orange-400">Quest Log</h2>
          <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close quest log">✕ (Q)</button>
        </div>
        {quests.length === 0 && <p className="text-xs text-gray-500">No quests yet. Find a quest-giver and press E to accept one.</p>}
        <div className="space-y-3">
          {QUEST_LOG_GROUPS.map(group => {
            const inGroup = quests.filter(q => q.state === group.state)
            if (inGroup.length === 0) return null
            return (
              <section key={group.state}>
                <p className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${group.accent}`}>{group.label} ({inGroup.length})</p>
                <ul className="space-y-2">
                  {inGroup.map(quest => {
                    const { completed, total } = progress(quest)
                    return (
                      <li key={quest.id} className="rounded border border-white/10 bg-black/40 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="truncate text-[11px] font-bold text-gray-100">{quest.title}</span>
                          <span className="ml-2 shrink-0 text-[10px] tabular-nums text-gray-400">{completed}/{total}</span>
                        </div>
                        <QuestObjectives quest={quest} />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function InventoryCard({ inventory, talentPath, onEquip, onUse, onSetClass }: {
  inventory: Inventory
  talentPath: TalentPath
  onEquip: (itemId: string) => void
  onUse: (itemId: string) => void
  onSetClass: (path: TalentPath) => void
}) {
  const classBtn = (path: TalentPath, label: string) =>
    `flex-1 rounded px-2 py-0.5 ${talentPath === path ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`
  return (
    <Card title="Inventory" accent="cyan">
      <div className="space-y-2 text-xs">
        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-gray-400">Class</span>
          <div className="flex gap-1">
            <button onClick={() => onSetClass('warrior')} className={classBtn('warrior', 'Warrior')} aria-pressed={talentPath === 'warrior'}>Warrior</button>
            <button onClick={() => onSetClass('magician')} className={classBtn('magician', 'Magician')} aria-pressed={talentPath === 'magician'}>Magician</button>
          </div>
        </div>
        <div className="text-gray-300">
          <div>Weapon: <span className="text-cyan-300">{inventory.equippedWeapon?.name ?? '—'}</span></div>
          <div>Armor: <span className="text-cyan-300">{inventory.equippedArmor?.name ?? '—'}</span></div>
        </div>
        <ul className="space-y-1">
          {inventory.items.length === 0 && <li className="text-gray-500">No items</li>}
          {inventory.items.map(item => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-gray-200">
                {item.name} <span className="text-gray-500">({item.slot})</span>
              </span>
              {item.slot === 'consumable' ? (
                <button onClick={() => onUse(item.id)} className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 hover:bg-emerald-600" aria-label={`Use ${item.name}`}>Use</button>
              ) : (
                <button onClick={() => onEquip(item.id)} className="shrink-0 rounded bg-cyan-700 px-2 py-0.5 hover:bg-cyan-600" aria-label={`Equip ${item.name}`}>Equip</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

/** Right-sidebar inspector for a clicked entity: edit its name / enemy-type, toggle
 *  whether it's hittable (a non-hittable enemy becomes passive scenery), see its
 *  stats + patrol, and delete it. Presentational — actions bubble to the editor. */
/** Reusable modal — dark gaming panel; click the backdrop or press Esc to close. */
function Modal({ title, accent = 'orange', onClose, children, wide, anchor }: {
  title: string
  accent?: 'orange' | 'cyan' | 'purple' | 'blue' | 'yellow' | 'red'
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  /** World-anchored screen point (px): when set, the panel floats ABOVE it (its
   *  bottom edge sitting at anchor.y) instead of centering. Off-screen → centered. */
  anchor?: { x: number; y: number } | null
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const ring = {
    orange: 'border-orange-500/40', cyan: 'border-cyan-500/40', purple: 'border-purple-500/40',
    blue: 'border-blue-500/40', yellow: 'border-yellow-500/40', red: 'border-red-500/40',
  }[accent]
  const head = {
    orange: 'text-orange-300', cyan: 'text-cyan-300', purple: 'text-purple-300',
    blue: 'text-blue-300', yellow: 'text-yellow-300', red: 'text-red-300',
  }[accent]
  // Anchored: float the panel above the world point (translate up + center on x);
  // otherwise fall back to the centered flex layout.
  const panelPos = anchor
    ? 'absolute -translate-x-1/2 -translate-y-full'
    : ''
  const panelStyle = anchor ? { left: anchor.x, top: anchor.y } : undefined
  return (
    <div
      className={`fixed inset-0 z-40 ${anchor ? '' : 'flex items-center justify-center'} bg-black/70 p-4 font-mono`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`${panelPos} flex max-h-[85vh] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex-col overflow-hidden rounded-xl border ${ring} bg-gray-950 text-white shadow-2xl shadow-black/60`}
        style={panelStyle}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-white/10 bg-black/40 px-4 py-3">
          <h3 className={`text-sm font-bold uppercase tracking-widest ${head}`}>{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded px-2 py-1 text-gray-400 hover:bg-white/10 hover:text-white">✕</button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

/** Identity + editable stats for the selected entity (Stats modal body). */
function EntityIdentityStatsBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  const hittable = entity.hittable ?? entity.kind === 'enemy'
  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-bold uppercase tracking-wider text-orange-300">{entity.kind}</span>
        <span className="text-gray-500">@ {entity.col},{entity.row}</span>
      </div>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-gray-400">Name</span>
        <input value={entity.name ?? ''} onChange={e => onPatch({ name: e.target.value })} aria-label="Entity name" className="w-full rounded bg-gray-800 p-1 text-xs" />
      </label>
      {entity.kind === 'enemy' && (
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-gray-400">Enemy type (kill-quest tag)</span>
          <input value={entity.enemyType ?? ''} onChange={e => onPatch({ enemyType: e.target.value })} aria-label="Enemy type" className="w-full rounded bg-gray-800 p-1 text-xs" />
        </label>
      )}
      <div>
        <span className="mb-0.5 block text-[10px] text-gray-400">Stats (editable)</span>
        <div className="grid grid-cols-2 gap-1">
          {([
            ['maxHp', 'HP'],
            ['defense', 'DEF'],
            ['strength', 'STR'],
            ['intelligence', 'INT'],
            ['dodge', 'DODGE%'],
          ] as const).map(([stat, label]) => (
            <label key={stat} className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="w-12 shrink-0">{label}</span>
              <input
                type="number"
                value={entity.baseStats[stat] ?? 0}
                onChange={e => onPatch({ baseStats: { ...entity.baseStats, [stat]: Number(e.target.value) } })}
                aria-label={`${entity.kind} ${label}`}
                className="w-full rounded bg-gray-800 p-1 text-xs"
              />
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 text-gray-300">
        <input type="checkbox" checked={hittable} onChange={e => onPatch({ hittable: e.target.checked })} aria-label="Hittable" />
        Hittable (can be attacked)
      </label>
      {entity.kind === 'enemy' && (
        <label className="flex items-center gap-2 text-[10px] text-gray-400">
          <span className="w-28 shrink-0">Respawn (s · 0 = never)</span>
          <input
            type="number"
            min={0}
            value={Math.round((entity.respawnMs ?? 0) / 1000)}
            onChange={e => onPatch({ respawnMs: Math.max(0, Number(e.target.value)) * 1000 })}
            aria-label="Respawn seconds"
            className="w-full rounded bg-gray-800 p-1 text-xs"
          />
        </label>
      )}
    </div>
  )
}

/** Step-list movement editor (Movement modal body). */
function EntityMovementBody({ entity, onPatch, waypointMode, onToggleWaypointMode }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
  waypointMode: boolean
  onToggleWaypointMode: () => void
}) {
  return (
    <div className="text-xs">
      <span className="mb-0.5 block text-[10px] text-gray-400">Movement pattern</span>
      <select
        value={entity.movement ? entity.movement.mode : 'none'}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'none') {
            onPatch({ movement: undefined })
            return
          }
          const next = entity.movement
            ? setMovementMode(entity.movement, mode as MovementPattern['mode'])
            : buildStepList(mode as MovementPattern['mode'])
          onPatch({ movement: next })
        }}
        aria-label="Movement mode"
        className="w-full rounded bg-gray-800 p-1 text-xs"
      >
        <option value="none">Stationary</option>
        <option value="sequential">Sequential (run steps in order)</option>
        <option value="random">Random (pick a step each cycle)</option>
      </select>
      {entity.movement && (
        <div className="mt-1 space-y-1">
          {(entity.movement.steps ?? []).map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={s.dir}
                onChange={e => onPatch({ movement: updateMovementStep(entity.movement!, i, { dir: e.target.value as Direction }) })}
                aria-label={`Step ${i + 1} direction`}
                className="rounded bg-gray-800 p-1 text-[11px]"
              >
                <option value="up">↑ up</option>
                <option value="down">↓ down</option>
                <option value="left">← left</option>
                <option value="right">→ right</option>
              </select>
              <input
                type="number"
                min={1}
                value={s.cells}
                onChange={e => onPatch({ movement: updateMovementStep(entity.movement!, i, { cells: Number(e.target.value) }) })}
                aria-label={`Step ${i + 1} cells`}
                className="w-14 rounded bg-gray-800 p-1 text-[11px]"
              />
              <span className="text-[10px] text-gray-500">cells</span>
              <button
                onClick={() => onPatch({ movement: removeMovementStep(entity.movement!, i) })}
                aria-label={`Remove step ${i + 1}`}
                className="ml-auto rounded bg-gray-700 px-2 text-[11px] hover:bg-red-700"
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPatch({ movement: addMovementStep(entity.movement!) })}
              className="flex-1 rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Add step
            </button>
            <label className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="shrink-0">delay ms</span>
              <input
                type="number"
                min={0}
                value={entity.movement.delayMs ?? 1200}
                onChange={e => onPatch({ movement: setStepDelay(entity.movement!, Number(e.target.value)) })}
                aria-label="Step delay ms"
                className="w-16 rounded bg-gray-800 p-1 text-[11px]"
              />
            </label>
          </div>
          <p className="text-[10px] text-gray-500">
            {(entity.movement.steps ?? []).length} steps · {entity.movement.mode} · a wall stops a run early
          </p>
          <div className="mt-1 flex gap-1">
            <button
              onClick={onToggleWaypointMode}
              aria-pressed={waypointMode}
              className={`flex-1 rounded px-2 py-1 text-[10px] ${waypointMode ? 'bg-cyan-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
            >
              {waypointMode ? 'Click cells… (done)' : 'Advanced: click-path'}
            </button>
            <button
              onClick={() => onPatch({ movement: clearWaypoints(entity.movement) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              Clear path
            </button>
          </div>
          {(entity.movement.waypoints?.length ?? 0) >= 2 && (
            <p className="mt-0.5 text-[10px] text-amber-400">A click-path ({entity.movement.waypoints.length} pts) is set — it overrides the steps above.</p>
          )}
          {waypointMode && (
            <p className="mt-0.5 text-[10px] text-cyan-400">Click cells in Top view to add waypoints.</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Attack-pattern editor for enemies (Attacks modal body). */
function EntityAttackBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  return (
    <div className="text-xs">
      <span className="mb-0.5 block text-[10px] text-gray-400">Attack pattern</span>
      <div className="flex gap-1">
        <select
          value={entity.attack?.mode ?? 'melee'}
          onChange={e => {
            const mode = e.target.value as AttackMode
            const cooldownMs = entity.attack?.cooldownMs ?? defaultAttackPattern(mode).cooldownMs
            onPatch({ attack: makeAttackPattern(mode, cooldownMs) })
          }}
          aria-label="Attack mode"
          className="flex-1 rounded bg-gray-800 p-1 text-xs"
        >
          <option value="melee">Melee (adjacent)</option>
          <option value="ranged">Ranged (line of sight)</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="shrink-0">CD ms</span>
          <input
            type="number"
            value={entity.attack?.cooldownMs ?? defaultAttackPattern(entity.attack?.mode ?? 'melee').cooldownMs}
            onChange={e =>
              onPatch({ attack: makeAttackPattern(entity.attack?.mode ?? 'melee', Number(e.target.value)) })
            }
            aria-label="Attack cooldown ms"
            className="w-16 rounded bg-gray-800 p-1 text-xs"
          />
        </label>
      </div>
      <p className="mt-1 text-[10px] text-gray-500">Melee strikes adjacent; ranged fires within line of sight. CD = cooldown between swings.</p>
    </div>
  )
}

/**
 * Quest OFFER body — the modal contents shown when a player talks to a giver whose
 * quest is still `available`. Renders the title, story, objectives and rewards, with
 * Accept (runs the engine's acceptQuest → active) and Reject (close only — the quest
 * stays `available`, so the giver can be re-asked later). Rendered inside the reusable
 * Modal, anchored above the giver entity.
 */
export function QuestGiveBody({ quest, onAccept, onReject }: {
  quest: Quest
  onAccept: () => void
  onReject: () => void
}) {
  return (
    <div className="space-y-3 text-xs">
      <h4 className="text-sm font-bold text-amber-300">{quest.title}</h4>
      {quest.description && <p className="leading-relaxed text-gray-300">{quest.description}</p>}
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Objectives</p>
        <QuestObjectives quest={quest} />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Rewards</p>
        <ul className="flex flex-col gap-0.5">
          {quest.rewards.length === 0 && <li className="text-gray-500">—</li>}
          {quest.rewards.map((reward, i) => (
            <li key={i} className="text-emerald-300">{rewardSummary(reward)}</li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onAccept} className="flex-1 rounded bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600">
          Accept
        </button>
        <button onClick={onReject} className="flex-1 rounded bg-gray-700 px-3 py-1.5 text-xs font-bold text-gray-200 hover:bg-gray-600">
          Reject
        </button>
      </div>
    </div>
  )
}

export default function TemplateEditor() {
  const router = useRouter()
  const { toast } = useToast()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<IsometricGrid | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showTopView, setShowTopView] = useState(false)
  const [showFlowView, setShowFlowView] = useState(false)
  const [topViewZoom, setTopViewZoom] = useState(1.0)
  const zoomRef = useRef(1.0)
  const isoZoomRef = useRef(1.0) // mouse-wheel zoom for the isometric view
  const [gridSize, setGridSize] = useState({ cols: 40, rows: 40 })
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set())
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ col: number; row: number } | null>(null)
  const selectedCellsRef = useRef<Set<string>>(new Set())
  // Camera panning with mouse drag
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  // Click-vs-drag in the play views: a clean click selects the entity under it, a drag pans.
  const dragMovedRef = useRef(false)
  const downCellRef = useRef<{ col: number; row: number } | null>(null)
  const [camOffset, setCamOffset] = useState({ x: 0, y: 0 })
  const camOffsetRef = useRef({ x: 0, y: 0 })
  const [selectedTile, setSelectedTile] = useState<{ char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string } | null>(null)
  const [selectedComposite, setSelectedComposite] = useState<string | null>(null)
  const [selectedMultiAsset, setSelectedMultiAsset] = useState<string | null>(null)
  // Render opacity (0.15–1) applied to tiles placed from the palette — play with contrast / depth.
  const [placeOpacity, setPlaceOpacity] = useState(1)
  // Animation Author panel — in-progress cycle the user composes, then applies to an asset.
  const [authorAnims, setAuthorAnims] = useState<Set<string>>(new Set())
  const [authorMode, setAuthorMode] = useState<CycleMode>('sequential')
  const [authorDelay, setAuthorDelay] = useState(0)
  const [authorTriggerKind, setAuthorTriggerKind] = useState<'always' | 'state'>('always')
  const [authorTriggerState, setAuthorTriggerState] = useState('combat')
  const [selectedHeight, setSelectedHeight] = useState(0)
  const [heightEditMode, setHeightEditMode] = useState(false)
  const [hideEntities, setHideEntities] = useState(false)
  const hideEntitiesRef = useRef(false)
  useEffect(() => {
    hideEntitiesRef.current = hideEntities
  }, [hideEntities])
  const [initialized, setInitialized] = useState(false)

  // Template limits
  const isProd = process.env.NODE_ENV === 'production'
  const maxTemplates = isProd ? MAX_TEMPLATES_PROD : Infinity

  // Template management state
  const [savedTemplates, setSavedTemplates] = useState<TemplateListItem[]>([])
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [showTemplateList, setShowTemplateList] = useState(false)

  // Template view type (isometric or 2d)
  const [viewType, setViewType] = useState<'isometric' | '2d'>('isometric')

  // Stage generator: selected zone (the variant is chosen per click)
  const [genZone, setGenZone] = useState<ZoneId>('spring')

  // Connector state
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [connectorMode, setConnectorMode] = useState(false)
  const [editingConnector, setEditingConnector] = useState<{ col: number; row: number } | null>(null)
  const [connectorForm, setConnectorForm] = useState<Partial<Connector>>({
    interaction: 'walk',
    spawnCol: 25,
    spawnRow: 25,
  })
  const connectorsRef = useRef<Connector[]>([])
  const connectorModeRef = useRef(false)
  const viewTypeRef = useRef<'isometric' | '2d'>('isometric')

  // Entity placement state (player / enemies / NPCs). The game loop is mounted
  // once and reads through a ref, so entities mirror to entitiesRef like connectors.
  const [entities, setEntities] = useState<Entity[]>([])
  const [entityTool, setEntityTool] = useState<EntityTool>(null)
  // The placed entity currently selected for inspection (click an entity to select).
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  // When on, a Top-view click appends a waypoint to the selected entity's patrol path
  // (author your own movement route instead of the default box patrol).
  const [waypointMode, setWaypointMode] = useState(false)
  // Which entity-action modal is open (Stats / Inventory / Movement / Quests / Attacks).
  const [entityModal, setEntityModal] = useState<'stats' | 'inventory' | 'movement' | 'quests' | 'attacks' | null>(null)
  // Disarm waypoint authoring + close any entity modal whenever the selection changes,
  // so clicks on a new entity select it (not drop a stray waypoint / show stale modal).
  useEffect(() => {
    setWaypointMode(false)
    setEntityModal(null)
  }, [selectedEntityId])
  const [enemyType, setEnemyType] = useState('goblin')
  const [npcName, setNpcName] = useState('')
  const entitiesRef = useRef<Entity[]>([])

  // ── Manual building editor state ────────────────────────────────────
  // The armed building tool + the index into grid.buildings of the selected
  // building. `buildingVersion` is bumped after every live edit so the React
  // inspector re-reads grid.buildings (the canvas itself is live via the loop).
  const [buildingTool, setBuildingTool] = useState<BuildingTool>(null)
  const [selectedBuildingIndex, setSelectedBuildingIndex] = useState<number | null>(null)
  const [buildingVersion, setBuildingVersion] = useState(0)
  const buildingToolRef = useRef<BuildingTool>(null)
  const selectedBuildingIndexRef = useRef<number | null>(null)
  const genZoneRef = useRef<ZoneId>(genZone)
  const bumpBuildingVersion = () => setBuildingVersion(v => v + 1)

  // ── Quest state (spec §10) ──────────────────────────────────────────
  // Quests are React state (drives the authoring panel + HUD), mirrored into a
  // ref so the once-mounted game loop can read/advance them. The authoring form
  // is its own draft; xp earned from turn-ins lives in a single player counter.
  const [quests, setQuests] = useState<Quest[]>([])
  const [questDraft, setQuestDraft] = useState<QuestDraft>(() => emptyQuestDraft())
  const [playerXp, setPlayerXp] = useState(0)
  const questsRef = useRef<Quest[]>([])
  // The quest log overlay (Q key / button) and the offer modal (opened when the
  // player talks to a giver whose quest is still `available`). The offer carries a
  // screen anchor so the modal floats above the giver; null anchor → centered.
  const [questLogOpen, setQuestLogOpen] = useState(false)
  const [questGiveModal, setQuestGiveModal] = useState<{ giverId: string; anchor: { x: number; y: number } | null } | null>(null)

  // Connector teleport runtime state (read/written inside the once-mounted game loop)
  const lastCellRef = useRef<{ col: number; row: number }>({ col: -1, row: -1 })
  const interactDownRef = useRef(false)
  const teleportingRef = useRef(false)
  const triggerConnectorRef = useRef<(c: Connector) => void>(() => {})
  const jumpDownRef = useRef(false)
  const jumpRef = useRef<JumpState>({ active: false, fromX: 0, fromZ: 0, toX: 0, toZ: 0, start: 0 })
  // Quest hooks the once-mounted loop calls through (latest closure, like the
  // connector trigger): fold kills into quests, and accept/turn-in on interact.
  const onKillsRef = useRef<(enemyTypes: readonly string[]) => void>(() => {})
  const questInteractRef = useRef<(col: number, row: number) => void>(() => {})
  const questEventRef = useRef<(event: QuestEvent) => void>(() => {})

  // ── Combat runtime (read/written only inside the once-mounted game loop) ──
  // Pure formulas live in @/game/combat; these refs hold the mutable per-play
  // state. The player carries a default warrior loadout (sword) + full HP/rage/
  // mana; each enemy gets a CombatState keyed by id (synced from entitiesRef).
  const playerWeaponRef = useRef<Weapon>(STARTER_SWORD)
  const playerStatsRef = useRef<Stats>(DEFAULT_PLAYER_STATS)
  const playerShieldRef = useRef<Weapon | undefined>(undefined)
  const playerLoadoutRef = useRef<Loadout>(seededPlayerLoadout())
  const specialKeysRef = useRef<Record<string, boolean>>({})
  const useSpecialSlotRef = useRef<(i: number) => void>(() => {})
  const playerCombatRef = useRef<CombatState>(startingCombatState(DEFAULT_PLAYER_STATS))
  // Player inventory: equipped weapon drives attacks, equipped armor folds into
  // defense, consumables heal. The loop reads through inventoryRef each frame.
  const [inventory, setInventory] = useState<Inventory>(starterInventory)
  // Per-entity loadouts (equip grid + bag + specials), keyed by entity id; the
  // player's lives under '__player__'. The visual panel toggles with the I key.
  const [loadouts, setLoadouts] = useState<Record<string, Loadout>>({})
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const inventoryRef = useRef<Inventory>(inventory)
  // Talent path / archetype: warrior fights with a sword/axe, magician with a staff.
  const [talentPath, setTalentPath] = useState<TalentPath>('warrior')
  const enemyRuntimeRef = useRef<EnemyRuntime>(makeEnemyRuntime())
  // Per-enemy patrol cursors + the last time enemies advanced (movement tick).
  const movementCursorRef = useRef<Map<string, Cursor>>(new Map())
  const lastEnemyMoveRef = useRef(0)
  const cannonFireRef = useRef<Map<string, number>>(new Map()) // per-cannon last-fired time
  const hitMarkersRef = useRef<HitMarker[]>([])
  const attackAnimsRef = useRef<AttackAnim[]>([])
  // Travelling projectiles in flight + their per-shot attacker context (for impact damage).
  const projectilesRef = useRef<Projectile[]>([])
  const projectileCtxRef = useRef<Map<string, ProjectileContext>>(new Map())
  // Attack-key edge triggers (mirror the interact/jump edge-trigger pattern).
  const attackDownRef = useRef(false)
  const specialDownRef = useRef(false)
  const lastAttackFireRef = useRef(0) // for hold-to-loop: when the last regular swing fired
  // Throttle how often we mirror combat state to React (HUD only needs ~UI cadence).
  const hudSyncAtRef = useRef(0)

  // HUD mirror (the ONLY combat state in React — drives the DOM overlay).
  const [playerHud, setPlayerHud] = useState<PlayerHud>(() => playerHudFrom(
    DEFAULT_PLAYER_STATS,
    STARTER_SWORD,
    startingCombatState(DEFAULT_PLAYER_STATS),
  ))

  // Mirror the player's combat ref into React for the HUD, throttled to ~10 Hz
  // so we don't trigger a render every animation frame (refs are the source).
  const HUD_SYNC_INTERVAL_MS = 100
  const syncCombatHud = useCallback((now: number) => {
    if (now - hudSyncAtRef.current < HUD_SYNC_INTERVAL_MS) return
    hudSyncAtRef.current = now
    setPlayerHud(playerHudFrom(DEFAULT_PLAYER_STATS, playerWeaponRef.current, playerCombatRef.current))
  }, [])

  // Keep viewType ref in sync
  useEffect(() => {
    viewTypeRef.current = viewType
  }, [viewType])

  // UI panels — sidebars are collapsible on mobile to free up canvas space
  const [showSidebars, setShowSidebars] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Load view state from localStorage on mount
  useEffect(() => {
    const savedDebug = localStorage.getItem('village-debug') === 'true'
    const savedTopView = localStorage.getItem('village-topview') === 'true'
    const savedZoom = parseFloat(localStorage.getItem('village-topview-zoom') || '1.0')
    debugMode = savedDebug
    topViewMode = savedTopView
    zoomRef.current = savedZoom
    setShowDebug(savedDebug)
    setShowTopView(savedTopView)
    setTopViewZoom(savedZoom)
  }, [])

  // Save view state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('village-debug', showDebug.toString())
    localStorage.setItem('village-topview', showTopView.toString())
    localStorage.setItem('village-topview-zoom', topViewZoom.toString())
    zoomRef.current = topViewZoom
  }, [showDebug, showTopView, topViewZoom])

  // ── View controls ────────────────────────────────────────────────
  // The game loop + renderers read the module-level view globals directly, while
  // the UI mirrors them in React state. These helpers keep both in sync in ONE
  // place so the JSX never reaches into the globals inline (the old desync smell).
  // `debugMode` stays an independent overlay that can ride on iso/top.
  const showPlayView = () => {
    topViewMode = false
    flowViewMode = false
    setShowTopView(false)
    setShowFlowView(false)
    // Entering a play view (iso/2d) exits connector authoring — authoring must never
    // bleed into play and silently freeze triggers/combat (the dead walk-in bug).
    connectorModeRef.current = false
    setConnectorMode(false)
    setEditingConnector(null)
  }
  const selectIsoView = () => {
    setViewType('isometric')
    showPlayView()
  }
  const select2DView = () => {
    setViewType('2d')
    showPlayView()
  }
  const selectTopView = () => {
    topViewMode = true
    flowViewMode = false
    setShowTopView(true)
    setShowFlowView(false)
  }
  const toggleFlowView = () => {
    const next = !flowViewMode
    flowViewMode = next
    setShowFlowView(next)
    if (!next) return
    topViewMode = false
    setShowTopView(false)
  }
  const toggleDebug = () => {
    debugMode = !debugMode
    setShowDebug(d => !d)
  }

  // Derived: which view is active (for highlighting the view buttons)
  const activeView: 'iso' | '2d' | 'top' | 'flow' =
    showFlowView ? 'flow' : showTopView ? 'top' : viewType === '2d' ? '2d' : 'iso'

  // Keep selectedCells ref in sync
  useEffect(() => {
    selectedCellsRef.current = selectedCells
  }, [selectedCells])

  // Keep building-editor refs in sync (read by the once-mounted key handler + loop)
  useEffect(() => { buildingToolRef.current = buildingTool }, [buildingTool])
  useEffect(() => { selectedBuildingIndexRef.current = selectedBuildingIndex }, [selectedBuildingIndex])
  useEffect(() => { genZoneRef.current = genZone }, [genZone])

  // Keep connectors ref in sync
  useEffect(() => {
    connectorsRef.current = connectors
  }, [connectors])

  // Keep connectorMode ref in sync
  useEffect(() => {
    connectorModeRef.current = connectorMode
  }, [connectorMode])

  // Keep entities ref in sync so the once-mounted game loop renders the latest set
  useEffect(() => {
    entitiesRef.current = entities
  }, [entities])

  // Inventory → refs: the loop reads inventoryRef (armor) each frame, and the
  // equipped weapon drives the player's attacks.
  useEffect(() => {
    inventoryRef.current = inventory
    playerWeaponRef.current = inventory.equippedWeapon ?? STARTER_SWORD
  }, [inventory])

  // Player LOADOUT → combat refs: the equipped weapon, a shield's block%, and gear
  // stat bonuses (str/int/defense/dodge) feed the live fight, so equipping in the
  // inventory panel actually changes how you play.
  useEffect(() => {
    const pl = loadouts['__player__'] ?? seededPlayerLoadout()
    const weapons = [pl.equipped.weapon1, pl.equipped.weapon2].flatMap(i =>
      i && i.slot === 'weapon' ? [i.weapon] : [],
    )
    const shield = weapons.find(w => w.kind === 'shield')
    const mainWeapon = weapons.find(w => w.kind !== 'shield') ?? weapons[0]
    const b = loadoutBonuses(pl)
    // The player is a normal entity: its inspector-edited baseStats are the base the
    // gear bonuses add to, so editing the player's stats actually changes play.
    const base = entities.find(e => e.kind === 'player')?.baseStats ?? DEFAULT_PLAYER_STATS
    playerLoadoutRef.current = pl
    playerWeaponRef.current = mainWeapon ?? inventory.equippedWeapon ?? STARTER_SWORD
    playerShieldRef.current = shield
    // Make the equipped gear VISIBLE on the player: a held-weapon glyph beside the
    // figure (changes when you equip a different weapon) + an armored tint.
    const armored = (['helmet', 'chest', 'gloves', 'boots'] as const).some(s => !!pl.equipped[s])
    playerRef.current.weaponGlyph = weaponGlyph(mainWeapon ?? playerWeaponRef.current)
    playerRef.current.shieldGlyph = shield ? weaponGlyph(shield) : ''
    playerRef.current.armored = armored
    playerStatsRef.current = {
      ...base,
      strength: base.strength + b.strength,
      intelligence: base.intelligence + b.intelligence,
      defense: base.defense + b.defense,
      maxHp: base.maxHp,
      dodge: (base.dodge ?? 0) + b.dodge,
    }
  }, [loadouts, inventory.equippedWeapon, entities])

  // Using a special slot (from a number key): apply a consumable's effect to the
  // player and clear the slot. Bombs/scrolls have no stat effect yet — they just
  // get consumed with a toast (throw/teleport behaviour is a later pass).
  useEffect(() => {
    useSpecialSlotRef.current = (i: number) => {
      const item = playerLoadoutRef.current.special[i]
      if (!item) return
      if (item.slot === 'consumable') {
        const eff = item.effect
        const pc = playerCombatRef.current
        playerCombatRef.current = {
          hp: Math.min(playerStatsRef.current.maxHp, pc.hp + (eff.hp ?? 0)),
          rage: pc.rage + (eff.rage ?? 0),
          mana: pc.mana + (eff.mana ?? 0),
        }
      }
      toast(`Used ${item.name}`, 'success')
      setLoadouts(prev => ({ ...prev, __player__: setSpecial(prev['__player__'] ?? seededPlayerLoadout(), i, null) }))
    }
  }, [])

  // Keep quests ref in sync so the once-mounted game loop reads the latest quests
  useEffect(() => {
    questsRef.current = quests
  }, [quests])

  // Convert screen position to grid cell (for top view)
  // Screen → grid cell for the ACTIVE view. Top view is the easy default, but iso and
  // 2D work too (each just inverts its own projection) — placement isn't top-only.
  const screenToCell = (clientX: number, clientY: number): { col: number; row: number } | null => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return null

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const cs = grid.cellSize
    const px = playerRef.current.x
    const pz = playerRef.current.z
    const cam = camOffsetRef.current

    let col: number
    let row: number

    if (topViewMode) {
      // Must match renderTopView's offset EXACTLY, including the pan (camOffset) —
      // otherwise clicks land on the wrong cell after panning.
      const tileSize = 16 * zoomRef.current
      const offsetX = canvas.width / 2 - (px / cs) * tileSize + cam.x
      const offsetY = canvas.height / 2 - (pz / cs) * tileSize + cam.y
      col = Math.floor((x - offsetX) / tileSize)
      row = Math.floor((y - offsetY) / tileSize)
    } else if (viewTypeRef.current === '2d') {
      const tileW = 24 * zoomRef.current
      const camCol = px / cs - cam.x / tileW
      const camRow = pz / cs - cam.y / tileW
      col = Math.floor(camCol + (x - canvas.width / 2) / tileW)
      row = Math.floor(camRow + (y - canvas.height / 2) / tileW)
    } else {
      // Isometric: invert the diamond projection (sx-w/2 = (wx-wz)·S, sy-h/2 = (wx+wz)·T).
      const S = grid.isoScale * isoZoomRef.current * 0.71
      const T = grid.isoScale * isoZoomRef.current * 0.36
      const camX = px - cam.x
      const camZ = pz - cam.y
      const a = (x - canvas.width / 2) / S
      const b = (y - canvas.height / 2) / T
      col = Math.floor(((a + b) / 2 + camX) / cs)
      row = Math.floor(((b - a) / 2 + camZ) / cs)
    }

    if (col >= 0 && col < grid.cols && row >= 0 && row < grid.rows) {
      return { col, row }
    }
    return null
  }

  // Mouse handlers for cell selection and panning
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Middle mouse button (1) or right click (2) for panning
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    // Play views (iso/2d): LEFT-click + drag pans the camera — UNLESS a placement tool
    // is armed (entity / building / connector), in which case a left-click places in that
    // view too (top view is just the easier surface for it). Pan with middle/right-drag.
    if (e.button === 0 && !topViewMode && !entityTool && !buildingTool && !connectorMode) {
      // Defer the decision: clean click → select the entity here; drag → pan (mouse-up decides).
      downCellRef.current = screenToCell(e.clientX, e.clientY)
      dragMovedRef.current = false
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return

    // Waypoint authoring: with "Set waypoints" armed, each click appends a cell to the
    // selected entity's patrol path (data-only — see game/patterns.ts appendWaypoint).
    if (waypointMode && selectedEntityId) {
      setEntities(prev =>
        prev.map(ent =>
          ent.id === selectedEntityId
            ? { ...ent, movement: appendWaypoint(ent.movement, cell, ent.movement?.mode ?? 'sequential') }
            : ent,
        ),
      )
      return
    }

    // In connector mode, open the connector editor. ONE connector owns a SET of
    // cells: clicking a cell that belongs to an existing connector loads that whole
    // connector (its full cell set); otherwise shift-click extends the selection and
    // a plain click starts a fresh one. saveConnector turns the selection into cells.
    if (connectorMode) {
      const existingConnector = connectors.find(c =>
        c.cells.some(p => p.col === cell.col && p.row === cell.row),
      )
      if (existingConnector) {
        setConnectorForm(existingConnector)
        setSelectedCells(new Set(existingConnector.cells.map(p => `${p.col},${p.row}`)))
      } else if (e.shiftKey) {
        setSelectedCells(prev => new Set(prev).add(`${cell.col},${cell.row}`))
      } else {
        setSelectedCells(new Set([`${cell.col},${cell.row}`]))
        setConnectorForm({ interaction: 'walk', spawnCol: 25, spawnRow: 25, targetTemplateId: '' })
      }
      setEditingConnector(cell)
      return
    }

    // Entity tool armed → place/erase on this cell instead of selecting it
    if (entityTool) {
      applyEntityTool(cell.col, cell.row)
      return
    }

    // Building tool armed → select / place / delete a building on this cell
    if (buildingTool) {
      applyBuildingTool(cell.col, cell.row)
      return
    }

    // Multi-cell structure armed → stamp the whole asset with its TOP-LEFT at this cell.
    if (selectedMultiAsset) {
      const grid = gridRef.current
      const asset = multiCellAssetById(selectedMultiAsset)
      if (grid && asset) {
        const { w, h } = assetFootprint(asset)
        // Clear any single-cell assets under the footprint first, so a re-stamp is clean.
        grid.assets = grid.assets.filter(
          a => !(a.col >= cell.col && a.col < cell.col + w && a.row >= cell.row && a.row < cell.row + h),
        )
        stampAsset(grid, asset, cell.col, cell.row)
      }
      setSelectedMultiAsset(null)
      return
    }

    // No tool armed: clicking ANY cell of an entity's footprint selects it.
    const clickedEntity = entityAtFootprint(entitiesRef.current, cell.col, cell.row)
    if (clickedEntity) {
      setSelectedEntityId(clickedEntity.id)
      return
    }

    setIsSelecting(true)
    setSelectionStart(cell)

    if (e.shiftKey) {
      // Add to selection
      setSelectedCells(prev => {
        const next = new Set(prev)
        next.add(`${cell.col},${cell.row}`)
        return next
      })
    } else {
      // New selection
      setSelectedCells(new Set([`${cell.col},${cell.row}`]))
    }
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    // Handle panning
    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x
      const dy = e.clientY - panStart.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true
      const newOffset = {
        x: camOffsetRef.current.x + dx,
        y: camOffsetRef.current.y + dy
      }
      setCamOffset(newOffset)
      camOffsetRef.current = newOffset
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    if (!isSelecting || !selectionStart || !topViewMode) return
    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return

    // Select rectangle from start to current
    const minCol = Math.min(selectionStart.col, cell.col)
    const maxCol = Math.max(selectionStart.col, cell.col)
    const minRow = Math.min(selectionStart.row, cell.row)
    const maxRow = Math.max(selectionStart.row, cell.row)

    const newSelection = new Set<string>()
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        newSelection.add(`${c},${r}`)
      }
    }
    setSelectedCells(newSelection)
  }

  const handleCanvasMouseUp = () => {
    // A no-drag click in a play view selects the entity under it (or clears selection).
    if (isPanning && !dragMovedRef.current && downCellRef.current) {
      const c = downCellRef.current
      const hit = entityAtFootprint(entitiesRef.current, c.col, c.row)
      setSelectedEntityId(hit ? hit.id : null)
    }
    downCellRef.current = null
    setIsSelecting(false)
    setIsPanning(false)
    setPanStart(null)
  }

  // Prevent context menu on right click (for panning)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
  }

  // Find a valid walkable spawn point near a target position
  const findValidSpawn = (grid: IsometricGrid, targetCol: number, targetRow: number): { col: number; row: number } => {
    // Check if target is valid
    if (isValidSpawn(grid, targetCol, targetRow)) {
      return { col: targetCol, row: targetRow }
    }

    // Spiral search outward from target
    for (let radius = 1; radius < Math.max(grid.cols, grid.rows); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue // Only check perimeter
          const col = targetCol + dx
          const row = targetRow + dy
          if (isValidSpawn(grid, col, row)) {
            return { col, row }
          }
        }
      }
    }

    // Fallback: find any valid spot
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (isValidSpawn(grid, c, r)) {
          return { col: c, row: r }
        }
      }
    }

    // Last resort: center of map
    return { col: Math.floor(grid.cols / 2), row: Math.floor(grid.rows / 2) }
  }

  // Check if a cell is valid for spawning (walkable ground, no blocking assets)
  const isValidSpawn = (grid: IsometricGrid, col: number, row: number): boolean => {
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return false

    // Check ground type - water is not walkable
    const groundType = grid.ground[row]?.[col]
    if (groundType === 'water') return false

    // Check collision grid
    if (grid.isBlocked(col, row)) return false

    return true
  }

  // Move player to valid spawn point
  const movePlayerToValidSpawn = (targetCol?: number, targetRow?: number) => {
    const grid = gridRef.current
    if (!grid) return

    const col = targetCol ?? Math.floor(grid.cols / 2)
    const row = targetRow ?? Math.floor(grid.rows / 2)

    const spawn = findValidSpawn(grid, col, row)
    playerRef.current.x = spawn.col * grid.cellSize + grid.cellSize / 2
    playerRef.current.z = spawn.row * grid.cellSize + grid.cellSize / 2
  }

  /** The cell the live play-loop player currently occupies. */
  const livePlayerCell = (): { col: number; row: number } => {
    const grid = gridRef.current
    if (!grid) return { col: 0, row: 0 }
    return {
      col: Math.floor(playerRef.current.x / grid.cellSize),
      row: Math.floor(playerRef.current.z / grid.cellSize),
    }
  }

  /** The player IS a selectable entity (click it → its vitals/stats/inventory show in
   *  the right sidebar). Guarantee exactly one 'player' entity exists. `reposition`
   *  moves an existing player to (col,row) — used when generating a fresh stage;
   *  otherwise an existing (saved/placed) player is left untouched — used on load. */
  const syncPlayerEntity = (col: number, row: number, reposition: boolean) => {
    setEntities(prev => {
      const existing = prev.find(e => e.kind === 'player')
      if (existing && !reposition) return prev
      const others = prev.filter(e => e.kind !== 'player')
      const player = existing ? { ...existing, col, row } : makePlayer(mintEntityId('player'), col, row)
      return [...others, player]
    })
  }

  // Save connector
  const saveConnector = () => {
    if (!editingConnector) return
    // A connector needs EITHER a teleport target OR a typed action.
    if (!connectorForm.targetTemplateId && !connectorForm.action) return

    // ONE connector owns ALL the selected cells (fall back to the single clicked
    // cell when nothing is multi-selected).
    const selected = Array.from(selectedCellsRef.current).map(key => {
      const [col, row] = key.split(',').map(Number)
      return { col, row }
    })
    const cells = selected.length > 0 ? selected : [{ col: editingConnector.col, row: editingConnector.row }]

    const connector: Connector = {
      cells,
      targetTemplateId: connectorForm.targetTemplateId ?? '',
      targetTemplateName: savedTemplates.find(t => t.id === connectorForm.targetTemplateId)?.name,
      interaction: connectorForm.interaction || 'walk',
      spawnCol: connectorForm.spawnCol ?? 25,
      spawnRow: connectorForm.spawnRow ?? 25,
      action: connectorForm.action,
    }

    setConnectors(prev => {
      // Replace any connector that overlaps the new cell set (re-saving an edited one).
      const cellSet = new Set(cells.map(p => `${p.col},${p.row}`))
      const filtered = prev.filter(c => !c.cells.some(p => cellSet.has(`${p.col},${p.row}`)))
      return [...filtered, connector]
    })
    setEditingConnector(null)
    setConnectorForm({ interaction: 'walk', spawnCol: 25, spawnRow: 25 })
  }

  // Delete the connector that owns the given cell.
  const deleteConnector = (col: number, row: number) => {
    setConnectors(prev => prev.filter(c => !c.cells.some(p => p.col === col && p.row === row)))
    if (editingConnector?.col === col && editingConnector?.row === row) {
      setEditingConnector(null)
    }
  }

  // ── Entity placement ───────────────────────────────────────────────
  // One builder per placeable kind (dispatch map, not a switch). Each returns a
  // fresh Entity from the pure factory; the orchestrator below guards placement.
  const ENTITY_BUILDERS: Record<EntityKind, (col: number, row: number) => Entity> = {
    player: (col, row) => makePlayer(mintEntityId('player'), col, row),
    enemy: (col, row) => ({
      // Placed enemies get a default left-right patrol so they MOVE out of the box
      // (the mover waits when a waypoint is blocked/off-map); custom waypoint
      // authoring is a follow-up.
      ...makeEnemy(mintEntityId('enemy'), col, row, enemyType.trim() || 'enemy'),
      movement: { mode: 'sequential', waypoints: [{ col, row }, { col: col + 3, row }] },
    }),
    npc: (col, row) => makeNpc(mintEntityId('npc'), col, row, { name: npcName.trim() || undefined }),
  }

  /** Arm an entity tool (re-clicking the active one disarms it). Clears the
   *  selection + connector + building modes so placement and selection never fight. */
  const toggleEntityTool = (tool: Exclude<EntityTool, null>) => {
    setEntityTool(prev => (prev === tool ? null : tool))
    setConnectorMode(false)
    setEditingConnector(null)
    setSelectedCells(new Set())
    setBuildingTool(null)
    deselectBuilding()
  }

  // ── Manual building editor actions ──────────────────────────────────
  /** Highlight a building's whole footprint via the shared selectedCells outline. */
  const highlightBuilding = (b: GridBuilding) => {
    setSelectedCells(new Set(buildingFootprintCells(b).cells.map(c => `${c.col},${c.row}`)))
  }

  /** Drop the building selection + its highlight. */
  const deselectBuilding = () => {
    selectedBuildingIndexRef.current = null
    setSelectedBuildingIndex(null)
    setSelectedCells(new Set())
  }

  /** Arm a building tool (re-clicking the active one disarms it). Mutually exclusive
   *  with the entity / connector tools so clicks route to exactly one editor. */
  const toggleBuildingTool = (tool: Exclude<BuildingTool, null>) => {
    setBuildingTool(prev => (prev === tool ? null : tool))
    setEntityTool(null)
    setConnectorMode(false)
    setEditingConnector(null)
    deselectBuilding()
  }

  /** Re-stamp `idx` from `old`→`next` iff the new footprint is valid (in-bounds, clear
   *  of roads/water/other buildings). Returns whether it moved. Keeps the array index
   *  stable so the selection stays on the same building. */
  const tryReplaceBuilding = (grid: IsometricGrid, idx: number, old: GridBuilding, next: GridBuilding): boolean => {
    const zone = genZoneRef.current
    const ignore = new Set(buildingFootprintCells(old).cells.map(c => `${c.col},${c.row}`))
    if (!canPlaceBuilding(buildingPlacementEnv(grid, idx, ignore), next)) return false
    unstampBuildingCells(grid, old, zone)
    stampBuildingCells(grid, next, zone)
    grid.buildings[idx] = next
    highlightBuilding(next)
    bumpBuildingVersion()
    return true
  }

  /** Select the building whose footprint contains (col,row); clears selection if none. */
  const selectBuildingAt = (col: number, row: number) => {
    const grid = gridRef.current
    if (!grid) return
    const idx = grid.buildings.findIndex(b => footprintContains(b, col, row))
    if (idx < 0) { deselectBuilding(); return }
    selectedBuildingIndexRef.current = idx
    setSelectedBuildingIndex(idx)
    highlightBuilding(grid.buildings[idx])
    bumpBuildingVersion()
  }

  /** Place a fresh building of `type` centred on (col,row), facing the nearest road. */
  const placeNewBuilding = (type: BuildingType, col: number, row: number) => {
    const grid = gridRef.current
    if (!grid) return
    const b = makeBuilding(type, nearestRoadFacing(grid, col, row), col, row)
    if (!canPlaceBuilding(buildingPlacementEnv(grid, -1, new Set()), b)) {
      toast('Cannot place a building here — blocked, on a road, or out of bounds', 'warning')
      return
    }
    stampBuildingCells(grid, b, genZoneRef.current)
    grid.buildings.push(b)
    const idx = grid.buildings.length - 1
    selectedBuildingIndexRef.current = idx
    setSelectedBuildingIndex(idx)
    setBuildingTool('select') // hand off to select so it can be tweaked immediately
    highlightBuilding(b)
    bumpBuildingVersion()
  }

  /** Remove the building at grid index `idx` (assets + collision + grid.buildings). */
  const removeBuildingAt = (idx: number) => {
    const grid = gridRef.current
    if (!grid) return
    const b = grid.buildings[idx]
    if (!b) return
    unstampBuildingCells(grid, b, genZoneRef.current)
    grid.buildings.splice(idx, 1)
    deselectBuilding()
    bumpBuildingVersion()
  }

  /** Apply the armed building tool at (col,row): select / delete / place-<type>. */
  const applyBuildingTool = (col: number, row: number) => {
    const tool = buildingTool
    if (!tool) return
    if (tool === 'select') { selectBuildingAt(col, row); return }
    if (tool === 'delete') {
      const grid = gridRef.current
      if (!grid) return
      const idx = grid.buildings.findIndex(b => footprintContains(b, col, row))
      if (idx < 0) { toast('No building here to delete', 'info'); return }
      removeBuildingAt(idx)
      return
    }
    const type = BUILDING_TOOL_TYPE[tool]
    if (type) placeNewBuilding(type, col, row)
  }

  /** Move the selected building by a grid delta (arrow keys / re-anchor). */
  const moveSelectedBuilding = (dCol: number, dRow: number) => {
    const grid = gridRef.current
    const idx = selectedBuildingIndexRef.current
    if (!grid || idx == null) return
    const old = grid.buildings[idx]
    if (!old) return
    if (!tryReplaceBuilding(grid, idx, old, moveBuilding(old, dCol, dRow))) {
      toast('Cannot move there — blocked or out of bounds', 'warning')
    }
  }

  /** Rotate the selected building's facing south→east→north→west, re-stamped in place. */
  const rotateSelectedBuilding = () => {
    const grid = gridRef.current
    const idx = selectedBuildingIndexRef.current
    if (!grid || idx == null) return
    const old = grid.buildings[idx]
    if (!old) return
    if (!tryReplaceBuilding(grid, idx, old, rotateBuilding(old))) {
      toast('Cannot rotate — no room for the rotated footprint here', 'warning')
    }
  }

  /** Delete the currently selected building. */
  const deleteSelectedBuilding = () => {
    const idx = selectedBuildingIndexRef.current
    if (idx == null) return
    removeBuildingAt(idx)
  }

  // Keyboard for the selected building (mounted once; reads refs + stable callbacks).
  // Arrows nudge it a cell, R rotates, Delete removes, Esc deselects — only while the
  // Select tool holds a building, and never while typing in a field.
  useEffect(() => {
    const ARROW_DELTA: Record<string, [number, number]> = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    }
    const onKey = (e: KeyboardEvent) => {
      if (buildingToolRef.current !== 'select' || selectedBuildingIndexRef.current == null) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const delta = ARROW_DELTA[e.key]
      if (delta) { e.preventDefault(); moveSelectedBuilding(delta[0], delta[1]); return }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateSelectedBuilding(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedBuilding(); return }
      if (e.key === 'Escape') deselectBuilding()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Place or erase an entity at (col,row) for the armed tool, via the pure module. */
  const applyEntityTool = (col: number, row: number) => {
    const grid = gridRef.current
    if (!grid || !entityTool) return

    if (entityTool === 'erase') {
      setEntities(prev => {
        const target = entityAt(prev, col, row)
        return target ? removeEntity(prev, target.id) : prev
      })
      return
    }

    // Collision paint: toggle a cell blocked/walkable directly (easy manual control).
    if (entityTool === 'collision') {
      grid.setCollision(col, row, !grid.isBlocked(col, row))
      return
    }

    const collisionFn = (c: number, r: number) => !!grid.collision[r]?.[c]

    // The placed PLAYER entity defines where the play-loop player spawns: only one
    // player (replaces any existing), and the live player jumps to that cell.
    if (entityTool === 'player') {
      const base = entitiesRef.current.filter(e => e.kind !== 'player')
      if (!canPlaceEntity(base, col, row, grid.cols, grid.rows, collisionFn)) {
        toast('Cell is blocked, out of bounds, or already occupied', 'warning')
        return
      }
      setEntities(placeEntity(base, ENTITY_BUILDERS.player(col, row)))
      movePlayerToValidSpawn(col, row) // placed player entity → live player position
      return
    }

    setEntities(prev => {
      if (!canPlaceEntity(prev, col, row, grid.cols, grid.rows, collisionFn)) {
        toast('Cell is blocked, out of bounds, or already occupied', 'warning')
        return prev
      }
      return placeEntity(prev, ENTITY_BUILDERS[entityTool](col, row))
    })
  }

  // ── Selected-entity inspector actions ─────────────────────────────
  const patchSelectedEntity = (patch: Partial<Entity>) => {
    if (!selectedEntityId) return
    setEntities(prev => prev.map(e => (e.id === selectedEntityId ? { ...e, ...patch } : e)))
  }
  const deleteSelectedEntity = () => {
    if (!selectedEntityId) return
    setEntities(prev => removeEntity(prev, selectedEntityId))
    setSelectedEntityId(null)
  }

  // Scatter a handful of enemies (+ the odd NPC) into the stage's free cells, each
  // pre-set with stats + a movement pattern (see game/spawner.ts).
  const randomizeEntities = () => {
    const grid = gridRef.current
    if (!grid) return
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r)),
    )
    setEntities(prev => {
      const occupied = prev.map(e => ({ col: e.col, row: e.row }))
      const spawned = scatterEntities({
        collision,
        occupied,
        count: 16, // ~12 enemies + ~4 npc — enough per type to feed kill quests (respawn refills)
        kinds: ['enemy', 'enemy', 'enemy', 'npc'], // ~3:1 enemies to NPCs
        enemyTypes: ENEMY_TYPES, // group each type into its own map zone (goblins, wolves, …)
        idPrefix: `scatter-${prev.length}`,
      })
      return [...prev, ...spawned]
    })
  }

  // ── Quest authoring + runtime (spec §10) ───────────────────────────
  // Save the drafted quest against the chosen NPC: mint the Quest, store it, and
  // link the giver's questId so interacting with that NPC offers it. Pure module
  // (questFromDraft) builds the Quest; this just guards + commits to state.
  const saveQuest = () => {
    const quest = questFromDraft(questDraft)
    if (!quest) {
      toast('Pick a quest-giver NPC and a title first', 'warning')
      return
    }
    setQuests(prev => upsertQuest(prev, quest))
    setEntities(prev => prev.map(e => (e.id === quest.giverId ? { ...e, questId: quest.id } : e)))
    setQuestDraft(prev => ({ ...emptyQuestDraft(), giverId: prev.giverId }))
    toast(`Quest linked to giver: ${quest.title}`, 'success')
  }

  // ── Inventory actions ──────────────────────────────────────────────
  // Equip a weapon/armor item (the sync effect pushes the equipped weapon into
  // playerWeaponRef); use a consumable to apply its effect to the live combat state.
  const equipItem = (itemId: string) => {
    setInventory(prev => {
      const item = prev.items.find(i => i.id === itemId)
      if (item?.slot === 'weapon') return equipWeapon(prev, itemId)
      if (item?.slot === 'armor') return equipArmor(prev, itemId)
      return prev
    })
  }

  // Pick an archetype: equip a weapon of the matching kind from the bag (warrior =
  // sword/axe, magician = staff). The sync effect pushes it into playerWeaponRef.
  const setArchetype = (path: TalentPath) => {
    setTalentPath(path)
    const wantKinds = path === 'warrior' ? ['sword', 'axe', 'shield'] : ['staff']
    setInventory(prev => {
      if (prev.equippedWeapon && wantKinds.includes(prev.equippedWeapon.kind)) return prev
      const match = prev.items.find(i => i.slot === 'weapon' && wantKinds.includes(i.weapon.kind))
      return match ? equipWeapon(prev, match.id) : prev
    })
  }

  const useItem = (itemId: string) => {
    setInventory(prev => {
      const { inventory: next, effect } = useConsumable(prev, itemId)
      if (!effect) return prev
      const c = playerCombatRef.current
      playerCombatRef.current = {
        hp: effect.hp ? Math.min(DEFAULT_PLAYER_STATS.maxHp, c.hp + effect.hp) : c.hp,
        rage: c.rage + (effect.rage ?? 0),
        mana: c.mana + (effect.mana ?? 0),
      }
      return next
    })
  }

  // Grant a single reward to the player (dispatch by kind, not a branch chain).
  // xp bumps the counter; item rewards now drop into the inventory; stat rewards
  // aren't authored in the simple UI yet.
  const REWARD_GRANTERS: Record<Reward['kind'], (reward: Reward) => void> = {
    xp: (reward) => setPlayerXp(prev => prev + reward.amount),
    item: (reward) => setInventory(prev => addItem(prev, itemFromReward(reward, mintItemId()))),
    stat: () => { /* stat rewards not authored in the simple UI yet */ },
  }

  // Fold this frame's kills into every active quest; toast each newly-completed
  // quest so the player knows to head back. Pure recordEvent does the counting.
  const handleKills = useCallback((enemyTypes: readonly string[]) => {
    if (enemyTypes.length === 0) return
    setQuests(prev => {
      let next = prev
      for (const enemyType of enemyTypes) {
        next = applyQuestEvent(next, { kind: 'kill', enemyType })
      }
      announceNewlyCompleted(prev, next)
      return next
    })
  }, [])

  /** Feed a single quest event (travel/find) to active quests + announce completions. */
  const recordQuestEvent = useCallback((event: QuestEvent) => {
    setQuests(prev => {
      const next = applyQuestEvent(prev, event)
      if (next === prev) return prev
      announceNewlyCompleted(prev, next)
      return next
    })
  }, [])

  // Toast quests that flipped active → completed between two quest lists.
  const announceNewlyCompleted = (before: readonly Quest[], after: readonly Quest[]) => {
    for (const quest of after) {
      if (quest.state !== 'completed') continue
      const prior = before.find(q => q.id === quest.id)
      if (prior?.state === 'completed') continue
      toast(`Objective complete: ${quest.title}`, 'success')
    }
  }

  // Accept or turn in the quest of a giver NPC the player can reach. Reachable =
  // the NPC sits on or adjacent to the player's cell (interaction has melee reach).
  // Guard clauses keep the lifecycle flat: no giver → no quest → accept → turn-in.
  const handleQuestInteract = useCallback((pCol: number, pRow: number) => {
    // 'find' objectives: interacting on/next to an NPC counts as finding them.
    for (const e of entitiesRef.current) {
      if (e.kind === 'npc' && Math.abs(e.col - pCol) <= 1 && Math.abs(e.row - pRow) <= 1) {
        recordQuestEvent({ kind: 'find', npcId: e.id })
      }
    }
    const giver = reachableQuestGiver(entitiesRef.current, pCol, pRow)
    if (!giver) return
    const quest = questForGiver(questsRef.current, giver)
    if (!quest) return
    // available → open the OFFER modal (anchored above the giver) instead of
    // instant-accepting, so the player can read it and Accept/Reject (re-askable).
    if (quest.state === 'available') return setQuestGiveModal({ giverId: giver.id, anchor: questGiverAnchor(giver) })
    if (quest.state === 'completed') return turnInGiverQuest(quest)
    // active (not yet complete) or already turned_in — nothing to do but remind.
    if (quest.state === 'active') toast(`In progress: ${quest.title}`, 'info')
  }, [])

  // Project the giver's cell to a screen point ABOVE the figure for the offer modal,
  // matching the active view's projection; null when off-screen → modal centers.
  const questGiverAnchor = (giver: Entity): { x: number; y: number } | null => {
    const grid = gridRef.current
    const canvas = canvasRef.current
    if (!grid || !canvas) return null
    const view = topViewMode ? 'top' : viewTypeRef.current === '2d' ? '2d' : 'isometric'
    const pos = questAnchorScreenPos({
      view,
      cellSize: grid.cellSize,
      isoScale: grid.isoScale,
      player: { x: playerRef.current.x, z: playerRef.current.z },
      camOffset: camOffsetRef.current,
      isoZoom: isoZoomRef.current,
      topZoom: zoomRef.current,
      w: canvas.width,
      h: canvas.height,
    }, giver.col, giver.row)
    return pos ? { x: pos.x, y: pos.y - 28 } : null
  }

  const acceptGiverQuest = (quest: Quest) => {
    setQuests(prev => upsertQuest(prev, acceptQuest(quest)))
    toast(`Quest accepted: ${quest.title}`, 'success')
  }

  const turnInGiverQuest = (quest: Quest) => {
    const result = turnIn(quest)
    if (!result) return
    setQuests(prev => upsertQuest(prev, result.quest))
    for (const reward of result.rewards) {
      REWARD_GRANTERS[reward.kind](reward)
      toast(`Reward granted: ${rewardSummary(reward)}`, 'success')
    }
  }

  // Point the loop's quest hooks at the latest closures (the loop is mounted once).
  useEffect(() => {
    onKillsRef.current = handleKills
    questInteractRef.current = handleQuestInteract
    questEventRef.current = recordQuestEvent
  })

  // Resize grid function
  const resizeGrid = (cols: number, rows: number) => {
    const newConfig = { ...VILLAGE_CONFIG, cols, rows }
    gridRef.current = new IsometricGrid(newConfig)
    // Fill with grass by default
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        gridRef.current.setGround(c, r, 'grass')
      }
    }
    setGridSize({ cols, rows })
    // Reset player to valid spawn at center
    movePlayerToValidSpawn(Math.floor(cols / 2), Math.floor(rows / 2))
  }

  // Check if ground type is a road/path (buildings cannot be placed on these)
  const isRoadGround = (groundType: string | undefined): boolean => {
    if (!groundType) return false
    // Include all road-like ground types including themed versions
    const roadTypes = [
      'road', 'road_center', 'road_edge', 'plaza', 'path_stone', 'path_dirt', 'bridge',
      'snow_path', 'desert_road', 'wooden_planks', 'courtyard_stone'
    ]
    return roadTypes.includes(groundType)
  }

  // Place tile on selected cells
  const placeTile = (tileInfo: { char: string; type: 'ground' | 'asset'; groundType?: string; tileKey?: string }) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) {
      setSelectedTile(tileInfo)
      setSelectedComposite(null)
      setSelectedMultiAsset(null)
      setHeightEditMode(false)
      return
    }

    // Check if this is a building/structure asset
    const tileDef = tileInfo.tileKey ? TILES[tileInfo.tileKey] : null
    const assetType = tileDef?.category ?? getAssetType(tileInfo.char)
    const isBuilding = assetType === 'building'

    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      if (tileInfo.type === 'ground' && tileInfo.groundType) {
        grid.setGround(col, row, tileInfo.groundType)
      } else if (tileInfo.type === 'asset') {
        // Prevent buildings on roads
        const groundType = grid.ground[row]?.[col] || 'grass'
        if (isBuilding && isRoadGround(groundType)) {
          return // Skip this cell - can't place building on road
        }
        // Remove any existing asset at this location first
        grid.assets = grid.assets.filter(a => !(a.col === col && a.row === row))
        // Use tileset definition if available
        grid.placeAsset([tileInfo.char], col, row, {
          type: assetType,
          blocking: tileDef?.blocking ?? isBlockingAsset(tileInfo.char),
          color: tileDef?.fg ?? getAssetColor(tileInfo.char),
          bgColor: tileDef?.bg,
          height: getDefaultAssetHeight(tileInfo.char),
          tileKey: tileInfo.tileKey,
          opacity: placeOpacity < 1 ? placeOpacity : undefined,
        })
      }
    })
    setSelectedCells(new Set())
    setSelectedTile(null)
  }

  // Place a composite asset at the first selected cell
  const placeCompositeAsset = (assetKey: string) => {
    const grid = gridRef.current
    if (!grid) return

    // Get the composite asset definition
    const asset = COMPOSITE_ASSETS[assetKey]
    if (!asset) return

    // If no cells selected, just select the asset for next click
    if (selectedCells.size === 0) {
      setSelectedComposite(assetKey)
      setSelectedTile(null)
      setSelectedMultiAsset(null)
      setHeightEditMode(false)
      return
    }

    // Get the first selected cell as the anchor point
    const firstCell = Array.from(selectedCells)[0]
    const [col, row] = firstCell.split(',').map(Number)

    // Check if any target cell is on a road (buildings can't go there)
    if (asset.category === 'building') {
      for (const t of asset.tiles) {
        const targetCol = col + t.dx
        const targetRow = row + t.dy
        const groundType = grid.ground[targetRow]?.[targetCol] || 'grass'
        if (isRoadGround(groundType)) {
          return // Can't place building on road
        }
      }
    }

    // Build the tiles array with actual characters
    const tiles = asset.tiles.map(t => {
      const tileDef = TILES[t.tile]
      return {
        tile: t.tile,
        char: tileDef?.char ?? '?',
        dx: t.dx,
        dy: t.dy,
        height: t.height,
        color: t.colorOverride ?? tileDef?.fg,
        bgColor: tileDef?.bg,
        blocking: tileDef?.blocking ?? false,
        type: asset.category,
      }
    })

    // ONE cell selected → stamp the composite once at that anchor (its natural
    // size). A REGION selected → SCALE it to ONE instance spanning the selection
    // (select 10×10 + click "well" → a single 10×10 well, not a grid of wells).
    if (selectedCells.size <= 1) {
      grid.placeComposite(assetKey, tiles, col, row)
    } else {
      scaleCompositeToRegion(grid, tiles, selectedCells)
    }

    setSelectedCells(new Set())
    setSelectedComposite(null)
  }

  // Arm / place a multi-cell structure asset (house, tower, well…). With no cells
  // selected, clicking the palette ARMS it — the next click in Top view stamps it
  // (top-left = the clicked cell). With a cell already selected, stamp at that anchor.
  const placeMultiAsset = (assetId: string) => {
    const grid = gridRef.current
    const asset = multiCellAssetById(assetId)
    if (!grid || !asset) return

    if (selectedCells.size === 0) {
      setSelectedMultiAsset(assetId)
      setSelectedTile(null)
      setSelectedComposite(null)
      setHeightEditMode(false)
      return
    }

    const [col, row] = Array.from(selectedCells)[0].split(',').map(Number)
    const { w, h } = assetFootprint(asset)
    grid.assets = grid.assets.filter(
      a => !(a.col >= col && a.col < col + w && a.row >= row && a.row < row + h),
    )
    stampAsset(grid, asset, col, row)
    setSelectedCells(new Set())
    setSelectedMultiAsset(null)
  }


  // Toggle an animation in the author panel's in-progress cycle.
  const toggleAuthorAnim = (id: string) => {
    setAuthorAnims(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Apply the composed cycle to the asset(s) in the selected cell(s) → animates via the engine.
  const applyCycleToSelectedAsset = () => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0 || authorAnims.size === 0) return
    const cycle = makeCycle(
      `authored-${authorTriggerKind}`,
      Array.from(authorAnims),
      authorMode,
      authorDelay,
      makeTrigger(authorTriggerKind, authorTriggerState),
    )
    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      const asset = grid.assets.find(a => a.col === col && a.row === row)
      if (asset) asset.cycles = [cycle]
    })
  }

  // Place height on selected cells
  const placeHeight = (h: number) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) {
      setSelectedHeight(h)
      setHeightEditMode(true)
      return
    }

    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      grid.setHeight(col, row, h)
    })
    setSelectedCells(new Set())
  }

  // Default heights for different asset types
  const getDefaultAssetHeight = (char: string): number => {
    switch (char) {
      case '█': return 2  // Wall - 2 blocks tall
      case '▀': return 3  // Roof - 3 blocks tall (on top of walls)
      case '░': return 1  // Floor - 1 block tall
      case '@': return 3  // Tree - 3 blocks tall
      case '*': return 1  // Bush - 1 block tall
      case '!': return 2  // Lamp - 2 blocks tall
      case '☺': return 2  // NPC - 2 blocks tall
      default: return 1
    }
  }

  // Helper functions for asset properties
  const getAssetType = (char: string): string => {
    switch (char) {
      case '@': case '*': return 'tree'
      case '$': return 'crate'
      case '!': return 'lamp'
      case '+': return 'flower'
      case 'o': return 'decoration'
      case '█': case '▀': case '░': return 'building'
      case '☺': return 'npc'
      default: return 'decoration'
    }
  }

  const isBlockingAsset = (char: string): boolean => {
    return ['@', '*', '$', '!', 'o', '█', '▀', '☺'].includes(char)
  }

  const getAssetColor = (char: string): string => {
    switch (char) {
      case '@': return '#33cc33'
      case '*': return '#44bb44'
      case '$': return '#ddaa55'
      case '!': return '#ffff55'
      case '+': return '#ff88cc'
      case 'o': return '#888888'
      case '█': return '#aa7755'
      case '▀': return '#dd7755'
      case '░': return '#aa9977'
      case '☺': return '#ffdd00'
      default: return '#ffffff'
    }
  }

  // Layout templates - complete with buildings, trees, NPCs
  const applyTemplate = (template: string) => {
    const grid = gridRef.current
    if (!grid) return

    const cols = grid.cols
    const rows = grid.rows
    const cx = Math.floor(cols / 2)
    const cy = Math.floor(rows / 2)

    // Clear grid first
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid.setGround(c, r, 'grass')
        grid.setCollision(c, r, false)
        grid.setHeight(c, r, 0)
      }
    }
    grid.assets = []
    grid.buildings = [] // legacy template buildings are █ blocks, not grouped facades

    // Helper to place a building (3x3 with walls, elevated)
    const placeBuilding = (x: number, y: number, color: string = '#aa7755', height: number = 2) => {
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (x + dx < cols && y + dy < rows) {
            // Set cell height for the building footprint
            grid.setHeight(x + dx, y + dy, height)
            // Place wall asset on top
            grid.placeAsset(['█'], x + dx, y + dy, { type: 'building', blocking: true, color, height })
          }
        }
      }
    }

    // Helper to place a tower (2x2 with extra height)
    const placeTower = (x: number, y: number, color: string = '#666666', height: number = 4) => {
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (x + dx < cols && y + dy < rows) {
            grid.setHeight(x + dx, y + dy, height)
            grid.placeAsset(['█'], x + dx, y + dy, { type: 'building', blocking: true, color, height })
          }
        }
      }
    }

    // Helper to place trees in area (trees inherit cell height, not set their own)
    const placeTrees = (x: number, y: number, w: number, h: number, density: number = 0.15) => {
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (Math.random() < density && x + dx < cols && y + dy < rows) {
            const cell = grid.ground[y + dy]?.[x + dx]
            if (cell === 'grass') {
              grid.placeAsset(['@'], x + dx, y + dy, { type: 'tree', blocking: true, color: '#33cc33', height: 3 })
            }
          }
        }
      }
    }

    // Helper to place NPC
    const placeNPC = (x: number, y: number) => {
      if (x < cols && y < rows) {
        grid.placeAsset(['☺'], x, y, { type: 'npc', blocking: true, color: '#ffdd00' })
      }
    }

    switch (template) {
      case 'village':
        // Main roads - cross pattern
        grid.fillGround(cx - 1, 2, 3, rows - 4, 'road')
        grid.fillGround(2, cy - 1, cols - 4, 3, 'road')

        // Central plaza
        grid.fillGround(cx - 5, cy - 5, 11, 11, 'plaza')

        // Fountain in center
        grid.fillGround(cx - 1, cy - 1, 3, 3, 'water')

        // Buildings around plaza
        placeBuilding(cx - 10, cy - 2, '#aa7755')  // Left building
        placeBuilding(cx + 8, cy - 2, '#aa6644')   // Right building
        placeBuilding(cx - 2, cy - 10, '#997766')  // Top building
        placeBuilding(cx - 2, cy + 8, '#bb8866')   // Bottom building

        // Corner houses
        placeBuilding(4, 4, '#cc9966')
        placeBuilding(cols - 7, 4, '#aa8855')
        placeBuilding(4, rows - 7, '#bb9955')
        placeBuilding(cols - 7, rows - 7, '#aa7744')

        // Trees in corners
        placeTrees(2, 2, 8, 8, 0.2)
        placeTrees(cols - 10, 2, 8, 8, 0.2)
        placeTrees(2, rows - 10, 8, 8, 0.2)
        placeTrees(cols - 10, rows - 10, 8, 8, 0.2)

        // River on one side
        for (let r = 0; r < rows; r++) {
          const offset = Math.floor(Math.sin(r * 0.15) * 2)
          grid.fillGround(cols - 5 + offset, r, 3, 1, 'water')
        }
        // Bridge over river
        grid.fillGround(cols - 6, cy - 1, 5, 3, 'bridge')

        // Lamps along main roads
        grid.placeAsset(['!'], cx - 1, cy - 7, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx + 1, cy + 7, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx - 7, cy - 1, { type: 'lamp', blocking: true, color: '#ffff44' })
        grid.placeAsset(['!'], cx + 7, cy + 1, { type: 'lamp', blocking: true, color: '#ffff44' })

        // NPCs
        placeNPC(cx + 3, cy + 3)
        placeNPC(cx - 8, cy)
        placeNPC(6, 8)
        break

      case 'forest':
        // Winding path through forest
        let pathX = 2
        for (let r = 0; r < rows; r++) {
          pathX += Math.floor(Math.random() * 3) - 1
          pathX = Math.max(2, Math.min(cols - 4, pathX))
          grid.fillGround(pathX, r, 2, 1, 'road')
        }

        // Second path crossing
        let pathY = 2
        for (let c = 0; c < cols; c++) {
          pathY += Math.floor(Math.random() * 3) - 1
          pathY = Math.max(2, Math.min(rows - 4, pathY))
          grid.fillGround(c, pathY, 1, 2, 'road')
        }

        // Dense trees everywhere
        placeTrees(0, 0, cols, rows, 0.25)

        // Small clearing with cabin (height 2 for cozy cabin)
        grid.fillGround(cx - 4, cy - 4, 9, 9, 'grass')
        // Remove trees from clearing (they were placed, need to filter)
        grid.assets = grid.assets.filter(a => {
          const inClearing = a.col >= cx - 4 && a.col < cx + 5 && a.row >= cy - 4 && a.row < cy + 5
          return !inClearing || a.type !== 'tree'
        })
        placeBuilding(cx - 1, cy - 1, '#8b4513', 2)

        // Mushrooms and flowers
        for (let i = 0; i < 20; i++) {
          const x = Math.floor(Math.random() * cols)
          const y = Math.floor(Math.random() * rows)
          if (grid.ground[y]?.[x] === 'grass') {
            grid.placeAsset(['+'], x, y, { type: 'flower', color: Math.random() > 0.5 ? '#ff88cc' : '#ffaa44' })
          }
        }

        // Hermit NPC
        placeNPC(cx + 2, cy)
        break

      case 'castle':
        // Outer walls
        grid.fillGround(0, 0, cols, rows, 'plaza')

        // Castle walls (thick, height 3)
        for (let i = 0; i < 3; i++) {
          for (let c = 2; c < cols - 2; c++) {
            grid.setHeight(c, 2 + i, 3)
            grid.placeAsset(['█'], c, 2 + i, { type: 'building', blocking: true, color: '#666666', height: 3 })
            grid.setHeight(c, rows - 5 + i, 3)
            grid.placeAsset(['█'], c, rows - 5 + i, { type: 'building', blocking: true, color: '#666666', height: 3 })
          }
          for (let r = 2; r < rows - 2; r++) {
            grid.setHeight(2 + i, r, 3)
            grid.placeAsset(['█'], 2 + i, r, { type: 'building', blocking: true, color: '#666666', height: 3 })
            grid.setHeight(cols - 5 + i, r, 3)
            grid.placeAsset(['█'], cols - 5 + i, r, { type: 'building', blocking: true, color: '#666666', height: 3 })
          }
        }

        // Gate entrance (bottom) - clear height at gate
        grid.fillGround(cx - 2, rows - 5, 5, 3, 'road')
        grid.fillHeight(cx - 2, rows - 5, 5, 3, 0)
        // Remove wall blocks at gate
        grid.assets = grid.assets.filter(a => {
          const atGate = a.col >= cx - 2 && a.col < cx + 3 && a.row >= rows - 5
          return !atGate
        })

        // Inner courtyard
        grid.fillGround(8, 8, cols - 16, rows - 16, 'road')

        // Main keep (large building in center-back, height 4)
        for (let dy = 0; dy < 6; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            grid.setHeight(cx - 4 + dx, 8 + dy, 4)
            grid.placeAsset(['█'], cx - 4 + dx, 8 + dy, { type: 'building', blocking: true, color: '#777777', height: 4 })
          }
        }

        // Corner towers (height 5 - tallest structures)
        placeTower(6, 6, '#555555', 5)
        placeTower(cols - 8, 6, '#555555', 5)
        placeTower(6, rows - 8, '#555555', 5)
        placeTower(cols - 8, rows - 8, '#555555', 5)

        // Training grounds
        grid.fillGround(10, rows - 15, 8, 6, 'plaza')

        // Garden area
        grid.fillGround(cols - 18, rows - 15, 8, 6, 'grass')
        placeTrees(cols - 17, rows - 14, 6, 4, 0.3)

        // Well in courtyard
        grid.fillGround(cx - 1, cy + 2, 3, 3, 'water')

        // Guards (NPCs)
        placeNPC(cx - 3, rows - 8)
        placeNPC(cx + 3, rows - 8)
        placeNPC(8, 10)
        placeNPC(cols - 9, 10)
        break

      case 'beach':
        // Ocean on left (depth -1 for water)
        grid.fillGround(0, 0, Math.floor(cols * 0.35), rows, 'water')

        // Wavy shoreline
        for (let r = 0; r < rows; r++) {
          const waveOffset = Math.floor(Math.sin(r * 0.2) * 3 + Math.sin(r * 0.1) * 2)
          const sandStart = Math.floor(cols * 0.35) + waveOffset
          grid.fillGround(sandStart, r, 6, 1, 'road') // sand
        }

        // Beach huts (lower height 1 for beach style)
        placeBuilding(Math.floor(cols * 0.5), 5, '#dda050', 1)
        placeBuilding(Math.floor(cols * 0.5), rows - 8, '#cc9040', 1)

        // Palm trees along beach (tall trees)
        for (let r = 3; r < rows - 3; r += 5) {
          const x = Math.floor(cols * 0.42) + Math.floor(Math.random() * 4)
          grid.placeAsset(['@'], x, r, { type: 'tree', blocking: true, color: '#44aa44', height: 4 })
        }

        // Path from beach inland
        grid.fillGround(Math.floor(cols * 0.45), cy - 1, cols - Math.floor(cols * 0.45) - 2, 3, 'road')

        // Inland village (taller buildings)
        grid.fillGround(cols - 15, cy - 8, 12, 16, 'grass')
        placeBuilding(cols - 12, cy - 5, '#aa8866', 2)
        placeBuilding(cols - 12, cy + 3, '#bb9977', 2)
        placeTrees(cols - 14, cy - 7, 10, 14, 0.1)

        // Dock
        grid.fillGround(Math.floor(cols * 0.30), cy - 1, 6, 3, 'bridge')

        // Beach NPCs
        placeNPC(Math.floor(cols * 0.40), cy + 5)
        placeNPC(Math.floor(cols * 0.38), 8)
        break

      case 'island':
        // All water base
        grid.fillGround(0, 0, cols, rows, 'water')

        // Main island (circular)
        const radius = Math.min(cols, rows) * 0.35
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const dist = Math.sqrt((c - cx) ** 2 + (r - cy) ** 2)
            if (dist < radius - 2) {
              grid.setGround(c, r, 'grass')
            } else if (dist < radius) {
              grid.setGround(c, r, 'road') // beach ring
            }
          }
        }

        // Central village (main building height 3)
        grid.fillGround(cx - 4, cy - 4, 9, 9, 'plaza')
        placeBuilding(cx - 1, cy - 1, '#aa8855', 3)

        // Paths to edges
        grid.fillGround(cx - 1, cy - Math.floor(radius) + 2, 3, Math.floor(radius) - 5, 'road')
        grid.fillGround(cx - 1, cy + 3, 3, Math.floor(radius) - 5, 'road')

        // Trees around village
        placeTrees(cx - Math.floor(radius) + 3, cy - Math.floor(radius) + 3,
                   Math.floor(radius * 2) - 6, Math.floor(radius * 2) - 6, 0.12)
        // Clear trees from village area
        grid.assets = grid.assets.filter(a => {
          const inVillage = a.col >= cx - 5 && a.col < cx + 6 && a.row >= cy - 5 && a.row < cy + 6
          return !inVillage || a.type !== 'tree'
        })

        // Small dock
        grid.fillGround(cx - 1, cy + Math.floor(radius) - 1, 3, 4, 'bridge')

        // Boat (just a decoration)
        grid.placeAsset(['$'], cx, cy + Math.floor(radius) + 2, { type: 'crate', blocking: true, color: '#8b4513' })

        // Island NPCs
        placeNPC(cx + 3, cy)
        placeNPC(cx - 2, cy + 4)
        break
    }

    // Move player to valid spawn point near center
    movePlayerToValidSpawn(cx, cy)
    setSelectedCells(new Set())
  }

  // ═══════════════════════════════════════════════════════════════════
  // THEME COLOR SYSTEM - Returns theme-appropriate colors for all assets
  // ═══════════════════════════════════════════════════════════════════
  interface ThemeColors {
    // Ground types to use
    baseGround: string
    tallGround: string
    roadGround: string
    plazaGround: string
    waterGround: string
    // Building colors
    buildingColors: string[]
    wallColor: string
    // Nature colors
    treeColor: string
    bushColor: string
    flowerColors: string[]
    rockColor: string
    // Special elements
    lampColor: string
  }

  const getThemeColors = (theme: TemplateTheme, groundType: string): ThemeColors => {
    // Default colors
    const defaults: ThemeColors = {
      baseGround: 'grass',
      tallGround: 'grass_tall',
      roadGround: 'road',
      plazaGround: 'plaza',
      waterGround: 'water',
      buildingColors: ['#aa7755', '#aa6644', '#997766', '#bb8866', '#8b7355', '#cc9977', '#886655'],
      wallColor: '#555566',
      treeColor: '#33cc33',
      bushColor: '#22aa22',
      flowerColors: ['#ff88cc', '#ffaa44'],
      rockColor: '#888888',
      lampColor: '#ffff44',
    }

    // Theme-specific overrides
    switch (theme) {
      // ICE/SNOW THEMES
      case 'ice':
        return {
          ...defaults,
          baseGround: 'snow',
          tallGround: 'snow_deep',
          roadGround: 'snow_path',
          plazaGround: 'ice',
          waterGround: 'frozen_water',
          buildingColors: ['#ccddee', '#bbccdd', '#aabbcc', '#99aabb', '#ddeeff'],
          wallColor: '#8899aa',
          treeColor: '#557788', // Frosted evergreens
          bushColor: '#668899',
          flowerColors: ['#aaddff', '#88ccff'], // Ice crystals
          rockColor: '#99aacc',
          lampColor: '#aaddff',
        }

      // DESERT THEMES
      case 'desert':
        return {
          ...defaults,
          baseGround: 'sand',
          tallGround: 'sand_dune',
          roadGround: 'desert_road',
          plazaGround: 'sandstone',
          waterGround: 'oasis',
          buildingColors: ['#ddbb88', '#ccaa77', '#eeccaa', '#ddaa66', '#c9a55c'],
          wallColor: '#aa8855',
          treeColor: '#77aa44', // Palm trees
          bushColor: '#889944', // Desert shrubs
          flowerColors: ['#ffcc44', '#ff9944'], // Desert flowers
          rockColor: '#aa9966',
          lampColor: '#ffdd88',
        }

      // EGYPTIAN THEME
      case 'egyptian':
        return {
          ...defaults,
          baseGround: 'sand',
          tallGround: 'sand_dune',
          roadGround: 'desert_road',
          plazaGround: 'hieroglyph_floor',
          waterGround: 'oasis',
          buildingColors: ['#ffdd88', '#eebb55', '#ddaa44', '#ccaa66', '#c9a55c'], // Golden sandstone
          wallColor: '#ddaa55',
          treeColor: '#669944', // Date palms
          bushColor: '#778844',
          flowerColors: ['#ffcc00', '#ff8800'], // Golden accents
          rockColor: '#ddbb77',
          lampColor: '#ffcc44',
        }

      // VOLCANIC THEMES
      case 'volcanic':
        return {
          ...defaults,
          baseGround: 'volcanic_rock',
          tallGround: 'ash',
          roadGround: 'obsidian',
          plazaGround: 'volcanic_rock',
          waterGround: 'lava',
          buildingColors: ['#443322', '#332211', '#554433', '#221100', '#3a2a1a'],
          wallColor: '#221111',
          treeColor: '#553322', // Dead trees
          bushColor: '#442211',
          flowerColors: ['#ff6600', '#ff3300'], // Fire flowers
          rockColor: '#444444',
          lampColor: '#ff8833',
        }

      // CAVE THEMES
      case 'cave':
        return {
          ...defaults,
          baseGround: 'cave_floor',
          tallGround: 'cave_moss',
          roadGround: 'ancient_stone',
          plazaGround: 'rune_floor',
          waterGround: 'water_deep',
          buildingColors: ['#555544', '#444433', '#666655', '#555533', '#4a4a3a'],
          wallColor: '#333322',
          treeColor: '#446633', // Mushrooms
          bushColor: '#558844', // Cave moss
          flowerColors: ['#99ccff', '#cc99ff'], // Glowing crystals
          rockColor: '#666655',
          lampColor: '#88ccff',
        }

      // CRYPT/CEMETERY THEMES
      case 'crypt':
        return {
          ...defaults,
          baseGround: groundType === 'grass' ? 'dead_grass' : 'crypt_floor',
          tallGround: 'dead_grass',
          roadGround: 'grave_dirt',
          plazaGround: 'crypt_floor',
          waterGround: 'water_deep',
          buildingColors: ['#555555', '#444444', '#666666', '#3a3a3a', '#4a4a4a'],
          wallColor: '#333333',
          treeColor: '#334422', // Dead trees
          bushColor: '#223311',
          flowerColors: ['#553355', '#442244'], // Dead flowers
          rockColor: '#555544',
          lampColor: '#aacc88',
        }

      // UNDERWATER THEME
      case 'underwater':
        return {
          ...defaults,
          baseGround: 'seafloor',
          tallGround: 'seaweed',
          roadGround: 'coral',
          plazaGround: 'ancient_stone',
          waterGround: 'water_deep',
          buildingColors: ['#557799', '#446688', '#668899', '#336677', '#5588aa'],
          wallColor: '#335566',
          treeColor: '#44aa77', // Kelp
          bushColor: '#33bb88', // Sea plants
          flowerColors: ['#ff88aa', '#ffaacc'], // Coral
          rockColor: '#667788',
          lampColor: '#88ffff',
        }

      // TEMPLE THEMES
      case 'temple':
        return {
          ...defaults,
          baseGround: 'grass',
          tallGround: 'cave_moss',
          roadGround: 'path_stone',
          plazaGround: 'ancient_stone',
          waterGround: 'water',
          buildingColors: ['#888877', '#777766', '#999988', '#666655', '#7a7a6a'],
          wallColor: '#555544',
          treeColor: '#338833', // Overgrown vines
          bushColor: '#449944',
          flowerColors: ['#aabb88', '#99aa77'], // Moss flowers
          rockColor: '#777766',
          lampColor: '#aadd88',
        }

      // ITALIAN THEME
      case 'italian':
        return {
          ...defaults,
          baseGround: 'olive_grove',
          tallGround: 'grass_tall',
          roadGround: 'path_stone',
          plazaGround: 'terracotta',
          waterGround: 'water',
          buildingColors: ['#ddaa77', '#cc9966', '#eebb88', '#dd9955', '#c9a077'],
          wallColor: '#aa7744',
          treeColor: '#557733', // Olive trees
          bushColor: '#668844',
          flowerColors: ['#ff6688', '#ffaa66'],
          rockColor: '#ccbbaa',
          lampColor: '#ffdd66',
        }

      // CHINESE THEME
      case 'chinese':
        return {
          ...defaults,
          baseGround: 'bamboo_floor',
          tallGround: 'grass_tall',
          roadGround: 'path_stone',
          plazaGround: 'red_lacquer',
          waterGround: 'koi_pond',
          buildingColors: ['#cc3333', '#dd4444', '#bb2222', '#aa1111', '#cc2222'], // Red buildings
          wallColor: '#aa2222',
          treeColor: '#448844', // Bamboo
          bushColor: '#55aa55',
          flowerColors: ['#ffcc00', '#ff6666'], // Red/gold lanterns
          rockColor: '#666666',
          lampColor: '#ffcc00',
        }

      // SPANISH THEME
      case 'spanish':
        return {
          ...defaults,
          baseGround: 'grass',
          tallGround: 'grass_tall',
          roadGround: 'courtyard_stone',
          plazaGround: 'spanish_tile',
          waterGround: 'water',
          buildingColors: ['#ffffff', '#fff8ee', '#ffeecc', '#ffeedd', '#f8f0e0'], // White walls
          wallColor: '#eeeeee',
          treeColor: '#557744',
          bushColor: '#668855',
          flowerColors: ['#ff5555', '#ff8855'], // Red/orange
          rockColor: '#ccbbaa',
          lampColor: '#ffcc66',
        }

      // RUSSIAN THEME
      case 'russian':
        return {
          ...defaults,
          baseGround: 'snow',
          tallGround: 'birch_forest',
          roadGround: 'snow_path',
          plazaGround: 'russian_red',
          waterGround: 'frozen_water',
          buildingColors: ['#aa3322', '#993311', '#bb4433', '#cc5544', '#aa2211'], // Red buildings
          wallColor: '#882211',
          treeColor: '#eeeecc', // Birch trees
          bushColor: '#557755',
          flowerColors: ['#ffffff', '#eeeeff'],
          rockColor: '#888899',
          lampColor: '#ffdd88',
        }

      // JAPANESE THEME
      case 'japanese':
        return {
          ...defaults,
          baseGround: 'zen_garden',
          tallGround: 'sakura_petals',
          roadGround: 'path_stone',
          plazaGround: 'tatami',
          waterGround: 'koi_pond',
          buildingColors: ['#996644', '#885533', '#aa7755', '#774422', '#8a6544'], // Natural wood
          wallColor: '#664422',
          treeColor: '#ffaacc', // Cherry blossom
          bushColor: '#558844',
          flowerColors: ['#ffccdd', '#ff99bb'], // Pink flowers
          rockColor: '#888877',
          lampColor: '#ffeecc',
        }

      // AFRICAN THEME
      case 'african':
        return {
          ...defaults,
          baseGround: 'savanna',
          tallGround: 'savanna',
          roadGround: 'red_earth',
          plazaGround: 'mud_hut',
          waterGround: 'water',
          buildingColors: ['#aa7744', '#996633', '#bb8855', '#885522', '#9a6b3e'],
          wallColor: '#775533',
          treeColor: '#667744', // Acacia
          bushColor: '#888855',
          flowerColors: ['#ffcc44', '#ff9944'],
          rockColor: '#aa8866',
          lampColor: '#ffaa55',
        }

      // VENEZUELAN THEME
      case 'venezuelan':
        return {
          ...defaults,
          baseGround: 'tropical_grass',
          tallGround: 'tropical_grass',
          roadGround: 'path_dirt',
          plazaGround: 'colorful_tile',
          waterGround: 'water',
          buildingColors: ['#ffcc44', '#44ccff', '#ff6688', '#88ff66', '#ff9944'], // Colorful houses
          wallColor: '#ffffff',
          treeColor: '#33bb33', // Palm trees
          bushColor: '#44cc44',
          flowerColors: ['#ff66aa', '#ffaa44', '#44ddff'],
          rockColor: '#888877',
          lampColor: '#ffff66',
        }

      // PERUVIAN THEME
      case 'peruvian':
        return {
          ...defaults,
          baseGround: 'grass',
          tallGround: 'pampas',
          roadGround: 'inca_stone',
          plazaGround: 'inca_stone',
          waterGround: 'water',
          buildingColors: ['#887766', '#776655', '#998877', '#665544', '#7a6b5a'],
          wallColor: '#554433',
          treeColor: '#557744',
          bushColor: '#668855',
          flowerColors: ['#ff6644', '#ffaa44'],
          rockColor: '#666655',
          lampColor: '#ffcc66',
        }

      // ARGENTINIAN THEME
      case 'argentinian':
        return {
          ...defaults,
          baseGround: 'pampas',
          tallGround: 'pampas',
          roadGround: 'path_dirt',
          plazaGround: 'path_stone',
          waterGround: 'water',
          buildingColors: ['#ddccbb', '#ccbbaa', '#eeddcc', '#bbaa99', '#d0c0b0'],
          wallColor: '#aa9988',
          treeColor: '#557744',
          bushColor: '#778855',
          flowerColors: ['#ffaacc', '#ffcc88'],
          rockColor: '#888877',
          lampColor: '#ffdd88',
        }

      // AMERICAN FRONTIER THEME
      case 'american':
        return {
          ...defaults,
          baseGround: 'prairie',
          tallGround: 'prairie',
          roadGround: 'path_dirt',
          plazaGround: 'wooden_planks',
          waterGround: 'water',
          buildingColors: ['#aa7744', '#996633', '#bb8855', '#885522', '#9a7040'],
          wallColor: '#774422',
          treeColor: '#557744',
          bushColor: '#888855',
          flowerColors: ['#ffcc44', '#ffaa55'],
          rockColor: '#887766',
          lampColor: '#ffcc44',
        }

      // MEXICAN THEME
      case 'mexican':
        return {
          ...defaults,
          baseGround: 'sand',
          tallGround: 'sand_dune',
          roadGround: 'path_dirt',
          plazaGround: 'adobe',
          waterGround: 'water',
          buildingColors: ['#ffcc66', '#ff9944', '#ff6688', '#88ddff', '#ddaa55'], // Vibrant colors
          wallColor: '#ddaa55',
          treeColor: '#557744', // Cacti
          bushColor: '#669955',
          flowerColors: ['#ff5566', '#ffaa44', '#ff6688'],
          rockColor: '#aa8866',
          lampColor: '#ffcc44',
        }

      // AUSTRALIAN OUTBACK THEME
      case 'australian':
        return {
          ...defaults,
          baseGround: 'outback_red',
          tallGround: 'outback_red',
          roadGround: 'path_dirt',
          plazaGround: 'sandstone',
          waterGround: 'water',
          buildingColors: ['#aa7755', '#996644', '#bb8866', '#885533', '#9a7050'],
          wallColor: '#775533',
          treeColor: '#668877', // Eucalyptus
          bushColor: '#779966',
          flowerColors: ['#ffcc44', '#ff8844'],
          rockColor: '#aa6633',
          lampColor: '#ffaa55',
        }

      default:
        return defaults
    }
  }

  // Random map generator using TEMPLATE_PRESETS system
  // Pipeline: grid → roads → buildings around roads → nature → collisions → NPCs
  // ── Stage generation (zone × variant) — randomized on click ──
  const applyStageToGrid = (stage: StageData, grid: IsometricGrid) => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        grid.ground[r][c] = stage.ground[r]?.[c] ?? 'ash'
        grid.height[r][c] = 0
        grid.collision[r][c] = stage.collision[r]?.[c] ? 1 : 0
      }
    }
    grid.assets = []
    // Group the facades for the ISO view (one upright unit per building). 2D keeps using the
    // per-cell assets below; iso renders from grid.buildings and skips those per-cell draws.
    grid.buildings = stage.buildings.map(b => ({
      col: b.col,
      row: b.row,
      length: b.length,
      height: b.height,
      depth: b.depth,
      type: b.type,
      cells: b.facade.cells,
      // Orient the iso billboard by the planner's REAL road-derived facing (door toward the road):
      // horizontal-street houses run along +col (axis 0), vertical-road houses along -row (axis 1).
      facing: isoFacingIndex(b.facing),
      // North/west houses front a road on their camera-far side → draw the door on the back face
      // so it never points at the near grass (revealed by proximity transparency on approach).
      facadeOnBack: isoFacadeOnBack(b.facing),
    }))
    const paint = stagePaint(stage)
    for (const g of paint.ground) {
      if (grid.ground[g.row]?.[g.col] !== undefined) grid.ground[g.row][g.col] = g.type
    }
    for (const a of paint.assets) {
      grid.placeAsset([a.char], a.col, a.row, { type: a.type, blocking: a.blocking, color: a.color, label: a.label, baseShadow: a.baseShadow, buildingType: a.buildingType })
    }
    // Mirror the generator's authoritative collision into the grid so trees/water/
    // features are truly blocked — enemies (manual placement + scatter) only land on
    // walkable cells, and patrols collide correctly.
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (stage.collision[r]?.[c] !== undefined) grid.setCollision(c, r, stage.collision[r][c])
      }
    }
  }

  const generateStageInEditor = (zone: ZoneId, variant: VariantId) => {
    // A city is a big settlement — give it a markedly larger grid (~1.7× town linear) so it READS
    // bigger on screen, on top of the denser street grid + ~4× building cap in villageLayout. Town,
    // forest and the rest stay on the modest default grid.
    const big = variant === 'city'
    const cols = big ? 52 + Math.floor(Math.random() * 20) : 30 + Math.floor(Math.random() * 16) // city 52–71, else 30–45
    const rows = big ? 42 + Math.floor(Math.random() * 16) : 24 + Math.floor(Math.random() * 12) // city 42–57, else 24–35
    resizeGrid(cols, rows)
    const grid = gridRef.current
    if (!grid) return
    const stage = generateStage({ zone, variant, cols: grid.cols, rows: grid.rows })
    applyStageToGrid(stage, grid)
    movePlayerToValidSpawn(stage.spawn.col, stage.spawn.row)
    const live = livePlayerCell()
    syncPlayerEntity(live.col, live.row, true) // fresh stage → player entity follows the spawn
    setSelectedCells(new Set())
    deselectBuilding() // building indices were rebuilt → drop any stale selection
  }

  const generateRandomMap = (presetId: string = 'village-small') => {
    const preset = TEMPLATE_PRESETS[presetId] || TEMPLATE_PRESETS['village-small']
    const seed = Math.random() * 10000

    // Get theme-specific colors
    const themeColors = getThemeColors(preset.theme, preset.groundType)

    // === STEP 0: Resize grid based on preset ===
    const cols = preset.cols.min + Math.floor(Math.random() * (preset.cols.max - preset.cols.min))
    const rows = preset.rows.min + Math.floor(Math.random() * (preset.rows.max - preset.rows.min))
    resizeGrid(cols, rows)

    // IMPORTANT: Get grid reference AFTER resizeGrid creates new grid
    const grid = gridRef.current
    if (!grid) return
    const cx = Math.floor(cols / 2)
    const cy = Math.floor(rows / 2)

    // Seeded random for reproducible noise
    const seededRandom = (x: number, y: number): number => {
      const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453
      return n - Math.floor(n)
    }

    // Smooth noise for natural terrain formations
    const smoothNoise = (x: number, y: number, scale: number): number => {
      const sx = x / scale
      const sy = y / scale
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const n00 = seededRandom(x0, y0)
      const n10 = seededRandom(x0 + 1, y0)
      const n01 = seededRandom(x0, y0 + 1)
      const n11 = seededRandom(x0 + 1, y0 + 1)
      const nx0 = n00 * (1 - fx) + n10 * fx
      const nx1 = n01 * (1 - fx) + n11 * fx
      return nx0 * (1 - fy) + nx1 * fy
    }

    // Ground type mapping for themes - now uses themeColors
    const getBaseGround = (): string => themeColors.baseGround

    // === STEP 1: Clear grid with natural ground formations ===
    grid.assets = []
    grid.buildings = [] // random-map buildings are █ blocks, not grouped facades
    const baseGround = getBaseGround()
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (preset.type === 'interior') {
          grid.setGround(c, r, baseGround)
        } else {
          // Natural ground patches using noise - use theme-specific ground types
          const groundNoise = smoothNoise(c, r, 8)
          const groundType = groundNoise > 0.6 ? themeColors.tallGround : themeColors.baseGround
          grid.setGround(c, r, groundType)
        }
        grid.setCollision(c, r, false)
        grid.setHeight(c, r, 0)
      }
    }

    // === STEP 2: Walls for interior maps ===
    if (preset.walls?.enabled && preset.type === 'interior') {
      const thickness = preset.walls.thickness
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isWall = c < thickness || c >= cols - thickness ||
                         r < thickness || r >= rows - thickness
          if (isWall) {
            // walls block access but do not raise terrain (blocks = collision, not elevation)
            grid.setCollision(c, r, true)
            grid.placeAsset(['█'], c, r, {
              type: 'wall', blocking: true, color: themeColors.wallColor, height: 3
            })
          }
        }
      }
    }

    // === STEP 3: Water features (using theme-appropriate water type) ===
    const waterType = themeColors.waterGround

    if (preset.water.type === 'river') {
      const riverSide = Math.floor(Math.random() * 4)
      let rx = riverSide === 0 ? 0 : riverSide === 1 ? cols - 1 : Math.floor(Math.random() * cols)
      let ry = riverSide === 2 ? 0 : riverSide === 3 ? rows - 1 : Math.floor(Math.random() * rows)

      for (let i = 0; i < Math.max(cols, rows); i++) {
        for (let w = -1; w <= 1; w++) {
          if (rx + w >= 0 && rx + w < cols && ry >= 0 && ry < rows) {
            grid.setGround(rx + w, ry, waterType)
          }
        }
        rx += Math.floor(Math.random() * 3) - 1 + (rx < cx ? 0.3 : -0.3)
        ry += Math.floor(Math.random() * 3) - 1 + (ry < cy ? 0.3 : -0.3)
        rx = Math.max(0, Math.min(cols - 1, Math.floor(rx)))
        ry = Math.max(0, Math.min(rows - 1, Math.floor(ry)))
        if (rx <= 0 || rx >= cols - 1 || ry <= 0 || ry >= rows - 1) break
      }
    }

    if (preset.water.type === 'lake' || preset.water.type === 'river') {
      const lakeX = Math.floor(Math.random() * (cols - 12)) + 6
      const lakeY = Math.floor(Math.random() * (rows - 12)) + 6
      const lakeR = 3 + Math.floor(Math.random() * 4)
      for (let r = -lakeR; r <= lakeR; r++) {
        for (let c = -lakeR; c <= lakeR; c++) {
          if (c * c + r * r < lakeR * lakeR) {
            const px = lakeX + c
            const py = lakeY + r
            if (px >= 0 && px < cols && py >= 0 && py < rows) {
              grid.setGround(px, py, waterType)
            }
          }
        }
      }
    }

    if (preset.water.type === 'moat') {
      // Randomize moat shape slightly
      const moatDist = Math.min(cols, rows) * (0.30 + Math.random() * 0.1)
      const moatOffsetX = Math.floor(Math.random() * 6) - 3
      const moatOffsetY = Math.floor(Math.random() * 6) - 3
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = Math.abs(c - (cx + moatOffsetX))
          const dy = Math.abs(r - (cy + moatOffsetY))
          const chebyshev = Math.max(dx, dy)
          // Add noise to moat edges
          const noise = smoothNoise(c, r, 4) * 2
          if (chebyshev >= moatDist - 2 + noise && chebyshev <= moatDist + 1 + noise) {
            grid.setGround(c, r, waterType)
          }
        }
      }
    }

    // === STEP 4: Generate roads based on pattern ===
    // Randomize road positions significantly
    let roadX = cx + Math.floor(Math.random() * 10) - 5
    let roadY = cy + Math.floor(Math.random() * 10) - 5
    // Ensure minimum road width of 3 for visual depth (center + edges)
    const roadWidth = Math.max(3, preset.roads.width)

    // Helper: Set road tile with center/edge contrast
    // w is the offset from the road start, totalWidth is the road width
    const setRoadTile = (col: number, row: number, w: number, totalWidth: number) => {
      if (col < 0 || col >= cols || row < 0 || row >= rows) return
      if (grid.ground[row]?.[col] === 'water') return

      // Determine if this is an edge or center tile
      // For width 3: edges are 0 and 2, center is 1
      // For width 4+: edges are 0 and totalWidth-1, center is middle tiles
      const isEdge = (w === 0 || w === totalWidth - 1)
      const groundType = isEdge ? 'road_edge' : 'road_center'
      grid.setGround(col, row, groundType)
    }

    if (preset.roads.enabled && preset.roads.pattern !== 'none') {
      if (preset.roads.pattern === 'cross') {
        // Horizontal road
        for (let c = 3; c < cols - 3; c++) {
          for (let w = 0; w < roadWidth; w++) {
            const r = roadY + w
            setRoadTile(c, r, w, roadWidth)
          }
        }
        // Vertical road
        for (let r = 3; r < rows - 3; r++) {
          for (let w = 0; w < roadWidth; w++) {
            const c = roadX + w
            setRoadTile(c, r, w, roadWidth)
          }
        }
      } else if (preset.roads.pattern === 'grid') {
        // Randomize grid spacing and offset
        const baseSpacing = preset.size === 'large' ? 15 : preset.size === 'medium' ? 12 : 10
        const gridSpacing = baseSpacing + Math.floor(Math.random() * 4) - 2
        const offsetX = Math.floor(Math.random() * (gridSpacing / 2))
        const offsetY = Math.floor(Math.random() * (gridSpacing / 2))

        // Horizontal roads
        for (let row = offsetY + gridSpacing; row < rows - 5; row += gridSpacing) {
          for (let c = 3; c < cols - 3; c++) {
            for (let w = 0; w < roadWidth; w++) {
              const r = row + w
              setRoadTile(c, r, w, roadWidth)
            }
          }
        }
        // Vertical roads
        for (let col = offsetX + gridSpacing; col < cols - 5; col += gridSpacing) {
          for (let r = 3; r < rows - 3; r++) {
            for (let w = 0; w < roadWidth; w++) {
              const c = col + w
              setRoadTile(c, r, w, roadWidth)
            }
          }
        }
        roadX = offsetX + gridSpacing
        roadY = offsetY + gridSpacing
      } else if (preset.roads.pattern === 'winding') {
        // Winding path - randomly horizontal or vertical
        const isHorizontal = Math.random() > 0.5
        if (isHorizontal) {
          let px = 3
          let py = 5 + Math.floor(Math.random() * (rows - 12))
          while (px < cols - 4) {
            for (let w = 0; w < roadWidth; w++) {
              setRoadTile(px, py + w, w, roadWidth)
            }
            px++
            py += Math.floor(Math.random() * 3) - 1
            py = Math.max(4, Math.min(rows - 5 - roadWidth, py))
          }
          roadY = py
          roadX = cx
        } else {
          let px = 5 + Math.floor(Math.random() * (cols - 12))
          let py = 3
          while (py < rows - 4) {
            for (let w = 0; w < roadWidth; w++) {
              setRoadTile(px + w, py, w, roadWidth)
            }
            py++
            px += Math.floor(Math.random() * 3) - 1
            px = Math.max(4, Math.min(cols - 5 - roadWidth, px))
          }
          roadX = px
          roadY = cy
        }
      } else if (preset.roads.pattern === 'single') {
        // Single road - randomly horizontal or vertical
        const isHorizontal = Math.random() > 0.5
        const offset = Math.floor(Math.random() * 10) - 5
        if (isHorizontal) {
          const roadRow = cy + offset
          for (let c = 3; c < cols - 3; c++) {
            for (let w = 0; w < roadWidth; w++) {
              const r = roadRow + w
              setRoadTile(c, r, w, roadWidth)
            }
          }
          roadY = roadRow
        } else {
          const roadCol = cx + offset
          for (let r = 3; r < rows - 3; r++) {
            for (let w = 0; w < roadWidth; w++) {
              const c = roadCol + w
              setRoadTile(c, r, w, roadWidth)
            }
          }
          roadX = roadCol
        }
      }

      // Add bridges over water crossings
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid.ground[r]?.[c] === 'water') {
            const adjRoad = [-1, 0, 1].some(dr =>
              [-1, 0, 1].some(dc => {
                const g = grid.ground[r + dr]?.[c + dc]
                return g === 'road' || g === 'road_center' || g === 'road_edge'
              })
            )
            if (adjRoad) {
              grid.setGround(c, r, 'bridge')
            }
          }
        }
      }
    }

    // === STEP 5: Plaza/town center (using theme-appropriate ground) ===
    const plazaOffset = Math.floor(Math.random() * 4) - 2
    const plazaSize = 10 + Math.floor(Math.random() * 4)
    const townX = roadX - Math.floor(plazaSize / 2) + plazaOffset
    const townY = roadY - Math.floor(plazaSize / 2) + plazaOffset
    if (preset.buildings.hasPlaza && preset.roads.enabled) {
      grid.fillGround(townX, townY, plazaSize, plazaSize, themeColors.plazaGround)
      // Center fountain/well with random position
      const fountainOffset = Math.floor(plazaSize / 2) - 1
      const fountainX = townX + fountainOffset + Math.floor(Math.random() * 2)
      const fountainY = townY + fountainOffset + Math.floor(Math.random() * 2)
      grid.fillGround(fountainX, fountainY, 2, 2, waterType)
      // Lamps at random corners
      const lampPositions = [
        { x: townX + 1, y: townY + 1 },
        { x: townX + plazaSize - 2, y: townY + 1 },
        { x: townX + 1, y: townY + plazaSize - 2 },
        { x: townX + plazaSize - 2, y: townY + plazaSize - 2 },
      ]
      // Place 2-4 lamps randomly
      const numLamps = 2 + Math.floor(Math.random() * 3)
      const shuffledLamps = lampPositions.sort(() => Math.random() - 0.5)
      for (let i = 0; i < numLamps && i < shuffledLamps.length; i++) {
        grid.placeAsset(['!'], shuffledLamps[i].x, shuffledLamps[i].y, { type: 'lamp', blocking: true, color: themeColors.lampColor, height: 2 })
      }
    }

    // === STEP 6: Buildings (positioned around roads, never ON roads) ===
    const numBuildings = preset.buildings.count.min +
      Math.floor(Math.random() * (preset.buildings.count.max - preset.buildings.count.min + 1))

    if (numBuildings > 0) {
      const validSpots: Array<{ x: number; y: number }> = []

      if (preset.buildings.hasPlaza) {
        // Place around plaza corners with random offset
        const offsetRange = 2
        validSpots.push(
          { x: townX + 1 + Math.floor(Math.random() * offsetRange), y: townY + 1 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 7 + Math.floor(Math.random() * offsetRange), y: townY + 1 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 1 + Math.floor(Math.random() * offsetRange), y: townY + 7 + Math.floor(Math.random() * offsetRange) },
          { x: townX + 7 + Math.floor(Math.random() * offsetRange), y: townY + 7 + Math.floor(Math.random() * offsetRange) },
        )
      }

      // Randomize building search grid
      const buildingSpacing = 5 + Math.floor(Math.random() * 3)
      const buildingOffsetX = Math.floor(Math.random() * buildingSpacing)
      const buildingOffsetY = Math.floor(Math.random() * buildingSpacing)

      if (preset.roads.enabled) {
        // Find spots along roads (but not on them)
        for (let r = 5 + buildingOffsetY; r < rows - 8; r += buildingSpacing) {
          for (let c = 5 + buildingOffsetX; c < cols - 8; c += buildingSpacing) {
            // Add small random jitter to each spot
            const jitterX = Math.floor(Math.random() * 3) - 1
            const jitterY = Math.floor(Math.random() * 3) - 1
            const checkC = c + jitterX
            const checkR = r + jitterY

            const ground = grid.ground[checkR]?.[checkC]
            if (!isRoadGround(ground) && ground !== 'water' && ground !== 'plaza') {
              // Check if near a road
              const nearRoad = [-4, -3, -2, -1, 0, 1, 2, 3, 4].some(dr =>
                [-4, -3, -2, -1, 0, 1, 2, 3, 4].some(dc =>
                  isRoadGround(grid.ground[checkR + dr]?.[checkC + dc])
                )
              )
              if (nearRoad) {
                validSpots.push({ x: checkC, y: checkR })
              }
            }
          }
        }
      }

      // Always add some random spots for variety
      for (let i = 0; i < 30; i++) {
        const x = 5 + Math.floor(Math.random() * (cols - 12))
        const y = 5 + Math.floor(Math.random() * (rows - 12))
        const ground = grid.ground[y]?.[x]
        // Check for any water-like or plaza-like ground (including themed versions)
        const isWater = ground?.includes('water') || ground?.includes('lava') || ground?.includes('frozen') || ground?.includes('oasis') || ground?.includes('koi')
        const isPlaza = ground?.includes('plaza') || ground?.includes('tile') || ground?.includes('floor') || ground?.includes('lacquer') || ground?.includes('tatami')
        if (!isRoadGround(ground) && !isWater && !isPlaza) {
          validSpots.push({ x, y })
        }
      }

      // Use theme-specific building colors
      const buildingColors = themeColors.buildingColors
      for (let i = 0; i < numBuildings && validSpots.length > 0; i++) {
        const spotIdx = Math.floor(Math.random() * validSpots.length)
        const spot = validSpots.splice(spotIdx, 1)[0]
        // Randomize building dimensions
        const buildingWidth = 2 + Math.floor(Math.random() * 3)  // 2-4
        const buildingDepth = 2 + Math.floor(Math.random() * 3)  // 2-4
        const buildingHeight = 2 + Math.floor(Math.random() * 3) // 2-4

        // Verify footprint doesn't overlap roads/water/plaza
        let canPlace = true
        for (let dy = 0; dy < buildingDepth && canPlace; dy++) {
          for (let dx = 0; dx < buildingWidth && canPlace; dx++) {
            const g = grid.ground[spot.y + dy]?.[spot.x + dx]
            const isWater = g?.includes('water') || g?.includes('lava') || g?.includes('frozen') || g?.includes('oasis') || g?.includes('koi')
            const isPlaza = g?.includes('plaza') || g?.includes('tile') || g?.includes('floor') || g?.includes('lacquer') || g?.includes('tatami')
            if (isRoadGround(g) || isWater || isPlaza || g === undefined) canPlace = false
          }
        }
        if (!canPlace) continue

        const color = buildingColors[Math.floor(Math.random() * buildingColors.length)]
        for (let dy = 0; dy < buildingDepth; dy++) {
          for (let dx = 0; dx < buildingWidth; dx++) {
            if (spot.x + dx < cols && spot.y + dy < rows) {
              // buildings block access but do not raise terrain (blocks = collision, not elevation)
              grid.setCollision(spot.x + dx, spot.y + dy, true)
              grid.placeAsset(['█'], spot.x + dx, spot.y + dy, {
                type: 'building', blocking: true, color, height: buildingHeight
              })
            }
          }
        }
      }
    }

    // === STEP 7: Nature (trees, bushes, flowers, rocks) using theme colors ===
    const { treeDensity, bushDensity, flowerDensity, rockDensity } = preset.nature

    for (let r = 2; r < rows - 2; r++) {
      for (let c = 2; c < cols - 2; c++) {
        const ground = grid.ground[r]?.[c]
        // Skip water-like and plaza-like ground (including themed versions)
        const isWater = ground?.includes('water') || ground?.includes('lava') || ground?.includes('frozen') || ground?.includes('oasis') || ground?.includes('koi')
        const isPlaza = ground?.includes('plaza') || ground?.includes('tile') || ground?.includes('floor') || ground?.includes('lacquer') || ground?.includes('tatami')
        if (isRoadGround(ground) || isWater || isPlaza) continue

        // Skip cells with existing assets
        const hasAsset = grid.assets.some(a => a.col === c && a.row === r)
        if (hasAsset) continue

        // Skip near town center if plaza
        if (preset.buildings.hasPlaza && c >= townX - 2 && c < townX + 14 && r >= townY - 2 && r < townY + 14) {
          continue
        }

        // Skip too close to roads
        if (preset.roads.enabled) {
          const tooCloseToRoad = [-2, -1, 0, 1, 2].some(dr =>
            [-2, -1, 0, 1, 2].some(dc =>
              isRoadGround(grid.ground[r + dr]?.[c + dc])
            )
          )
          if (tooCloseToRoad && Math.random() > 0.3) continue
        }

        const noise = smoothNoise(c, r, 6)

        // Trees: use noise for clustering - theme-appropriate color
        if (treeDensity > 0 && noise > (1 - treeDensity * 0.8)) {
          if (Math.random() < treeDensity * 0.5) {
            grid.placeAsset(['@'], c, r, { type: 'tree', blocking: true, color: themeColors.treeColor, height: 3 })
            grid.setCollision(c, r, true)
            continue
          }
        }

        // Bushes - theme-appropriate color
        if (bushDensity > 0 && Math.random() < bushDensity * 0.15) {
          grid.placeAsset(['&'], c, r, { type: 'bush', blocking: true, color: themeColors.bushColor, height: 1 })
          grid.setCollision(c, r, true)
          continue
        }

        // Flowers (not blocking) - theme-appropriate colors
        if (flowerDensity > 0 && Math.random() < flowerDensity * 0.1) {
          const flowerColor = themeColors.flowerColors[Math.floor(Math.random() * themeColors.flowerColors.length)]
          grid.placeAsset(['+'], c, r, {
            type: 'flower',
            color: flowerColor
          })
          continue
        }

        // Rocks (near water) - theme-appropriate color
        if (rockDensity > 0 && Math.random() < rockDensity * 0.08) {
          const nearWater = [-1, 0, 1].some(dy =>
            [-1, 0, 1].some(dx => {
              const g = grid.ground[r + dy]?.[c + dx]
              return g?.includes('water') || g?.includes('lava') || g?.includes('frozen') || g?.includes('oasis') || g?.includes('koi')
            })
          )
          if (nearWater || Math.random() < 0.3) {
            grid.placeAsset(['o'], c, r, { type: 'rock', blocking: true, color: themeColors.rockColor })
            grid.setCollision(c, r, true)
          }
        }
      }
    }

    // === STEP 8: Set collisions for all blocking elements ===
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ground = grid.ground[r]?.[c]
        // Water-like elements are blocking (including themed versions)
        const isWaterLike = ground?.includes('water') || ground?.includes('lava') || ground?.includes('frozen') || ground?.includes('oasis') || ground?.includes('koi') || ground?.includes('magma')
        if (isWaterLike) {
          grid.setCollision(c, r, true)
        }
      }
    }

    // === STEP 9: NPCs ===
    if (preset.npcs.enabled) {
      const npcCount = preset.npcs.count.min +
        Math.floor(Math.random() * (preset.npcs.count.max - preset.npcs.count.min + 1))
      let npcsPlaced = 0

      // Try plaza/town center first
      if (preset.buildings.hasPlaza) {
        for (let attempts = 0; attempts < 20 && npcsPlaced < npcCount; attempts++) {
          const nx = townX + 2 + Math.floor(Math.random() * 8)
          const ny = townY + 2 + Math.floor(Math.random() * 8)
          const ground = grid.ground[ny]?.[nx]
          const hasAsset = grid.assets.some(a => a.col === nx && a.row === ny)

          if ((ground === 'plaza' || ground === 'road') && !hasAsset) {
            grid.placeAsset(['☺'], nx, ny, { type: 'npc', blocking: true, color: '#ffdd00' })
            npcsPlaced++
          }
        }
      }

      // Place remaining on roads or walkable ground
      for (let attempts = 0; attempts < 50 && npcsPlaced < npcCount; attempts++) {
        const nx = 4 + Math.floor(Math.random() * (cols - 8))
        const ny = 4 + Math.floor(Math.random() * (rows - 8))
        const ground = grid.ground[ny]?.[nx]
        const hasAsset = grid.assets.some(a => a.col === nx && a.row === ny)
        const isCollision = grid.collision[ny]?.[nx]

        if (!isCollision && !hasAsset && ground !== 'water') {
          grid.placeAsset(['☺'], nx, ny, { type: 'npc', blocking: true, color: '#ffdd00' })
          npcsPlaced++
        }
      }
    }

    // Move player to valid spawn
    const spawnX = preset.buildings.hasPlaza ? townX + 6 : cx
    const spawnY = preset.buildings.hasPlaza ? townY + 6 : cy
    movePlayerToValidSpawn(spawnX, spawnY)
    const live = livePlayerCell()
    syncPlayerEntity(live.col, live.row, true) // new map → a selectable player at the spawn
    setSelectedCells(new Set())
  }

  // Export layers for use with other game engines or tileset replacement
  const exportLayers = () => {
    const grid = gridRef.current
    if (!grid) return

    const cols = grid.cols
    const rows = grid.rows

    // Layer 1: Ground characters (for tileset mapping)
    const groundLayer: string[][] = []
    const groundTypes: string[][] = []
    for (let r = 0; r < rows; r++) {
      groundLayer[r] = []
      groundTypes[r] = []
      for (let c = 0; c < cols; c++) {
        const type = grid.ground[r]?.[c] || 'grass'
        groundTypes[r][c] = type
        // Map ground type to character
        const charMap: Record<string, string> = {
          grass: '.', water: '~', road: '=', plaza: '#', bridge: '|'
        }
        groundLayer[r][c] = charMap[type] || '.'
      }
    }

    // Layer 2: Height map
    const heightLayer: number[][] = []
    for (let r = 0; r < rows; r++) {
      heightLayer[r] = []
      for (let c = 0; c < cols; c++) {
        heightLayer[r][c] = grid.getHeight(c, r)
      }
    }

    // Layer 3: Collision map (0 = walkable, 1 = blocked)
    const collisionLayer: number[][] = []
    for (let r = 0; r < rows; r++) {
      collisionLayer[r] = []
      for (let c = 0; c < cols; c++) {
        const groundType = grid.ground[r]?.[c]
        const blocked = groundType === 'water' || grid.isBlocked(c, r) ? 1 : 0
        collisionLayer[r][c] = blocked
      }
    }

    // Layer 4-6: Asset layers by category
    const buildingsLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const natureLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const decorationsLayer: Array<{ col: number; row: number; char: string; tileKey?: string; height?: number }> = []
    const npcsLayer: Array<{ col: number; row: number; char: string; tileKey?: string }> = []

    for (const asset of grid.assets) {
      const assetData = {
        col: asset.col,
        row: asset.row,
        char: asset.art[0] || '?',
        tileKey: asset.tileKey,
        height: asset.heightLevel,
      }

      switch (asset.type) {
        case 'building':
          buildingsLayer.push(assetData)
          break
        case 'tree':
        case 'flower':
          natureLayer.push(assetData)
          break
        case 'npc':
          npcsLayer.push({ col: asset.col, row: asset.row, char: asset.art[0] || '☺', tileKey: asset.tileKey })
          break
        default:
          decorationsLayer.push(assetData)
      }
    }

    // Full combined character grid (for visual reference)
    const fullGrid: string[][] = []
    for (let r = 0; r < rows; r++) {
      fullGrid[r] = [...groundLayer[r]]
    }
    for (const asset of grid.assets) {
      if (asset.row >= 0 && asset.row < rows && asset.col >= 0 && asset.col < cols) {
        fullGrid[asset.row][asset.col] = asset.art[0] || '?'
      }
    }

    const exportData = {
      metadata: {
        name: templateName || 'Untitled',
        cols,
        rows,
        viewType,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
      tileMapping: {
        ground: { '.': 'grass', '~': 'water', '=': 'road', '#': 'plaza', '|': 'bridge' },
        assets: {
          '@': 'tree', '*': 'bush', '$': 'crate', '!': 'lamp', '+': 'flower',
          'o': 'rock', '█': 'wall', '▀': 'roof', '░': 'floor', '☺': 'npc',
          '▓': 'tower', '┤': 'trunk', '♠': 'foliage',
        },
      },
      layers: {
        ground: groundLayer,
        groundTypes,
        height: heightLayer,
        collision: collisionLayer,
        buildings: buildingsLayer,
        nature: natureLayer,
        decorations: decorationsLayer,
        npcs: npcsLayer,
        full: fullGrid,
      },
      spawn: {
        col: Math.floor(playerRef.current.x / grid.cellSize),
        row: Math.floor(playerRef.current.z / grid.cellSize),
      },
      connectors,
    }

    // Download as JSON
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${templateName || 'level'}-layers.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const playerRef = useRef<PlayerState>({
    x: VILLAGE_CONFIG.spawnCol * VILLAGE_CONFIG.cellSize,
    z: VILLAGE_CONFIG.spawnRow * VILLAGE_CONFIG.cellSize,
    facing: 'down',
    moving: false,
    frame: 0,
  })
  const keysRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Setup canvas
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    // Create minimal empty grid - actual content loaded via URL params
    // Don't create random village here, let loadTemplate or generateRandomMap handle it
    gridRef.current = new IsometricGrid({
      cols: 40,
      rows: 40,
      cellSize: VILLAGE_CONFIG.cellSize,
      isoScale: VILLAGE_CONFIG.isoScale,
    })

    // Validate initial spawn point
    const grid = gridRef.current
    const spawnCol = VILLAGE_CONFIG.spawnCol
    const spawnRow = VILLAGE_CONFIG.spawnRow

    // Find valid spawn near configured spawn point
    let validCol = spawnCol
    let validRow = spawnRow

    // Spiral search for valid spawn
    outer: for (let radius = 0; radius < Math.max(grid.cols, grid.rows); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
          const c = spawnCol + dx
          const r = spawnRow + dy
          if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows) {
            const groundType = grid.ground[r]?.[c]
            if (groundType !== 'water' && !grid.isBlocked(c, r)) {
              validCol = c
              validRow = r
              break outer
            }
          }
        }
      }
    }

    playerRef.current.x = validCol * grid.cellSize + grid.cellSize / 2
    playerRef.current.z = validRow * grid.cellSize + grid.cellSize / 2
    lastCellRef.current = { col: validCol, row: validRow }

    // Input handling
    const handleKeyDown = (e: KeyboardEvent) => {
      // I toggles the inventory panel — but not while typing in a field.
      const tag = (e.target as HTMLElement | null)?.tagName
      if ((e.key === 'i' || e.key === 'I') && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setInventoryOpen(o => !o)
        return
      }
      // Q toggles the quest log (same guard).
      if ((e.key === 'q' || e.key === 'Q') && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        setQuestLogOpen(o => !o)
        return
      }
      keysRef.current[e.key] = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false
    }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      // Top + 2D share one zoom; the isometric view has its own (scales the
      // iso projection in render()). Both clamped to a sane range.
      if (topViewMode || viewTypeRef.current === '2d') {
        setTopViewZoom(z => Math.max(0.5, Math.min(4.0, z + delta)))
      } else {
        isoZoomRef.current = Math.max(0.5, Math.min(4.0, isoZoomRef.current + delta))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    canvas.addEventListener('wheel', handleWheel, { passive: false })

    // Game loop
    let animFrame: number
    let lastTime = 0
    let animTimer = 0

    const gameLoop = (time: number) => {
      const dt = time - lastTime
      lastTime = time
      animTimer += dt

      const grid = gridRef.current
      const player = playerRef.current
      const keys = keysRef.current

      if (!grid) return

      const use2DMovement = topViewMode || viewTypeRef.current === '2d'
      const jump = jumpRef.current

      // Face the direction currently held BEFORE the jump trigger, so a standing
      // jump goes the way you're pressing (facing is otherwise only set while
      // walking — which the jump branch below skips, leaving it stale).
      const pressedFacing = facingFromKeys(keys)
      if (pressedFacing) player.facing = pressedFacing

      // Jump trigger (edge): begin an arc if not already airborne.
      const jumpDown = !!keys[' ']
      // Only carry the jump forward if a direction is actually held; otherwise hop in place.
      if (jumpDown && !jumpDownRef.current) beginJump(player, grid, use2DMovement, jump, time, pressedFacing !== null)
      jumpDownRef.current = jumpDown

      // Entities block movement across their FULL footprint: NPCs + living enemies are
      // solid, the player's own marker + dead enemies are not. Recomputed each frame so
      // it follows patrols and clears the moment an enemy dies. Used by both the player
      // collision below and the patrol stepper.
      const entityBlocked = entityOccupiedCells(
        entitiesRef.current,
        e => e.kind === 'player' || (e.kind === 'enemy' && !isLivingEnemy(e, enemyRuntimeRef.current)),
      )
      const blockedCell = (x: number, z: number): boolean =>
        entityBlocked.has(`${Math.floor(x / grid.cellSize)},${Math.floor(z / grid.cellSize)}`)

      // Mid-jump: animate the arc (lerp across the cells + parabolic hop), ignore
      // WASD/collision until we land. Otherwise: normal walking.
      if (jump.active) {
        const t = Math.min(1, (time - jump.start) / JUMP_MS)
        player.x = jump.fromX + (jump.toX - jump.fromX) * t
        player.z = jump.fromZ + (jump.toZ - jump.fromZ) * t
        player.jumpHeight = Math.sin(Math.PI * t) * JUMP_PEAK_PX
        player.moving = true
        if (t >= 1) {
          player.x = jump.toX
          player.z = jump.toZ
          player.jumpHeight = 0
          jump.active = false
        }
      } else {
      player.jumpHeight = 0
      // Update player - slower speed for 16px cells
      const speed = 80 * (dt / 1000)
      player.moving = false

      let newX = player.x
      let newZ = player.z

      // While the Select tool holds a building, arrow keys nudge the BUILDING (handled
      // by its own key listener) — so the live player ignores movement input here.
      const editingBuilding = buildingToolRef.current === 'select' && selectedBuildingIndexRef.current != null
      const mkeys: Record<string, boolean> = editingBuilding ? EMPTY_KEYS : keys

      if (use2DMovement) {
        // 2D/Top view: simple grid movement (up=north, down=south, etc.)
        if (mkeys['ArrowUp'] || mkeys['w']) {
          newZ -= speed
          player.facing = 'up'
          player.moving = true
        }
        if (mkeys['ArrowDown'] || mkeys['s']) {
          newZ += speed
          player.facing = 'down'
          player.moving = true
        }
        if (mkeys['ArrowLeft'] || mkeys['a']) {
          newX -= speed
          player.facing = 'left'
          player.moving = true
        }
        if (mkeys['ArrowRight'] || mkeys['d']) {
          newX += speed
          player.facing = 'right'
          player.moving = true
        }
      } else {
        // Isometric view: diagonal movement
        const diagSpeed = speed * 0.707
        if (mkeys['ArrowUp'] || mkeys['w']) {
          newX -= diagSpeed
          newZ -= diagSpeed
          player.facing = 'up'
          player.moving = true
        }
        if (mkeys['ArrowDown'] || mkeys['s']) {
          newX += diagSpeed
          newZ += diagSpeed
          player.facing = 'down'
          player.moving = true
        }
        if (mkeys['ArrowLeft'] || mkeys['a']) {
          newX -= diagSpeed
          newZ += diagSpeed
          player.facing = 'left'
          player.moving = true
        }
        if (mkeys['ArrowRight'] || mkeys['d']) {
          newX += diagSpeed
          newZ -= diagSpeed
          player.facing = 'right'
          player.moving = true
        }
      }

      // Collision check
      if (!grid.isWorldBlocked(newX, newZ) && !blockedCell(newX, newZ)) {
        player.x = newX
        player.z = newZ
      }

      // Bounds
      player.x = Math.max(0, Math.min(player.x, grid.cols * grid.cellSize))
      player.z = Math.max(0, Math.min(player.z, grid.rows * grid.cellSize))
      }

      // Animation frame
      if (player.moving && animTimer > 150) {
        player.frame = (player.frame + 1) % 2
        animTimer = 0
      }

      // ── Connector triggers (teleport between templates) ──
      // Movement/interact triggers fire during play regardless of the connector
      // authoring toggle — only the click-to-author behavior (handleCanvasMouseDown)
      // is gated on connectorMode. Suppressed only mid-teleport so a load can't
      // re-fire the connector on the landing cell.
      if (!teleportingRef.current) {
        const curCol = Math.floor(player.x / grid.cellSize)
        const curRow = Math.floor(player.z / grid.cellSize)
        const last = lastCellRef.current
        if (curCol !== last.col || curRow !== last.row) {
          lastCellRef.current = { col: curCol, row: curRow }
          // Travel quest objectives complete when the player reaches the target cell.
          questEventRef.current({ kind: 'travel', place: `${curCol},${curRow}` })
          const entered = findTriggeredConnector(curCol, curRow, connectorsRef.current, 'enter')
          if (entered) triggerConnectorRef.current(entered)
        }
        // Interact key (edge-triggered): E / Enter — drives BOTH connectors and
        // quest accept/turn-in. A connector on the cell wins; otherwise we offer
        // the quest of a reachable giver NPC (accept when available, turn in when
        // complete). Quests never block connectors — they're checked only when no
        // interact connector fires here.
        const interactDown = !!(keys['e'] || keys['E'] || keys['Enter'])
        if (interactDown && !interactDownRef.current) {
          const pressed = findTriggeredConnector(curCol, curRow, connectorsRef.current, 'interact')
          if (pressed) triggerConnectorRef.current(pressed)
          else questInteractRef.current(curCol, curRow)
        }
        interactDownRef.current = interactDown

        // Special-item slots: number keys (1–0) use the bound consumable/special item.
        const sLoadout = playerLoadoutRef.current
        for (let i = 0; i < sLoadout.special.length; i++) {
          const sKey = sLoadout.shortcuts[i]
          const sDown = !!keys[sKey]
          if (sDown && !specialKeysRef.current[sKey]) useSpecialSlotRef.current(i)
          specialKeysRef.current[sKey] = sDown
        }
      }

      // ── Combat tick (only while playing, paused during connector authoring) ──
      // Attack keys are edge-triggered like interact: f = regular, g = special.
      const runtime = enemyRuntimeRef.current
      if (!connectorModeRef.current && !teleportingRef.current) {
        const attackDown = !!(keys['f'] || keys['F'])
        const specialDown = !!(keys['g'] || keys['G'])
        // Hold-to-loop the regular attack: fire on the rising edge, then repeat every ATTACK_LOOP_MS
        // while held so swings chain; each fire plays a swoosh.
        const fireAttack = attackDown && (!attackDownRef.current || time - lastAttackFireRef.current >= ATTACK_LOOP_MS)
        if (fireAttack) { lastAttackFireRef.current = time; playSwoosh() }
        const step = stepCombat({
          player,
          entities: entitiesRef.current,
          runtime,
          playerCombat: playerCombatRef.current,
          playerWeapon: playerWeaponRef.current,
          playerArmor: inventoryRef.current.equippedArmor,
          playerStats: playerStatsRef.current,
          playerShield: playerShieldRef.current,
          hitMarkers: hitMarkersRef.current,
          cellSize: grid.cellSize,
          use2D: use2DMovement,
          attack: fireAttack,
          special: specialDown && !specialDownRef.current,
          now: time,
          anims: attackAnimsRef.current,
          projectiles: projectilesRef.current,
          projectileCtx: projectileCtxRef.current,
        })
        playerCombatRef.current = step.playerCombat
        attackDownRef.current = attackDown
        specialDownRef.current = specialDown
        // Feed this frame's kills to active quests (the pure module counts them).
        if (step.kills.length > 0) onKillsRef.current(step.kills)

        // Travelling projectiles resolve on impact: advance the in-flight ones and resolve
        // any that arrived this frame against the target's CURRENT cell (move/dodge/block).
        const projStep = tickProjectiles({
          projectiles: projectilesRef.current,
          ctx: projectileCtxRef.current,
          entities: entitiesRef.current,
          runtime,
          playerCombat: playerCombatRef.current,
          hitMarkers: hitMarkersRef.current,
          anims: attackAnimsRef.current,
          cellSize: grid.cellSize,
          now: time,
        })
        playerCombatRef.current = projStep.playerCombat
        if (projStep.kills.length > 0) onKillsRef.current(projStep.kills)
        syncCombatHud(time)

        // Cannon behavior: ready cannons fire at a nearby player.
        const cannonDamage = tickCannons(grid, player, cannonFireRef.current, hitMarkersRef.current, time)
        if (cannonDamage > 0) {
          const c = playerCombatRef.current
          playerCombatRef.current = { ...c, hp: Math.max(0, c.hp - cannonDamage) }
        }

        // Patrol tick: advance enemies one cell on a throttled cadence. Update the
        // ref immediately (this frame renders the new positions) and mirror to
        // React state so the two stay in sync.
        if (time - lastEnemyMoveRef.current > ENEMY_MOVE_MS) {
          lastEnemyMoveRef.current = time
          const before = entitiesRef.current
          const movedEntities = advanceEnemyMovement(grid, before, player, movementCursorRef.current, entityBlocked)
          if (movedEntities !== before) {
            // Stamp render motion for each entity whose cell changed → the views interpolate
            // from→to over this tick (entityRenderCell / motionPos). No motion = no movement.
            for (const e of movedEntities) {
              const prev = before.find(p => p.id === e.id)
              if (prev && (prev.col !== e.col || prev.row !== e.row)) {
                entityMotion.set(e.id, { from: { col: prev.col, row: prev.row }, to: { col: e.col, row: e.row }, startMs: time })
              }
            }
            entitiesRef.current = movedEntities as Entity[]
            setEntities(movedEntities as Entity[])
          }
        }
      }

      // Render - movement works in all views. When entities are hidden (authoring
      // terrain without clutter), pass an empty list to every view.
      const renderEntities = hideEntitiesRef.current ? EMPTY_ENTITIES : entitiesRef.current
      if (flowViewMode) {
        // Flow view is handled by React overlay, just clear canvas
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else if (topViewMode) {
        renderTopView(ctx, canvas.width, canvas.height, grid, player, zoomRef.current, selectedCellsRef.current, connectorsRef.current, connectorModeRef.current, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, questsRef.current)
      } else if (viewTypeRef.current === '2d') {
        render2D(ctx, canvas.width, canvas.height, grid, player, time, zoomRef.current, camOffsetRef.current, renderEntities, runtime.combat, connectorsRef.current, questsRef.current)
      } else {
        render(ctx, canvas.width, canvas.height, grid, player, time, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, isoZoomRef.current, attackAnimsRef.current, connectorsRef.current, questsRef.current, projectilesRef.current)
      }
      // Drop finished attack animations (kept tiny — a few in flight at once).
      if (attackAnimsRef.current.length > 0) {
        attackAnimsRef.current = attackAnimsRef.current.filter(a => !isAnimDone(a, time))
      }

      // Movement works in top view too (grid-aligned for clarity)
      // In top view, we move in screen directions (up=up, down=down, etc.)

      animFrame = requestAnimationFrame(gameLoop)
    }

    animFrame = requestAnimationFrame(gameLoop)

    return () => {
      cancelAnimationFrame(animFrame)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      canvas.removeEventListener('wheel', handleWheel)
    }
  }, [])

  // ═══════════════════════════════════════════════════════════════════
  // TEMPLATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  // Load saved templates list
  const loadTemplateList = async () => {
    try {
      const { templates } = await listTemplates({ limit: 50 })
      setSavedTemplates(templates)
    } catch (error) {
      console.error('Failed to load templates:', error)
    }
  }

  // Save current map as template
  const saveCurrentTemplate = async () => {
    const grid = gridRef.current
    if (!grid || !templateName.trim()) return

    // Check template limit for new templates
    if (!currentTemplateId && savedTemplates.length >= maxTemplates) {
      toast(`Template limit reached (${maxTemplates}). Delete one first.`, 'warning')
      return
    }

    setIsSaving(true)
    try {
      const { groundData, heightData, assetsData } = serializeGrid(grid)

      // Entities AND quests have no field in the template schema (api.ts is
      // read-only here), so they ride alongside the assets as marked records and
      // are split back out on load. This keeps both persistent without touching
      // the API layer. NPC↔quest links survive via each entity's own questId.
      const assetsWithEntities = [
        ...assetsData,
        ...entitiesToAssets(entities),
        ...questsToAssets(quests),
        ...buildingsToAssets(grid.buildings), // grouped buildings ride along so load rebuilds the render
      ]

      if (currentTemplateId) {
        // Update existing
        await updateTemplate(currentTemplateId, {
          name: templateName,
          groundData,
          heightData,
          assetsData: assetsWithEntities,
          connectors,
          entities: entitiesRef.current,
          quests: questsRef.current,
          cols: grid.cols,
          rows: grid.rows,
          cellSize: grid.cellSize,
          isoScale: grid.isoScale,
          spawnCol: Math.floor(playerRef.current.x / grid.cellSize),
          spawnRow: Math.floor(playerRef.current.z / grid.cellSize),
        })
      } else {
        // Create new
        const created = await createTemplate({
          name: templateName,
          groundData,
          heightData,
          assetsData: assetsWithEntities,
          connectors,
          entities: entitiesRef.current,
          quests: questsRef.current,
          cols: grid.cols,
          rows: grid.rows,
          cellSize: grid.cellSize,
          isoScale: grid.isoScale,
          spawnCol: Math.floor(playerRef.current.x / grid.cellSize),
          spawnRow: Math.floor(playerRef.current.z / grid.cellSize),
        })
        setCurrentTemplateId(created.id)
      }

      await loadTemplateList()
      toast('Template saved!', 'success')
    } catch (error) {
      console.error('Failed to save template:', error)
      toast('Failed to save template', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // Load a template
  const loadTemplate = async (id: string, spawnOverride?: { col: number; row: number }) => {
    setIsLoading(true)
    try {
      const template = await getTemplate(id)
      const grid = gridRef.current
      if (!grid) return

      // Resize grid if needed
      if (template.cols !== grid.cols || template.rows !== grid.rows) {
        resizeGrid(template.cols, template.rows)
      }

      // Deserialize into grid
      deserializeToGrid(template, gridRef.current!)

      // Split placed entities AND quests back out of the assets they rode in on,
      // then strip both marker kinds so they don't double-render as decoration.
      const loadedEntities = entitiesFromAssets(gridRef.current!.assets)
      const loadedQuests = questsFromAssets(gridRef.current!.assets)
      const loadedBuildings = buildingsFromAssets(gridRef.current!.assets)
      gridRef.current!.assets = gridRef.current!.assets.filter(
        a => !isEntityAsset(a) && !isQuestAsset(a) && !isBuildingAsset(a),
      )
      // Restore the grouped buildings so iso/2D/top render the upright model, not the per-cell fallback.
      gridRef.current!.buildings = loadedBuildings
      setEntities(loadedEntities)
      setQuests(loadedQuests)

      // Move player to valid spawn. Priority: a connector teleport override, else the
      // placed PLAYER entity's cell (player=entity: the placed player defines the spawn),
      // else the template's default spawn.
      const playerEntity = (template.entities ?? []).find(e => e.kind === 'player')
      const spawn =
        spawnOverride ??
        (playerEntity
          ? { col: playerEntity.col, row: playerEntity.row }
          : { col: template.spawnCol, row: template.spawnRow })
      movePlayerToValidSpawn(spawn.col, spawn.row)

      // Sync the connector edge-detector to where we actually landed, so a connector
      // sitting on the spawn cell doesn't instantly re-fire on the next frame.
      const landed = gridRef.current
      if (landed) {
        lastCellRef.current = {
          col: Math.floor(playerRef.current.x / landed.cellSize),
          row: Math.floor(playerRef.current.z / landed.cellSize),
        }
      }

      // Load connectors + the persisted entities/quests (enemies, NPCs, quests survive
      // a save→reload now; enemy CombatState is rebuilt from entitiesRef on sync).
      // Normalize on load so legacy single-cell saves get the {cells:[...]} shape
      // before the trigger/render paths (which read connector.cells) ever see them.
      setConnectors((template.connectors || []).map(normalizeConnector))
      setEntities(template.entities ?? [])
      setQuests(template.quests ?? [])
      // Older saves may have no player entity → mint one at the spawn so the player
      // is still a clickable, vitals-showing entity. A saved player is kept as-is.
      const landedCell = livePlayerCell()
      syncPlayerEntity(landedCell.col, landedCell.row, false)

      setCurrentTemplateId(template.id)
      setTemplateName(template.name)
      setShowTemplateList(false)
    } catch (error) {
      console.error('Failed to load template:', error)
      toast('Failed to load template', 'error')
    } finally {
      setIsLoading(false)
    }
  }

  // Restore the LAST SAVED template (the user's most recent work) from the DB,
  // rather than opening an empty/random editor. Falls back to the gallery only if
  // nothing is saved yet. "Last saved" = newest updatedAt, sorted client-side so
  // it doesn't depend on the API's list ordering.
  const loadMostRecentTemplate = async () => {
    try {
      const { templates } = await listTemplates({ limit: 50 })
      if (templates.length === 0) {
        router.replace('/personal-projects/game-engine') // nothing saved yet → gallery
        return
      }
      const mostRecent = [...templates].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0]
      await loadTemplate(mostRecent.id)
    } catch (error) {
      console.error('Failed to load last saved template:', error)
      router.replace('/personal-projects/game-engine')
    }
  }

  // Teleport the player through a connector to its target template, landing on the
  // connector's spawn cell. Guarded so an in-flight load can't re-trigger.
  const triggerConnector = async (c: Connector) => {
    if (teleportingRef.current) return
    // Typed action (triggers generalization): resolve collect / content / move
    // (and action-encoded teleports) through the pure triggers module.
    if (c.action) {
      resolveConnectorAction(c.action)
      return
    }
    // Legacy connector: teleport to the target template.
    teleportingRef.current = true
    try {
      await loadTemplate(c.targetTemplateId, { col: c.spawnCol, row: c.spawnRow })
    } finally {
      teleportingRef.current = false
    }
  }

  /** Perform a connector's typed action via the pure resolver (dispatch on the
   *  resolved effect kind — no branching on the raw action). */
  const resolveConnectorAction = (action: TriggerAction) => {
    const effect = resolveAction(action)
    if (effect.kind === 'move') {
      movePlayerToValidSpawn(effect.col, effect.row)
    } else if (effect.kind === 'grant') {
      setInventory(prev => addItem(prev, itemFromReward({ kind: 'item', amount: effect.qty, itemId: effect.itemId }, mintItemId())))
      toast(`Picked up: ${effect.itemId}`, 'success')
    } else if (effect.kind === 'reveal') {
      toast(`Revealed: ${effect.sectionId}`, 'success')
    } else if (effect.kind === 'teleport') {
      teleportingRef.current = true
      loadTemplate(effect.templateId, effect.spawn).finally(() => { teleportingRef.current = false })
    }
  }

  // Keep the game loop's trigger callback pointed at the latest closure
  // (the loop is mounted once, so it must call through a ref).
  useEffect(() => {
    triggerConnectorRef.current = triggerConnector
  })

  // Delete a template
  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this template?')) return

    try {
      await deleteTemplate(id)
      if (currentTemplateId === id) {
        setCurrentTemplateId(null)
        setTemplateName('')
      }
      await loadTemplateList()
    } catch (error) {
      console.error('Failed to delete template:', error)
      toast('Failed to delete template', 'error')
    }
  }

  // Load templates on mount
  useEffect(() => {
    loadTemplateList()
  }, [])

  // Handle URL params — RE-RUNS whenever the query KEY changes (a different ?id, or ?new=1), so an
  // in-editor "＋ New" / loading another template actually takes effect instead of being blocked by a
  // one-shot `initialized` guard.
  const handledQueryRef = useRef<string | null>(null)
  const loadBtnRef = useRef<HTMLButtonElement>(null)
  const [loadMenuPos, setLoadMenuPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!router.isReady || !gridRef.current) return
    const { id, new: isNew } = router.query
    const key = typeof id === 'string' ? `id:${id}` : isNew === '1' ? 'new' : 'recent'
    if (handledQueryRef.current === key) return
    handledQueryRef.current = key

    if (typeof id === 'string') {
      loadTemplate(id) // sets currentTemplateId
    } else if (isNew === '1') {
      // A blank NEW template: drop the current id (so the button reads "Save", not "Update"), clear
      // authored data, and lay down a fresh map.
      setCurrentTemplateId(null)
      setConnectors([])
      setQuests([])
      generateRandomMap()
      setTemplateName(`Template ${new Date().toLocaleDateString()}`)
    } else {
      // No id, not new → restore the user's LAST SAVED template (falls back to the gallery).
      loadMostRecentTemplate()
    }
    setInitialized(true)
  }, [router.isReady, router.query])

  return (
    <>
      <Head>
        <title>{templateName || 'New Template'} - Nebulith</title>
      </Head>
      <main className="fixed inset-0 overflow-hidden bg-black">
        <canvas
          ref={canvasRef}
          className="block w-full h-full cursor-grab"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onContextMenu={handleContextMenu}
          style={{ cursor: isPanning ? 'grabbing' : topViewMode ? 'default' : 'grab' }}
        />

        {/* Vitals are NOT an always-on HUD — they live in the selected-entity panel on
            the right sidebar (shown only when the player or an entity is selected). */}

        {/* Quest tracker — active quest title + kill progress. Same play-view gate
            as the combat HUD. Renders nothing when no quest is active. */}
        {!showFlowView && !showTopView && (
          <QuestHud quest={activeQuest(quests)} />
        )}

        {/* Flow View Overlay */}
        {showFlowView && currentTemplateId && (
          <FlowViewOverlay
            currentTemplate={{ id: currentTemplateId, name: templateName }}
            connectors={connectors}
            allTemplates={savedTemplates}
            onSelectTemplate={(id) => {
              flowViewMode = false
              setShowFlowView(false)
              loadTemplate(id)
            }}
          />
        )}

        {/* Exit Flow view — the only way back, since the sidebars hide in flow */}
        {showFlowView && (
          <button
            onClick={toggleFlowView}
            className="fixed right-4 top-4 z-30 rounded bg-purple-700 px-3 py-2 font-mono text-xs font-bold text-white shadow-lg hover:bg-purple-600"
          >
            Exit Flow
          </button>
        )}

        {/* TOP NAV — links · views · save/load · export · connectors · new */}
        {showSidebars && !showFlowView && (
        <nav className="fixed left-4 right-4 top-4 z-20 flex items-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-black/90 px-3 py-2 font-mono text-sm text-white shadow-lg shadow-black/40">
          <Link href="/personal-projects/game-engine" className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600">← Templates</Link>
          <Link href="/" className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600">CV</Link>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          <div className="flex shrink-0 gap-1">
            <ViewButton label="ISO" active={activeView === 'iso'} activeClass="bg-yellow-600" onClick={selectIsoView} />
            <ViewButton label="2D" active={activeView === '2d'} activeClass="bg-blue-600" onClick={select2DView} />
            <ViewButton label="Top" active={activeView === 'top'} activeClass="bg-blue-600" onClick={selectTopView} />
            <ViewButton label="Flow" active={activeView === 'flow'} activeClass="bg-purple-600" onClick={toggleFlowView} />
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Template name…"
            aria-label="Template name"
            className="w-36 shrink-0 rounded bg-gray-800 px-2 py-1 text-xs"
          />
          <button
            onClick={saveCurrentTemplate}
            disabled={isSaving || !templateName.trim()}
            className="shrink-0 rounded bg-green-700 px-3 py-1 text-xs font-bold hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500"
          >
            {isSaving ? '…' : currentTemplateId ? 'Update' : 'Save'}
          </button>
          <div className="relative shrink-0">
            <button
              ref={loadBtnRef}
              onClick={() => {
                const r = loadBtnRef.current?.getBoundingClientRect()
                if (r) setLoadMenuPos({ top: r.bottom + 4, left: r.left })
                setShowTemplateList(v => !v)
              }}
              aria-expanded={showTemplateList}
              className="rounded bg-blue-800 px-3 py-1 text-xs hover:bg-blue-700"
            >
              Load ({savedTemplates.length})
            </button>
            {showTemplateList && loadMenuPos && (
              // FIXED (not absolute) so it escapes the nav's overflow-x-auto clipping; positioned under
              // the Load button via its measured rect.
              <div
                style={{ position: 'fixed', top: loadMenuPos.top, left: loadMenuPos.left }}
                className="z-30 max-h-72 w-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl"
              >
                {savedTemplates.length === 0 && <p className="text-[10px] text-gray-500">No saved templates.</p>}
                {savedTemplates.map(t => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-1 rounded p-1 text-xs ${currentTemplateId === t.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'}`}
                  >
                    <button onClick={() => { loadTemplate(t.id); setShowTemplateList(false) }} className="flex-1 truncate text-left" disabled={isLoading}>{t.name}</button>
                    <button onClick={() => handleDeleteTemplate(t.id)} aria-label={`Delete ${t.name}`} className="px-1 text-red-400 hover:text-red-300">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={exportLayers} className="shrink-0 rounded bg-orange-700 px-3 py-1 text-xs font-bold hover:bg-orange-600">Export</button>
          <button
            onClick={() => { setConnectorMode(!connectorMode); setEditingConnector(null) }}
            aria-pressed={connectorMode}
            className={`shrink-0 rounded px-3 py-1 text-xs font-bold ${connectorMode ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            Connectors{connectorMode ? ' • on' : ''}
          </button>
          <Link href="/personal-projects/game-engine/templates?new=1" className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600">＋ New</Link>
        </nav>
        )}

        {/* Preview toggle — hide all editor UI (sidebars overlay the canvas) to
            preview the game cleanly, in ANY view. Available on desktop + mobile. */}
        <button
          onClick={() => setShowSidebars(s => !s)}
          aria-pressed={!showSidebars}
          className="fixed bottom-4 right-4 z-30 rounded-full bg-purple-700 px-4 py-2 font-mono text-xs font-bold text-white shadow-lg hover:bg-purple-600"
        >
          {showSidebars ? '▣ Preview (hide UI)' : '✎ Edit (show UI)'}
        </button>

        {/* LEFT SIDEBAR — Views · Stage presets · Assets */}
        {showSidebars && (
          <aside
            className={`fixed left-4 z-10 flex flex-col gap-3 overflow-y-auto pr-1 font-mono text-white ${
              isMobile
                ? 'top-16 right-4 max-h-[42vh]'
                : 'top-20 bottom-4 w-72'
            }`}
            aria-label="Build tools"
          >
            {/* Display — view toggles live in the top nav now */}
            <Card title="Display" accent="yellow">
              <button
                onClick={toggleDebug}
                aria-pressed={showDebug}
                className={`mt-2 w-full rounded px-2 py-1 text-xs font-bold transition-colors ${
                  showDebug ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                Debug overlay {showDebug ? 'on' : 'off'}
              </button>
              <button
                onClick={() => setHideEntities(h => !h)}
                aria-pressed={hideEntities}
                className={`mt-2 w-full rounded px-2 py-1 text-xs font-bold transition-colors ${
                  hideEntities ? 'bg-amber-600' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {hideEntities ? 'Entities hidden' : 'Hide entities'}
              </button>

              <div className="mt-3">
                <p className="mb-1 text-xs font-bold text-gray-400">
                  Grid {viewType === '2d' ? '(W × H)' : '(Cols × Rows)'}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    aria-label="Grid columns"
                    value={gridSize.cols}
                    onChange={(e) => setGridSize(s => ({ ...s, cols: parseInt(e.target.value) || 10 }))}
                    className="w-14 rounded bg-gray-800 p-1 text-center text-xs"
                    min="10" max="100"
                  />
                  <span className="text-xs text-gray-400">×</span>
                  <input
                    type="number"
                    aria-label="Grid rows"
                    value={gridSize.rows}
                    onChange={(e) => setGridSize(s => ({ ...s, rows: parseInt(e.target.value) || 10 }))}
                    className="w-14 rounded bg-gray-800 p-1 text-center text-xs"
                    min="10" max="100"
                  />
                  <button
                    onClick={() => resizeGrid(gridSize.cols, gridSize.rows)}
                    className="rounded bg-red-800 px-2 py-1 text-xs font-bold hover:bg-red-700"
                  >
                    Apply
                  </button>
                </div>
              </div>
              <p className="mt-2 text-[10px] text-gray-500">WASD / arrows move · Space jumps · E interacts</p>
            </Card>

            {/* Stage presets */}
            <Card title="Stage presets" accent="purple">
              <p className="mb-1 text-xs text-gray-400">Zone</p>
              <div className="mb-2 grid grid-cols-4 gap-1">
                {STAGE_ZONES.map(z => (
                  <button
                    key={z}
                    onClick={() => setGenZone(z)}
                    aria-pressed={genZone === z}
                    className={`rounded px-2 py-1 text-xs capitalize transition-colors ${
                      genZone === z ? SEASON_BTN[z] : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    {z}
                  </button>
                ))}
              </div>
              <p className="mb-1 text-xs text-gray-400">Variant</p>
              <div className="grid grid-cols-2 gap-1">
                {STAGE_VARIANTS.map(v => (
                  <button
                    key={v}
                    onClick={() => generateStageInEditor(genZone, v)}
                    className="rounded bg-purple-700 px-2 py-1.5 text-xs capitalize transition-colors hover:bg-purple-600"
                    title={`Generate a randomized ${genZone} ${v.replace('-', ' ')}`}
                  >
                    {v.replace('-', ' ')}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-gray-500">
                Pick a variant to generate a randomized {genZone} stage — forest, town, or a much larger city.
              </p>
            </Card>

            {/* Assets */}
            <Card title="Assets" accent="cyan">
              <p className="mb-2 text-[10px] text-gray-500">
                Pick a tile, then select cells in Top view to paint them.
              </p>

              {/* Height tool */}
              <div className={`mb-3 rounded p-2 ${heightEditMode ? 'bg-cyan-900/50 ring-1 ring-cyan-500' : 'bg-gray-800'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-cyan-400">Height</span>
                  <button
                    onClick={() => placeHeight(Math.max(0, selectedHeight - 1))}
                    className="h-6 w-6 rounded bg-gray-700 text-xs font-bold hover:bg-gray-600"
                    aria-label="Lower height"
                  >−</button>
                  <div className="flex gap-0.5">
                    {[0, 1, 2, 3, 4, 5].map(h => (
                      <button
                        key={h}
                        onClick={() => placeHeight(h)}
                        className={`h-6 w-6 rounded text-xs font-bold ${
                          selectedHeight === h && heightEditMode
                            ? 'bg-cyan-500 text-white'
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => placeHeight(Math.min(9, selectedHeight + 1))}
                    className="h-6 w-6 rounded bg-gray-700 text-xs font-bold hover:bg-gray-600"
                    aria-label="Raise height"
                  >+</button>
                </div>
              </div>

              {/* Tile FX — place tiles at reduced opacity to play with contrast / depth. */}
              <div className="mb-2">
                <label className="mb-1 flex items-center justify-between text-xs font-bold text-cyan-300">
                  <span>Opacity</span>
                  <span className="text-[10px] text-gray-400">{Math.round(placeOpacity * 100)}%</span>
                </label>
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={Math.round(placeOpacity * 100)}
                  onChange={e => setPlaceOpacity(Number(e.target.value) / 100)}
                  aria-label="Tile placement opacity"
                  className="w-full"
                />
              </div>

              {/* Ground */}
              <PaletteGroup label="Ground" color="text-gray-400">
                {GROUND_SWATCHES.map(g => (
                  <TileSwatch
                    key={g.char}
                    char={g.char}
                    name={g.name}
                    bg={g.bg}
                    fg={g.fg}
                    onClick={() => placeTile({ char: g.char, type: 'ground', groundType: g.groundType })}
                    selected={selectedTile?.char === g.char && selectedTile?.type === 'ground'}
                  />
                ))}
              </PaletteGroup>

              {/* Nature */}
              <PaletteGroup label="Nature" color="text-green-400">
                {NATURE_TILE_KEYS.map(key => (
                  <AssetTileSwatch key={key} tileKey={key} selectedTile={selectedTile} onPlace={placeTile} />
                ))}
              </PaletteGroup>

              {/* Animation Author — compose a cycle + apply it to the selected cell's asset. */}
              <div className="border-t border-white/10 pt-3">
                <p className="mb-1 text-xs font-bold text-fuchsia-400">Animation Author</p>
                <p className="mb-2 text-[9px] leading-tight text-gray-500">
                  Pick animations + mode + delay + trigger, select a cell, then Apply to animate its asset.
                </p>
                <div className="mb-2 flex flex-wrap gap-1">
                  {animationOptions().map(o => (
                    <button
                      key={o.id}
                      onClick={() => toggleAuthorAnim(o.id)}
                      className={`rounded px-2 py-1 text-[10px] ${authorAnims.has(o.id) ? 'bg-fuchsia-700 text-white' : 'bg-gray-800 text-gray-300'}`}
                    >
                      {o.name}
                    </button>
                  ))}
                </div>
                <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-300">
                  <span className="w-14 shrink-0">Mode</span>
                  <select value={authorMode} onChange={e => setAuthorMode(e.target.value as CycleMode)} className="flex-1 rounded bg-gray-800 p-1">
                    {CYCLE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-300">
                  <span className="w-14 shrink-0">Delay ms</span>
                  <input type="number" min={0} value={authorDelay} onChange={e => setAuthorDelay(Number(e.target.value))} className="flex-1 rounded bg-gray-800 p-1" />
                </div>
                <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-300">
                  <span className="w-14 shrink-0">Trigger</span>
                  <select value={authorTriggerKind} onChange={e => setAuthorTriggerKind(e.target.value as 'always' | 'state')} className="rounded bg-gray-800 p-1">
                    <option value="always">always</option>
                    <option value="state">on state</option>
                  </select>
                  {authorTriggerKind === 'state' && (
                    <input value={authorTriggerState} onChange={e => setAuthorTriggerState(e.target.value)} placeholder="combat" className="flex-1 rounded bg-gray-800 p-1" />
                  )}
                </div>
                {(() => {
                  const cycle = makeCycle('preview', Array.from(authorAnims), authorMode, authorDelay, makeTrigger(authorTriggerKind, authorTriggerState))
                  const v = validateCycle(cycle, new Set(Object.keys(ANIMATION_LIBRARY)))
                  return (
                    <>
                      <p className="mb-1 text-[9px] text-gray-400">{describeCycle(cycle)}</p>
                      {!v.ok && <p className="mb-1 text-[9px] text-amber-400">{v.reason}</p>}
                      <button
                        onClick={applyCycleToSelectedAsset}
                        disabled={!v.ok || selectedCells.size === 0}
                        className="w-full rounded bg-fuchsia-700 py-1 text-[10px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-40"
                      >
                        {selectedCells.size === 0 ? 'Select a cell first' : 'Apply to selected cell'}
                      </button>
                    </>
                  )
                })()}
              </div>
            </Card>

          </aside>
        )}

        {/* RIGHT SIDEBAR — Selected entity (action bar → modals) · Entities · Connectors */}
        {showSidebars && (
          <aside
            className={`fixed right-4 z-10 flex flex-col gap-3 overflow-y-auto pl-1 font-mono text-white ${
              isMobile
                ? 'bottom-16 left-4 max-h-[42vh]'
                : 'top-20 bottom-4 w-72'
            }`}
            aria-label="Project tools"
          >
            {/* Brand header */}
            <div className="rounded-lg border border-white/10 bg-black/60 p-3 text-center shadow-lg shadow-black/40">
              <h2 className="text-base font-bold tracking-widest text-yellow-400">NEBULITH</h2>
              <p className="text-[10px] text-gray-500">{templateName || 'New Template'}</p>
            </div>

            {/* Selected-entity ACTION BAR — opens focused modals (Stats / Inventory /
                Movement / Quests / Attacks). Appears only when an entity is selected. */}
            {(() => {
              const selected = entities.find(e => e.id === selectedEntityId)
              if (!selected) return null
              const btn = 'rounded bg-gray-700 px-2 py-1.5 text-xs font-bold transition-colors hover:bg-gray-600'
              return (
                <Card title="Selected entity" accent="orange">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-orange-300">{selected.name || selected.kind}</span>
                    <span className="text-gray-500">@ {selected.col},{selected.row}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button className={btn} onClick={() => setEntityModal('stats')}>⚔ Stats</button>
                    {selected.kind === 'player' && (
                      <button className={btn} onClick={() => setEntityModal('inventory')}>🎒 Inventory</button>
                    )}
                    {(selected.kind === 'enemy' || selected.kind === 'npc') && (
                      <button className={btn} onClick={() => setEntityModal('movement')}>➤ Movement</button>
                    )}
                    {selected.kind === 'enemy' && (
                      <button className={btn} onClick={() => setEntityModal('attacks')}>✦ Attacks</button>
                    )}
                    {selected.kind === 'npc' && (
                      <button className={btn} onClick={() => setEntityModal('quests')}>❒ Quests</button>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={deleteSelectedEntity} className="flex-1 rounded bg-red-800 px-2 py-1 text-xs font-bold hover:bg-red-700">Delete</button>
                    <button onClick={() => { setWaypointMode(false); setSelectedEntityId(null) }} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600">Deselect</button>
                  </div>
                </Card>
              )
            })()}

            {/* Entities — drop a player, enemies, and NPCs onto the stage */}
            <Card title="Entities" accent="orange">
              <p className="mb-2 text-[10px] text-gray-500">
                Pick a tool, then click a cell in Top view to place. Only one player.
              </p>
              <div className="grid grid-cols-4 gap-1">
                <EntityToolButton
                  label="Player"
                  glyph={ENTITY_GLYPH.player}
                  active={entityTool === 'player'}
                  activeClass="bg-yellow-600 text-black"
                  onClick={() => toggleEntityTool('player')}
                />
                <EntityToolButton
                  label="Enemy"
                  glyph={ENTITY_GLYPH.enemy}
                  active={entityTool === 'enemy'}
                  activeClass="bg-red-600"
                  onClick={() => toggleEntityTool('enemy')}
                />
                <EntityToolButton
                  label="NPC"
                  glyph={ENTITY_GLYPH.npc}
                  active={entityTool === 'npc'}
                  activeClass="bg-cyan-600 text-black"
                  onClick={() => toggleEntityTool('npc')}
                />
                <EntityToolButton
                  label="Erase"
                  glyph="✕"
                  active={entityTool === 'erase'}
                  activeClass="bg-gray-500"
                  onClick={() => toggleEntityTool('erase')}
                />
                <EntityToolButton
                  label="Collision"
                  glyph="▦"
                  active={entityTool === 'collision'}
                  activeClass="bg-red-700"
                  onClick={() => toggleEntityTool('collision')}
                />
              </div>
              <button
                onClick={randomizeEntities}
                className="mt-2 w-full rounded bg-purple-700 px-2 py-1.5 text-xs font-bold transition-colors hover:bg-purple-600"
                title="Scatter enemies + an NPC into the free space, each with stats + a movement pattern"
              >
                ⤳ Scatter entities
              </button>

              {entityTool === 'enemy' && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-xs font-bold text-red-400">Enemy type</span>
                  <input
                    type="text"
                    value={enemyType}
                    onChange={e => setEnemyType(e.target.value)}
                    placeholder="goblin"
                    aria-label="Enemy type"
                    className="w-full rounded bg-gray-800 p-1.5 text-xs"
                  />
                </label>
              )}

              {entityTool === 'npc' && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-xs font-bold text-cyan-400">NPC name (optional)</span>
                  <input
                    type="text"
                    value={npcName}
                    onChange={e => setNpcName(e.target.value)}
                    placeholder="Villager"
                    aria-label="NPC name"
                    className="w-full rounded bg-gray-800 p-1.5 text-xs"
                  />
                </label>
              )}

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-gray-400">
                <span>{entities.length} placed</span>
                {entities.length > 0 && (
                  <button
                    onClick={() => setEntities([])}
                    className="rounded bg-red-900 px-2 py-1 font-bold text-red-200 hover:bg-red-800"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </Card>

            {/* Buildings — fix the randomizer by hand: select / move / rotate / delete / place */}
            <Card title="Buildings" accent="orange">
              <p className="mb-2 text-[10px] text-gray-500">
                Select a building to move (arrow keys), rotate (R), or delete. Place a new one with a type tool.
              </p>
              <div className="grid grid-cols-5 gap-1">
                <EntityToolButton
                  label="Select"
                  glyph="◎"
                  active={buildingTool === 'select'}
                  activeClass="bg-yellow-600 text-black"
                  onClick={() => toggleBuildingTool('select')}
                />
                <EntityToolButton
                  label="House"
                  glyph="⌂"
                  active={buildingTool === 'place-house'}
                  activeClass="bg-amber-700"
                  onClick={() => toggleBuildingTool('place-house')}
                />
                <EntityToolButton
                  label="Store"
                  glyph="$"
                  active={buildingTool === 'place-store'}
                  activeClass="bg-blue-600"
                  onClick={() => toggleBuildingTool('place-store')}
                />
                <EntityToolButton
                  label="Hosp."
                  glyph="✚"
                  active={buildingTool === 'place-hospital'}
                  activeClass="bg-green-600 text-black"
                  onClick={() => toggleBuildingTool('place-hospital')}
                />
                <EntityToolButton
                  label="Delete"
                  glyph="✕"
                  active={buildingTool === 'delete'}
                  activeClass="bg-red-700"
                  onClick={() => toggleBuildingTool('delete')}
                />
              </div>

              {/* Selected-building inspector — keyed on buildingVersion so move/rotate refresh it */}
              {(() => {
                const grid = gridRef.current
                const b = selectedBuildingIndex != null ? grid?.buildings[selectedBuildingIndex] : undefined
                if (!b) return (
                  <p className="mt-3 border-t border-white/10 pt-2 text-[10px] text-gray-500">
                    {buildingTool === 'select' ? 'Click a building to select it.' : 'No building selected.'}
                  </p>
                )
                const facing = gridBuildingFacing(b)
                const door = buildingFootprintCells(b).door
                return (
                  <div key={`bld-${selectedBuildingIndex}-${buildingVersion}`} className="mt-3 border-t border-white/10 pt-2">
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-bold uppercase tracking-wider text-orange-300">{b.type}</span>
                      <span className="text-gray-500">facing {facing}</span>
                    </div>
                    <div className="mb-2 text-[10px] text-gray-400">
                      footprint {b.length}×{b.height} · facade {facadeLength(b)} · depth {b.depth} · door @ {door.col},{door.row}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={rotateSelectedBuilding}
                        className="flex-1 rounded bg-orange-700 px-2 py-1 text-xs font-bold hover:bg-orange-600"
                        title="Rotate facing south→east→north→west (R)"
                      >
                        ⟳ Rotate
                      </button>
                      <button
                        onClick={deleteSelectedBuilding}
                        className="flex-1 rounded bg-red-800 px-2 py-1 text-xs font-bold hover:bg-red-700"
                        title="Delete this building (Del)"
                      >
                        Delete
                      </button>
                      <button
                        onClick={deselectBuilding}
                        className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
                      >
                        Deselect
                      </button>
                    </div>
                  </div>
                )
              })()}

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-gray-400">
                <span>{gridRef.current?.buildings.length ?? 0} buildings</span>
              </div>
            </Card>

            {/* Connectors */}
            <Card
              title="Connectors"
              accent="purple"
              action={
                <button
                  onClick={() => { setConnectorMode(!connectorMode); setEditingConnector(null) }}
                  aria-pressed={connectorMode}
                  className={`rounded px-2 py-1 text-xs ${connectorMode ? 'bg-purple-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >
                  {connectorMode ? 'Exit' : 'Edit'}
                </button>
              }
            >
              {connectorMode && (
                <p className="mb-2 text-xs text-gray-400">Click a cell in Top view to add a connector.</p>
              )}

              {editingConnector && (
                <div className="mb-2 rounded bg-gray-800 p-2">
                  <p className="mb-1 text-xs text-yellow-400">
                    {selectedCells.size > 1
                      ? `${selectedCells.size} cells selected`
                      : `(${editingConnector.col}, ${editingConnector.row})`}
                  </p>
                  <select
                    value={connectorForm.action?.type ?? 'teleport'}
                    onChange={e => {
                      const t = e.target.value
                      setConnectorForm(f => ({
                        ...f,
                        action:
                          t === 'teleport' ? undefined
                          : t === 'collect' ? { type: 'collect', itemId: '', qty: 1 }
                          : t === 'content' ? { type: 'content', sectionId: '' }
                          : { type: 'goto_region', col: f.spawnCol ?? 0, row: f.spawnRow ?? 0 },
                      }))
                    }}
                    aria-label="Trigger action"
                    className="mb-1 w-full rounded bg-gray-700 p-1 text-xs"
                  >
                    <option value="teleport">Action: Go to template (teleport)</option>
                    <option value="goto_region">Action: Move within stage (uses Arrive-at)</option>
                    <option value="collect">Action: Collect item</option>
                    <option value="content">Action: Reveal content</option>
                  </select>
                  {connectorForm.action?.type === 'collect' && (
                    <input
                      type="text"
                      placeholder="Item id to grant"
                      aria-label="Item id to collect"
                      value={connectorForm.action.itemId}
                      onChange={e => setConnectorForm(f => ({ ...f, action: { type: 'collect', itemId: e.target.value, qty: 1 } }))}
                      className="mb-1 w-full rounded bg-gray-700 p-1 text-xs"
                    />
                  )}
                  {connectorForm.action?.type === 'content' && (
                    <input
                      type="text"
                      placeholder="Section id to reveal"
                      aria-label="Section id to reveal"
                      value={connectorForm.action.sectionId}
                      onChange={e => setConnectorForm(f => ({ ...f, action: { type: 'content', sectionId: e.target.value } }))}
                      className="mb-1 w-full rounded bg-gray-700 p-1 text-xs"
                    />
                  )}
                  {(connectorForm.action?.type ?? 'teleport') === 'teleport' && (
                  <select
                    value={connectorForm.targetTemplateId || ''}
                    onChange={e => setConnectorForm(f => ({ ...f, targetTemplateId: e.target.value }))}
                    aria-label="Target template"
                    className="mb-1 w-full rounded bg-gray-700 p-1 text-xs"
                  >
                    <option value="">Target template...</option>
                    {savedTemplates.filter(t => t.id !== currentTemplateId).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  )}
                  <select
                    value={connectorForm.interaction || 'walk'}
                    onChange={e => setConnectorForm(f => ({ ...f, interaction: e.target.value as Connector['interaction'] }))}
                    aria-label="How the player triggers this connector"
                    className="mb-1 w-full rounded bg-gray-700 p-1 text-xs"
                  >
                    <option value="walk">Walk onto it</option>
                    <option value="interact">Press E on it</option>
                    <option value="auto">Auto on enter</option>
                  </select>
                  <div className="mb-1 flex items-center gap-1 text-xs">
                    <span className="whitespace-nowrap text-gray-400">Arrive at</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Spawn column in target template"
                      value={connectorForm.spawnCol ?? 0}
                      onChange={e => setConnectorForm(f => ({ ...f, spawnCol: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                      className="w-12 rounded bg-gray-700 p-1 text-xs"
                    />
                    <span className="text-gray-500">,</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Spawn row in target template"
                      value={connectorForm.spawnRow ?? 0}
                      onChange={e => setConnectorForm(f => ({ ...f, spawnRow: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                      className="w-12 rounded bg-gray-700 p-1 text-xs"
                    />
                    <span className="whitespace-nowrap text-gray-400">in target</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={saveConnector} disabled={!connectorForm.targetTemplateId && !connectorForm.action} className="flex-1 rounded bg-green-700 p-1 text-xs hover:bg-green-600 disabled:bg-gray-700">Save</button>
                    <button onClick={() => deleteConnector(editingConnector.col, editingConnector.row)} className="rounded bg-red-800 p-1 text-xs hover:bg-red-700">Del</button>
                    <button onClick={() => setEditingConnector(null)} className="rounded bg-gray-700 p-1 text-xs hover:bg-gray-600">X</button>
                  </div>
                </div>
              )}

              {connectors.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {connectors.map((c, i) => (
                    <button
                      key={`${c.cells[0]?.col},${c.cells[0]?.row},${i}`}
                      type="button"
                      className="flex w-full items-center justify-between rounded bg-gray-800 p-1 text-left text-xs hover:bg-gray-700"
                      onClick={() => {
                        setConnectorForm(c)
                        setEditingConnector({ col: c.cells[0].col, row: c.cells[0].row })
                        setSelectedCells(new Set(c.cells.map(p => `${p.col},${p.row}`)))
                        setConnectorMode(true)
                      }}
                    >
                      <span>({c.cells[0]?.col},{c.cells[0]?.row}){c.cells.length > 1 ? ` +${c.cells.length - 1}` : ''}→{c.targetTemplateName?.slice(0, 8) || '?'}</span>
                      <span className="text-purple-400">{c.interaction}</span>
                    </button>
                  ))}
                </div>
              )}

              {connectors.length === 0 && !editingConnector && (
                <p className="text-[10px] text-gray-500">No connectors yet.</p>
              )}
            </Card>
          </aside>
        )}

        {/* Debug Legend — only when sidebars are hidden, so it isn't redundant */}
        {showDebug && !showSidebars && !showFlowView && (
          <div className="fixed bottom-4 left-4 z-20 rounded bg-black/90 p-3 font-mono text-xs text-white">
            <h3 className="mb-1 font-bold text-red-400">DEBUG</h3>
            <p><span className="text-red-400">■</span> Blocked</p>
            <p><span className="text-green-400">■</span> Walkable</p>
          </div>
        )}

        {/* Inventory — open button (also toggled by the I key) + the panel overlay */}
        {showSidebars && !inventoryOpen && !showFlowView && (
          <button
            onClick={() => setInventoryOpen(true)}
            className="fixed bottom-4 left-1/2 z-20 -translate-x-1/2 rounded bg-cyan-700 px-3 py-1 font-mono text-xs font-bold text-white shadow-lg hover:bg-cyan-600"
            aria-label="Open inventory (I)"
          >
            ▤ Inventory (I)
          </button>
        )}
        {inventoryOpen && (() => {
          const activeId = selectedEntityId ?? '__player__'
          const current = loadouts[activeId] ?? (activeId === '__player__' ? seededPlayerLoadout() : createLoadout())
          const who = selectedEntityId ? entities.find(e => e.id === selectedEntityId)?.name ?? 'Entity' : 'Player'
          return (
            <EquipmentPanel
              label={who}
              loadout={current}
              onChange={l => setLoadouts(prev => ({ ...prev, [activeId]: l }))}
              onClose={() => setInventoryOpen(false)}
            />
          )
        })()}

        {/* Quest log — open button (also toggled by the Q key) + the panel overlay */}
        {showSidebars && !questLogOpen && !showFlowView && (
          <button
            onClick={() => setQuestLogOpen(true)}
            className="fixed bottom-4 left-[calc(50%+150px)] z-20 -translate-x-1/2 rounded bg-orange-700 px-3 py-1 font-mono text-xs font-bold text-white shadow-lg hover:bg-orange-600"
            aria-label="Open quest log (Q)"
          >
            ❒ Quests (Q)
          </button>
        )}
        {questLogOpen && (
          <QuestLogPanel quests={quests} onClose={() => setQuestLogOpen(false)} />
        )}

        {/* Quest OFFER modal — opened when the player talks to a giver with an
            `available` quest; floats above the giver (centered if off-screen). */}
        {questGiveModal && (() => {
          const giver = entities.find(e => e.id === questGiveModal.giverId)
          const quest = giver ? questForGiver(quests, giver) : null
          const close = () => setQuestGiveModal(null)
          if (!quest || quest.state !== 'available') return null
          return (
            <Modal title="Quest Offer" accent="orange" onClose={close} anchor={questGiveModal.anchor}>
              <QuestGiveBody
                quest={quest}
                onAccept={() => { acceptGiverQuest(quest); close() }}
                onReject={close}
              />
            </Modal>
          )
        })()}

        {/* Entity-action MODALS — opened from the selected-entity action bar */}
        {entityModal && (() => {
          const selected = entities.find(e => e.id === selectedEntityId)
          if (!selected) return null
          const who = selected.name || selected.kind
          const close = () => setEntityModal(null)
          if (entityModal === 'stats') {
            return (
              <Modal title={`${who} — Stats`} accent="orange" onClose={close}>
                <EntityIdentityStatsBody entity={selected} onPatch={patchSelectedEntity} />
                {selected.kind === 'player' && <div className="mt-3"><CombatHud hud={playerHud} /></div>}
              </Modal>
            )
          }
          if (entityModal === 'movement') {
            return (
              <Modal title={`${who} — Movement patterns`} accent="cyan" onClose={close}>
                <EntityMovementBody
                  entity={selected}
                  onPatch={patchSelectedEntity}
                  waypointMode={waypointMode}
                  onToggleWaypointMode={() => setWaypointMode(v => !v)}
                />
              </Modal>
            )
          }
          if (entityModal === 'attacks') {
            return (
              <Modal title={`${who} — Attacks`} accent="red" onClose={close}>
                <EntityAttackBody entity={selected} onPatch={patchSelectedEntity} />
              </Modal>
            )
          }
          if (entityModal === 'inventory') {
            return (
              <Modal title={`${who} — Inventory`} accent="cyan" wide onClose={close}>
                <CombatHud hud={playerHud} />
                <div className="mt-3">
                  <InventoryCard inventory={inventory} talentPath={talentPath} onEquip={equipItem} onUse={useItem} onSetClass={setArchetype} />
                </div>
                <button
                  onClick={() => { close(); setInventoryOpen(true) }}
                  className="mt-3 w-full rounded bg-cyan-700 px-2 py-1.5 text-xs font-bold hover:bg-cyan-600"
                >
                  Open full equipment panel
                </button>
              </Modal>
            )
          }
          if (entityModal === 'quests') {
            return (
              <Modal title={`${who} — Quests`} accent="orange" wide onClose={close}>
                <QuestAuthoringCard
                  npcs={entities.filter(e => e.kind === 'npc')}
                  quests={quests}
                  draft={questDraft}
                  playerXp={playerXp}
                  onDraftChange={setQuestDraft}
                  onSave={saveQuest}
                />
              </Modal>
            )
          }
          return null
        })()}
      </main>
    </>
  )
}

// Render function - ASCII art on isometric diamond tiles
// Eased per-entity render position (fractional cell) so run-patrol steps GLIDE in the
// iso view instead of teleporting. Ephemeral render cache keyed by entity id.
// Per-entity render motion: from→to over one patrol tick, stamped when the logical cell
// changes (see the patrol tick). The renderers read entityRenderCell(...) every frame, so
// movement is the SAME deterministic, unit-tested function (motionPos) in every game view.
const entityMotion = new Map<string, { from: { col: number; row: number }; to: { col: number; row: number }; startMs: number }>()

/** The entity's interpolated render cell at `now` (its logical cell if it never moved). */
function entityRenderCell(entity: Entity, now: number): { col: number; row: number } {
  const m = entityMotion.get(entity.id)
  if (!m) return { col: entity.col, row: entity.row }
  return motionPos(m.from, m.to, m.startMs, now, ENEMY_MOVE_MS)
}

/** Deterministic per-cell grass tint: a stable position hash nudges the base grass bg lighter
 *  or darker so the lawn reads as natural patches instead of one flat sheet. Computed from
 *  (col,row) only — stable per cell, never shifts frame-to-frame. Paths/roads never call this. */
function grassShade(baseBg: string, col: number, row: number): string {
  const n = Math.sin(col * 127.1 + row * 311.7) * 43758.5453
  return varyIntensity(baseBg, n - Math.floor(n), 0.22)
}

function render(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  hitMarkers: readonly HitMarker[] = [],
  now: number = time,
  zoom: number = 1,
  attackAnims: readonly AttackAnim[] = [],
  connectors: Connector[] = [],
  quests: readonly Quest[] = [],
  projectiles: readonly Projectile[] = [],
) {
  // Clear
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const isoScale = grid.isoScale * zoom // mouse-wheel zoom scales the iso projection

  // Camera follows player + pan offset
  const camX = player.x - camOffset.x
  const camZ = player.z - camOffset.y

  // Tile dimensions - slightly overlapping to eliminate gaps
  const tileW = cellSize * isoScale * 0.71  // Half-width of diamond
  const tileH = cellSize * isoScale * 0.36  // Half-height of diamond
  const heightStep = cellSize * isoScale * 0.4  // Height per elevation level
  const cubeDepth = tileH * 1.6  // base extrusion so every tile reads as a CUBE

  // Convert world to screen (center of diamond tile)
  const toScreen = (col: number, row: number) => {
    const wx = col * cellSize - camX
    const wz = row * cellSize - camZ
    return {
      x: w / 2 + (wx - wz) * isoScale * 0.71,
      y: h / 2 + (wx + wz) * isoScale * 0.36
    }
  }

  // ─── GROUND TILES (ASCII on diamonds) ─────────────────────────────

  // Zoom-aware visible range: derive the half-span from the ACTUAL (zoomed) tile
  // size, so we iterate exactly the cells the camera can see — fewer when zoomed in,
  // more when zoomed out — then CLAMP to the grid so off-grid cells aren't scanned.
  const halfSpan = Math.ceil((w / tileW + h / tileH) / 2) + 4
  const camCol = Math.floor(camX / cellSize)
  const camRow = Math.floor(camZ / cellSize)
  const startCol = Math.max(0, camCol - halfSpan)
  const endCol = Math.min(grid.cols - 1, camCol + halfSpan)
  const startRow = Math.max(0, camRow - halfSpan)
  const endRow = Math.min(grid.rows - 1, camRow + halfSpan)

  // Font for ground characters
  const groundFontSize = Math.max(12, tileH * 1.1)
  ctx.font = `bold ${groundFontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const p = toScreen(col, row)
      if (p.x < -tileW * 2 || p.x > w + tileW * 2 || p.y < -tileH * 2 || p.y > h + tileH * 2) continue

      const tileType = grid.ground[row]?.[col] || 'grass'
      const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass

      // Noise-based color variation (same as 2D view)
      const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
      const colorIdx = noiseVal > 0 ? 0 : 1

      const char = colors.char[colorIdx % colors.char.length]
      const fg = colors.fg[colorIdx % colors.fg.length]
      // Grass varies per-cell into natural green tones (deterministic hash); every other
      // ground keeps its uniform floor base — no per-cell checkerboard (calmer floor).
      const bg = tileType.includes('grass') ? grassShade(colors.bg[0], col, row) : colors.bg[0]

      // Get cell height
      const cellHeight = grid.getHeight(col, row)
      const heightOffset = cellHeight * heightStep

      // Draw diamond tile with background
      const drawY = p.y - heightOffset

      // CUBE sides — but an interior cube's sides are HIDDEN by the cube in front of
      // it; only the terrain's front edges actually show a wall. Draw the left face
      // only when the down-left neighbour (col,row+1) is lower/absent, the right face
      // only when the down-right neighbour (col+1,row) is. Same look, a fraction of
      // the fills — the real iso perf win.
      const sideBottom = p.y + cubeDepth
      const leftOpen = row + 1 >= grid.rows || grid.getHeight(col, row + 1) < cellHeight
      const rightOpen = col + 1 >= grid.cols || grid.getHeight(col + 1, row) < cellHeight
      if (leftOpen) {
        ctx.fillStyle = darkenColor(bg, 0.5)
        ctx.beginPath()
        ctx.moveTo(p.x - tileW, drawY)
        ctx.lineTo(p.x, drawY + tileH)
        ctx.lineTo(p.x, sideBottom + tileH)
        ctx.lineTo(p.x - tileW, sideBottom)
        ctx.closePath()
        ctx.fill()
      }
      if (rightOpen) {
        ctx.fillStyle = darkenColor(bg, 0.7)
        ctx.beginPath()
        ctx.moveTo(p.x + tileW, drawY)
        ctx.lineTo(p.x, drawY + tileH)
        ctx.lineTo(p.x, sideBottom + tileH)
        ctx.lineTo(p.x + tileW, sideBottom)
        ctx.closePath()
        ctx.fill()
      }

      // Top face (diamond) - always draw
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()

      // ASCII character on top. Only grass flickers, so only grass touches
      // globalAlpha (skip the set/reset state-churn on every other ground cell).
      ctx.fillStyle = fg
      if (tileType.includes('grass')) {
        ctx.globalAlpha = 0.85 + 0.15 * (Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1)
        ctx.fillText(char, p.x, drawY)
        ctx.globalAlpha = 1
      } else {
        ctx.fillText(char, p.x, drawY)
      }
    }
  }

  // ─── CONNECTOR MARKERS (purple diamond + ◊ on each owned cell's top face) ──
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col, pcell.row)
      const drawY = p.y - grid.getHeight(pcell.col, pcell.row) * heightStep
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.beginPath()
      ctx.moveTo(p.x, drawY - tileH)
      ctx.lineTo(p.x + tileW, drawY)
      ctx.lineTo(p.x, drawY + tileH)
      ctx.lineTo(p.x - tileW, drawY)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${tileH * 1.1}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('◊', p.x, drawY)
    }
  }

  // ─── ASSETS + PLAYER (ASCII art stacked in isometric space) ────────

  // Zoom-aware cull: use the SAME span the camera can see (matches the ground tiles above),
  // so zooming OUT reveals more of the map's elements instead of a fixed 30×20 window — at
  // full zoom-out the span covers the whole map, so every element shows.
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camX / cellSize),
    Math.floor(camZ / cellSize),
    halfSpan * 2, halfSpan * 2
  )
  // Ground shadow goes ONLY on a tree's bottom (ground-contact) cell — see isGroundContact.
  const treeCells = new Set(grid.assets.filter(a => a.type === 'tree').map(a => `${a.col},${a.row}`))
  const isTreeCell = (c: number, r: number): boolean => treeCells.has(`${c},${r}`)

  // Sort all objects by depth (back to front). Placed entities depth-sort with
  // assets/player and draw as glyphs on top of their cell.
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  // Buildings render as ONE upright unit (grid.buildings) — collect their footprint cells so we
  // SKIP the per-cell building assets in iso (2D still draws them). Legacy █ buildings aren't
  // grouped, so they fall through and render per-cell as before.
  const buildingFootprint = new Set<string>()
  for (const b of grid.buildings ?? []) {
    const top = b.row - (b.height - 1)
    for (let r = 0; r < b.height; r++) for (let c = 0; c < b.length; c++) buildingFootprint.add(`${b.col + c},${top + r}`)
  }
  const allObjects: { col: number; row: number; isPlayer?: boolean; asset?: GridAsset; entity?: Entity; moving?: boolean; inRange?: boolean; building?: GridBuilding }[] = [
    ...visibleAssets
      .filter(a => !(a.type === 'building' && buildingFootprint.has(`${a.col},${a.row}`)))
      .map(a => ({ col: a.col, row: a.row, asset: a })),
    ...(grid.buildings ?? []).map(b => ({ col: b.col + (b.length - 1) / 2, row: b.row, building: b })),
    // The player ENTITY is drawn as the live sprite below (isPlayer), so skip it here
    // to avoid a ghost double at the spawn cell. (Top view keeps it — see renderTopView.)
    ...entities.filter(e => e.kind !== 'player').map(e => {
      const pos = entityRenderCell(e, now) // smooth, deterministic interpolation (motionPos)
      const mot = entityMotion.get(e.id)
      const moving = !!mot && now < mot.startMs + ENEMY_MOVE_MS // mid-interpolation → walk anim
      const inRange = e.kind === 'enemy' && Math.hypot(e.col - pCol, e.row - pRow) <= COMBAT_RANGE
      return { col: pos.col, row: pos.row, entity: e, moving, inRange }
    }),
    {
      col: player.x / cellSize,
      row: player.z / cellSize,
      isPlayer: true
    }
  ].sort((a, b) => (a.col + a.row) - (b.col + b.row))

  // Render each object with ASCII art style
  for (const obj of allObjects) {
    const p = toScreen(obj.col, obj.row)
    const cellHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const heightOffset = cellHeight * heightStep

    if (obj.isPlayer) {
      // The player's melee swing progress (0..1) drives the in-hand weapon animation below.
      const inHandSlash = attackAnims.find(a => a.inHand && now - a.start < a.durationMs)
      const swingP = inHandSlash ? Math.min(1, (now - inHandSlash.start) / inHandSlash.durationMs) : null
      drawIsoPlayer(ctx, p.x, p.y - heightOffset - (player.jumpHeight ?? 0), tileW, tileH, player, time, swingP)
    } else if (obj.entity) {
      const combat = obj.entity.kind === 'enemy' ? enemyCombat.get(obj.entity.id) : undefined
      if (isDeadEnemy(obj.entity, combat)) continue // hidden until it respawns
      const anchor = drawIsoEntity(ctx, p.x, p.y - heightOffset, obj.entity, tileH, combat, now, obj.moving ?? false, obj.inRange ?? false)
      drawQuestMarker(ctx, entityQuestMarker(obj.entity, quests), anchor.x, anchor.y, Math.max(14, tileH * 1.6))
    } else if (obj.building) {
      // ONE upright unit, oriented by its real road-derived facing. The planner already reserved
      // the oriented footprint rect (road-free), so the billboard can't spill — no gate needed.
      const b = obj.building
      const f = ISO_FACINGS[(b.facing ?? 0) % ISO_FACINGS.length]
      const oC = b.col + f.baseColFrac * b.length // base start col (which end of the frontage)
      const oR = b.row + 0.5 // base sits on the frontage front edge
      const origin = toScreen(oC, oR)
      const lp = toScreen(oC + f.len[0], oR + f.len[1])
      const colVec = { x: lp.x - origin.x, y: lp.y - origin.y } // per-column step along the length axis
      const dp = toScreen(oC + f.dep[0] * b.depth, oR + f.dep[1] * b.depth)
      const depthVec = { x: dp.x - origin.x, y: dp.y - origin.y } // z-depth = the building's own GROUND depth
      const flicker = Math.sin(time * 0.003 + b.col * 0.5 + b.row * 0.7) * 0.15 + 1
      // Fade the building when the player is near, so a back-facing door behind it is findable.
      const fade = buildingFadeAlpha(pCol, pRow, b, BUILDING_FADE_RADIUS, BUILDING_MIN_ALPHA)
      if (fade < 1) ctx.globalAlpha = fade
      drawIsoBuilding(ctx, b, origin, colVec, depthVec, tileW * 0.9, flicker)
      if (fade < 1) ctx.globalAlpha = 1
    } else if (obj.asset) {
      const op = obj.asset.opacity ?? 1 // per-asset opacity for contrast/depth
      if (op < 1) ctx.globalAlpha = op
      drawIsoAssetAscii(ctx, p.x, p.y - heightOffset, obj.asset, tileW, tileH, time, obj.asset.type === 'tree' && (!!obj.asset.baseShadow || isGroundContact(isTreeCell, obj.asset.col, obj.asset.row)))
      if (op < 1) ctx.globalAlpha = 1
    }
  }

  // Attack animations (slash / shot / lightning / block) in iso space. Read-only:
  // the loop prunes finished ones (animFrame returns null past the duration).
  if (attackAnims.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(14, tileH * 1.7)}px ${ASCII_FONT}`
    for (const a of attackAnims) {
      if (a.inHand) continue // the player's melee is the ONE in-hand weapon swinging (drawn by drawIsoPlayer)
      const f = animFrame(a, now)
      if (!f) continue
      const sp = toScreen(f.x / cellSize, f.z / cellSize)
      ctx.fillStyle = f.color
      if (f.angle != null) {
        // SLASH: swing the blade through its arc AT the attacker's hand (not a stick floating off the cell)
        ctx.save()
        ctx.translate(sp.x, sp.y - tileH * 1.25)
        ctx.rotate(f.angle)
        ctx.fillText(f.char, 0, 0)
        ctx.restore()
      } else {
        ctx.fillText(f.char, sp.x, sp.y - tileH)
      }
    }
  }

  // Travelling projectiles (arrow/bullet/bolt) — lerp along their path in iso space. The
  // loop ticks/resolves/drops them; this is read-only draw at the interpolated cell.
  if (projectiles.length > 0) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${Math.max(14, tileH * 1.6)}px ${ASCII_FONT}`
    ctx.fillStyle = '#ffe9a8'
    for (const pr of projectiles) {
      const pc = projectileCellAt(pr, now)
      const sp = toScreen(pc.col + 0.5, pc.row + 0.5)
      ctx.fillText(pr.glyph, sp.x, sp.y - tileH)
    }
  }

  // Floating "+dmg" hit markers, drawn over everything in iso space.
  for (const marker of hitMarkers) {
    const p = toScreen(marker.col + 0.5, marker.row + 0.5)
    drawHitMarker(ctx, p.x, p.y, marker, now)
  }

  // ─── DEBUG MODE ────────────────────────────────────────────────────

  if (debugMode) {
    renderDebugOverlays(ctx, w, h, grid, player, (wx, wz) => toScreen(wx / cellSize, wz / cellSize), cellSize)
  }

  // ─── UI ───────────────────────────────────────────────────────────

  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillText(`Grid: ${Math.floor(player.x / cellSize)}, ${Math.floor(player.z / cellSize)}`, 10, 50)

  if (debugMode) {
    ctx.fillStyle = '#ff4444'
    ctx.fillText('DEBUG MODE', 10, 70)
  }
}

// Draw player as ASCII art in isometric view (matching 2D style)
/** A flat ground shadow centered at (cx, footY), sized a bit WIDER than the figure's
 *  half-width so it always reads beneath the figure instead of hiding behind it.
 *  Figure-relative = deterministic, no per-figure pixel guessing. */
function drawGroundShadow(ctx: CanvasRenderingContext2D, cx: number, footY: number, halfWidth: number): void {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)'
  ctx.beginPath()
  ctx.ellipse(cx, footY, halfWidth * 1.15, Math.max(2, halfWidth * 0.34), 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Draw multi-row ASCII art in the TREE block language: each row gets a solid `bg` block
 *  (sized to that row's glyph extent) + a bright `fg` glyph + a 1px shadow. Rows stack
 *  bottom-to-top from `baseY`, left-aligned at `leftX` (monospace advance = `charW`). Shared
 *  by entities + the player so the whole cast reads as ROBUST sprites, not thin line-art.
 *  Caller sets ctx.font + textAlign 'left' + textBaseline 'middle'. */
function drawBlockFigure(
  ctx: CanvasRenderingContext2D,
  art: readonly string[],
  leftX: number,
  baseY: number,
  lineHeight: number,
  charW: number,
  fg: string,
  bg: string,
): void {
  for (let i = 0; i < art.length; i++) {
    const line = art[art.length - 1 - i]
    const ly = baseY - i * lineHeight
    const start = line.length - line.trimStart().length // skip leading spaces — block hugs the glyphs
    const end = line.trimEnd().length
    if (end > start) {
      const blockH = lineHeight * 0.78 // skinnier than the full line — the backing hugs the glyph row
      ctx.fillStyle = bg
      ctx.fillRect(leftX + start * charW - 1, ly - blockH / 2, (end - start) * charW + 2, blockH)
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)' // 1px drop shadow for crisp edges
    ctx.fillText(line, leftX + 1, ly + 1)
    ctx.fillStyle = fg
    ctx.fillText(line, leftX, ly)
  }
}

function drawIsoPlayer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileW: number,
  tileH: number,
  player: PlayerState,
  time: number,
  swingP: number | null = null,
) {
  const playerArt = getPlayerArt(player)
  const lineHeight = tileH * 1.4
  const fontSize = tileH * 1.2

  // Breathing animation
  const breathe = Math.sin(time * 0.004) * 2

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // Armor tint: steel-blue when wearing gear, warm yellow otherwise — the figure visibly
  // changes the moment you equip armor. Paired with a dark block bg (the trees' language).
  const bodyColor = player.armored ? '#bcd4ff' : '#ffdd00'
  const bodyBg = player.armored ? '#243a5e' : '#5a4412'

  const charW = fontSize * 0.6
  const maxW = playerArt.reduce((m, r) => Math.max(m, r.length), 0)
  const pHalf = (maxW * charW) / 2
  // Ground shadow sized to the player figure (always reads; fixed — doesn't bob).
  drawGroundShadow(ctx, x, y - tileH * 0.5, pHalf)

  // Robust block figure — same recipe as entities + trees; `breathe` bobs the whole figure.
  drawBlockFigure(ctx, playerArt, x - pHalf, y - lineHeight * 0.5 - breathe, lineHeight, charW, bodyColor, bodyBg)

  // The held weapon, drawn beside the figure at mid-height so equipped gear shows.
  ctx.textAlign = 'center'
  if (player.weaponGlyph) {
    // The ONE held weapon — bigger so a sword reads, on the facing hand, at ARM/body height (the
    // <#> row, one line above the legs). At rest the blade points UP; on attack THIS SAME blade
    // swings through the arc (no separate stroke), mirrored by facing.
    const weaponSize = fontSize * 1.7
    const onLeft = player.facing === 'left'
    const dir = onLeft ? -1 : 1
    const handX = onLeft ? x - pHalf - weaponSize * 0.18 : x + pHalf + weaponSize * 0.18
    const handY = y - lineHeight * 1.5 - breathe // the HAND, at the arm/body row — NOT the legs
    const swing = dir * 2.2 * (swingP ?? 0) // 0 at rest (blade up) → sweep the tip DOWN-forward
    ctx.font = `bold ${weaponSize}px ${ASCII_FONT}`
    ctx.textBaseline = 'middle'
    ctx.save()
    ctx.translate(handX, handY) // PIVOT = the hand = the HILT (bottom of the blade)
    ctx.rotate(swing)           // sweep the blade around the hilt
    ctx.rotate(Math.PI)         // flip the down-pointing glyph so the blade extends UP from the hilt
    // offset the glyph so its hilt sits at the pivot and the blade reaches up (toward the head)
    ctx.fillStyle = '#000000'
    ctx.fillText(player.weaponGlyph, 0, weaponSize * 0.45 + 1)
    ctx.fillStyle = '#e6e6e6'
    ctx.fillText(player.weaponGlyph, 0, weaponSize * 0.45)
    ctx.restore()
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}` // restore for the shield draw below
  }
  // A shield on the off-hand (left side), when equipped.
  if (player.shieldGlyph) {
    const shX = x - fontSize * 0.8
    const shY = y - lineHeight - breathe
    ctx.fillStyle = '#000000'
    ctx.fillText(player.shieldGlyph, shX + 1, shY + 1)
    ctx.fillStyle = '#9fd3ff'
    ctx.fillText(player.shieldGlyph, shX, shY)
  }
}

// Draw asset as ASCII art in isometric view (matching 2D style)
/** Draw a generated, labeled cell as a single glyph (its label char + zone color)
 *  on a subtle backing — one cell = one tile, matching the keystone model. */
// Apex signage per building TYPE — makes a store / hospital read at a glance.
const BUILDING_BADGES: Record<string, { text: string; color: string }> = {
  store: { text: 'STORE', color: '#ffe24a' }, // gold marquee on the blue store
  hospital: { text: 'HOSPITAL', color: '#ffffff' }, // white word on the green hospital (green+white identity)
}

// Apex roof glyph by type: a house PEAKS (▲ = triangle roof); every other type keeps the flat
// (squared) apex. Replaces the default roof_top glyph for that one cell.
const ROOF_APEX_GLYPH: Record<string, string> = { house: '▲' }

function drawIsoLabeledCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileH: number,
): void {
  const char = asset.art[0] ?? '?'
  const fontSize = tileH * 1.25
  // Sit the glyph ON its own cell (same anchor as the ground glyph: p.y -
  // heightOffset). The old half-tile lift floated the canopy ~half a cell north
  // of the cell it actually blocks, so leaves *looked* passable. Aligned now:
  // the leaf you see is the cell that blocks; only the canopy TOP stays walkable.
  const cy = y
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Monospace single glyph → advance ≈ 0.6em. Avoids a per-cell measureText(), the
  // canvas-2D layout call that tanked iso FPS on dense (forest) stages.
  const w = fontSize * 0.6
  // Building cells FILL with their own part color so a dark door + a glass/lit window read as
  // solid coloured blocks (a dark glyph on a black backing was invisible). Trees keep the plain
  // dark backing behind their canopy glyph.
  const base = asset.color ?? '#cccccc'
  ctx.fillStyle = asset.type === 'building' ? darkenColor(base, 0.28) : 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(x - w / 2 - 2, cy - fontSize * 0.55, w + 4, fontSize * 1.1)
  // Roof shape by building type: houses peak (▲), squared "buildings" stay flat.
  const glyph = asset.label === 'roof_top' ? (ROOF_APEX_GLYPH[asset.buildingType ?? ''] ?? char) : char
  ctx.fillStyle = base
  ctx.fillText(glyph, x, cy)

  // Type signage on the apex: a "STORE" marquee, a red hospital cross. Only the ONE
  // roof_top cell per building hits this → the measureText here is rare, not per-cell.
  if (asset.label === 'roof_top' && asset.buildingType) {
    const badge = BUILDING_BADGES[asset.buildingType]
    if (badge) {
      const bf = fontSize * (badge.text.length > 1 ? 0.5 : 0.9)
      ctx.font = `bold ${bf}px ${ASCII_FONT}`
      const by = cy - fontSize * 0.95
      const bw = ctx.measureText(badge.text).width
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
      ctx.fillRect(x - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
      ctx.fillStyle = badge.color
      ctx.fillText(badge.text, x, by)
    }
  }
}

/** An enemy that's been killed and is waiting to respawn (no live combat state). */
function isDeadEnemy(entity: Entity, combat: CombatState | undefined): boolean {
  if (entity.kind !== 'enemy') return false
  return !!combat && isDead(combat.hp)
}

/** Fraction (0..1) of an enemy's HP remaining; 1 if no runtime state yet. */
function hpFraction(entity: Entity, combat: CombatState | undefined): number {
  if (!combat) return 1
  if (entity.baseStats.maxHp <= 0) return 0
  return Math.max(0, Math.min(1, combat.hp / entity.baseStats.maxHp))
}

/** Color the HP bar fill green→amber→red as the enemy is whittled down. */
function hpBarColor(fraction: number): string {
  if (fraction > 0.5) return '#4ade80'
  if (fraction > 0.25) return '#facc15'
  return '#f87171'
}

/** Draw a small HP bar centred at (x,y) — shared by iso + top enemy rendering. */
function drawHpBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fraction: number,
): void {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.fillRect(x - width / 2 - 1, y - 1, width + 2, height + 2)
  ctx.fillStyle = '#3a1414'
  ctx.fillRect(x - width / 2, y, width, height)
  ctx.fillStyle = hpBarColor(fraction)
  ctx.fillRect(x - width / 2, y, width * fraction, height)
}

/** Draw a fading "+N" damage number that drifts upward over its lifetime. */
function drawHitMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  marker: HitMarker,
  now: number,
): void {
  const age = (now - marker.bornAt) / HIT_MARKER_MS
  if (age >= 1) return
  const rise = age * 24
  ctx.globalAlpha = 1 - age
  ctx.font = `bold 16px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000000'
  ctx.fillText(`-${marker.amount}`, x + 1, y - 18 - rise + 1)
  ctx.fillStyle = marker.target === 'enemy' ? '#ffd166' : '#ff6b6b'
  ctx.fillText(`-${marker.amount}`, x, y - 18 - rise)
  ctx.globalAlpha = 1
}

// Quest indicators floating above entities: a gold "!" over a giver, an amber "◆"
// over a quest-linked enemy. Colors echo the quest UI's orange accent.
const QUEST_GIVER_COLOR = '#ffe14d'
const QUEST_TARGET_COLOR = '#ff9f1c'

/** Draw centred text with a 1px black drop-shadow then a bright fill — legible over any map tile. */
function drawShadowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  font: string,
): void {
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000000'
  ctx.fillText(text, x + 1, y + 1)
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

/** Draw the above-entity quest marker (shared by iso / 2D / top views). */
function drawQuestMarker(
  ctx: CanvasRenderingContext2D,
  marker: QuestMarker,
  x: number,
  y: number,
  size: number,
): void {
  if (!marker) return
  if (marker === 'giver') {
    drawShadowText(ctx, '!', x, y, QUEST_GIVER_COLOR, `bold ${size}px ${ASCII_FONT}`)
    return
  }
  drawShadowText(ctx, '◆', x, y, QUEST_TARGET_COLOR, `bold ${size * 0.8}px ${ASCII_FONT}`)
}

/** Draw a placed entity as its glyph on a dark backing, in the ISO renderer.
 *  (x,y) is the screen centre of the entity's cell; sits ON TOP of ground/assets.
 *  Living enemies get a small HP bar floating above them. */
/** Idle-animation clock. Returns 0 in non-browser contexts (jest), so draws are pure there. */
const IDLE_FRAME_MS = 480
const idleNow = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)
const idleFrame = (): number => Math.floor(idleNow() / IDLE_FRAME_MS)

// An enemy within this many cells of the player reads as "in combat".
const COMBAT_RANGE = 1.6
/** The entity's animation frame, gated on movement: idle HOLDS a static pose (no leg/arm
 *  swap over time), walk swaps the base/alt art (frame 0/1) only while the entity is moving,
 *  and combat swaps when an enemy is in range. Pure selection lives in engine/entityAnim. */
const ENTITY_FRAME_COUNT = 2 // entity art has a base pose (0) and an alt pose (1)
function entityAnimFrame(entity: Entity, now: number, moving: boolean, inRange: boolean): readonly string[] {
  const state = entityAnimState({ moving, inRange, kind: entity.kind })
  return entityArtFrame(entity, entityFrameIndex(state, now, ENTITY_FRAME_COUNT))
}

function drawIsoEntity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  entity: Entity,
  tileH: number,
  combat?: CombatState,
  now: number = idleNow(),
  moving = false,
  inRange = false,
): { x: number; y: number } {
  // Multi-row ASCII creature, drawn bottom-to-top. The frame comes from the animation
  // engine (frameAt): idle bob when still, a faster step cycle while moving, an attack
  // cadence when the player is in range — built on top of the existing base/alt art.
  const art = entityAnimFrame(entity, now, moving, inRange)
  // Same scale as drawIsoPlayer, so NPCs/monsters stand as tall as the player
  // (a 3-row figure ≈ 2 cells tall), not a squished 1×1.
  const fontSize = tileH * 1.2
  const lineHeight = tileH * 1.4
  const baseY = y - lineHeight * 0.5
  // LEFT-align all rows on a shared origin (monospace advance ≈ 0.6em) so the figure's
  // shape holds together — centering each row independently mangles real ASCII art.
  const charW = fontSize * 0.6
  const maxW = art.reduce((m, r) => Math.max(m, r.length), 0)
  const leftX = x - (maxW * charW) / 2
  // Ground shadow sized to the figure so it always reads (not hidden behind it).
  drawGroundShadow(ctx, x, baseY + tileH * 0.1, (maxW * charW) / 2)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const pal = entityPalette(entity)
  drawBlockFigure(ctx, art, leftX, baseY, lineHeight, charW, pal.fg, pal.bg)

  // Top of the figure — where above-entity overlays (quest marker) anchor.
  const figureTop = baseY - art.length * lineHeight
  if (entity.kind !== 'enemy') return { x, y: figureTop - lineHeight * 0.5 }

  // Bigger, thicker enemy HP bar (was tileH*1.4 × 4) so it reads at a glance.
  const barWidth = Math.max(28, tileH * 2.2)
  drawHpBar(ctx, x, figureTop, barWidth, 7, hpFraction(entity, combat))
  // Enemy name above the bar, shadow-text style.
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, tileH * 0.95)
  const nameY = figureTop - nameSize * 0.85
  drawShadowText(ctx, label, x, nameY, '#ffe8c2', `bold ${nameSize}px ${ASCII_FONT}`)
  return { x, y: nameY - nameSize * 0.9 }
}

/** Draw a placed entity in the TOP (blueprint) renderer — a filled cell badge
 *  with the glyph, drawn over ground/assets/player so it always reads. Living
 *  enemies get a thin HP bar across the top edge of their cell. */
function drawTopEntity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  entity: Entity,
  combat?: CombatState,
  now: number = idleNow(),
  moving = false,
  inRange = false,
): { x: number; y: number } {
  // The figure spans a footprint (a 3-row figure ≈ 2 cells tall, 1 wide) anchored so
  // the entity's cell is the BOTTOM cell — matching the player's 2-tall look in top view.
  const art = entityAnimFrame(entity, now, moving, inRange)
  const cellsTall = Math.max(2, Math.ceil(art.length / 1.5))
  const spanH = cellsTall * tileSize
  const topY = y - (cellsTall - 1) * tileSize
  const fontSize = Math.max(6, (spanH * 0.9) / art.length)
  const charW = fontSize * 0.6
  const maxW = art.reduce((m, r) => Math.max(m, r.length), 0)
  const cx = x + tileSize / 2
  const textLeft = cx - (maxW * charW) / 2
  const startY = topY + spanH / 2 - ((art.length - 1) / 2) * fontSize

  // Ground shadow at the figure's feet (bottom row) — sized to the figure.
  drawGroundShadow(ctx, cx, startY + (art.length - 1) * fontSize + fontSize * 0.35, (maxW * charW) / 2)
  // NO background panel — the figure draws directly on the map (a colored box behind
  // every monster/NPC made stages unreadable). A 1px shadow keeps it legible.
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  // Block style — solid bg per row + bright glyph, so the 2D view matches the iso view.
  const pal = entityPalette(entity)
  for (let i = 0; i < art.length; i++) {
    const line = art[i]
    const ly = startY + i * fontSize
    const s = line.length - line.trimStart().length
    const en = line.trimEnd().length
    if (en > s) {
      ctx.fillStyle = pal.bg
      ctx.fillRect(textLeft + s * charW - 1, ly - fontSize * 0.42, (en - s) * charW + 2, fontSize * 0.82)
    }
    ctx.fillStyle = '#000000'
    ctx.fillText(line, textLeft + 1, ly + 1)
    ctx.fillStyle = pal.fg
    ctx.fillText(line, textLeft, ly)
  }

  // Top of the figure — where above-entity overlays (quest marker) anchor.
  const figureTop = topY - 4
  if (entity.kind !== 'enemy') return { x: cx, y: figureTop - fontSize * 0.6 }

  // Bigger, thicker enemy HP bar (was figure-width × 3) so it reads at a glance.
  const barWidth = Math.max(maxW * charW, tileSize * 2.2)
  drawHpBar(ctx, cx, figureTop, barWidth, 6, hpFraction(entity, combat))
  // Enemy name above the bar, shadow-text style.
  const label = entity.name ?? entity.enemyType ?? 'Enemy'
  const nameSize = Math.max(9, fontSize)
  const nameY = figureTop - nameSize * 0.85
  drawShadowText(ctx, label, cx, nameY, '#ffe8c2', `bold ${nameSize}px ${ASCII_FONT}`)
  return { x: cx, y: nameY - nameSize * 0.9 }
}

/** TOP (blueprint) view: an entity is a single `>` glyph colored by role — yellow player,
 *  red enemy, and NPCs blue / green (offers a quest) / purple (quest in progress). */
function drawTopArrow(ctx: CanvasRenderingContext2D, x: number, y: number, tileSize: number, color: string): void {
  const cx = x + tileSize / 2
  const cy = y + tileSize / 2
  ctx.font = `bold ${tileSize * 0.95}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillText('>', cx + 1, cy + 1)
  ctx.fillStyle = color
  ctx.fillText('>', cx, cy)
}

/** The 3 canopy layer styles (fg + bg) derived from ONE base tree color, so a
 *  legacy (hand-placed, label-less) tree's canopy tints to the asset's
 *  zone/theme color instead of a hardcoded spring green. The trunk stays bark —
 *  only the canopy (the "always green" part) follows the color. Shared by the iso
 *  and 2D legacy tree paths. */
function treeCanopyLayers(base: string, flicker: number): { fg: string; bg: string }[] {
  return [
    { fg: withAlpha(base, 0.7 + 0.3 * flicker), bg: darkenColor(base, 0.4) },
    { fg: withAlpha(lightenColor(base, 0.12), 0.8 + 0.2 * flicker), bg: darkenColor(base, 0.5) },
    { fg: withAlpha(base, 0.85 + 0.15 * flicker), bg: darkenColor(base, 0.45) },
  ]
}

/** Draw a generated, labeled cell as a single glyph (its label char + zone/theme
 *  color) on a dark backing in the 2D view — the cell IS the tile, matching the
 *  iso (drawIsoLabeledCell) and top renderers so a stage looks the same in
 *  every view (and a zone tree is NEVER spring-green). */
function draw2DLabeledCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  tileW: number,
  tileH: number,
  asset: GridAsset,
): void {
  const char = asset.art[0] ?? '?'
  const cy = baseY - tileH * 0.5
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(x - tileW / 2, cy - tileH / 2, tileW, tileH)
  ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
  ctx.fillStyle = asset.color ?? '#cccccc'
  ctx.fillText(char, x, cy)
}

/** One building FACADE cell rendered as a single tile, using the SAME tiles the layered
 *  house drew (|[]| windows, |==| door, /\ red roof). The cell's structural glyph picks which:
 *  ▀/▔ → red roof, ╫ → door, everything else (█ wall, ▒ window) → the gold |[]| body tile —
 *  so the body looks exactly like #16's dense windowed wall. Painting one tile per cell (not a
 *  whole house per cell) keeps the red roof to the facade's 2 top rows instead of a stack. */
function draw2DBuildingTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  tileW: number,
  tileH: number,
  asset: GridAsset,
  flicker: number,
): void {
  // Same palette the layered house used.
  const wallColor = 'rgba(180, 132, 65, 0.9)'
  const wallDarkColor = 'rgba(138, 98, 48, 0.9)'
  const roofColor = 'rgba(200, 64, 64, 0.95)'

  const glyph = asset.art[0] ?? '█'
  const isRoof = glyph === '▀' || glyph === '▔'
  const isDoor = glyph === '╫'
  const tile = isRoof
    ? { text: '/\\', fg: `rgba(255, 100, 80, ${0.8 + 0.2 * flicker})`, bg: roofColor }
    : isDoor
    ? { text: '|==|', fg: '#664422', bg: wallColor }
    : { text: '|[]|', fg: `rgba(255, 220, 80, ${0.5 + 0.3 * flicker})`, bg: wallColor } // wall + window → dense |[]| like #16

  const top = baseY - tileH
  ctx.fillStyle = tile.bg
  ctx.fillRect(cx - tileW * 0.5, top, tileW, tileH)

  // Side-wall seams on the gold body tiles (the "connected wall" look) — not on the roof.
  if (!isRoof) {
    ctx.fillStyle = wallDarkColor
    ctx.fillRect(cx - tileW * 0.5 - 2, top, 3, tileH)
    ctx.fillRect(cx + tileW * 0.5 - 1, top, 3, tileH)
  }

  ctx.font = `bold ${tileH * 0.85}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = tile.fg
  ctx.fillText(tile.text, cx, top + tileH * 0.5)
}

/** 2D FRONT ELEVATION of a building: its facade (b.cells — door-down, windows, peaked/flat roof on
 *  top) drawn upright over the small footprint's front edge. `centerX` is the footprint centre, `baseY`
 *  the bottom of the front row. The ground footprint stays width×depth (collision matches); only the
 *  drawn facade rises tall — the height/footprint decoupling, in 2D. */
function draw2DBuilding(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  centerX: number,
  baseY: number,
  tileW: number,
  tileH: number,
  flicker: number,
): void {
  // The 2D house stays UPRIGHT (roof on top). It shows its FRONT (door + windows) only on the
  // camera-NEAR facings (south/east — the same split iso uses via `facadeOnBack`); the FAR facings
  // (north/west) show a plain BACK wall, since a flat elevation can't show a door that faces away.
  // ~50/50 front/back, and the door indicator (render2D) marks the real entrance on the backs.
  const showFront = !isoFacadeOnBack(gridBuildingFacing(b))
  const cells = b.cells
  const L = cells[0]?.length ?? b.length
  const H = cells.length
  // Each cell gets its OWN background so a door reads as a dark doorway and a window as glass — not a
  // glyph on identical wall. Colors come from the shared per-building source (real-house wall tones,
  // dark doors, glass windows; store=blue roof, hospital=green roof) so 2D matches the other views.
  const t = b.type as BuildingType
  const a = (col: string): string => withAlpha(col, 0.96)
  const roofBg = a(buildingCellColor(t, 'roof', b.col))
  const roofGlyph = a(darkenColor(buildingCellColor(t, 'roof', b.col), 0.58)) // the /\ as a darker roof tone, so it reads
  const wallBg = a(buildingCellColor(t, 'wall', b.col))
  const doorBg = a(buildingCellColor(t, 'door', b.col))
  const windowBg = a(buildingCellColor(t, 'window', b.col))
  const wallSeam = a(darkenColor(buildingCellColor(t, 'wall', b.col), 0.72))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < L; c++) {
      const raw = cells[r]?.[c]
      if (!raw || raw === 'empty') continue
      // Back of the house → only the DOOR becomes wall (no entrance from behind); windows still show.
      const kind = !showFront && raw === 'door' ? 'wall' : raw
      const x = centerX + (c - (L - 1) / 2) * tileW
      const cellTop = baseY - (H - r) * tileH // row r (0 = roof apex) stacks up from the front edge
      const isRoof = kind === 'roof'
      const isDoor = kind === 'door'
      const isWindow = kind === 'window'
      ctx.fillStyle = isRoof ? roofBg : isDoor ? doorBg : isWindow ? windowBg : wallBg
      ctx.fillRect(x - tileW * 0.5, cellTop, tileW, tileH)
      // seams only on plain wall cells (the connected-wall look) — keep doors/windows clean
      if (!isRoof && !isDoor && !isWindow) {
        ctx.fillStyle = wallSeam
        ctx.fillRect(x - tileW * 0.5 - 1, cellTop, 2, tileH)
        ctx.fillRect(x + tileW * 0.5 - 1, cellTop, 2, tileH)
      }
      // detail glyph that READS on the cell's own background
      const glyph = isRoof ? '/\\' : isDoor ? '▯' : isWindow ? '⊞' : ''
      if (glyph) {
        ctx.fillStyle = isRoof
          ? roofGlyph // darker shade of THIS roof's color
          : isDoor
          ? 'rgba(232, 212, 170, 0.9)' // warm handle/panel on the dark door
          : 'rgba(40, 62, 84, 0.85)' // dark frame on the glass window
        ctx.font = `bold ${tileH * 0.7}px ${ASCII_FONT}`
        ctx.fillText(glyph, x, cellTop + tileH * 0.5)
      }
    }
  }
  // Type signage (STORE / HOSPITAL) above the roof apex — mirrors the iso badge so a shop / clinic
  // reads at a glance in 2D too. Only store + hospital carry a badge.
  const badge = BUILDING_BADGES[b.type]
  if (badge) {
    const topY = baseY - H * tileH
    const bf = tileH * (badge.text.length > 1 ? 0.55 : 1.0)
    ctx.font = `bold ${bf}px ${ASCII_FONT}`
    const bw = ctx.measureText(badge.text).width
    const by = topY - bf * 0.5
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(centerX - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
    ctx.fillStyle = badge.color
    ctx.fillText(badge.text, centerX, by)
  }
}

// Diablo/PoE-style proximity fade: a building goes semi-transparent when the player is within
// BUILDING_FADE_RADIUS cells, easing to BUILDING_MIN_ALPHA when standing on it, so an occluded
// (back-facing) door is findable on approach.
const BUILDING_FADE_RADIUS = 3.5
const BUILDING_MIN_ALPHA = 0.35

// ISO facing. Each building stands inside its plot RECT — cols [col, col+L] × the clear headroom
// rows ABOVE the frontage (that whole rect is road-free, verified on the grid). A facing keeps
// the footprint inside that rect by extruding UP into the headroom, never DOWN onto the street
// it fronts. `baseColFrac` is which end of the frontage the base starts at; `len`/`dep` are the
// grid axes the length + depth run along. Applied only when the rotated footprint fits (L < H);
// wide-short types (store/temple/castle) stay front-facing so they can't spill past the rect.
const ISO_FACINGS: { len: [number, number]; dep: [number, number]; baseColFrac: number }[] = [
  { len: [1, 0], dep: [0, -1], baseColFrac: 0 },  // faces down-left:  base +col,        depth up-right
  { len: [0, -1], dep: [-1, 0], baseColFrac: 1 }, // faces down-right: base up the right, depth up-left
]

type Pt = { x: number; y: number }
const ptAdd = (p: Pt, v: Pt): Pt => ({ x: p.x + v.x, y: p.y + v.y })
const ptScale = (v: Pt, k: number): Pt => ({ x: v.x * k, y: v.y * k })
const fillQuad = (ctx: CanvasRenderingContext2D, a: Pt, b: Pt, c: Pt, d: Pt): void => {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.fill()
}

/** One facade cell as an ISO PARALLELOGRAM: the bottom edge runs along `colVec` (the iso
 *  angle), the sides rise straight up by `cellH`. Same tile vocabulary as 2D (red /\ roof,
 *  gold |[]| body, |==| door) — just sheared onto the iso axis instead of a 90° rect. */
interface FacadeColors { wall: string; door: string; window: string; roof: string }

function drawIsoFacadeTile(ctx: CanvasRenderingContext2D, bl: Pt, colVec: Pt, cellH: number, kind: string, flicker: number, colors: FacadeColors): void {
  const up: Pt = { x: 0, y: -cellH }
  const br = ptAdd(bl, colVec)
  const tl = ptAdd(bl, up)
  const tr = ptAdd(br, up)
  const isRoof = kind === 'roof'
  const isDoor = kind === 'door'
  const isWindow = kind === 'window'
  // distinct per-cell bg from the SAME per-building palette as 2D (door = dark doorway, window = glass)
  const bg = isRoof ? colors.roof : isDoor ? colors.door : isWindow ? colors.window : colors.wall
  const fg = isRoof
    ? darkenColor(colors.roof, 0.58) // /\ as a darker shade of this roof
    : isDoor
    ? 'rgba(232, 212, 170, 0.9)' // warm handle on the dark door
    : isWindow
    ? 'rgba(40, 62, 84, 0.85)' // dark frame on the glass
    : darkenColor(colors.wall, 0.72)
  const glyph = isRoof ? '/\\' : isDoor ? '▯' : isWindow ? '⊞' : ''
  ctx.fillStyle = bg
  fillQuad(ctx, bl, br, tr, tl)
  if (!glyph) return
  ctx.font = `bold ${cellH * 0.62}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = fg
  ctx.fillText(glyph, (bl.x + tr.x) / 2, (bl.y + tr.y) / 2)
}

const ROOF_ROWS = 2 // facade roof is always the top 2 rows (mirrors composeBuilding)
const ROOF_OVERHANG = 0.3 // peaked-roof eaves stick out past the walls
const ROOF_RIDGE_FRAC = 0.46 // peaked-roof flat-top width as a fraction of length

/** ISO building = the 2D facade standing at its plot, sheared onto the iso angle, drawn as a
 *  SOLID box — all four walls + every roof face filled, so it never shows through from any
 *  facing — with the z-depth extruded along depthVec. Houses get a peaked (trapezoid-prism)
 *  roof, flat types a box slab; EVERY roof face is red. `origin` = front-bottom-left corner;
 *  `colVec` = per-column length step; `depthVec` = full z-depth back. */
function drawIsoBuilding(
  ctx: CanvasRenderingContext2D,
  b: GridBuilding,
  origin: Pt,
  colVec: Pt,
  depthVec: Pt,
  cellH: number,
  flicker: number,
): void {
  // Billboard size comes from the FACADE grid (b.cells), not the footprint span — for east/west
  // buildings the footprint rect is rotated (length/height swapped), so reading b.length/b.height
  // there would draw the facade with the wrong proportions.
  const L = b.cells[0]?.length ?? b.length
  const H = b.cells.length
  const bodyH = H - ROOF_ROWS // wall/window/door rows
  const up = (n: number): Pt => ({ x: 0, y: -n * cellH })
  // Houses peak (composeBuilding leaves empty corners in row 0); flat types keep a box roof.
  const peaked = (b.cells[0] ?? []).some(k => k === 'empty')

  // Per-building colors from the SAME source as 2D/top, so all three views agree. Wall + roof faces
  // are shaded by orientation (front brightest → back darkest); the facade tiles (door/windows) use
  // the full palette.
  const tcol = b.type as BuildingType
  const wallC = buildingCellColor(tcol, 'wall', b.col)
  const roofC = buildingCellColor(tcol, 'roof', b.col)
  const facadeColors: FacadeColors = {
    wall: withAlpha(wallC, 0.98),
    door: withAlpha(buildingCellColor(tcol, 'door', b.col), 0.98),
    window: withAlpha(buildingCellColor(tcol, 'window', b.col), 0.98),
    roof: withAlpha(roofC, 0.98),
  }
  const wallSide = withAlpha(wallC, 0.98) // solid wall faces (front is the facade tiles)
  const wallBack = withAlpha(darkenColor(wallC, 0.82), 0.98)
  const roofFront = withAlpha(roofC, 0.98) // every roof face = this roof's color, shaded by orientation
  const roofSlope = withAlpha(darkenColor(roofC, 0.8), 0.98)
  const roofTop = withAlpha(darkenColor(roofC, 0.9), 0.98)
  const roofBack = withAlpha(darkenColor(roofC, 0.66), 0.98)

  // ground corners + helper to lift a corner to the eaves (top of the walls)
  const fbl = origin
  const fbr = ptAdd(fbl, ptScale(colVec, L))
  const bbl = ptAdd(fbl, depthVec)
  const bbr = ptAdd(fbr, depthVec)
  const eave = (p: Pt): Pt => ptAdd(p, up(bodyH))

  // Paint the facade tiles (door/windows) onto one face. `base` is that face's bottom-left corner.
  const drawFacade = (base: Pt): void => {
    for (let r = 0; r < H; r++) {
      if (peaked && r < ROOF_ROWS) continue
      for (let c = 0; c < L; c++) {
        const kind = b.cells[r]?.[c]
        if (!kind || kind === 'empty') continue
        const bl = ptAdd(ptAdd(base, ptScale(colVec, c)), up(H - 1 - r))
        drawIsoFacadeTile(ctx, bl, colVec, cellH, kind, flicker, facadeColors)
      }
    }
  }

  // North/west houses front a road on the camera-FAR side: draw their facade on the BACK face
  // FIRST so the solid box occludes it (door toward the road, never toward the near grass).
  if (b.facadeOnBack) drawFacade(bbl)

  // ── WALL BODY (solid box, ground → eaves): both sides + the non-facade face ──
  ctx.fillStyle = wallBack
  if (b.facadeOnBack) fillQuad(ctx, fbl, fbr, eave(fbr), eave(fbl)) // plain FRONT wall (camera side)
  else fillQuad(ctx, bbl, bbr, eave(bbr), eave(bbl)) // plain BACK wall (facade is on the front)
  ctx.fillStyle = wallSide
  fillQuad(ctx, fbl, bbl, eave(bbl), eave(fbl)) // left
  fillQuad(ctx, fbr, bbr, eave(bbr), eave(fbr)) // right

  // ── ROOF (all faces red) ──
  if (peaked) {
    const rh = (L * ROOF_RIDGE_FRAC) / 2
    const FEL = ptAdd(eave(fbl), ptScale(colVec, -ROOF_OVERHANG))
    const FER = ptAdd(eave(fbr), ptScale(colVec, ROOF_OVERHANG))
    const BEL = ptAdd(FEL, depthVec)
    const BER = ptAdd(FER, depthVec)
    const FRL = ptAdd(ptAdd(fbl, ptScale(colVec, L / 2 - rh)), up(H))
    const FRR = ptAdd(ptAdd(fbl, ptScale(colVec, L / 2 + rh)), up(H))
    const BRL = ptAdd(FRL, depthVec)
    const BRR = ptAdd(FRR, depthVec)
    ctx.fillStyle = roofBack
    fillQuad(ctx, BEL, BER, BRR, BRL) // back trapezoid
    ctx.fillStyle = roofSlope
    fillQuad(ctx, FEL, BEL, BRL, FRL) // left slope
    fillQuad(ctx, FER, BER, BRR, FRR) // right slope
    ctx.fillStyle = roofTop
    fillQuad(ctx, FRL, FRR, BRR, BRL) // flat top
    ctx.fillStyle = roofFront
    fillQuad(ctx, FEL, FER, FRR, FRL) // front trapezoid (the `‾\_/‾`)
  } else {
    const top = (p: Pt): Pt => ptAdd(p, up(H))
    ctx.fillStyle = roofBack
    fillQuad(ctx, eave(bbl), eave(bbr), top(bbr), top(bbl))
    ctx.fillStyle = roofSlope
    fillQuad(ctx, eave(fbl), eave(bbl), top(bbl), top(fbl)) // left
    fillQuad(ctx, eave(fbr), eave(bbr), top(bbr), top(fbr)) // right
    ctx.fillStyle = roofTop
    fillQuad(ctx, top(fbl), top(fbr), top(bbr), top(bbl))
    ctx.fillStyle = roofFront
    fillQuad(ctx, eave(fbl), eave(fbr), top(fbr), top(fbl))
  }

  // ── FRONT FACADE TILES (on top of the box, nearest the camera) for south/east houses ──
  if (!b.facadeOnBack) drawFacade(fbl)

  // ── TYPE SIGNAGE (STORE / HOSPITAL) floating above the roof apex — mirrors the 2D/top badge
  //    (black pill + colored text) so a shop / clinic reads at a glance in iso too. Only
  //    store + hospital carry a badge. Projected at the footprint-centre lifted to the roof top.
  const badge = BUILDING_BADGES[b.type]
  if (badge) {
    const apex = ptAdd(ptAdd(ptAdd(fbl, ptScale(colVec, L / 2)), ptScale(depthVec, 0.5)), up(H))
    const bf = cellH * (badge.text.length > 1 ? 0.7 : 1.1)
    ctx.font = `bold ${bf}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const bw = ctx.measureText(badge.text).width
    const by = apex.y - bf * 0.9 // sit just above the apex
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.fillRect(apex.x - bw / 2 - 3, by - bf * 0.65, bw + 6, bf * 1.3)
    ctx.fillStyle = badge.color
    ctx.fillText(badge.text, apex.x, by)
  }
}

function drawIsoAssetAscii(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  tileW: number,
  tileH: number,
  time: number,
  groundContact = false,
) {
  const lineHeight = tileH * 1.3
  const fontSize = tileH * 1.1
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Generated multi-cell assets carry a cell-part label → draw each cell as ONE
  // glyph (the cell IS the tile). The layered art below is for legacy single-cell,
  // manually-placed assets only.
  if (asset.label) {
    drawIsoLabeledCell(ctx, x, y, asset, tileH)
    return
  }

  // Authored animation cycles (author panel) OVERRIDE static type rendering with the live
  // frame — applies to ANY asset the user animated. No cycles → normal rendering below.
  const cycleArt = assetCycleFrame(asset.cycles, time)
  if (cycleArt) {
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(cycleArt[0] ?? '?', x, layerY)
    return
  }

  if (asset.type === 'tree') {
    // Tree: bark trunk + layered canopy. The canopy tints to the asset's
    // zone/theme color (never hardcoded green); the trunk stays bark.
    const canopy = treeCanopyLayers(asset.color || '#2e8b2e', flicker)
    // Canopy is an UPRIGHT pyramid: widest just above the trunk, narrowing to the apex
    // at the top. (Layer i rises up the screen as i grows, so wide base = drawn first.)
    const layers = [
      { text: '0', color: '#ad8621', bg: '#5a4510' },  // Trunk bottom
      { text: 'W', color: '#c9a030', bg: '#6a5520' },  // Trunk top
      { text: '(@&@&@)', color: canopy[0].fg, bg: canopy[0].bg }, // wide base
      { text: '(@&@)', color: canopy[1].fg, bg: canopy[1].bg },   // mid
      { text: '(&)', color: canopy[2].fg, bg: canopy[2].bg },     // narrow apex
    ]
    // Ground shadow ONLY on the tree's bottom (ground-contact) cell — never every cell.
    if (groundContact) {
      ctx.save()
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.beginPath()
      ctx.ellipse(x, y, tileW * 0.55, tileH * 0.5, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      // Bigger font at the wide base, smaller toward the apex → a crisp upright pyramid.
      const layerFontSize = i < 2 ? fontSize * 0.9 : fontSize * (0.85 - (i - 2) * 0.05)
      ctx.font = `bold ${layerFontSize}px ${ASCII_FONT}`

      // Background shape
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      // Text
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'building') {
    // Building: connected structure with walls, windows, and peaked roof
    // Use consistent width and visual connection between layers
    const buildingWidth = tileW * 2.2
    const wallColor = '#b48441'
    const wallDarkColor = '#8a6230'
    const roofColor = '#cc4040'
    const roofDarkColor = '#992020'

    const layers = [
      { text: '|==|', color: '#664422', bg: wallColor, width: 1.0 },          // Base/door
      { text: '|[]|', color: `rgba(255, 220, 80, ${0.5 + 0.3 * flicker})`, bg: wallColor, width: 1.0 },   // Window floor 1
      { text: '|[]|', color: `rgba(255, 200, 60, ${0.4 + 0.3 * flicker})`, bg: wallDarkColor, width: 1.0 }, // Window floor 2
      { text: '/==\\', color: roofColor, bg: roofDarkColor, width: 1.1 },     // Roof eave
      { text: '/\\', color: `rgba(255, 100, 80, ${0.8 + 0.2 * flicker})`, bg: roofColor, width: 0.7 },    // Roof peak
    ]

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerWidth = buildingWidth * layer.width

      // Background - maintains visual connection
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - layerWidth / 2, layerY - lineHeight / 2, layerWidth, lineHeight)

      // Draw connecting side walls for wall sections
      if (i < 3) {
        ctx.fillStyle = wallDarkColor
        ctx.fillRect(x - layerWidth / 2 - 2, layerY - lineHeight / 2, 3, lineHeight)
        ctx.fillRect(x + layerWidth / 2 - 1, layerY - lineHeight / 2, 3, lineHeight)
      }

      // Character
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'lamp' || asset.type === 'lantern') {
    // Lamp post with glowing top
    const glow = lampPulse(time) // looping lamp animation (behaviors module)
    const layers = [
      { text: '|', color: '#666666', bg: '#333333' },
      { text: '|', color: '#777777', bg: '#444444' },
      { text: 'o', color: `rgba(255, 220, 50, ${glow})`, bg: `rgba(100, 80, 0, ${glow})` },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'bush') {
    // Small bush
    const layers = [
      { text: '*', color: `rgba(80, 200, 80, ${0.8 + 0.2 * flicker})`, bg: 'rgba(0, 100, 0, 0.85)' },
      { text: '**', color: `rgba(60, 180, 60, ${0.85 + 0.15 * flicker})`, bg: 'rgba(0, 90, 0, 0.8)' },
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5

      ctx.font = `bold ${fontSize * 0.9}px ${ASCII_FONT}`
      ctx.fillStyle = layer.bg
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'npc') {
    // NPC character - cleaner humanoid figure
    // Stack: legs, body/arms, head with face
    const layers = [
      { text: '/\\', color: '#3355aa', bg: '#1a2a55' },     // Legs (pants)
      { text: '[=]', color: '#4466cc', bg: '#223366' },    // Body/torso
      { text: '(o)', color: '#ffccaa', bg: '#996644' },    // Head with simple face
    ]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const layerY = y - i * lineHeight - lineHeight * 0.5
      const layerFontSize = i === 2 ? fontSize * 0.95 : fontSize  // Slightly smaller head

      ctx.font = `bold ${layerFontSize}px ${ASCII_FONT}`

      // Background for visibility
      const textWidth = ctx.measureText(layer.text).width
      ctx.fillStyle = layer.bg
      ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)

      // Shadow
      ctx.fillStyle = '#000000'
      ctx.fillText(layer.text, x + 1, layerY + 1)
      // Character
      ctx.fillStyle = layer.color
      ctx.fillText(layer.text, x, layerY)
    }

  } else if (asset.type === 'flower') {
    // Small flower — ambient sway driven by the animation engine (assetAnimFrame).
    ctx.font = `bold ${fontSize * 0.8}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.3
    ctx.fillStyle = asset.color || '#ff88cc'
    ctx.fillText(assetAnimFrame('flower', time)?.[0] ?? '+', x, layerY)

  } else if (asset.type === 'rock' || asset.type === 'decoration') {
    // Rock/decoration
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    const layerY = y - lineHeight * 0.5
    ctx.fillStyle = '#555555'
    ctx.fillRect(x - tileW / 2, layerY - lineHeight / 2, tileW, lineHeight)
    ctx.fillStyle = '#999999'
    ctx.fillText('O', x, layerY)

  } else {
    // Default: show the asset's art character
    const char = asset.art[0] || '?'
    const layerY = y - lineHeight * 0.5
    ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
    ctx.fillStyle = darkenColor(asset.color || '#888888', 0.4)
    const textWidth = ctx.measureText(char).width
    ctx.fillRect(x - textWidth / 2 - 2, layerY - lineHeight / 2, textWidth + 4, lineHeight)
    ctx.fillStyle = asset.color || '#ffffff'
    ctx.fillText(char, x, layerY)
  }
}

// 2D Render function - RPG-style 3/4 top-down view (like Pokemon/Zelda)
function render2D(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  time: number,
  zoom: number = 1.0,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  connectors: Connector[] = [],
  quests: readonly Quest[] = [],
) {
  // Clear with sky/background color
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, w, h)

  const cellSize = grid.cellSize
  const baseTileSize = 24
  const tileW = baseTileSize * zoom // Tile width in pixels
  const tileH = baseTileSize * zoom // Tile height in pixels
  const heightScale = 16 * zoom // Pixels per height unit (objects extend upward)

  // Camera follows player (centered) + pan offset
  const camCol = player.x / cellSize - camOffset.x / tileW
  const camRow = player.z / cellSize - camOffset.y / tileH

  // Convert grid position to screen
  const toScreen = (col: number, row: number) => ({
    x: w / 2 + (col - camCol) * tileW,
    y: h / 2 + (row - camRow) * tileH
  })

  // Calculate visible range
  const tilesX = Math.ceil(w / tileW) + 4
  const tilesY = Math.ceil(h / tileH) + 4
  const startCol = Math.floor(camCol) - Math.floor(tilesX / 2)
  const startRow = Math.floor(camRow) - Math.floor(tilesY / 2)

  // ─── GROUND LAYER ─────────────────────────────────────────────────
  for (let row = startRow; row < startRow + tilesY; row++) {
    for (let col = startCol; col < startCol + tilesX; col++) {
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const p = toScreen(col + 0.5, row + 0.5)
      if (p.x < -tileW || p.x > w + tileW || p.y < -tileH || p.y > h + tileH) continue

      const tileType = grid.ground[row]?.[col] || 'grass'
      const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass

      // Use noise-based variation for natural look (not checkerboard)
      // Create larger patches using position-based pseudo-noise
      const noiseVal = Math.sin(col * 0.3 + row * 0.5) * Math.cos(col * 0.7 - row * 0.2)
      const colorIdx = noiseVal > 0 ? 0 : 1 // Smooth patches instead of checkerboard

      const char = colors.char[colorIdx % colors.char.length]
      const fg = colors.fg[colorIdx % colors.fg.length]
      // Grass varies per-cell into natural green tones (deterministic hash); other ground
      // keeps its uniform floor base.
      const bg = tileType.includes('grass') ? grassShade(colors.bg[0], col, row) : colors.bg[0]

      // Draw ground tile
      ctx.fillStyle = bg
      ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)

      // Draw ground character with slight animation
      const grassFlicker = tileType.includes('grass') ? Math.sin(time * 0.001 + col * 0.3 + row * 0.4) * 0.1 + 1 : 1
      ctx.fillStyle = fg
      ctx.globalAlpha = 0.85 + 0.15 * grassFlicker
      ctx.font = `bold ${tileH * 0.7}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(char, p.x, p.y)
      ctx.globalAlpha = 1

      // Height creates elevated platforms - draw "front face" if height > 0
      const cellHeight = grid.getHeight(col, row)
      if (cellHeight > 0) {
        const elevH = cellHeight * heightScale
        // Top surface (slightly brighter)
        ctx.fillStyle = bg
        ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2 - elevH, tileW, tileH)
        ctx.fillStyle = fg
        ctx.fillText(char, p.x, p.y - elevH)
        // Front face (darker)
        ctx.fillStyle = darkenColor(bg, 0.6)
        ctx.fillRect(p.x - tileW / 2, p.y + tileH / 2 - elevH, tileW, elevH)
      }
    }
  }

  // ─── CONNECTOR MARKERS (one per owned cell, same purple ◊ as top view) ──
  for (const connector of connectors) {
    for (const pcell of connector.cells) {
      const p = toScreen(pcell.col + 0.5, pcell.row + 0.5)
      if (p.x < -tileW || p.x > w + tileW || p.y < -tileH || p.y > h + tileH) continue
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${tileH * 0.6}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('◊', p.x, p.y)
    }
  }

  // ─── OBJECTS LAYER (sorted by row for depth) ─────────────────────
  // Collect all drawable objects: assets + buildings + player
  const drawables: Array<{
    row: number
    col: number
    type: 'asset' | 'player' | 'building'
    asset?: GridAsset
    building?: GridBuilding
  }> = []

  // Buildings render as ONE front elevation (from grid.buildings) — collect their footprint cells
  // so we SKIP the per-cell building assets (a roof from above), exactly like the iso view. Legacy
  // █ buildings aren't grouped (grid.buildings empty), so they fall through and render per-cell.
  const buildingFootprint2D = new Set<string>()
  for (const b of grid.buildings ?? []) {
    const top = b.row - (b.height - 1)
    for (let r = 0; r < b.height; r++) for (let c = 0; c < b.length; c++) buildingFootprint2D.add(`${b.col + c},${top + r}`)
  }

  // Add assets (skip the per-cell building footprint cells — the elevation replaces them)
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(camCol), Math.floor(camRow), tilesX, tilesY
  )
  const treeCells2D = new Set(grid.assets.filter(a => a.type === 'tree').map(a => `${a.col},${a.row}`))
  const isTreeCell2D = (c: number, r: number): boolean => treeCells2D.has(`${c},${r}`)
  for (const asset of visibleAssets) {
    if (asset.type === 'building' && buildingFootprint2D.has(`${asset.col},${asset.row}`)) continue
    drawables.push({ row: asset.row, col: asset.col, type: 'asset', asset })
  }

  // Add buildings as front elevations, anchored at their front (bottom) row + footprint centre.
  for (const b of grid.buildings ?? []) {
    drawables.push({ row: b.row, col: b.col + b.length / 2, type: 'building', building: b })
  }

  // Add player
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize
  drawables.push({ row: playerRow, col: playerCol, type: 'player' })

  // Sort by row (things further up screen drawn first = behind)
  drawables.sort((a, b) => a.row - b.row)

  // Draw each object
  for (const obj of drawables) {
    const p = toScreen(obj.col + 0.5, obj.row + 0.5)
    const groundHeight = grid.getHeight(Math.floor(obj.col), Math.floor(obj.row))
    const elevOffset = groundHeight * heightScale

    if (obj.type === 'player') {
      // Draw player using ASCII art sprite - grounded at cell bottom (lifted mid-jump)
      const playerArt = getPlayerArt(player)
      const baseY = p.y + tileH * 0.5 - elevOffset - (player.jumpHeight ?? 0)

      // Draw each line of the ASCII art, stacking upward from baseY
      const fontSize = tileH * 0.7
      const lineHeight = fontSize * 0.9
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw each line from bottom to top (no background)
      const bodyColor = player.armored ? '#bcd4ff' : '#ffdd00'
      for (let i = 0; i < playerArt.length; i++) {
        const line = playerArt[playerArt.length - 1 - i] // Reverse order (bottom to top)
        const lineY = baseY - (i + 0.5) * lineHeight
        ctx.fillStyle = bodyColor
        ctx.fillText(line, p.x, lineY)
      }
      // Held weapon beside the figure (changes when you equip a different weapon).
      if (player.weaponGlyph) {
        ctx.fillStyle = '#e0e0e0'
        ctx.fillText(player.weaponGlyph, p.x + fontSize * 0.6, baseY - lineHeight * 1.2)
      }
      // Shield on the off-hand, when equipped.
      if (player.shieldGlyph) {
        ctx.fillStyle = '#9fd3ff'
        ctx.fillText(player.shieldGlyph, p.x - fontSize * 0.6, baseY - lineHeight * 1.2)
      }

    } else if (obj.type === 'building' && obj.building) {
      // ONE upright FRONT ELEVATION over the small footprint, oriented so the door faces the road,
      // raised from the building's facade — the same grid.buildings the iso reads, so 2D + iso +
      // collision agree on one model.
      const b = obj.building
      const flicker = Math.sin(time * 0.003 + b.col * 0.5 + b.row * 0.7) * 0.15 + 1
      draw2DBuilding(ctx, b, p.x, p.y + tileH * 0.5, tileW, tileH, flicker)

      // Subtle interactive-entrance marker on the door cell: a small warm chevron, so the player
      // can tell which cell opens the building (the lone walkable footprint cell).
      const door = doorCellFor(gridBuildingFacing(b), buildingRect(b))
      const dp = toScreen(door.col + 0.5, door.row + 0.5)
      ctx.fillStyle = `rgba(255, 198, 92, ${0.55 + 0.25 * flicker})`
      ctx.font = `bold ${tileH * 0.62}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('▾', dp.x, dp.y)

    } else if (obj.asset) {
      const asset = obj.asset

      // Get proper height for 2D RPG view based on asset type
      let heightTiles = 1
      if (asset.type === 'tree') heightTiles = 3
      else if (asset.type === 'building') heightTiles = 4
      else if (asset.type === 'lamp') heightTiles = 2

      // Base at bottom of cell - tiles stack upward
      const baseY = p.y + tileH * 0.5 - elevOffset

      ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Draw based on asset type - VIBRANT test-ascii style (Crash Bandicoot palette)
      // Animation flicker based on time
      const flicker = Math.sin(time * 0.003 + obj.col * 0.5 + obj.row * 0.7) * 0.15 + 1

      if (asset.label) {
        // Generated multi-cell cell → one glyph in its zone/theme color (the cell
        // IS the tile), matching the iso + top views. No green multi-tile overdraw.
        draw2DLabeledCell(ctx, p.x, baseY, tileW, tileH, asset)
      } else if (asset.type === 'tree') {
        // Layered tree: bark trunk + canopy tinted to the asset's zone/theme color.
        const canopy = treeCanopyLayers(asset.color || '#2e8b2e', flicker)
        // Ground shadow on the tree's base: a generator-marked base cell (always, even when
        // stacked on another tree) or any bottom (ground-contact) cell.
        if (asset.baseShadow || isGroundContact(isTreeCell2D, asset.col, asset.row)) {
          ctx.save()
          ctx.fillStyle = 'rgba(0, 0, 0, 0.25)'
          ctx.beginPath()
          ctx.ellipse(p.x, baseY, tileW * 0.5, tileH * 0.45, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        const trunkChars = ['W', '0', 'W']
        for (let h = 0; h < 2; h++) {
          const tileTop = baseY - (h + 1) * tileH
          ctx.fillStyle = `rgba(173, 134, 33, 0.96)` // Golden brown
          ctx.fillRect(p.x - tileW * 0.35, tileTop, tileW * 0.7, tileH)
          ctx.fillStyle = `rgba(243, 191, 54, ${0.7 + 0.3 * flicker})` // Bright gold
          ctx.fillText(trunkChars[h] || '0', p.x, tileTop + tileH * 0.5)
        }
        // Layered canopy - tinted to the asset's zone/theme color
        // Upright pyramid: wide base above the trunk (drawn first/lowest), narrow apex on top.
        const layers = [
          { chars: '(@&@&@)', width: 2.0, bg: canopy[0].bg, fg: canopy[0].fg }, // wide base
          { chars: '(@&@)', width: 1.6, bg: canopy[1].bg, fg: canopy[1].fg },   // mid
          { chars: '(&)', width: 1.2, bg: canopy[2].bg, fg: canopy[2].fg },     // apex
        ]
        for (let h = 0; h < layers.length; h++) {
          const layer = layers[h]
          const tileTop = baseY - (h + 3) * tileH
          ctx.fillStyle = layer.bg
          ctx.fillRect(p.x - tileW * layer.width * 0.5, tileTop, tileW * layer.width, tileH)
          ctx.fillStyle = layer.fg
          ctx.font = `bold ${tileH * 0.65}px ${ASCII_FONT}`
          ctx.fillText(layer.chars, p.x, tileTop + tileH * 0.5)
        }
        ctx.font = `bold ${tileH * 0.8}px ${ASCII_FONT}`

      } else if (asset.type === 'building') {
        // ONE tile per facade cell (red roof / gold |[]| body / |==| door, picked by the
        // cell's glyph) — the SAME tiles as the old layered house, but not a whole house per
        // cell. That keeps the red roof to the facade's 2 top rows: a compact house.
        draw2DBuildingTile(ctx, p.x, baseY, tileW, tileH, asset, flicker)

      } else if (asset.type === 'lamp') {
        // Animated lantern - yellow glow that flickers
        ctx.fillStyle = '#333333'
        ctx.fillRect(p.x - tileW * 0.12, baseY - tileH * 2, tileW * 0.24, tileH * 2)
        ctx.fillStyle = '#555555'
        ctx.fillText('|', p.x, baseY - tileH * 0.5)
        // Glowing lamp top
        ctx.fillStyle = `rgba(255, 255, 0, ${0.6 + 0.4 * flicker})`
        ctx.fillRect(p.x - tileW * 0.25, baseY - tileH * 2.4, tileW * 0.5, tileH * 0.5)
        ctx.fillStyle = `rgba(255, 200, 50, ${0.7 + 0.3 * flicker})`
        ctx.fillText('o', p.x, baseY - tileH * 2.2)

      } else if (asset.type === 'npc') {
        // NPC - cleaner humanoid figure matching isometric style
        const layers = [
          { text: '/\\', fg: '#3355aa', bg: '#1a2a55' },     // Legs
          { text: '[=]', fg: '#4466cc', bg: '#223366' },    // Body
          { text: '(o)', fg: '#ffccaa', bg: '#996644' },    // Head
        ]
        for (let h = 0; h < layers.length; h++) {
          const layer = layers[h]
          const tileTop = baseY - (h + 1) * tileH
          const layerWidth = h === 2 ? 0.7 : 0.8

          ctx.fillStyle = layer.bg
          ctx.fillRect(p.x - tileW * layerWidth * 0.5, tileTop, tileW * layerWidth, tileH)
          ctx.fillStyle = layer.fg
          ctx.fillText(layer.text, p.x, tileTop + tileH * 0.5)
        }

      } else {
        // Default - still use vibrant colors with animation
        const tileFg = asset.color || '#ffffff'
        const tileBg = asset.bgColor || darkenColor(tileFg, 0.3)
        const char = asset.art[0] || '?'
        ctx.fillStyle = tileBg
        ctx.fillRect(p.x - tileW * 0.5, baseY - tileH, tileW, tileH)
        ctx.fillStyle = tileFg
        ctx.fillText(char, p.x, baseY - tileH * 0.5)
      }
    }
  }

  // ─── DEBUG OVERLAY ─────────────────────────────────────────────────
  if (debugMode) {
    ctx.globalAlpha = 0.6
    // Draw collision overlay
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue
        const p = toScreen(col + 0.5, row + 0.5)
        const isCollision = grid.collision[row]?.[col]
        const cellHeight = grid.getHeight(col, row)

        if (isCollision) {
          ctx.fillStyle = 'rgba(255, 50, 50, 0.4)'
          ctx.fillRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
        }

        // Show height numbers
        if (cellHeight > 0) {
          ctx.fillStyle = '#ffff00'
          ctx.font = `bold ${tileH * 0.4}px ${ASCII_FONT}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(cellHeight), p.x, p.y)
        }
      }
    }
    ctx.globalAlpha = 1

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    ctx.lineWidth = 1
    for (let row = startRow; row < startRow + tilesY; row++) {
      for (let col = startCol; col < startCol + tilesX; col++) {
        const p = toScreen(col + 0.5, row + 0.5)
        ctx.strokeRect(p.x - tileW / 2, p.y - tileH / 2, tileW, tileH)
      }
    }
  }

  // Placed entities (enemies / NPCs) on top of the world layer — same as Top/iso.
  // Skip the player entity: the live player sprite is drawn above (no ghost double).
  const pCol = player.x / cellSize
  const pRow = player.z / cellSize
  for (const entity of entities) {
    if (entity.kind === 'player') continue
    const combat = entity.kind === 'enemy' ? enemyCombat.get(entity.id) : undefined
    if (isDeadEnemy(entity, combat)) continue
    const rc = entityRenderCell(entity, time) // same interpolation as iso → no snap in 2D
    const e = toScreen(rc.col, rc.row)
    // Same movement/combat signals the iso path uses, so 2D only swaps walk frames while moving.
    const mot = entityMotion.get(entity.id)
    const moving = !!mot && time < mot.startMs + ENEMY_MOVE_MS
    const inRange = entity.kind === 'enemy' && Math.hypot(entity.col - pCol, entity.row - pRow) <= COMBAT_RANGE
    const anchor = drawTopEntity(ctx, e.x, e.y, tileW, entity, combat, time, moving, inRange)
    drawQuestMarker(ctx, entityQuestMarker(entity, quests), anchor.x, anchor.y, Math.max(14, tileW * 1.4))
  }

  // ─── UI ───────────────────────────────────────────────────────────
  ctx.fillStyle = '#ffffff'
  ctx.font = `14px ${ASCII_FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`Pos: ${Math.floor(player.x)}, ${Math.floor(player.z)}`, 10, 30)
  ctx.fillStyle = debugMode ? '#ff6666' : '#4488ff'
  ctx.fillText(debugMode ? '2D DEBUG MODE' : '2D RPG MODE', 10, 50)
}

// Get player sprite based on state
function getPlayerArt(player: PlayerState): string[] {
  if (!player.moving) return playerSprite.idle

  const f = player.frame
  switch (player.facing) {
    case 'right': return f === 0 ? playerSprite.right1 : playerSprite.right2
    case 'left': return f === 0 ? playerSprite.left1 : playerSprite.left2
    case 'up': return f === 0 ? playerSprite.up1 : playerSprite.up2
    case 'down': return f === 0 ? playerSprite.down1 : playerSprite.down2
  }
}

// Auto-generate dark background from color
// Draw ASCII art at position - ALWAYS draws background for visibility
function drawAscii(
  ctx: CanvasRenderingContext2D,
  art: string[],
  x: number,
  y: number,
  color: string,
  scale: number = 1.0,
  bgColor?: string
) {
  const fontSize = 14 * scale
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'left'

  const lineHeight = fontSize * 0.95
  const charWidth = fontSize * 0.6

  // Anchor at bottom center
  const startY = y - (art.length * lineHeight)
  const maxWidth = Math.max(...art.map(l => l.length))
  const startX = x - (maxWidth * charWidth) / 2

  // Use provided bgColor or auto-generate dark version
  const actualBg = bgColor || darkenColor(color)

  for (let i = 0; i < art.length; i++) {
    const line = art[i]
    const lineY = startY + i * lineHeight

    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === ' ') continue

      const charX = startX + j * charWidth

      // Background - ALWAYS draw for visibility
      ctx.fillStyle = actualBg
      ctx.fillRect(charX - 1, lineY - fontSize * 0.75, charWidth + 1, lineHeight)

      // Character
      ctx.fillStyle = color
      ctx.fillText(char, charX, lineY)
    }
  }
}

// Draw isometric 3D asset matching 2D vibrant style
function drawIsoAsset(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  asset: GridAsset,
  cellSize: number,
  isoScale: number,
  time: number
) {
  const blockW = cellSize * isoScale * 0.7
  const blockH = cellSize * isoScale * 0.35
  const blockTall = cellSize * isoScale * 0.5

  // Animation flicker
  const flicker = Math.sin(time * 0.003 + x * 0.01 + y * 0.02) * 0.15 + 1

  // Helper: draw isometric block
  const drawBlock = (bx: number, by: number, width: number, top: string, left: string, right: string) => {
    const hw = blockW * width * 0.5
    // Top face
    ctx.fillStyle = top
    ctx.beginPath()
    ctx.moveTo(bx, by - blockH)
    ctx.lineTo(bx + hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx - hw, by)
    ctx.closePath()
    ctx.fill()
    // Left face
    ctx.fillStyle = left
    ctx.beginPath()
    ctx.moveTo(bx - hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx, by + blockH + blockTall)
    ctx.lineTo(bx - hw, by + blockTall)
    ctx.closePath()
    ctx.fill()
    // Right face
    ctx.fillStyle = right
    ctx.beginPath()
    ctx.moveTo(bx + hw, by)
    ctx.lineTo(bx, by + blockH)
    ctx.lineTo(bx, by + blockH + blockTall)
    ctx.lineTo(bx + hw, by + blockTall)
    ctx.closePath()
    ctx.fill()
  }

  if (asset.type === 'tree') {
    // Trunk (2 blocks)
    for (let h = 0; h < 2; h++) {
      const by = y - h * blockTall
      drawBlock(x, by, 0.4, '#ad8621', '#7a5c17', '#c9a030')
    }
    // Canopy (3 layers, expanding outward)
    const layers = [
      { w: 0.8, top: '#1ab61a', left: '#0d7a0d', right: '#22cc22' },
      { w: 1.2, top: '#22cc22', left: '#119911', right: '#2dd82d' },
      { w: 1.6, top: '#1ec01e', left: '#0e880e', right: '#28d428' },
    ]
    for (let h = 0; h < layers.length; h++) {
      const layer = layers[h]
      const by = y - (h + 2) * blockTall
      // Animated brightness
      const bright = flicker
      const top = adjustColorBrightness(layer.top, bright)
      const left = adjustColorBrightness(layer.left, bright * 0.8)
      const right = adjustColorBrightness(layer.right, bright)
      drawBlock(x, by, layer.w, top, left, right)
    }
    // Top highlight
    ctx.fillStyle = `rgba(100, 255, 100, ${0.3 * flicker})`
    ctx.font = `bold ${blockTall * 0.6}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('@', x, y - 4.5 * blockTall)

  } else if (asset.type === 'building') {
    // Walls (3 blocks)
    for (let h = 0; h < 3; h++) {
      const by = y - h * blockTall
      drawBlock(x, by, 1.0, '#b48441', '#8a6330', '#cca060')
    }
    // Window on middle block
    ctx.fillStyle = `rgba(255, 255, 100, ${0.4 + 0.3 * flicker})`
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('▒', x, y - 1.5 * blockTall)
    // Roof (2 layers, red)
    for (let h = 0; h < 2; h++) {
      const by = y - (h + 3) * blockTall
      const width = 1.3 - h * 0.2
      const bright = 1 - h * 0.15
      drawBlock(x, by, width,
        adjustColorBrightness('#cc3030', bright),
        adjustColorBrightness('#991010', bright),
        adjustColorBrightness('#dd4545', bright))
    }
    // Roof peak decoration
    ctx.fillStyle = `rgba(255, 100, 80, ${0.7 + 0.3 * flicker})`
    ctx.fillText('▲', x, y - 5 * blockTall)

  } else if (asset.type === 'lamp' || asset.type === 'lantern') {
    // Post
    ctx.fillStyle = '#555555'
    ctx.fillRect(x - blockW * 0.08, y - blockTall * 2, blockW * 0.16, blockTall * 2)
    // Glowing lantern
    const glow = lampPulse(time) // looping lamp animation (behaviors module)
    ctx.fillStyle = `rgba(255, 220, 50, ${glow})`
    ctx.beginPath()
    ctx.arc(x, y - blockTall * 2.3, blockW * 0.25, 0, Math.PI * 2)
    ctx.fill()
    // Light rays
    ctx.fillStyle = `rgba(255, 255, 150, ${glow * 0.3})`
    ctx.beginPath()
    ctx.arc(x, y - blockTall * 2.3, blockW * 0.4, 0, Math.PI * 2)
    ctx.fill()

  } else if (asset.type === 'npc') {
    // Humanoid character - 3 blocks (legs, body, head)
    drawBlock(x, y, 0.5, '#3355aa', '#2244aa', '#4466bb')           // Legs
    drawBlock(x, y - blockTall, 0.6, '#4466cc', '#3355aa', '#5577dd')  // Body
    drawBlock(x, y - blockTall * 2, 0.45, '#ffccaa', '#ddaa88', '#ffddbb') // Head
    // Simple face
    ctx.fillStyle = '#333'
    ctx.font = `bold ${blockTall * 0.35}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('o', x, y - blockTall * 2.1)

  } else if (asset.type === 'bush') {
    drawBlock(x, y, 0.8,
      adjustColorBrightness('#22aa22', flicker),
      adjustColorBrightness('#118811', flicker),
      adjustColorBrightness('#28c828', flicker))
    ctx.fillStyle = `rgba(80, 200, 80, ${0.5 * flicker})`
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('*', x, y - blockH)

  } else if (asset.type === 'rock' || asset.type === 'decoration') {
    drawBlock(x, y, 0.6, '#888888', '#555555', '#999999')

  } else if (asset.type === 'flower') {
    // Small decorative flower
    ctx.fillStyle = asset.color || '#ff88cc'
    ctx.font = `bold ${blockTall * 0.6}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('+', x, y - blockH * 0.5)

  } else {
    // Default: simple colored block
    const color = asset.color || '#888888'
    drawBlock(x, y, 0.8,
      color,
      adjustColorBrightness(color, 0.6),
      adjustColorBrightness(color, 0.85))
    // Draw character on top
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
    ctx.textAlign = 'center'
    ctx.fillText(asset.art[0] || '?', x, y - blockH)
  }
}

// Draw block-based character (1 wide x 3 tall blocks) with animation
function drawBlockCharacter(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cellSize: number,
  isoScale: number,
  facing: 'up' | 'down' | 'left' | 'right',
  time: number = 0
) {
  const blockW = cellSize * isoScale * 0.7
  const blockH = cellSize * isoScale * 0.35
  const blockTall = cellSize * isoScale * 0.5

  // Subtle breathing animation
  const breathe = Math.sin(time * 0.004) * 0.03 + 1

  // Vibrant character colors (matching 2D style)
  const colors = {
    legs: { fill: '#3355cc', dark: '#2244aa', light: '#4466dd' },
    body: { fill: '#ffdd00', dark: '#ccaa00', light: '#ffee44' },
    head: { fill: '#ffccaa', dark: '#ddaa88', light: '#ffddbb' },
  }

  const parts = [
    { y: 0, ...colors.legs },
    { y: 1, ...colors.body },
    { y: 2 * breathe, ...colors.head },
  ]

  for (const part of parts) {
    const py = screenY - part.y * blockTall

    // Top face
    ctx.fillStyle = part.light
    ctx.beginPath()
    ctx.moveTo(screenX, py - blockH)
    ctx.lineTo(screenX + blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX - blockW * 0.5, py)
    ctx.closePath()
    ctx.fill()

    // Left side (darker)
    ctx.fillStyle = part.dark
    ctx.beginPath()
    ctx.moveTo(screenX - blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX, py + blockH + blockTall * 0.4)
    ctx.lineTo(screenX - blockW * 0.5, py + blockTall * 0.4)
    ctx.closePath()
    ctx.fill()

    // Right side (medium)
    ctx.fillStyle = part.fill
    ctx.beginPath()
    ctx.moveTo(screenX + blockW * 0.5, py)
    ctx.lineTo(screenX, py + blockH)
    ctx.lineTo(screenX, py + blockH + blockTall * 0.4)
    ctx.lineTo(screenX + blockW * 0.5, py + blockTall * 0.4)
    ctx.closePath()
    ctx.fill()
  }

  // Face/direction on head
  const headY = screenY - 2 * breathe * blockTall - blockH * 0.3
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${blockTall * 0.5}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let dirChar = 'v'
  switch (facing) {
    case 'up': dirChar = '^'; break
    case 'down': dirChar = 'v'; break
    case 'left': dirChar = '<'; break
    case 'right': dirChar = '>'; break
  }
  ctx.fillText(dirChar, screenX, headY)
}

// Helper to adjust color brightness
function adjustColorBrightness(hex: string, factor: number): string {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!match) return hex
  const r = Math.min(255, Math.floor(parseInt(match[1], 16) * factor))
  const g = Math.min(255, Math.floor(parseInt(match[2], 16) * factor))
  const b = Math.min(255, Math.floor(parseInt(match[3], 16) * factor))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// Debug overlay rendering
function renderDebugOverlays(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  toScreen: (wx: number, wz: number) => { x: number; y: number },
  cellSize: number
) {
  const tilesX = Math.ceil(w / 32) + 10
  const tilesZ = Math.ceil(h / 20) + 10
  const startCol = Math.floor(player.x / cellSize) - tilesX / 2
  const startRow = Math.floor(player.z / cellSize) - tilesZ / 2

  ctx.font = `bold 10px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Pass 1: Draw collision overlay (red tint on blocked cells)
  for (let rz = 0; rz < tilesZ; rz++) {
    for (let rx = 0; rx < tilesX; rx++) {
      const col = Math.floor(startCol + rx)
      const row = Math.floor(startRow + rz)

      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue

      const worldX = col * cellSize
      const worldZ = row * cellSize
      const p = toScreen(worldX, worldZ)

      if (p.x < -50 || p.x > w + 50 || p.y < -50 || p.y > h + 50) continue

      const isBlocked = grid.isBlocked(col, row)
      const tileW = cellSize * grid.isoScale * 0.7
      const tileH = cellSize * grid.isoScale * 0.35

      if (isBlocked) {
        // Red overlay for collision
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'
        ctx.beginPath()
        ctx.moveTo(p.x, p.y - tileH)
        ctx.lineTo(p.x + tileW, p.y)
        ctx.lineTo(p.x, p.y + tileH)
        ctx.lineTo(p.x - tileW, p.y)
        ctx.closePath()
        ctx.fill()
      }

      // Grid coordinates
      ctx.fillStyle = isBlocked ? '#ffaaaa' : '#aaffaa'
      ctx.fillText(`${col},${row}`, p.x, p.y)
    }
  }

  // Pass 2: Asset type labels
  const visibleAssets = grid.getVisibleAssets(
    Math.floor(player.x / cellSize),
    Math.floor(player.z / cellSize),
    30, 20
  )

  ctx.font = `bold 11px ${ASCII_FONT}`

  for (const asset of visibleAssets) {
    const worldX = asset.col * cellSize
    const worldZ = asset.row * cellSize
    const p = toScreen(worldX, worldZ)

    // Color by type
    let labelColor = '#ffffff'
    let labelBg = 'rgba(0, 0, 0, 0.7)'
    switch (asset.type) {
      case 'building':
        labelColor = '#ffaa00'
        labelBg = 'rgba(100, 60, 0, 0.8)'
        break
      case 'tree':
        labelColor = '#44ff44'
        labelBg = 'rgba(0, 60, 0, 0.8)'
        break
      case 'water':
      case 'fountain':
        labelColor = '#44aaff'
        labelBg = 'rgba(0, 40, 80, 0.8)'
        break
      case 'decoration':
      case 'crate':
      case 'lamp':
        labelColor = '#ffff44'
        labelBg = 'rgba(60, 60, 0, 0.8)'
        break
      case 'flower':
        labelColor = '#ff88ff'
        labelBg = 'rgba(60, 0, 60, 0.8)'
        break
    }

    // Draw label background
    const label = asset.type.toUpperCase()
    const metrics = ctx.measureText(label)
    const labelY = p.y - 30

    ctx.fillStyle = labelBg
    ctx.fillRect(p.x - metrics.width / 2 - 3, labelY - 8, metrics.width + 6, 16)

    ctx.fillStyle = labelColor
    ctx.fillText(label, p.x, labelY)

    // Connection line
    ctx.strokeStyle = labelColor
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    ctx.moveTo(p.x, labelY + 8)
    ctx.lineTo(p.x, p.y - 5)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Player label
  const playerP = toScreen(player.x, player.z)
  ctx.fillStyle = 'rgba(80, 60, 0, 0.8)'
  ctx.fillRect(playerP.x - 25, playerP.y - 50, 50, 16)
  ctx.fillStyle = '#ffdd00'
  ctx.fillText('PLAYER', playerP.x, playerP.y - 42)
}

// Top-down 2D blueprint view - flat, no height, just positions
// Dark, neutral-ish backing per asset type so each cell's OWN glyph + color (the
// label glyph for generated cells, the zone tint for trees) reads clearly.
const TOP_ASSET_BACKDROP: Record<string, string> = {
  building: '#2a1810',
  tree: '#0a1f0a',
  water: '#0a1c2e',
  fountain: '#0a1c2e',
  decoration: '#241a0e',
  crate: '#241a0e',
  lamp: '#241f08',
  flower: '#1a0a12',
  npc: '#1a1a0a',
  rock: '#1a181c',
  boss: '#2a0e0e',
  column: '#1c1c1c',
}

function renderTopView(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  grid: IsometricGrid,
  player: PlayerState,
  zoom: number = 1.0,
  selectedCells: Set<string> = new Set(),
  connectors: Connector[] = [],
  connectorMode: boolean = false,
  camOffset: { x: number; y: number } = { x: 0, y: 0 },
  entities: readonly Entity[] = [],
  enemyCombat: ReadonlyMap<string, CombatState> = new Map(),
  hitMarkers: readonly HitMarker[] = [],
  now: number = 0,
  quests: readonly Quest[] = []
) {
  // Clear
  ctx.fillStyle = '#0a0a10'
  ctx.fillRect(0, 0, w, h)

  // Calculate tile size with zoom
  const baseTileSize = 16
  const tileSize = baseTileSize * zoom

  // Center on player position + pan offset
  const cellSize = grid.cellSize
  const playerCol = player.x / cellSize
  const playerRow = player.z / cellSize

  // Offset so player is centered + camera pan
  const offsetX = w / 2 - playerCol * tileSize + camOffset.x
  const offsetY = h / 2 - playerRow * tileSize + camOffset.y

  const fontSize = Math.max(8, tileSize * 0.6)
  ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Calculate visible range
  const startCol = Math.max(0, Math.floor(-offsetX / tileSize) - 1)
  const endCol = Math.min(grid.cols, Math.ceil((w - offsetX) / tileSize) + 1)
  const startRow = Math.max(0, Math.floor(-offsetY / tileSize) - 1)
  const endRow = Math.min(grid.rows, Math.ceil((h - offsetY) / tileSize) + 1)

  // Build a map of assets by position for quick lookup
  const assetMap: Record<string, GridAsset> = {}
  for (const asset of grid.assets) {
    assetMap[`${asset.col},${asset.row}`] = asset
  }

  // Draw each cell - show ground OR asset (asset takes priority)
  for (let row = startRow; row < endRow; row++) {
    for (let col = startCol; col < endCol; col++) {
      const x = offsetX + col * tileSize
      const y = offsetY + row * tileSize
      const key = `${col},${row}`
      const asset = assetMap[key]

      let char: string
      let fg: string
      let bg: string

      if (asset) {
        // Show the cell's OWN glyph + color — the label glyph for generated
        // multi-cell assets (╨│@♣ trees, autotiled masses, roofs/doors) and the
        // zone tint for trees — over a dark type-flavored backing for contrast.
        char = asset.art[0] ?? '?'
        fg = asset.color ?? '#cccccc'
        bg = TOP_ASSET_BACKDROP[asset.type] ?? '#141414'
      } else {
        // Ground tile
        const tileType = grid.ground[row]?.[col] || 'grass'
        const colors = GROUND_COLORS[tileType as keyof typeof GROUND_COLORS] || GROUND_COLORS.grass
        char = colors.char[0]
        fg = colors.fg[0]
        // Grass varies per-cell into natural green tones (deterministic hash); other ground stays flat.
        bg = tileType.includes('grass') ? grassShade(colors.bg[0], col, row) : colors.bg[0]
      }

      // Draw cell
      ctx.fillStyle = bg
      ctx.fillRect(x, y, tileSize - 1, tileSize - 1)

      ctx.fillStyle = fg
      ctx.fillText(char, x + tileSize / 2, y + tileSize / 2)

      // Height indicator (show in corner if height > 0)
      const cellHeight = grid.getHeight(col, row)
      if (cellHeight > 0 && tileSize > 10) {
        // Draw height badge in top-right corner
        const badgeSize = Math.max(10, tileSize * 0.4)
        ctx.fillStyle = '#00ccff'
        ctx.fillRect(x + tileSize - badgeSize - 2, y + 1, badgeSize, badgeSize)
        ctx.fillStyle = '#000000'
        ctx.font = `bold ${Math.max(8, badgeSize * 0.8)}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(cellHeight.toString(), x + tileSize - badgeSize / 2 - 2, y + badgeSize / 2 + 1)
        // Reset font
        ctx.font = `bold ${fontSize}px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
      }

      // Selection highlight
      if (selectedCells.has(`${col},${row}`)) {
        ctx.strokeStyle = '#ffff00'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, tileSize - 3, tileSize - 3)
      }

      // Debug: show cell coordinates
      if (debugMode && tileSize > 12) {
        ctx.font = `${Math.max(6, tileSize * 0.35)}px ${ASCII_FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`${col},${row}`, x + 1, y + 1)
      }
    }
  }

  // ── BUILDING ROOFS (top-down): each building drawn as a cohesive roof seen from above (like a
  //    neighborhood map) over its footprint — filled roof + edge + ridge line + a door notch on the
  //    road-facing side. Overlays the per-cell building tiles for a clean blueprint look.
  const ROOF_TOP_COLORS: Record<string, { fill: string; ridge: string; edge: string }> = {
    house: { fill: '#c0463c', ridge: '#e0786a', edge: '#7a2a24' },
    'big-house': { fill: '#b0673a', ridge: '#d08f5a', edge: '#6e3f22' },
    store: { fill: '#3a7ea5', ridge: '#5fa6cc', edge: '#234e66' },
    hospital: { fill: '#3aa55a', ridge: '#5fcc80', edge: '#23663a' },
  }
  const roofPalette = (t: string) => ROOF_TOP_COLORS[t] ?? { fill: '#a0644a', ridge: '#c08a6a', edge: '#5e3a2a' }
  for (const b of grid.buildings ?? []) {
    const topRow = b.row - (b.height - 1)
    if (b.col + b.length <= startCol || b.col >= endCol || topRow + b.height <= startRow || topRow >= endRow) continue
    const rx = offsetX + b.col * tileSize
    const ry = offsetY + topRow * tileSize
    const rw = b.length * tileSize
    const rh = b.height * tileSize
    const pal = roofPalette(b.type)
    ctx.fillStyle = pal.fill
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeStyle = pal.edge
    ctx.lineWidth = Math.max(1, tileSize * 0.12)
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1)
    // ridge down the longer axis (gable read)
    ctx.strokeStyle = pal.ridge
    ctx.lineWidth = Math.max(1, tileSize * 0.16)
    ctx.beginPath()
    if (rw >= rh) {
      const my = ry + rh / 2
      ctx.moveTo(rx + tileSize * 0.25, my)
      ctx.lineTo(rx + rw - tileSize * 0.25, my)
    } else {
      const mx = rx + rw / 2
      ctx.moveTo(mx, ry + tileSize * 0.25)
      ctx.lineTo(mx, ry + rh - tileSize * 0.25)
    }
    ctx.stroke()
    // door notch (dark) on the road-facing edge: facing 0 = horizontal street, 1 = vertical road;
    // facadeOnBack flips near/far so the notch sits toward the actual road.
    const dn = Math.max(3, tileSize * 0.4)
    ctx.fillStyle = '#241308'
    if ((b.facing ?? 0) === 0) {
      const dx = rx + rw / 2 - dn / 2
      const dy = b.facadeOnBack ? ry - dn * 0.25 : ry + rh - dn * 0.75
      ctx.fillRect(dx, dy, dn, dn * 0.5)
    } else {
      const dy = ry + rh / 2 - dn / 2
      const dx = b.facadeOnBack ? rx - dn * 0.25 : rx + rw - dn * 0.75
      ctx.fillRect(dx, dy, dn * 0.5, dn)
    }
    // Type signage (STORE / HOSPITAL) on the roof — same badge the iso + 2D views show, so a shop /
    // clinic reads at a glance on the top-down map too.
    const badge = BUILDING_BADGES[b.type]
    if (badge && tileSize > 8) {
      const bf = Math.max(7, tileSize * (badge.text.length > 1 ? 0.34 : 0.7))
      ctx.font = `bold ${bf}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const bw = ctx.measureText(badge.text).width
      const bx = rx + rw / 2
      const by = ry + rh / 2
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(bx - bw / 2 - 2, by - bf * 0.6, bw + 4, bf * 1.2)
      ctx.fillStyle = badge.color
      ctx.fillText(badge.text, bx, by)
      ctx.font = `bold ${fontSize}px ${ASCII_FONT}` // restore the cell font for subsequent draws
    }
  }

  // Grid lines (subtle)
  if (tileSize > 10) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let col = startCol; col <= endCol; col++) {
      const x = offsetX + col * tileSize
      ctx.beginPath()
      ctx.moveTo(x, offsetY + startRow * tileSize)
      ctx.lineTo(x, offsetY + endRow * tileSize)
      ctx.stroke()
    }
    for (let row = startRow; row <= endRow; row++) {
      const y = offsetY + row * tileSize
      ctx.beginPath()
      ctx.moveTo(offsetX + startCol * tileSize, y)
      ctx.lineTo(offsetX + endCol * tileSize, y)
      ctx.stroke()
    }
  }

  // Draw player position (1x1 cell footprint)
  const playerCellCol = Math.floor(player.x / cellSize)
  const playerCellRow = Math.floor(player.z / cellSize)
  const px = offsetX + playerCellCol * tileSize
  const py = offsetY + playerCellRow * tileSize

  // Player cell background + bold outline so it never gets lost in the foliage
  ctx.fillStyle = '#ffdd00'
  ctx.fillRect(px, py, tileSize - 1, tileSize - 1)
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = 2
  ctx.strokeRect(px + 1, py + 1, tileSize - 3, tileSize - 3)

  // Direction arrow
  ctx.fillStyle = '#000000'
  ctx.font = `bold ${tileSize * 0.7}px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let dirChar = 'v'
  switch (player.facing) {
    case 'up': dirChar = '^'; break
    case 'down': dirChar = 'v'; break
    case 'left': dirChar = '<'; break
    case 'right': dirChar = '>'; break
  }
  ctx.fillText(dirChar, px + tileSize / 2, py + tileSize / 2)

  // Draw connectors — one marker per cell the connector owns; the label rides on
  // the connector's first cell only.
  for (const connector of connectors) {
    connector.cells.forEach((pcell, idx) => {
      const cx = offsetX + pcell.col * tileSize
      const cy = offsetY + pcell.row * tileSize

      // Portal/connector appearance
      ctx.fillStyle = 'rgba(180, 80, 255, 0.6)'
      ctx.fillRect(cx, cy, tileSize - 1, tileSize - 1)

      // Draw portal symbol
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${tileSize * 0.6}px ${ASCII_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('◊', cx + tileSize / 2, cy + tileSize / 2)

      // Draw pulsing border in connector mode
      if (connectorMode) {
        ctx.strokeStyle = '#ff88ff'
        ctx.lineWidth = 2
        ctx.strokeRect(cx, cy, tileSize - 1, tileSize - 1)
      }

      // Label (if room) — only on the first cell so multi-cell connectors aren't noisy
      if (idx === 0 && tileSize > 20 && connector.targetTemplateName) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(cx - 5, cy - 12, tileSize + 10, 12)
        ctx.fillStyle = '#ff88ff'
        ctx.font = `bold 9px ${ASCII_FONT}`
        ctx.textAlign = 'center'
        ctx.fillText(connector.targetTemplateName.slice(0, 10), cx + tileSize / 2, cy - 5)
      }
    })
  }

  // Draw placed entities last — each a single `>` glyph colored by role (blueprint legend).
  for (const entity of entities) {
    const combat = entity.kind === 'enemy' ? enemyCombat.get(entity.id) : undefined
    if (isDeadEnemy(entity, combat)) continue // hidden until it respawns
    const ex = offsetX + entity.col * tileSize
    const ey = offsetY + entity.row * tileSize
    drawTopArrow(ctx, ex, ey, tileSize, topRoleColor(entity, quests))
    if (entity.kind === 'enemy') drawHpBar(ctx, ex + tileSize / 2, ey - 3, tileSize, 3, hpFraction(entity, combat))
    drawQuestMarker(ctx, entityQuestMarker(entity, quests), ex + tileSize / 2, ey - tileSize * 0.9, Math.max(12, tileSize * 1.1))
  }

  // Floating "+dmg" hit markers (cell-centred in top space).
  for (const marker of hitMarkers) {
    const mx = offsetX + (marker.col + 0.5) * tileSize
    const my = offsetY + marker.row * tileSize
    drawHitMarker(ctx, mx, my, marker, now)
  }

  // UI
  ctx.fillStyle = debugMode ? '#ff6666' : '#55aaff'
  ctx.font = `bold 16px ${ASCII_FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(debugMode ? 'TOP VIEW + DEBUG' : 'TOP VIEW', w / 2, 20)

  ctx.fillStyle = '#888'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`WASD move | Scroll zoom (${zoom.toFixed(1)}x) | Click to select`, w / 2, 38)

  // Selection info
  if (selectedCells.size > 0) {
    ctx.fillStyle = '#ffff00'
    ctx.fillText(`${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''} selected`, w / 2, 54)
  }

  ctx.fillStyle = '#666'
  ctx.font = `12px ${ASCII_FONT}`
  ctx.fillText(`${grid.cols}x${grid.rows} grid | Cell: ${playerCellCol},${playerCellRow}`, w / 2, h - 15)
}

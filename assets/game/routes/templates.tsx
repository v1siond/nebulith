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
import Head from 'next/head'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import { GridBuilding, IsometricGrid } from '@/engine/IsometricGrid'
import { COMPOSITE_ASSETS, TILES } from '@/engine/Tileset'
import { type AttackAnim, isAnimDone } from '@/engine/attackAnimations'
import { shouldFire } from '@/engine/behaviors'
import { type BuildingType } from '@/engine/buildingComposer'
import { type PlacementEnv, buildingCellBlocked, buildingFootprintCells, canPlaceBuilding, facadeLength, footprintContains, gridBuildingFacing, makeBuilding, moveBuilding, rotateBuilding } from '@/engine/buildingEditor'
import { type AnimFrame, type AnimPreset, CELL_ANIM_PRESETS, type Ease, makeCellAnimation, restFrame } from '@/engine/cellAnimation'
import { cellTile } from '@/engine/cellTileset'
import { scaleCompositeToRegion } from '@/engine/compositeFill'
import { findTriggeredConnector, normalizeConnector } from '@/engine/connectors'
import { entityPalette, weaponGlyph } from '@/engine/entityArt'
import { isoFacadeOnBack, isoFacingIndex } from '@/engine/isoBuilding'
import { type MoverState, RUN_PATROL_DELAY_MS, type RunState, STEP_LIST_DELAY_MS, type StepListState, initMover, initRunState, initStepList, stepMover, stepRunPatrol, stepStepList } from '@/engine/movement'
import { assetFootprint, multiCellAssetById, stampAsset } from '@/engine/multiCellAssets'
import { StageData, VariantId, buildingCellColor, generateStage, stagePaint } from '@/engine/stageGenerator'
import { type Action as TriggerAction, resolveAction } from '@/engine/triggers'
import { type Facing } from '@/engine/villageLayout'
import { ZONE_PALETTES, ZoneId } from '@/engine/zones'
import { ABILITY_REGISTRY, ABILITY_SLOTS, ABILITY_TINT, type AbilityAnimation, type AbilityBinding, type AbilityDef, type AbilitySlot, DEFAULT_ABILITY_LOADOUT, abilityReady, assignAbility, bindingForSlot, rebindAbility, removeAbility } from '@/game/abilities'
import { startingCombatState } from '@/game/combat'
import { DEFAULT_PLAYER_STATS, canPlaceEntity, entityAt, entityAtFootprint, entityOccupiedCells, makeEnemy, makeNpc, makePlayer, placeEntity, removeEntity } from '@/game/entities'
import { type Game, addTemplate as addGameTemplate, createGame, deleteGame as deleteGameFromList, levelCount, levelTemplate, removeTemplate as removeGameTemplate, renameGame, reorderTemplate as reorderGameTemplate, upsertGame } from '@/game/games'
import { loadGames, saveGames } from '@/game/gamesStore'
import { GEAR_CATALOG, starterWarriorGear } from '@/game/gear'
import { addItem, createInventory, equipArmor, equipWeapon, useConsumable } from '@/game/inventory'
import { addToBag, allowedSlots, createLoadout, equip as equipToSlot, loadoutBonuses, setShortcut, setSpecial, unequip as unequipSlot } from '@/game/loadout'
import { ENEMY_ATTACK_PRESETS, addEnemyAttack, addMovementStep, appendWaypoint, buildAttackPattern, buildStepList, clearWaypoints, defaultEnemyAttack, enemyAttackFromAbility, normalizeAttackPattern, removeEnemyAttack, removeMovementStep, setAttackPatternMode, setMovementMode, setStepDelay, updateEnemyAttack, updateMovementStep } from '@/game/patterns'
import { TEMPLATE_PRESETS, type TemplateTheme } from '@/game/presets'
import { type Projectile } from '@/game/projectiles'
import { type QuestEvent, acceptQuest, isComplete, progress, recordEvent, turnIn } from '@/game/quests'
import { BARE_HANDS, type HitMarker, type PlayerHud, type ProjectileContext, playerHudFrom, pushHitMarker, stepCombat, tickProjectiles, triggerAbility } from '@/game/runtime/combat'
import { DEFAULT_PLAYER_NAME, type PlayerState, aimDelta, aimFromKeys, facingFromKeys, jumpLandingCell, playerDisplayName } from '@/game/runtime/player'
import { questAnchorScreenPos } from '@/game/runtime/quest'
import { type EnemyRuntime, isLivingEnemy, makeEnemyRuntime } from '@/game/runtime/targeting'
import { ENEMY_TYPES, archetypeForEnemyType, scatterEntities } from '@/game/spawner'
import { type Armor, type AttackMode, type AttackPattern, type AttackPatternMode, type CombatState, type ConsumableEffect, type Direction, EQUIP_SLOTS, type EnemyAttack, type Entity, type EntityKind, type EquipSlot, type Inventory, type Item, type Loadout, type MovementPattern, type Objective, type ObjectiveKind, type Quest, type Reward, type Stats, type TalentPath, type Weapon } from '@/game/types'
import { weaponReach } from '@/game/weapons'
import { VILLAGE_CONFIG } from '@/levels/village'
import { Connector, TemplateListItem, createTemplate, deleteTemplate, deserializeToGrid, getTemplate, listTemplates, serializeGrid, updateTemplate } from '@/lib/api'
import { ENTITY_GLYPH, buildingsFromAssets, buildingsToAssets, entitiesFromAssets, entitiesToAssets, isBuildingAsset, isEntityAsset, isQuestAsset, questsFromAssets, questsToAssets } from '@/lib/gridCodec'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { render, render2D, renderTopView, clampCameraAxis, entityMotion, ENEMY_MOVE_MS, isDebugMode, setDebugMode, type DayNight } from '@/engine/render'


// Block-based sizing: each block is 16x16x16 (width x depth x height)
const BLOCK_SIZE = 16

// Character dimensions in blocks
const CHAR_WIDTH = 1   // 1 block wide
const CHAR_DEPTH = 1   // 1 block deep
const CHAR_HEIGHT = 3  // 3 blocks tall (legs, body, head)

// View mode states (global for game loop access)
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
 * The placement environment for the editor. A footprint cell is blocked only when it is
 * truly occupied — it overlaps ANOTHER building's footprint, carries collision (trees,
 * water, lava, features, or any blocking asset), or is a road — except the cells in
 * `ignore` (the moving/rotating building's own footprint, about to be vacated). Any other
 * walkable, non-road cell is free: bare grass, an interior floor, or a cell that only holds
 * non-blocking ground decor. Pure-ish reader over the live grid; the policy itself lives in
 * the pure `buildingCellBlocked` so it stays unit-testable.
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
      return buildingCellBlocked({
        occupied: others.has(key), // another building's footprint (incl. its door)
        collision: grid.collision[row]?.[col] === 1, // trees / water / lava / features / blocking assets
        ground: grid.ground[row]?.[col] ?? '',
      })
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

/** A short, unique-enough id for an entity minted in the editor session. */
function mintEntityId(kind: EntityKind): string {
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** A short, unique-enough id for a minted item (quest rewards, etc.). */
function mintItemId(): string {
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// ═══════════════════════════════════════════════════════════════════
// COMBAT — wiring the pure engine (src/game/combat.ts) into the play loop.
// All formulas live in the combat module; this is orchestration only:
// targeting from facing, runtime state in refs, death/respawn timing, and a
// simple enemy melee retaliation. Pure + module-level so nothing re-allocates
// per frame and the rules stay unit-testable. (spec §2–6)
// ═══════════════════════════════════════════════════════════════════


/** A magician alternative the player can equip from the starting inventory.
 *  Two-handed magical melee caster (reach 2). */
const OAK_STAFF: Weapon = {
  id: 'oak-staff', kind: 'staff', name: 'Oak Staff',
  baseDamage: 0, baseMagic: 10, baseDefense: 0, strengthBonus: 0, intBonus: 4,
  school: 'magical', range: 'melee', hands: 2, reachCells: 2,
}

/** A starting inventory: NOTHING equipped (the player begins bare-handed), plus a staff,
 *  light armor, and a potion to demonstrate equip/use. (Fresh objects each call.) */
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
    null, // start UNARMED — the player fights bare-handed until a weapon is equipped
    null,
  )
}

/** Build a carryable item from a quest 'item' reward (no item DB yet → a small
 *  health potion tagged by the reward's itemId). */
function itemFromReward(reward: Reward, id: string): Item {
  return { id, name: reward.itemId || 'Reward Item', slot: 'consumable', effect: { hp: 25 } }
}

/** Hold-to-loop cadence for the regular attack — one swing per this interval while `f` is held.
 *  The basic strike is always-available on a 1.5s beat (per the ability spec — see
 *  docs/ability-system.md); abilities (keys 1–4) are the faster/heavier hits, gated by their own
 *  cooldowns. */
const ATTACK_LOOP_MS = 500















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

/** A −/value/+ stepper for one transform field of an animation frame (x / y / rot). */
function FrameStepper({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (v: number) => void
}) {
  const round2 = (v: number) => Math.round(v * 100) / 100
  return (
    <div className="flex flex-col items-center rounded bg-gray-800 p-0.5">
      <span className="text-[8px] uppercase text-gray-500">{label}</span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onChange(round2(value - step))} className="px-1 text-fuchsia-300 hover:text-white" aria-label={`${label} minus`}>−</button>
        <span className="w-8 text-center text-[9px] text-gray-200">{value > 0 ? '+' : ''}{round2(value)}</span>
        <button onClick={() => onChange(round2(value + step))} className="px-1 text-fuchsia-300 hover:text-white" aria-label={`${label} plus`}>+</button>
      </div>
    </div>
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


/** Begin a jump. A MOVING jump leaps along the 8-way AIM (so all 8 directions work, #66); a STANDING
 *  jump (`forward===false`) hops straight up on the same cell. The loop animates the arc. No-op if
 *  already mid-jump. */
function beginJump(player: PlayerState, grid: IsometricGrid, use2D: boolean, jump: JumpState, now: number, forward: boolean): void {
  if (jump.active) return
  // Leap along the 8-way AIM (the way you're actually moving), not the 4-way facing — otherwise a
  // diagonal hold collapses to a cardinal hop (the iso "x/y but no z" + 2D "no diagonal" bug). #66
  const [dCol, dRow] = aimDelta(player, use2D)
  const cs = grid.cellSize
  const pCol = Math.floor(player.x / cs)
  const pRow = Math.floor(player.z / cs)
  const landing = jumpLandingCell(pCol, pRow, dCol, dRow, forward, (c, r) => grid.isBlocked(c, r), grid.cols, grid.rows)
  if (!landing) return
  jump.active = true
  jump.fromX = player.x
  jump.fromZ = player.z
  jump.toX = landing.col * cs + cs / 2
  jump.toZ = landing.row * cs + cs / 2
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
 * Play-view ABILITY BAR: the 4 assigned slots (keys 1–4) with a cooldown sweep. The slots reflect
 * the live loadout (re-renders on assign/remove); the sweep reads the SAME last-used clock the play
 * loop stamps on fire (`lastUsedRef`) against `performance.now()` — that clock shares the rAF time
 * origin the loop uses, so the math lines up. A dark overlay fills the slot from the bottom and
 * shrinks as it cools; the icon dims while cooling and brightens (full color) when ready.
 */
function AbilityBar({ loadout, lastUsedRef }: {
  loadout: readonly AbilityBinding[]
  lastUsedRef: React.MutableRefObject<Map<string, number>>
}) {
  // Repaint a few times a second so the sweep animates — cooldowns are seconds long, so ~16 fps is
  // plenty smooth and far cheaper than a per-frame rAF. The clock itself comes from performance.now.
  const [, repaint] = useState(0)
  useEffect(() => {
    const id = setInterval(() => repaint(t => (t + 1) % 1_000_000), 60)
    return () => clearInterval(id)
  }, [])
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  return (
    <div
      className="fixed bottom-16 left-1/2 z-20 flex -translate-x-1/2 gap-1.5 rounded-md bg-black/80 p-1.5 font-mono shadow-lg ring-1 ring-white/10"
      role="group"
      aria-label="Ability bar"
    >
      {ABILITY_SLOTS.map(slot => {
        const ability = bindingForSlot(loadout, slot)?.ability
        const tint = ability ? ABILITY_TINT[ability.animation] : '#555'
        const lastUsed = ability ? lastUsedRef.current.get(ability.id) : undefined
        const ready = !ability || abilityReady(ability, lastUsed, now)
        const remaining = ability && lastUsed != null ? Math.max(0, ability.cooldownMs - (now - lastUsed)) : 0
        const fillPct = ability && ability.cooldownMs > 0 ? (remaining / ability.cooldownMs) * 100 : 0
        const abbrev = ability ? ability.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '—'
        return (
          <div
            key={slot}
            title={ability ? `${ability.name} · ${(ability.cooldownMs / 1000).toFixed(0)}s` : `Slot ${slot} — empty`}
            className="relative h-11 w-11 overflow-hidden rounded border bg-black/70"
            style={{ borderColor: ability ? tint : 'rgba(255,255,255,0.15)' }}
          >
            {/* cooldown sweep: a dark overlay that fills the slot then shrinks to 0 as it cools */}
            {!ready && <div className="absolute inset-x-0 bottom-0 bg-black/70" style={{ height: `${fillPct}%` }} />}
            <span className="absolute left-0.5 top-0 text-[9px] font-bold text-gray-300">{slot}</span>
            <span
              className="flex h-full items-center justify-center text-[13px] font-bold"
              style={{ color: tint, opacity: ready ? 1 : 0.55 }}
            >
              {abbrev}
            </span>
            {!ready && (
              <span className="absolute inset-0 flex items-center justify-center text-[12px] font-bold tabular-nums text-white">
                {Math.ceil(remaining / 1000)}
              </span>
            )}
          </div>
        )
      })}
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

// ── GAMES VIEW ───────────────────────────────────────────────────────────────
// A Game is an ORDERED list of templates presented as levels (see docs/games-flows.md):
// index 0 = level 1. This overlay lists saved games and, per game, an editor to set the
// level sequence — add templates in order, reorder (up/down), remove, jump into any level.
// Pure ops live in @/game/games; persistence (localStorage v1) in @/game/gamesStore.

/** One level row in the game editor: "Level N: <template name>" + reorder / remove / play. */
function GameLevelRow({
  level, name, isFirst, isLast, onUp, onDown, onRemove, onPlay,
}: {
  level: number
  name: string
  isFirst: boolean
  isLast: boolean
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  onPlay: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded bg-gray-800 px-2 py-1.5 text-xs">
      <span className="shrink-0 rounded bg-indigo-700 px-2 py-0.5 font-bold text-white">Level {level}</span>
      <span className="flex-1 truncate text-gray-200">{name}</span>
      <button onClick={onPlay} aria-label={`Go to level ${level}`} title="Go to this level" className="shrink-0 rounded bg-emerald-700 px-2 py-0.5 font-bold text-white hover:bg-emerald-600">▶</button>
      <button onClick={onUp} disabled={isFirst} aria-label={`Move level ${level} up`} className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600 disabled:opacity-30">▲</button>
      <button onClick={onDown} disabled={isLast} aria-label={`Move level ${level} down`} className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-gray-200 hover:bg-gray-600 disabled:opacity-30">▼</button>
      <button onClick={onRemove} aria-label={`Remove level ${level}`} className="shrink-0 rounded px-1.5 py-0.5 text-red-400 hover:text-red-300">✕</button>
    </div>
  )
}

/** Editor for ONE game: rename, add templates (in order), reorder, remove, go-to-level-N. */
function GameEditor({
  game, savedTemplates, onChange, onPlayLevel, onBack,
}: {
  game: Game
  savedTemplates: TemplateListItem[]
  onChange: (game: Game) => void
  onPlayLevel: (templateId: string) => void
  onBack: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const nameOf = (id: string) => savedTemplates.find(t => t.id === id)?.name ?? '(missing template)'
  const levels = game.templateIds

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">← Games</button>
        <input
          value={game.name}
          onChange={e => onChange(renameGame(game, e.target.value))}
          aria-label="Game name"
          placeholder="Game name…"
          className="flex-1 rounded bg-gray-800 px-3 py-1.5 text-sm text-white"
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-300">Levels ({levels.length})</h4>
          <div className="relative">
            <button onClick={() => setPickerOpen(v => !v)} aria-expanded={pickerOpen} className="rounded bg-indigo-700 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-600">＋ Add template</button>
            {pickerOpen && (
              <div className="absolute right-0 z-10 mt-1 max-h-64 w-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl">
                {savedTemplates.length === 0 && <p className="text-[10px] text-gray-500">No saved templates to add.</p>}
                {savedTemplates.map(t => (
                  <button key={t.id} onClick={() => { onChange(addGameTemplate(game, t.id)); setPickerOpen(false) }} className="block w-full truncate rounded bg-gray-800 px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-700">{t.name}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {levels.length === 0 && (
          <p className="rounded border border-dashed border-white/10 px-3 py-6 text-center text-xs text-gray-500">No levels yet — add templates in the order you want to play them.</p>
        )}

        <div className="space-y-1.5">
          {levels.map((id, i) => (
            <GameLevelRow
              key={`${id}-${i}`}
              level={i + 1}
              name={nameOf(id)}
              isFirst={i === 0}
              isLast={i === levels.length - 1}
              onUp={() => onChange(reorderGameTemplate(game, i, i - 1))}
              onDown={() => onChange(reorderGameTemplate(game, i, i + 1))}
              onRemove={() => onChange(removeGameTemplate(game, i))}
              onPlay={() => onPlayLevel(id)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/** The Games view: a list of saved games (▶ Play = level 1) + an inline game editor. */
function GamesViewOverlay({
  savedTemplates, onPlayLevel, onClose,
}: {
  savedTemplates: TemplateListItem[]
  onPlayLevel: (templateId: string) => void
  onClose: () => void
}) {
  const [games, setGames] = useState<Game[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  // Load once on open; persist (state + localStorage) on every change so it round-trips.
  useEffect(() => { setGames(loadGames()) }, [])
  const persist = useCallback((next: Game[]) => { setGames(next); saveGames(next) }, [])

  const editing = editingId ? games.find(g => g.id === editingId) ?? null : null
  const updateGame = (g: Game) => persist(upsertGame(games, g))
  const nameOf = (id: string) => savedTemplates.find(t => t.id === id)?.name ?? '(missing template)'

  const handleNew = () => {
    const g = createGame('New game')
    persist(upsertGame(games, g))
    setEditingId(g.id)
  }
  const handleDelete = (id: string) => {
    persist(deleteGameFromList(games, id))
    if (editingId === id) setEditingId(null)
  }

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#0a0a12]/95 font-mono text-white backdrop-blur-sm">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold uppercase tracking-widest text-indigo-300">{editing ? 'Game Editor' : 'Games'}</h2>
          <button onClick={onClose} aria-label="Exit games" className="rounded bg-red-700 px-3 py-1.5 text-xs font-bold hover:bg-red-600">⨯ Exit</button>
        </header>

        {editing ? (
          <GameEditor
            game={editing}
            savedTemplates={savedTemplates}
            onChange={updateGame}
            onPlayLevel={onPlayLevel}
            onBack={() => setEditingId(null)}
          />
        ) : (
          <div className="space-y-3">
            <button onClick={handleNew} className="w-full rounded-lg border border-dashed border-indigo-500/40 bg-indigo-900/20 px-4 py-3 text-sm font-bold text-indigo-200 hover:bg-indigo-900/40">＋ New Game</button>

            {games.length === 0 && (
              <p className="rounded-lg border border-white/10 bg-black/40 px-4 py-10 text-center text-sm text-gray-400">No games yet. Create one to group templates into a playable, ordered flow (level 1, 2, 3 …).</p>
            )}

            {games.map(g => {
              const first = levelTemplate(g, 1)
              const count = levelCount(g)
              return (
                <div key={g.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/50 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-white">{g.name}</p>
                    <p className="truncate text-xs text-gray-400">{count} {count === 1 ? 'level' : 'levels'}{first ? ` · starts at ${nameOf(first)}` : ''}</p>
                  </div>
                  <button
                    onClick={() => first && onPlayLevel(first)}
                    disabled={!first}
                    aria-label={`Play ${g.name}`}
                    className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500"
                  >
                    ▶ Play
                  </button>
                  <button onClick={() => setEditingId(g.id)} aria-label={`Edit ${g.name}`} className="shrink-0 rounded bg-gray-700 px-3 py-1.5 text-xs hover:bg-gray-600">Edit</button>
                  <button onClick={() => handleDelete(g.id)} aria-label={`Delete ${g.name}`} className="shrink-0 rounded px-2 py-1.5 text-red-400 hover:text-red-300">✕</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
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

// ── item hover tooltips (#51): read the real numbers off each item def ──
/** Stat lines for a weapon. Shields lead with block%; everything else shows the
 *  damage / reach / hands / school that drives a swing. */
function weaponTooltipStats(w: Weapon): string[] {
  if (w.kind === 'shield') {
    const lines = [`Block ${w.blockChance ?? 0}%`, `Defense ${w.baseDefense}`]
    if (w.strengthBonus) lines.push(`Strength +${w.strengthBonus}`)
    if (w.intBonus) lines.push(`Intelligence +${w.intBonus}`)
    return lines
  }
  const dmg = w.school === 'magical' ? w.baseMagic : w.baseDamage
  const lines = [
    `Damage ${dmg}`,
    `Reach ${weaponReach(w)} (${w.range})`,
    `${w.hands === 2 ? 'Two-handed' : 'One-handed'} · ${w.school}`,
  ]
  if (w.strengthBonus) lines.push(`Strength +${w.strengthBonus}`)
  if (w.intBonus) lines.push(`Intelligence +${w.intBonus}`)
  if (w.baseDefense) lines.push(`Defense +${w.baseDefense}`)
  return lines
}

/** Stat lines for a piece of armor: its defense value plus any worn bonuses. */
function armorTooltipStats(a: Armor): string[] {
  const lines = [`Armor ${a.defenseBonus}`]
  if (a.strengthBonus) lines.push(`Strength +${a.strengthBonus}`)
  if (a.intBonus) lines.push(`Intelligence +${a.intBonus}`)
  if (a.dodgeBonus) lines.push(`Dodge +${a.dodgeBonus}%`)
  return lines
}

/** Stat lines for a consumable / special item: what it restores, or a plain note
 *  for throwables (bomb / scroll) whose behaviour fires in the play loop. */
function consumableTooltipStats(effect: ConsumableEffect): string[] {
  const lines: string[] = []
  if (effect.hp) lines.push(`Restore ${effect.hp} HP`)
  if (effect.mana) lines.push(`Restore ${effect.mana} Mana`)
  if (effect.rage) lines.push(`Restore ${effect.rage} Rage`)
  if (lines.length === 0) lines.push('Special item')
  return lines
}

/** The hover-tooltip stat lines for ANY item (dispatch on its slot). */
function itemTooltipStats(item: Item): string[] {
  if (item.slot === 'weapon') return weaponTooltipStats(item.weapon)
  if (item.slot === 'armor') return armorTooltipStats(item.armor)
  return consumableTooltipStats(item.effect)
}

/** Floating, cursor-anchored item tooltip (dark mono panel, matches the editor UI).
 *  Pinned with `position: fixed` to the live cursor and clamped to the viewport so it
 *  never clips off an edge; pointer-events-none so it never eats the hover/click. */
function ItemTooltip({ item, x, y }: { item: Item; x: number; y: number }) {
  const lines = itemTooltipStats(item)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = Math.max(8, Math.min(x + 14, vw - 192))
  const top = Math.max(8, Math.min(y + 14, vh - (lines.length * 15 + 44)))
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-44 rounded border border-cyan-500/50 bg-gray-900/95 px-2 py-1.5 font-mono text-[10px] text-gray-300 shadow-xl"
      style={{ left, top }}
    >
      <div className="mb-0.5 truncate text-[11px] font-bold text-cyan-300">{item.name}</div>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

/** Tooltip stat lines for an ability (category / cooldown / effect) — mirrors itemTooltipStats. */
function abilityTooltipLines(a: AbilityDef): string[] {
  const lines = [`Category: ${a.category}`, `Cooldown ${(a.cooldownMs / 1000).toFixed(1)}s`]
  if (a.effect.damage) lines.push(`Damage ${a.effect.damage}`)
  if (a.effect.healing) lines.push(`Healing ${a.effect.healing}`)
  if (a.effect.shieldMs) lines.push(`Shield ${(a.effect.shieldMs / 1000).toFixed(1)}s`)
  if (a.effect.debuff) lines.push(`${a.effect.debuff.kind} ${(a.effect.debuff.durationMs / 1000).toFixed(1)}s`)
  return lines
}

/** Compact one-line effect summary for an ability card (browse modal): the headline number. */
function abilityEffectLabel(a: AbilityDef): string {
  const e = a.effect
  if (e.healing) return `+${e.healing} HP`
  if (e.shieldMs) return `shield ${(e.shieldMs / 1000).toFixed(0)}s`
  const parts: string[] = []
  if (e.damage) parts.push(`${e.damage} dmg`)
  if (e.debuff) parts.push(e.debuff.kind)
  return parts.join(' · ') || '—'
}

/** Floating ability tooltip — same cursor-anchored dark panel as ItemTooltip (#51), tinted to the
 *  ability's animation color so a Fire Slash reads orange, a Frost reads blue, etc. */
function AbilityTooltip({ ability, x, y }: { ability: AbilityDef; x: number; y: number }) {
  const lines = abilityTooltipLines(ability)
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = Math.max(8, Math.min(x + 14, vw - 192))
  const top = Math.max(8, Math.min(y + 14, vh - (lines.length * 15 + 44)))
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-44 rounded border border-fuchsia-500/50 bg-gray-900/95 px-2 py-1.5 font-mono text-[10px] text-gray-300 shadow-xl"
      style={{ left, top }}
    >
      <div className="mb-0.5 truncate text-[11px] font-bold" style={{ color: ABILITY_TINT[ability.animation] }}>{ability.name}</div>
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  )
}

// ── live player/entity stats panel (#52) ────────────────────────────
/** One labelled stat readout in the stats grid. */
function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/40 px-2 py-1">
      <div className="text-[8px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className="text-[12px] font-bold tabular-nums text-gray-100">{value}</div>
    </div>
  )
}

/**
 * Live stats for the entity whose loadout is open — the SAME source the combat HUD
 * reads from: base stats folded with the equipped gear's bonuses (loadoutBonuses)
 * and the equipped weapon. Equipping/unequipping re-renders this with new totals, so
 * the numbers move as you change gear (sword → attack up, shield → block up, etc.).
 */
function PlayerStatsPanel({ baseStats, loadout, hp }: {
  baseStats: Stats
  loadout: Loadout
  hp: { current: number; max: number }
}) {
  const b = loadoutBonuses(loadout)
  const weapons = [loadout.equipped.weapon1, loadout.equipped.weapon2].flatMap(i =>
    i && i.slot === 'weapon' ? [i.weapon] : [],
  )
  const weapon = weapons.find(w => w.kind !== 'shield') ?? weapons[0] ?? BARE_HANDS
  // Effective stats = base + worn gear (mirrors the play-loop's playerStatsRef wiring).
  const strength = baseStats.strength + b.strength
  const intelligence = baseStats.intelligence + b.intelligence
  const defense = baseStats.defense + b.defense
  const dodge = (baseStats.dodge ?? 0) + b.dodge
  // Regular-hit damage per the combat formula (physical scales str, magical scales int).
  const attack = weapon.school === 'magical' ? weapon.baseMagic + intelligence : weapon.baseDamage + strength
  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-black/40 p-2">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Stats — live totals (incl. gear)</p>
      <div className="grid grid-cols-4 gap-1">
        <StatChip label="HP" value={`${hp.current}/${hp.max}`} />
        <StatChip label="Attack" value={`${attack} ${weapon.school === 'magical' ? '✦' : '⚔'}`} />
        <StatChip label="Defense" value={`${defense}`} />
        <StatChip label="Reach" value={`${weaponReach(weapon)} ${weapon.range === 'ranged' ? 'rng' : 'mel'}`} />
        <StatChip label="Dodge" value={`${dodge}%`} />
        <StatChip label="Block" value={`${b.block}%`} />
        <StatChip label="Strength" value={`${strength}`} />
        <StatChip label="Intelligence" value={`${intelligence}`} />
      </div>
      <p className="mt-1 truncate text-[9px] text-gray-500">Weapon: {weapon.name}</p>
    </div>
  )
}

/** Hover-handler bundle for an ability button (drives the #51-style floating tooltip). */
type AbilityTipProps = {
  onMouseEnter: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseLeave: () => void
}

/** First ability slot with no binding — the default target for the "Browse abilities" button. */
function firstEmptyAbilitySlot(loadout: readonly AbilityBinding[]): AbilitySlot {
  return ABILITY_SLOTS.find(s => !bindingForSlot(loadout, s)) ?? 1
}

/** A clickable trigger-key badge: click → the parent enters key-capture mode and rebinds on the next
 *  keypress; while capturing it pulses "press…". Shared by special-action + ability slots so BOTH
 *  sets read as user-keyed and remappable. */
function KeyCaptureBadge({ keyLabel, capturing, onClick, ariaLabel, tone }: {
  keyLabel: string
  capturing: boolean
  onClick: () => void
  ariaLabel: string
  tone: 'amber' | 'fuchsia'
}) {
  const toneCls = tone === 'amber' ? 'bg-amber-700 hover:bg-amber-600' : 'bg-fuchsia-700 hover:bg-fuchsia-600'
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title="Click, then press a key to rebind"
      className={`rounded px-1.5 text-[10px] font-bold leading-tight ${capturing ? 'animate-pulse bg-white/30 text-white ring-1 ring-white' : toneCls}`}
    >
      {capturing ? 'press…' : keyLabel.toUpperCase()}
    </button>
  )
}

/**
 * External "browse abilities" modal (#51-style cards) — lists the WHOLE registry (name, category,
 * cooldown, effect) and assigns the picked ability into the chosen slot. Slot tabs across the top
 * select the target; assigning keeps the modal open so several slots can be filled in one visit.
 * Sits above the inventory panel (z-40); its hover tooltips render in the parent at z-50.
 */
function AbilityBrowseModal({ loadout, targetSlot, onPickSlot, onAssign, onClose, tipProps }: {
  loadout: readonly AbilityBinding[]
  targetSlot: AbilitySlot
  onPickSlot: (s: AbilitySlot) => void
  onAssign: (slot: AbilitySlot, ability: AbilityDef) => void
  onClose: () => void
  tipProps: (a: AbilityDef) => AbilityTipProps
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 font-mono" role="dialog" aria-label="Browse abilities" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-fuchsia-500/50 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-fuchsia-300">Browse Abilities</h2>
          <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close ability browser">✕</button>
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Assign to slot</p>
        <div className="mb-3 grid grid-cols-4 gap-1">
          {ABILITY_SLOTS.map(slot => {
            const ability = bindingForSlot(loadout, slot)?.ability
            const active = slot === targetSlot
            return (
              <button
                key={slot}
                onClick={() => onPickSlot(slot)}
                aria-label={`Target slot ${slot}${active ? ' (selected)' : ''}`}
                className={`rounded border px-1.5 py-1 text-center text-[10px] ${active ? 'border-fuchsia-400 bg-fuchsia-900/60' : 'border-white/10 bg-black/40 hover:bg-white/5'}`}
              >
                <span className="block font-bold">Slot {slot}</span>
                <span className="block truncate text-[9px]" style={{ color: ability ? ABILITY_TINT[ability.animation] : '#6b7280' }}>{ability ? ability.name : 'empty'}</span>
              </button>
            )
          })}
        </div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Abilities ({ABILITY_REGISTRY.length})</p>
        <div className="grid grid-cols-2 gap-1.5">
          {ABILITY_REGISTRY.map(a => (
            <button
              key={a.id}
              onClick={() => onAssign(targetSlot, a)}
              {...tipProps(a)}
              className="rounded border border-white/10 bg-gray-800 px-2 py-1.5 text-left hover:border-fuchsia-500/60 hover:bg-fuchsia-900/40"
            >
              <span className="block truncate text-[11px] font-bold" style={{ color: ABILITY_TINT[a.animation] }}>{a.name}</span>
              <span className="block truncate text-[9px] text-gray-400">{a.category} · {(a.cooldownMs / 1000).toFixed(0)}s cd</span>
              <span className="block truncate text-[9px] text-gray-300">{abilityEffectLabel(a)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function EquipmentPanel({ label, loadout, baseStats, hp, onChange, onClose, abilityLoadout, onAbilityChange, nameValue, onNameChange }: {
  label: string
  loadout: Loadout
  baseStats: Stats
  hp: { current: number; max: number }
  onChange: (l: Loadout) => void
  onClose: () => void
  // Ability loadout (slot 1–4 → ability). Optional: only the player passes these in v1, so an
  // enemy's inventory shows gear only. When present, the Abilities section becomes editable.
  abilityLoadout?: readonly AbilityBinding[]
  onAbilityChange?: (l: readonly AbilityBinding[]) => void
  // Player only: the raw, EDITABLE name (empty = falls back to the default). When onNameChange is
  // passed the header name becomes an input so you can rename right from the inventory.
  nameValue?: string
  onNameChange?: (name: string) => void
}) {
  // Hovered item + live cursor pos for the stat tooltip (#51). Cleared on leave.
  const [hovered, setHovered] = useState<{ item: Item; x: number; y: number } | null>(null)
  const hideTip = () => setHovered(null)
  const moveTip = (e: React.MouseEvent) => setHovered(h => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
  /** Hover-handler props for an item button; no-op object for empty slots. */
  const tipProps = (item: Item | null | undefined) =>
    item
      ? {
          onMouseEnter: (e: React.MouseEvent) => setHovered({ item, x: e.clientX, y: e.clientY }),
          onMouseMove: moveTip,
          onMouseLeave: hideTip,
        }
      : {}
  const unequipToBag = (slot: EquipSlot) => {
    const item = loadout.equipped[slot]
    if (item) onChange(addToBag(unequipSlot(loadout, slot), item))
  }
  const sendSpecialToBag = (i: number) => {
    const item = loadout.special[i]
    if (item) onChange(addToBag(setSpecial(loadout, i, null), item))
  }
  // Hovered ability tooltip (#51 style) — fed by the ability slots AND the browse modal's cards.
  const [hoveredAbility, setHoveredAbility] = useState<{ ability: AbilityDef; x: number; y: number } | null>(null)
  const abilityTipProps = (a: AbilityDef): AbilityTipProps => ({
    onMouseEnter: (e: React.MouseEvent) => setHoveredAbility({ ability: a, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setHoveredAbility(h => (h ? { ...h, x: e.clientX, y: e.clientY } : h)),
    onMouseLeave: () => setHoveredAbility(null),
  })
  // Browse-abilities modal: the slot it targets (null = closed). Opened from the abilities section.
  const [browseSlot, setBrowseSlot] = useState<AbilitySlot | null>(null)
  // Key-capture: which slot is being rebound (null = idle). Click a key badge → the NEXT keypress
  // remaps that slot. Special actions + abilities share this, so both read as user-keyed/remappable.
  const [capturing, setCapturing] = useState<{ kind: 'ability' | 'special'; index: number } | null>(null)
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopImmediatePropagation: the press rebinds HERE and never reaches the play
      // loop's key map, so we don't fire the very action we're rebinding (or toggle the inventory).
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') { setCapturing(null); return }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return // wait for a non-modifier key
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (capturing.kind === 'ability' && abilityLoadout && onAbilityChange) {
        onAbilityChange(rebindAbility(abilityLoadout, capturing.index as AbilitySlot, key))
      } else if (capturing.kind === 'special') {
        onChange(setShortcut(loadout, capturing.index, key))
      }
      setCapturing(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, abilityLoadout, onAbilityChange, loadout, onChange])
  const capturingSpecial = (i: number) => capturing?.kind === 'special' && capturing.index === i
  const capturingAbility = (slot: AbilitySlot) => capturing?.kind === 'ability' && capturing.index === slot

  return (
    <>
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4 font-mono" role="dialog" aria-label="Inventory" onClick={onClose}>
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-cyan-500/40 bg-gray-900 p-4 text-white shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1 text-sm font-bold text-cyan-400">
              Inventory —{' '}
              {onNameChange ? (
                <input
                  value={nameValue ?? ''}
                  onChange={e => onNameChange(e.target.value)}
                  placeholder={DEFAULT_PLAYER_NAME}
                  aria-label="Player name"
                  className="w-40 rounded bg-gray-800 px-1.5 py-0.5 text-sm font-bold text-cyan-300 outline-none focus:ring-1 focus:ring-cyan-500"
                />
              ) : (
                label
              )}
            </h2>
            <button onClick={onClose} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600" aria-label="Close inventory">✕ (I)</button>
          </div>

          {/* ── Action slots: SPECIAL ACTIONS beside ABILITIES — two distinct, user-keyed sets ── */}
          <div className="mb-3 grid grid-cols-2 gap-3">
            {/* Special actions (consumables / throwables) — default keys 5–8, rebindable to any key. */}
            <section className="rounded-lg border border-amber-500/30 bg-black/40 p-2">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Special actions — own keys</p>
              <div className="grid grid-cols-2 gap-1">
                {loadout.special.map((item, i) => (
                  <div key={i} className="rounded border border-amber-600/40 bg-amber-900/20 p-1 text-center text-[11px]">
                    <KeyCaptureBadge
                      keyLabel={loadout.shortcuts[i]}
                      capturing={capturingSpecial(i)}
                      onClick={() => setCapturing({ kind: 'special', index: i })}
                      ariaLabel={`Rebind key for special slot ${i + 1}`}
                      tone="amber"
                    />
                    <button onClick={() => sendSpecialToBag(i)} disabled={!item} {...tipProps(item)} className="mt-0.5 block w-full truncate hover:text-amber-300">{item ? item.name : '—'}</button>
                  </div>
                ))}
              </div>
            </section>

            {/* Abilities — default keys 1–4, rebindable; assigned from the external browse modal. */}
            <section className="rounded-lg border border-fuchsia-500/30 bg-black/40 p-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">Abilities — own keys</p>
                {abilityLoadout && onAbilityChange && (
                  <button
                    onClick={() => setBrowseSlot(firstEmptyAbilitySlot(abilityLoadout))}
                    className="rounded bg-fuchsia-700 px-1.5 py-0.5 text-[9px] font-bold hover:bg-fuchsia-600"
                    aria-label="Browse abilities"
                  >
                    ＋ Browse
                  </button>
                )}
              </div>
              {abilityLoadout && onAbilityChange ? (
                <div className="grid grid-cols-2 gap-1">
                  {ABILITY_SLOTS.map(slot => {
                    const binding = bindingForSlot(abilityLoadout, slot)
                    const ability = binding?.ability
                    return (
                      <div
                        key={slot}
                        className="rounded border border-fuchsia-600/40 bg-fuchsia-900/20 p-1 text-center text-[11px]"
                        style={ability ? { borderColor: ABILITY_TINT[ability.animation] } : undefined}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <KeyCaptureBadge
                            keyLabel={binding?.key ?? String(slot)}
                            capturing={capturingAbility(slot)}
                            onClick={() => setCapturing({ kind: 'ability', index: slot })}
                            ariaLabel={`Rebind key for ability slot ${slot}`}
                            tone="fuchsia"
                          />
                          {ability && (
                            <button
                              onClick={() => onAbilityChange(removeAbility(abilityLoadout, slot))}
                              className="rounded bg-black/40 px-1 text-[10px] text-fuchsia-200 hover:text-red-300"
                              aria-label={`Remove ability from slot ${slot}`}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                        {ability ? (
                          <button
                            {...abilityTipProps(ability)}
                            onClick={() => setBrowseSlot(slot)}
                            className="mt-0.5 block w-full truncate font-bold hover:text-fuchsia-300"
                            style={{ color: ABILITY_TINT[ability.animation] }}
                          >
                            {ability.name}
                          </button>
                        ) : (
                          <button
                            onClick={() => setBrowseSlot(slot)}
                            className="mt-0.5 block w-full truncate text-gray-500 hover:text-fuchsia-300"
                            aria-label={`Assign ability to slot ${slot}`}
                          >
                            + Assign
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[10px] text-gray-600">No abilities for this entity.</p>
              )}
            </section>
          </div>

          {/* ── Two-column body: LEFT = bag (inventory), RIGHT = character equipment + stats ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* LEFT — the bag */}
            <section>
              <p className="mb-1 text-xs font-bold text-gray-400">Inventory — Bag ({loadout.bag.filter(Boolean).length}/{loadout.bag.length})</p>
              <div className="mb-3 grid grid-cols-4 gap-1">
                {loadout.bag.map((item, i) => (
                  <button key={i} onClick={() => onChange(useBagItem(loadout, i))} disabled={!item} {...tipProps(item)}
                    title={item ? `Equip / use ${item.name}` : ''}
                    className={`aspect-square rounded border p-1 text-[9px] leading-tight ${item ? 'border-white/20 bg-gray-800 hover:bg-gray-700' : 'border-white/5 bg-black/30 text-gray-700'}`}>
                    {item ? item.name.slice(0, 10) : ''}
                  </button>
                ))}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-gray-400">+ Add gear to bag</summary>
                <div className="mt-1 grid grid-cols-2 gap-1">
                  {GEAR_CATALOG.map(g => (
                    <button key={g.id} onClick={() => onChange(addToBag(loadout, g))} className="truncate rounded bg-gray-700 px-1 py-0.5 text-[10px] hover:bg-gray-600">{g.name}</button>
                  ))}
                </div>
              </details>
            </section>

            {/* RIGHT — character equipment + live stat totals */}
            <section>
              <PlayerStatsPanel baseStats={baseStats} loadout={loadout} hp={hp} />
              <p className="mb-1 text-xs font-bold text-gray-400">Equipment</p>
              <div className="grid grid-cols-2 gap-1">
                {EQUIP_SLOTS.map(slot => {
                  const item = loadout.equipped[slot]
                  return (
                    <button key={slot} onClick={() => unequipToBag(slot)} disabled={!item} {...tipProps(item)}
                      className={`rounded border px-2 py-1.5 text-left text-[11px] ${item ? 'border-cyan-600 bg-cyan-900/40 hover:bg-cyan-900/70' : 'border-white/10 bg-black/40 text-gray-600'}`}>
                      <span className="block text-[9px] uppercase text-gray-500">{SLOT_LABEL[slot]}</span>
                      <span className="block truncate">{item ? item.name : '—'}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
      {browseSlot !== null && abilityLoadout && onAbilityChange && (
        <AbilityBrowseModal
          loadout={abilityLoadout}
          targetSlot={browseSlot}
          onPickSlot={setBrowseSlot}
          onAssign={(slot, ability) => onAbilityChange(assignAbility(abilityLoadout, slot, ability))}
          onClose={() => setBrowseSlot(null)}
          tipProps={abilityTipProps}
        />
      )}
      {hovered && <ItemTooltip item={hovered.item} x={hovered.x} y={hovered.y} />}
      {hoveredAbility && <AbilityTooltip ability={hoveredAbility.ability} x={hoveredAbility.x} y={hoveredAbility.y} />}
    </>
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

/** The seeded animation ids (drive the swing/bolt tint) — for the per-attack tint picker. */
const ATTACK_ANIMATION_OPTIONS = Object.keys(ABILITY_TINT) as AbilityAnimation[]

/** One attack row in the pattern editor: melee/ranged + damage + cooldown + tint + remove. */
function EnemyAttackRow({ attack, index, onChange, onRemove }: {
  attack: EnemyAttack
  index: number
  onChange: (patch: Partial<EnemyAttack>) => void
  onRemove: () => void
}) {
  const tint = attack.animation ? ABILITY_TINT[attack.animation] : '#9aa4b2'
  return (
    <div className="rounded border border-gray-700 p-1.5">
      <div className="mb-1 flex items-center gap-1">
        <span className="text-[11px] font-bold" style={{ color: tint }}>
          {attack.name ?? `Attack ${index + 1}`}
        </span>
        <span className="text-[10px] text-gray-500">{attack.mode}</span>
        <button
          onClick={onRemove}
          aria-label={`Remove attack ${index + 1}`}
          className="ml-auto rounded bg-gray-700 px-2 text-[11px] hover:bg-red-700"
        >
          ×
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={attack.mode}
          onChange={e => onChange({ mode: e.target.value as AttackMode })}
          aria-label={`Attack ${index + 1} mode`}
          className="rounded bg-gray-800 p-1 text-[11px]"
        >
          <option value="melee">Melee (adjacent)</option>
          <option value="ranged">Ranged (reach)</option>
        </select>
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="shrink-0">dmg</span>
          <input
            type="number"
            min={0}
            value={attack.damage}
            onChange={e => onChange({ damage: Number(e.target.value) })}
            aria-label={`Attack ${index + 1} damage`}
            className="w-14 rounded bg-gray-800 p-1 text-[11px]"
          />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-gray-400">
          <span className="shrink-0">CD ms</span>
          <input
            type="number"
            value={attack.cooldownMs}
            onChange={e => onChange({ cooldownMs: Number(e.target.value) })}
            aria-label={`Attack ${index + 1} cooldown ms`}
            className="w-16 rounded bg-gray-800 p-1 text-[11px]"
          />
        </label>
        <select
          value={attack.animation ?? ''}
          onChange={e => onChange({ animation: (e.target.value || undefined) as AbilityAnimation | undefined })}
          aria-label={`Attack ${index + 1} animation`}
          className="rounded bg-gray-800 p-1 text-[11px]"
          style={{ color: tint }}
        >
          <option value="">(default tint)</option>
          {ATTACK_ANIMATION_OPTIONS.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

/**
 * Attack-pattern editor for enemies (Attacks modal body) — the enemy mirror of the movement
 * editor. The author builds an ordered LIST of attacks (add presets / registry abilities / blank
 * melee + ranged), tunes each one's damage / cooldown / tint, and picks the traversal mode
 * (sequential cycles the list, random picks one) — exactly how movement steps are authored. The
 * pattern rides the entity record, so it saves with the template.
 */
function EntityAttackBody({ entity, onPatch }: {
  entity: Entity
  onPatch: (patch: Partial<Entity>) => void
}) {
  // entity.attack may be absent (engine default) or a legacy single-attack save → normalize for
  // display, but only AFTER the author has opted into a pattern (absent stays "Default").
  const pattern = entity.attack ? normalizeAttackPattern(entity.attack) : undefined

  const setPattern = (next: AttackPattern) =>
    onPatch({ attack: next.attacks.length > 0 ? next : undefined })

  return (
    <div className="text-xs">
      <span className="mb-0.5 block text-[10px] text-gray-400">Attack pattern</span>
      <select
        value={pattern ? pattern.mode : 'default'}
        onChange={e => {
          const mode = e.target.value
          if (mode === 'default') {
            onPatch({ attack: undefined })
            return
          }
          const next = pattern
            ? setAttackPatternMode(pattern, mode as AttackPatternMode)
            : buildAttackPattern(mode as AttackPatternMode)
          onPatch({ attack: next })
        }}
        aria-label="Attack pattern mode"
        className="w-full rounded bg-gray-800 p-1 text-xs"
      >
        <option value="default">Default (single melee)</option>
        <option value="sequential">Sequential (cycle attacks in order)</option>
        <option value="random">Random (pick an attack each swing)</option>
      </select>

      {pattern && (
        <div className="mt-1 space-y-1">
          {pattern.attacks.map((attack, i) => (
            <EnemyAttackRow
              key={i}
              attack={attack}
              index={i}
              onChange={patch => setPattern(updateEnemyAttack(pattern, i, patch))}
              onRemove={() => setPattern(removeEnemyAttack(pattern, i))}
            />
          ))}

          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => onPatch({ attack: addEnemyAttack(pattern, defaultEnemyAttack()) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Melee
            </button>
            <button
              onClick={() => onPatch({ attack: addEnemyAttack(pattern, ENEMY_ATTACK_PRESETS[2]) })}
              className="rounded bg-gray-700 px-2 py-1 text-[10px] hover:bg-gray-600"
            >
              + Ranged
            </button>
            <select
              value=""
              onChange={e => {
                const v = e.target.value
                if (!v) return
                if (v.startsWith('preset:')) {
                  const preset = ENEMY_ATTACK_PRESETS[Number(v.slice('preset:'.length))]
                  if (preset) onPatch({ attack: addEnemyAttack(pattern, preset) })
                  return
                }
                const ability = ABILITY_REGISTRY.find(a => a.id === v.slice('ability:'.length))
                if (ability) onPatch({ attack: addEnemyAttack(pattern, enemyAttackFromAbility(ability)) })
              }}
              aria-label="Add attack from preset or ability"
              className="rounded bg-gray-800 p-1 text-[10px]"
            >
              <option value="">+ From library…</option>
              <optgroup label="Presets">
                {ENEMY_ATTACK_PRESETS.map((p, i) => (
                  <option key={i} value={`preset:${i}`}>{p.name}</option>
                ))}
              </optgroup>
              <optgroup label="Abilities">
                {ABILITY_REGISTRY.filter(a => (a.effect.damage ?? 0) > 0).map(a => (
                  <option key={a.id} value={`ability:${a.id}`}>{a.name}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <p className="text-[10px] text-gray-500">
            {pattern.attacks.length} attack{pattern.attacks.length === 1 ? '' : 's'} · {pattern.mode} · melee strikes adjacent, ranged fires within reach
          </p>
        </div>
      )}
      {!pattern && (
        <p className="mt-1 text-[10px] text-gray-500">No pattern: a single strength-only melee swing. Pick Sequential / Random to build a multi-attack list.</p>
      )}
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
  // GAMES view — a full overlay (like Flow) listing playable flows + a game editor.
  const [showGamesView, setShowGamesView] = useState(false)
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
  // Animation Author panel — the frames + timing the user defines, then attaches to selected cells.
  // Frame 0 is always the rest pose; later frames are offset nudges (dx/dy/rot/scale).
  const [authorFrames, setAuthorFrames] = useState<AnimFrame[]>([restFrame()])
  const [authorDuration, setAuthorDuration] = useState(1200)
  const [authorDelay, setAuthorDelay] = useState(400)
  const [authorLoop, setAuthorLoop] = useState(true)
  const [authorEase, setAuthorEase] = useState<Ease>('sine')
  const [authorStatus, setAuthorStatus] = useState('')
  const [selectedHeight, setSelectedHeight] = useState(0)
  const [heightEditMode, setHeightEditMode] = useState(false)
  const [hideEntities, setHideEntities] = useState(false)
  const hideEntitiesRef = useRef(false)
  useEffect(() => {
    hideEntitiesRef.current = hideEntities
  }, [hideEntities])
  // Day/Night: the render loop reads the ref each frame; default day.
  const [dayNight, setDayNight] = useState<DayNight>('day')
  const dayNightRef = useRef<DayNight>('day')
  useEffect(() => {
    dayNightRef.current = dayNight
  }, [dayNight])
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
  const playerWeaponRef = useRef<Weapon>(BARE_HANDS)
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
  // Ability keys (1–4, data-driven loadout): edge-trigger per key + per-ability last-used clock
  // (keyed by ability id) so each ability respects its own cooldown.
  const abilityKeysRef = useRef<Record<string, boolean>>({})
  const abilityLastUsedRef = useRef<Map<string, number>>(new Map())
  // Editable per-entity ability loadout (slot 1–4 → ability), keyed by entity id like the gear
  // loadouts. v1 only the player ('__player__') is editable; the play loop + the inventory UI +
  // the HUD bar all read the SAME state, so assigning in the inventory changes what the keys fire.
  // The ref mirrors the player's loadout so the once-mounted game loop reads it without re-binding.
  const [abilityLoadouts, setAbilityLoadouts] = useState<Record<string, readonly AbilityBinding[]>>({
    __player__: DEFAULT_ABILITY_LOADOUT,
  })
  const playerAbilityLoadoutRef = useRef<readonly AbilityBinding[]>(DEFAULT_ABILITY_LOADOUT)
  // Throttle how often we mirror combat state to React (HUD only needs ~UI cadence).
  const hudSyncAtRef = useRef(0)

  // HUD mirror (the ONLY combat state in React — drives the DOM overlay).
  const [playerHud, setPlayerHud] = useState<PlayerHud>(() => playerHudFrom(
    DEFAULT_PLAYER_STATS,
    BARE_HANDS,
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
  // PLAY MODE — the clean play view: hides ALL editor chrome (nav + both sidebars +
  // the Preview toggle), leaving only the canvas, the combat HUD and the Inventory /
  // Quests buttons (+ an Exit). Movement, combat and the connector flow all keep
  // running (the game loop never gated on chrome), so you can just play the level.
  const [playMode, setPlayMode] = useState(false)
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
    setDebugMode(savedDebug)
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
  // Enter the clean PLAY VIEW. Top/flow aren't playable, so drop into iso; otherwise
  // keep the user's iso/2d choice. showPlayView() also clears connector authoring so
  // walk-in connectors + combat fire freely (the dead walk-in bug guard).
  const enterPlayMode = () => {
    if (showTopView || showFlowView) selectIsoView()
    else showPlayView()
    setPlayMode(true)
  }
  const exitPlayMode = () => setPlayMode(false)
  // GAMES view — open the overlay (closing flow first; they're mutually exclusive).
  const openGamesView = () => {
    flowViewMode = false
    setShowFlowView(false)
    setShowGamesView(true)
  }
  // Play a game LEVEL: close the Games overlay, load that template, drop into the play
  // view. Await the load so enterPlayMode reads the freshly loaded grid/spawn.
  const playGameLevel = async (templateId: string) => {
    setShowGamesView(false)
    await loadTemplate(templateId)
    enterPlayMode()
  }
  const toggleDebug = () => {
    setDebugMode(!isDebugMode())
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
    playerWeaponRef.current = inventory.equippedWeapon ?? BARE_HANDS
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
    const playerEntity = entities.find(e => e.kind === 'player')
    const base = playerEntity?.baseStats ?? DEFAULT_PLAYER_STATS
    playerLoadoutRef.current = pl
    // No weapon equipped → BARE_HANDS (kind 'unarmed') drives the swing/reach but draws no blade.
    playerWeaponRef.current = mainWeapon ?? inventory.equippedWeapon ?? BARE_HANDS
    playerShieldRef.current = shield
    // Make the equipped gear VISIBLE on the player: a held-weapon glyph beside the
    // figure (changes when you equip a different weapon) + an armored tint.
    const armored = (['helmet', 'chest', 'gloves', 'boots'] as const).some(s => !!pl.equipped[s])
    playerRef.current.weaponGlyph = weaponGlyph(mainWeapon ?? playerWeaponRef.current)
    playerRef.current.shieldGlyph = shield ? weaponGlyph(shield) : ''
    playerRef.current.armored = armored
    // Per-entity character tone (deterministic by id) so the player varies like NPCs do;
    // the armored steel-blue still overrides this in the render. No player entity → gold default.
    if (playerEntity) {
      const pal = entityPalette(playerEntity)
      playerRef.current.bodyColor = pal.fg
      playerRef.current.bodyBg = pal.bg
    }
    // Mirror the player entity's (persisted) name onto the render struct so the life-bar label
    // shows it the way enemies show their type/name.
    playerRef.current.name = playerDisplayName(playerEntity?.name)
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

  // Player ABILITY loadout → ref: the once-mounted game loop fires the CURRENT loadout's slot
  // ability (not a hardcoded default), so assigning/removing in the inventory takes effect live.
  useEffect(() => {
    playerAbilityLoadoutRef.current = abilityLoadouts['__player__'] ?? DEFAULT_ABILITY_LOADOUT
  }, [abilityLoadouts])

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
      // Match renderTopView EXACTLY, INCLUDING the #38 camera CLAMP (clampCameraAxis on the focus) —
      // otherwise clicks land on the wrong cell near the grid edges. Mirrors lines ~11047/11057.
      const tileSize = 16 * zoomRef.current
      const fCol = clampCameraAxis(px / cs - cam.x / tileSize, canvas.width / tileSize / 2, grid.cols)
      const fRow = clampCameraAxis(pz / cs - cam.y / tileSize, canvas.height / tileSize / 2, grid.rows)
      col = Math.floor((x - (canvas.width / 2 - fCol * tileSize)) / tileSize)
      row = Math.floor((y - (canvas.height / 2 - fRow * tileSize)) / tileSize)
    } else if (viewTypeRef.current === '2d') {
      // Match render2D's clamped camera (baseTileSize 24).
      const tileW = 24 * zoomRef.current
      const camCol = clampCameraAxis(px / cs - cam.x / tileW, canvas.width / tileW / 2, grid.cols)
      const camRow = clampCameraAxis(pz / cs - cam.y / tileW, canvas.height / tileW / 2, grid.rows)
      col = Math.floor(camCol + (x - canvas.width / 2) / tileW)
      row = Math.floor(camRow + (y - canvas.height / 2) / tileW)
    } else {
      // Isometric: invert the diamond projection, with the SAME clamped focus the render uses — the
      // col/row edge clamp (#70), so clicks track the camera near the edges.
      const eff = grid.isoScale * isoZoomRef.current
      const S = eff * 0.71
      const T = eff * 0.36
      const pPad = canvas.width / (2 * cs * S)
      const qPad = canvas.height / (2 * cs * T)
      let fc = (px - cam.x) / cs
      let fr = (pz - cam.y) / cs
      const isoHalfSpan = (pPad + qPad) / 2
      fc = clampCameraAxis(fc, isoHalfSpan, grid.cols)
      fr = clampCameraAxis(fr, isoHalfSpan, grid.rows)
      const a = (x - canvas.width / 2) / S
      const b = (y - canvas.height / 2) / T
      col = Math.floor(((a + b) / 2 + fc * cs) / cs)
      row = Math.floor(((b - a) / 2 + fr * cs) / cs)
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
      // authoring is a follow-up. The typed enemy type also picks a combat archetype
      // (stats + attack pattern) so a placed goblin/wolf/bandit/skeleton differs.
      ...makeEnemy(mintEntityId('enemy'), col, row, enemyType.trim() || 'enemy', {
        archetype: archetypeForEnemyType(enemyType.trim()),
      }),
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
  /** Rename the player — patches the player entity's name, which persists via the entities codec
   *  (entitiesToAssets/entitiesFromAssets) and shows on the life bar + inventory header. */
  const setPlayerName = (name: string) => {
    setEntities(prev => prev.map(e => (e.kind === 'player' ? { ...e, name } : e)))
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


  // ── Frame-based Animation Author handlers ──────────────────────────
  const round2 = (v: number) => Math.round(v * 100) / 100

  // "+ Add frame": append an offset frame, nudged a bit further right than the last so the new
  // frame is visibly different (the author then tweaks it).
  const addAuthorFrame = () => {
    setAuthorFrames(prev => {
      const last = prev[prev.length - 1] ?? restFrame()
      return [...prev, { dx: round2((last.dx ?? 0) + 0.15), dy: last.dy ?? 0, rot: last.rot, scale: last.scale }]
    })
    setAuthorStatus('')
  }

  const updateAuthorFrame = (i: number, patch: Partial<AnimFrame>) => {
    setAuthorFrames(prev => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  // Frame 0 is the rest pose and can't be deleted or moved off the front.
  const deleteAuthorFrame = (i: number) => {
    if (i === 0) return
    setAuthorFrames(prev => prev.filter((_, idx) => idx !== i))
  }

  const moveAuthorFrame = (i: number, dir: -1 | 1) => {
    setAuthorFrames(prev => {
      const j = i + dir
      if (i <= 0 || j <= 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  // Load a starting template (the old presets, now ready-to-tweak frame sets).
  const loadAuthorPreset = (p: AnimPreset) => {
    setAuthorFrames(p.frames.map(f => ({ ...f })))
    setAuthorDuration(p.durationMs)
    setAuthorDelay(p.delayMs)
    setAuthorEase(p.ease)
    setAuthorLoop(true)
    setAuthorStatus(`loaded "${p.name}" — tweak the frames, then Apply`)
  }

  // Attach the authored animation to the selected cells' assets. It plays live immediately because
  // the render loop reads asset.cellAnim every frame, so Preview and Apply share this path.
  const attachAuthorAnim = (commit: boolean) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) return
    const cells = Array.from(selectedCells).map(key => {
      const [col, row] = key.split(',').map(Number)
      return { col, row }
    })
    const anim = makeCellAnimation(cells, authorFrames, {
      id: `cellanim-${Date.now()}`,
      durationMs: authorDuration,
      delayMs: authorDelay,
      loop: authorLoop,
      ease: authorEase,
      trigger: 'always',
    })
    let hit = 0
    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      const asset = grid.assets.find(a => a.col === col && a.row === row)
      if (asset) {
        asset.cellAnim = anim
        hit++
      }
    })
    setAuthorStatus(
      hit === 0
        ? 'no asset in the selected cell(s) — place one first'
        : `${commit ? 'applied' : 'previewing'} on ${hit} cell${hit === 1 ? '' : 's'} — it plays live`,
    )
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
      grid.placeAsset([a.char], a.col, a.row, { type: a.type, blocking: a.blocking, color: a.color, label: a.label, baseShadow: a.baseShadow, buildingType: a.buildingType, edge: a.edge, footprint: a.footprint, cellPart: a.label })
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

      // 8-way GRID aim (separate from the 4-way facing that drives the weapon hand): set from the
      // movement keys so the player aims where they move — hold two keys for a diagonal. Kept when
      // nothing is held, so a standing shot fires the last-aimed direction. Attacks read player.aim.
      const pressedAim = aimFromKeys(keys, use2DMovement)
      if (pressedAim) player.aim = pressedAim

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
        // Abilities (keys 1–4, data-driven loadout): on the key's rising edge, fire the bound ability
        // if it's off cooldown → a melee swing with its authored damage + a tinted blade. First
        // binding to fire this frame wins (one swing per tick).
        const abilitySwing = triggerAbility(playerAbilityLoadoutRef.current, keys, abilityKeysRef.current, abilityLastUsedRef.current, time)
        if (abilitySwing) playSwoosh()
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
          attack: fireAttack || !!abilitySwing,
          special: specialDown && !specialDownRef.current,
          abilitySwing,
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
      // Mirror live HP onto the player struct so every view can draw the over-figure life bar
      // (the SAME bar enemies get); maxHp is the bar's denominator.
      player.hp = playerCombatRef.current.hp
      player.maxHp = playerStatsRef.current.maxHp
      if (flowViewMode) {
        // Flow view is handled by React overlay, just clear canvas
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else if (topViewMode) {
        renderTopView(ctx, canvas.width, canvas.height, grid, player, zoomRef.current, selectedCellsRef.current, connectorsRef.current, connectorModeRef.current, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, questsRef.current, dayNightRef.current)
      } else if (viewTypeRef.current === '2d') {
        render2D(ctx, canvas.width, canvas.height, grid, player, time, zoomRef.current, camOffsetRef.current, renderEntities, runtime.combat, connectorsRef.current, questsRef.current, dayNightRef.current, attackAnimsRef.current, hitMarkersRef.current, projectilesRef.current, weaponReach(playerWeaponRef.current))
      } else {
        render(ctx, canvas.width, canvas.height, grid, player, time, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, isoZoomRef.current, attackAnimsRef.current, connectorsRef.current, questsRef.current, projectilesRef.current, dayNightRef.current, weaponReach(playerWeaponRef.current))
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

        {/* Combat HUD (HP / rage / mana + F attack · G special) — always shown in the
            clean PLAY VIEW so vitals stay visible while playing. */}
        {playMode && !showFlowView && (
          <CombatHud hud={playerHud} />
        )}

        {/* Ability action bar (keys 1–4 + cooldown sweep) — shows the live player loadout, same
            play-view gate as the vitals HUD. */}
        {playMode && !showFlowView && (
          <AbilityBar loadout={abilityLoadouts['__player__'] ?? DEFAULT_ABILITY_LOADOUT} lastUsedRef={abilityLastUsedRef} />
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

        {/* GAMES view — list playable flows + the game editor; ▶ plays from a level. */}
        {showGamesView && (
          <GamesViewOverlay
            savedTemplates={savedTemplates}
            onPlayLevel={playGameLevel}
            onClose={() => setShowGamesView(false)}
          />
        )}

        {/* TOP NAV — links · views · save/load · export · connectors · new */}
        {showSidebars && !showFlowView && !showGamesView && !playMode && (
        <nav className="fixed left-4 right-4 top-4 z-20 flex items-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-black/90 px-3 py-2 font-mono text-sm text-white shadow-lg shadow-black/40">
          <Link href="/personal-projects/game-engine" className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600">← Templates</Link>
          <Link href="/" className="shrink-0 rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600">CV</Link>
          <button
            onClick={enterPlayMode}
            aria-label="Execute game"
            className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow hover:bg-emerald-500"
          >
            ▶ Execute Game
          </button>
          <button
            onClick={openGamesView}
            aria-label="Games"
            className="shrink-0 rounded bg-indigo-700 px-3 py-1 text-xs font-bold text-white shadow hover:bg-indigo-600"
          >
            Games
          </button>
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

        {/* Bottom-right floating control: Preview toggle in the editor (hides the
            sidebars for a clean look), Exit Game while playing. Execute Game (top nav)
            enters the full clean PLAY VIEW; this is how you leave it. */}
        {!playMode && !showGamesView && (
          <button
            onClick={() => setShowSidebars(s => !s)}
            aria-pressed={!showSidebars}
            className="fixed bottom-4 right-4 z-30 rounded-full bg-purple-700 px-4 py-2 font-mono text-xs font-bold text-white shadow-lg hover:bg-purple-600"
          >
            {showSidebars ? '▣ Preview (hide UI)' : '✎ Edit (show UI)'}
          </button>
        )}
        {playMode && (
          <button
            onClick={exitPlayMode}
            aria-label="Exit game"
            className="fixed left-4 top-4 z-30 rounded-full bg-red-700 px-4 py-2 font-mono text-xs font-bold text-white shadow-lg hover:bg-red-600"
          >
            ⨯ Exit Game
          </button>
        )}

        {/* LEFT SIDEBAR — Views · Stage presets · Assets */}
        {showSidebars && !playMode && (
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
              <button
                onClick={() => setDayNight(d => (d === 'day' ? 'night' : 'day'))}
                aria-pressed={dayNight === 'night'}
                className={`mt-2 w-full rounded px-2 py-1 text-xs font-bold transition-colors ${
                  dayNight === 'night' ? 'bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                Night mode {dayNight === 'night' ? 'on' : 'off'}
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

              {/* Animation Author — define an asset's motion as FRAMES, set timing, it loops. */}
              <div className="border-t border-white/10 pt-3" data-testid="animation-author">
                <p className="mb-1 text-xs font-bold text-fuchsia-400">Animation Author — frames</p>
                <p className="mb-2 text-[9px] leading-tight text-gray-500">
                  Define frames (frame 0 = rest), set a duration → it loops. Each later frame nudges the
                  asset right/left/up/down + rotate; chain them for a wind sway. Select a cell, then Apply.
                </p>

                {/* Starting templates — the old presets, now ready-to-tweak frame sets. */}
                <p className="mb-1 text-[9px] uppercase tracking-wide text-gray-500">Start from a template</p>
                <div className="mb-3 flex flex-wrap gap-1">
                  {CELL_ANIM_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => loadAuthorPreset(p)}
                      className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 transition-colors hover:bg-fuchsia-800 hover:text-white"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>

                {/* FRAME STRIP — frame 0 = rest; add/reorder/delete offset frames. */}
                <div className="mb-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[9px] uppercase tracking-wide text-gray-500">Frames ({authorFrames.length})</span>
                    <button
                      onClick={addAuthorFrame}
                      className="rounded bg-fuchsia-700 px-2 py-0.5 text-[10px] font-bold text-white transition-all hover:opacity-80"
                    >
                      + Add frame
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {authorFrames.map((f, i) => (
                      <div key={i} className="rounded bg-black/40 p-1.5 text-[9px]" data-testid={`anim-frame-${i}`}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-bold text-gray-300">{i === 0 ? 'Frame 0 · rest' : `Frame ${i}`}</span>
                          <span className="flex gap-1">
                            <button onClick={() => moveAuthorFrame(i, -1)} disabled={i <= 1} className="px-1 text-gray-400 hover:text-white disabled:opacity-30" aria-label="move earlier">◀</button>
                            <button onClick={() => moveAuthorFrame(i, 1)} disabled={i === 0 || i === authorFrames.length - 1} className="px-1 text-gray-400 hover:text-white disabled:opacity-30" aria-label="move later">▶</button>
                            <button onClick={() => deleteAuthorFrame(i)} disabled={i === 0} className="px-1 text-red-400 hover:text-red-300 disabled:opacity-30" aria-label="delete frame">✕</button>
                          </span>
                        </div>
                        {i === 0 ? (
                          <p className="text-gray-600">no offset — the asset's normal position</p>
                        ) : (
                          <div className="grid grid-cols-3 gap-1">
                            <FrameStepper label="x" value={f.dx} step={0.05} onChange={v => updateAuthorFrame(i, { dx: v })} />
                            <FrameStepper label="y" value={f.dy} step={0.05} onChange={v => updateAuthorFrame(i, { dy: v })} />
                            <FrameStepper label="rot" value={f.rot ?? 0} step={0.05} onChange={v => updateAuthorFrame(i, { rot: v })} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* TIMING — duration to play frame 0 → last, delay before the loop, ease, loop. */}
                <div className="mb-2 grid grid-cols-2 gap-1.5 text-[10px] text-gray-300">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Duration ms</span>
                    <input type="number" min={0} value={authorDuration} onChange={e => setAuthorDuration(Math.max(0, Number(e.target.value)))} className="rounded bg-gray-800 p-1" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Delay ms</span>
                    <input type="number" min={0} value={authorDelay} onChange={e => setAuthorDelay(Math.max(0, Number(e.target.value)))} className="rounded bg-gray-800 p-1" />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-gray-500">Ease</span>
                    <select value={authorEase} onChange={e => setAuthorEase(e.target.value as Ease)} className="rounded bg-gray-800 p-1">
                      <option value="sine">sine (natural)</option>
                      <option value="linear">linear</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-1 pb-1">
                    <input type="checkbox" checked={authorLoop} onChange={e => setAuthorLoop(e.target.checked)} />
                    <span>loop</span>
                  </label>
                </div>

                {authorStatus && <p className="mb-1 text-[9px] text-amber-300">{authorStatus}</p>}

                <div className="flex gap-1">
                  <button
                    onClick={() => attachAuthorAnim(false)}
                    disabled={selectedCells.size === 0 || authorFrames.length < 2}
                    className="flex-1 rounded bg-gray-700 py-1 text-[10px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-40"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => attachAuthorAnim(true)}
                    disabled={selectedCells.size === 0 || authorFrames.length < 2}
                    className="flex-1 rounded bg-fuchsia-700 py-1 text-[10px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-40"
                  >
                    {selectedCells.size === 0 ? 'Select a cell' : 'Apply'}
                  </button>
                </div>
              </div>
            </Card>

          </aside>
        )}

        {/* RIGHT SIDEBAR — Selected entity (action bar → modals) · Entities · Connectors */}
        {showSidebars && !playMode && (
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
        {(showSidebars || playMode) && !inventoryOpen && !showFlowView && !showGamesView && (
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
          const selEntity = selectedEntityId ? entities.find(e => e.id === selectedEntityId) : undefined
          // Whose stats the panel shows: the selected entity, else the player. HP for the
          // player comes from the live HUD mirror (same source the combat HUD reads).
          const playerEntity = entities.find(e => e.kind === 'player')
          const who = selEntity?.name ?? (selectedEntityId ? 'Entity' : playerDisplayName(playerEntity?.name))
          const baseStats = selEntity?.baseStats ?? playerEntity?.baseStats ?? DEFAULT_PLAYER_STATS
          const hp = selEntity
            ? { current: selEntity.baseStats.maxHp, max: selEntity.baseStats.maxHp }
            : { current: Math.round(playerHud.hp), max: Math.round(playerHud.maxHp) }
          return (
            <EquipmentPanel
              label={who}
              loadout={current}
              baseStats={baseStats}
              hp={hp}
              onChange={l => setLoadouts(prev => ({ ...prev, [activeId]: l }))}
              onClose={() => setInventoryOpen(false)}
              {...(activeId === '__player__'
                ? {
                    nameValue: playerEntity?.name ?? '',
                    onNameChange: setPlayerName,
                    abilityLoadout: abilityLoadouts['__player__'] ?? DEFAULT_ABILITY_LOADOUT,
                    onAbilityChange: (l: readonly AbilityBinding[]) =>
                      setAbilityLoadouts(prev => ({ ...prev, __player__: l })),
                  }
                : {})}
            />
          )
        })()}

        {/* Quest log — open button (also toggled by the Q key) + the panel overlay */}
        {(showSidebars || playMode) && !questLogOpen && !showFlowView && !showGamesView && (
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


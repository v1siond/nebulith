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
import { type BuildingType } from '@/engine/buildingComposer'
import { buildingFootprintCells, canPlaceBuilding, facadeLength, footprintContains, gridBuildingFacing, makeBuilding, moveBuilding, resizeBuilding, rotateBuilding } from '@/engine/buildingEditor'
import { type AnimFrame, type AnimPreset, CELL_ANIM_PRESETS, type Ease, makeCellAnimation, restFrame } from '@/engine/cellAnimation'
import { scaleCompositeToRegion } from '@/engine/compositeFill'
import { findTriggeredConnector, normalizeConnector } from '@/engine/connectors'
import { entityPalette, punchTile, weaponEmoji, weaponGlyph, weaponPose } from '@/engine/entityArt'
import { isoFacadeOnBack, isoFacingIndex } from '@/engine/isoBuilding'
import { assetFootprint, multiCellAssetById, stampAsset } from '@/engine/multiCellAssets'
import { StageData, VariantId, generateStage, stagePaint } from '@/engine/stageGenerator'
import { type Action as TriggerAction, resolveAction } from '@/engine/triggers'
import { ZONE_DECOR_TILE, ZoneId } from '@/engine/zones'
import { type AbilityBinding, DEFAULT_ABILITY_LOADOUT } from '@/game/abilities'
import { startingCombatState } from '@/game/combat'
import { DEFAULT_PLAYER_STATS, byKind, canPlaceEntity, entityAt, entityAtClick, entityAtFootprint, entityCollisionCells, makeEnemy, makeNpc, makePlayer, mintEntityId, placeEntity, removeEntity, withPlayerCell } from '@/game/entities'
import { cycleSelection, unitsInRange } from '@/game/unitSelection'
import { addItem, equipArmor, equipWeapon, itemFromReward, mintItemId, starterInventory, useConsumable } from '@/game/inventory'
import { createLoadout, loadoutBonuses, seededPlayerLoadout, setSpecial } from '@/game/loadout'
import { appendWaypoint } from '@/game/patterns'
import { TEMPLATE_PRESETS, type TemplateTheme } from '@/game/presets'
import { type Projectile } from '@/game/projectiles'
import { type QuestEvent, acceptQuest, recordEvent, turnIn } from '@/game/quests'
import { BARE_HANDS, type HitMarker, type PlayerHud, type ProjectileContext, playerHudFrom, stepCombat, tickProjectiles, triggerAbility } from '@/game/runtime/combat'
import { type PlayerState, aimFromKeys, facingFromKeys, playerDisplayName, resolveSpawnCell } from '@/game/runtime/player'
import { activeQuest, applyQuestEvent, questAnchorScreenPos, questForGiver, reachableQuestGiver, rewardSummary, upsertQuest } from '@/game/runtime/quest'
import { type EnemyRuntime, isLivingEnemy, makeEnemyRuntime, RANGED_RANGE } from '@/game/runtime/targeting'
import { ENEMY_TYPES, CAVE_ENEMY_TYPES, TEMPLE_ENEMY_TYPES, archetypeForEnemyType, scatterEntities } from '@/game/spawner'
import { type CombatState, type Entity, type EntityKind, type EntityVariant, type Inventory, type Item, type Loadout, type Quest, type Reward, type Stats, type TalentPath, type Weapon } from '@/game/types'
import { weaponReach } from '@/game/weapons'
import { VILLAGE_CONFIG } from '@/levels/village'
import { Connector, TemplateListItem, createTemplate, deleteTemplate, deserializeToGrid, getTemplate, listTemplates, serializeGrid, updateTemplate } from '@/lib/api'
import { type CellTriggerGroup, ENTITY_GLYPH, buildingsFromAssets, buildingsToAssets, cellTriggersFromAssets, cellTriggersToAssets, entitiesFromAssets, entitiesToAssets, isBuildingAsset, isEntityAsset, isQuestAsset, isStyleAsset, isTriggerAsset, questsFromAssets, questsToAssets, styleFromAssets, styleToAssets, triggersAtCell } from '@/lib/gridCodec'
import { type Trigger, type TriggerEffect, fireTriggers } from '@/game/runtime/trigger'
import { ASCII_STYLE, type Style, styleById, groundKind, assetKind, entityKind, genderize, resolveVisual, visualForTileId } from '@/game/artStyle'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { render, render2D, renderTopView, clampCameraAxis, isoCameraFocus, entityMotion, ENEMY_MOVE_MS, isDebugMode, setDebugMode, isShowCollisions, setShowCollisions as setCollisionsFlag, cellCaptionMap, type DayNight } from '@/engine/render'
import { loadTilesetsFromBackend, saveTilesetToBackend } from '@/engine/tileset/tilesetLoader'
import { EMOJI_TILESET, setTilePose } from '@/engine/tileset/emojiTileset'
import { type TilePose } from '@/engine/tileset/pose'
import { type QuestDraft, emptyQuestDraft, questFromDraft } from '@/game/runtime/questDraft'
import { buildingPlacementEnv, nearestRoadFacing, stampBuildingCells, unstampBuildingCells } from '@/game/runtime/buildings'
import { type Cursor, type JumpState, JUMP_MS, JUMP_PEAK_PX, advanceEnemyMovement, beginJump, tickCannons } from '@/game/runtime/movement'
import { playSwoosh } from '@/game/runtime/audio'
import { AssetTileSwatch, Card, EntityToolButton, FrameStepper, PaletteGroup, TileSwatch, ViewButton } from '@/components/game/controls'
import { AbilityBar, CombatHud, QuestHud } from '@/components/game/hud'
import { EquipmentPanel, InventoryCard, QuestAuthoringCard, QuestLogPanel } from '@/components/game/panels'
import { EntityAttackBody, EntityIdentityStatsBody, EntityMovementBody, Modal, QuestGiveBody } from '@/components/game/modals'
import { FlowViewOverlay, GamesViewOverlay } from '@/components/game/games'
import { BUILDING_TOOL_TYPE, type BuildingTool, type EditorMode, type EntityTool, GROUND_SWATCHES, NATURE_TILE_KEYS } from '@/components/game/editorConfig'
import { AnimationEditor, ArtSection, Dropdown, GenerateControls, PoseControls, type QuickAction, QuickActionToolbar, SelectionHeader, StylePicker, TileLibraryBody, ToolRail, TriggerEditor, WEAPON_KINDS } from '@/components/game/editorChrome'


// View mode states (global for game loop access)
let topViewMode = false
let flowViewMode = false

// Template limits
const MAX_TEMPLATES_PROD = 1

/** Hold-to-loop cadence for the regular attack — one swing per this interval while `f` is held.
 *  The basic strike is always-available on a 1.5s beat (per the ability spec — see
 *  docs/ability-system.md); abilities (keys 1–4) are the faster/heavier hits, gated by their own
 *  cooldowns. */
const ATTACK_LOOP_MS = 500

/** Stable empty list passed to the renderers when entities are hidden (avoids per-frame alloc). */
const EMPTY_ENTITIES: Entity[] = []
// A frozen empty key map → the player ignores movement input (e.g. while a building
// is selected for editing, when arrow keys drive the BUILDING instead).
const EMPTY_KEYS: Record<string, boolean> = {}


export default function TemplateEditor() {
  const router = useRouter()
  const { toast } = useToast()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<IsometricGrid | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  const [showCollisions, setShowCollisions] = useState(false) // lighter overlay: tint blocked cells only
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

  // ── Unified triggers (stage E) ──────────────────────────────────────
  // "When [event] → do [action]." Cell triggers (enter / interact) live here,
  // keyed by cell; on-defeat triggers live on the entity (entity.triggers). The
  // once-mounted loop reads cell triggers through a ref. Persist via a marker asset.
  const [cellTriggers, setCellTriggers] = useState<CellTriggerGroup[]>([])
  const cellTriggersRef = useRef<CellTriggerGroup[]>([])
  // Play-mode overlays fired by triggers: a win/lose end-state and a dismissible
  // message popup. Null = hidden. The loop sets these through refs (latest closure).
  const [endState, setEndState] = useState<'win' | 'lose' | null>(null)
  const [triggerMessage, setTriggerMessage] = useState<string | null>(null)

  // Entity placement state (player / enemies / NPCs). The game loop is mounted
  // once and reads through a ref, so entities mirror to entitiesRef like connectors.
  const [entities, setEntities] = useState<Entity[]>([])
  const [entityTool, setEntityTool] = useState<EntityTool>(null)
  // UI-only flag: the left tool-rail's "Paint" mode (reveals the tile palette). It
  // doesn't gate any canvas behaviour — painting is driven by selectedTile + the
  // selected cells — it only decides which mode the rail highlights / which left
  // panel shows. The other rail modes derive straight from the tool state below.
  const [paintMode, setPaintMode] = useState(false)
  // ── ART STYLE (stage D) — the global reskin switch. State drives the UI; a ref feeds
  //    the once-mounted render loop. A style change reskins every view instantly (the iso
  //    ground cache keys on style.id, so it rebuilds on switch). Persists with the template.
  const [activeStyleId, setActiveStyleId] = useState<string>('ascii')
  const activeStyleRef = useRef<Style>(ASCII_STYLE)
  useEffect(() => { activeStyleRef.current = styleById(activeStyleId) }, [activeStyleId])
  const activeStyle = styleById(activeStyleId)
  // Live POSE editing writes straight into the in-memory tileset (the RAF loop redraws from it, so the
  // element retunes in-scene); bumpPose then forces the Inspector's PoseControls to re-read the mutation
  // so its sliders track the new value. Undefined pose → setTilePose drops the deviation (back to identity).
  const [, bumpPose] = useReducer((n: number) => n + 1, 0)
  const writeTilePose = useCallback((kind: string, pose: TilePose | undefined) => {
    setTilePose(kind, pose)
    bumpPose()
  }, [])
  const [savingPoses, setSavingPoses] = useState(false)
  // Persist the live-tuned emoji tileset (poses included) back to the backend DB. Success/error → a toast.
  const saveEmojiPoses = useCallback(async () => {
    setSavingPoses(true)
    try {
      await saveTilesetToBackend('emoji')
      toast('Saved poses to the backend', 'success')
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`, 'warning')
    } finally {
      setSavingPoses(false)
    }
  }, [toast])
  // Which selection the Tile Library modal is editing (null = closed). It pins/clears the
  // selected element's per-element override; scope tracks the current selection precedence.
  const [tileLibraryOpen, setTileLibraryOpen] = useState(false)

  // The placed entity currently selected for inspection (click an entity to select).
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const selectedEntityIdRef = useRef<string | null>(null) // live mirror for the game loop / debug seams
  const hoveredEntityIdRef = useRef<string | null>(null) // unit under the cursor — the RAF loop draws its hover reticle (no React state on mousemove)
  // Which Inspector section a quick-action asked to focus. `n` is a nonce so clicking
  // the same verb twice still re-opens + re-scrolls that section (see Card `focus`).
  const [sectionFocus, setSectionFocus] = useState<{ id: string; n: number } | null>(null)
  const focusInspectorSection = (id: string) => setSectionFocus(f => ({ id, n: (f?.n ?? 0) + 1 }))
  // When on, a Top-view click appends a waypoint to the selected entity's patrol path
  // (author your own movement route instead of the default box patrol).
  const [waypointMode, setWaypointMode] = useState(false)
  // Which entity-action modal is open (Stats / Inventory / Movement / Quests / Attacks).
  const [entityModal, setEntityModal] = useState<'inventory' | 'quests' | null>(null)
  // Disarm waypoint authoring + close any entity modal whenever the selection changes,
  // so clicks on a new entity select it (not drop a stray waypoint / show stale modal).
  useEffect(() => {
    selectedEntityIdRef.current = selectedEntityId
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

  // Clear a pending quick-action section focus whenever the SELECTION itself changes, so
  // a section opened on one element doesn't auto-open on the next. Done during render
  // (not a post-commit effect) so the freshly-mounted Inspector cards never see the stale
  // focus. Keyed by a value string — selectedCells is a fresh Set each update.
  const selectionKey = `${selectedEntityId ?? ''}|${selectedBuildingIndex ?? ''}|${editingConnector ? `${editingConnector.col},${editingConnector.row}` : ''}|${Array.from(selectedCells).sort().join(';')}`
  const prevSelectionKeyRef = useRef(selectionKey)
  if (prevSelectionKeyRef.current !== selectionKey) {
    prevSelectionKeyRef.current = selectionKey
    if (sectionFocus) setSectionFocus(null)
  }

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
  // Unified-trigger effect applier the once-mounted loop calls through (latest closure,
  // like triggerConnector). `prevDiedRef` tracks which enemies were already dead last
  // frame so an on-defeat trigger fires exactly once per death (re-fires after respawn).
  const applyTriggerEffectRef = useRef<(effect: TriggerEffect) => void>(() => {})
  const prevDiedRef = useRef<Set<string>>(new Set())
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
  const playModeRef = useRef(false) // live playMode for the raf render loop (mirrors activeStyleRef)
  useEffect(() => { playModeRef.current = playMode }, [playMode])
  // Load tilesets from the nebulith Elixir backend on mount — replaces the bundled defaults (same shape,
  // so render + generation transparently use the DB-served data); falls back to bundled if the API is down.
  useEffect(() => { void loadTilesetsFromBackend() }, [])
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
    const savedCollisions = localStorage.getItem('village-show-collisions') === 'true'
    setDebugMode(savedDebug)
    setCollisionsFlag(savedCollisions)
    topViewMode = savedTopView
    zoomRef.current = savedZoom
    setShowDebug(savedDebug)
    setShowCollisions(savedCollisions)
    setShowTopView(savedTopView)
    setTopViewZoom(savedZoom)
  }, [])

  // Save view state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('village-debug', showDebug.toString())
    localStorage.setItem('village-show-collisions', showCollisions.toString())
    localStorage.setItem('village-topview', showTopView.toString())
    localStorage.setItem('village-topview-zoom', topViewZoom.toString())
    zoomRef.current = topViewZoom
  }, [showDebug, showCollisions, showTopView, topViewZoom])

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
    await loadTemplate(templateId, undefined, { resetToSpawn: true }) // starting a level → begin at its spawn
    enterPlayMode()
  }
  const toggleDebug = () => {
    setDebugMode(!isDebugMode())
    setShowDebug(d => !d)
  }
  const toggleCollisions = () => {
    setCollisionsFlag(!isShowCollisions())
    setShowCollisions(c => !c)
  }

  // Derived: which view is active (for highlighting the view buttons)
  const activeView: 'iso' | '2d' | 'top' | 'flow' =
    showFlowView ? 'flow' : showTopView ? 'top' : viewType === '2d' ? '2d' : 'iso'

  // Derived: which tool-rail MODE is active. Connector/building/unit win over the
  // UI-only paint flag so the rail always mirrors the real armed tool — toggling a
  // tool off (it goes null) drops back to paint or select. The canvas handlers read
  // the fine-grained state, not this; the rail is just a switcher + highlighter.
  const editorMode: EditorMode =
    connectorMode ? 'connector'
    : buildingTool ? 'building'
    : entityTool ? 'unit'
    : paintMode ? 'paint'
    : 'select'

  // Keep selectedCells ref in sync
  useEffect(() => {
    selectedCellsRef.current = selectedCells
  }, [selectedCells])

  // Keep building-editor refs in sync (read by the once-mounted key handler + loop)
  useEffect(() => { buildingToolRef.current = buildingTool }, [buildingTool])
  useEffect(() => { selectedBuildingIndexRef.current = selectedBuildingIndex }, [selectedBuildingIndex])
  useEffect(() => { genZoneRef.current = genZone }, [genZone])

  // Flow view is a full-screen graph — flag it on <body> so the global FPS overlay (rendered
  // outside this tree in _app) can hide itself instead of sitting on top of the flow.
  useEffect(() => {
    document.body.classList.toggle('flow-view-active', showFlowView)
    return () => document.body.classList.remove('flow-view-active')
  }, [showFlowView])

  // The game-engine page fills all four screen corners with its own HUD/nav, so flag it on <body>
  // and pull the global FPS overlay (mounted in _app, top-right) out of the top nav zone via CSS —
  // it was overlapping the "More" button. Removed on unmount so other pages keep the default corner.
  useEffect(() => {
    document.body.classList.add('game-engine-active')
    return () => document.body.classList.remove('game-engine-active')
  }, [])

  // Keep connectors ref in sync
  useEffect(() => {
    connectorsRef.current = connectors
  }, [connectors])

  // Keep connectorMode ref in sync
  useEffect(() => {
    connectorModeRef.current = connectorMode
  }, [connectorMode])

  // Keep the cell-triggers ref in sync so the once-mounted loop fires the latest set
  useEffect(() => {
    cellTriggersRef.current = cellTriggers
  }, [cellTriggers])

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
    // Under a reskin style, the hero holds a real ⚔️/🏹/🪄/🛡️ emoji; ASCII keeps the drawn glyph.
    const emojiHands = activeStyleId !== 'ascii'
    const heldWeapon = mainWeapon ?? playerWeaponRef.current
    playerRef.current.weaponGlyph = emojiHands ? weaponEmoji(heldWeapon) : weaponGlyph(heldWeapon)
    playerRef.current.shieldGlyph = shield ? (emojiHands ? weaponEmoji(shield) : weaponGlyph(shield)) : ''
    // The weapon/shield POSE is re-read from the tileset each frame in the render loop (so the live Pose
    // editor retunes the equipped weapon in-scene) — not cached here.
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
    // Mirror the player entity's authored animations so the live hero plays what you author (#91).
    playerRef.current.animations = playerEntity?.animations
    playerRef.current.variant = playerEntity?.variant // male/female figure
    playerStatsRef.current = {
      ...base,
      strength: base.strength + b.strength,
      intelligence: base.intelligence + b.intelligence,
      defense: base.defense + b.defense,
      maxHp: base.maxHp,
      dodge: (base.dodge ?? 0) + b.dodge,
    }
  }, [loadouts, inventory.equippedWeapon, entities, activeStyleId])

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
      // Use the SAME camera focus the iso render uses (isoCameraFocus, the #38/#70 edge clamp) — the
      // old clampCameraAxis here disagreed with the render, so clicks landed 3–4 cells off and units
      // (incl. the player) couldn't be selected in iso.
      const rawFc = (px - cam.x) / cs
      const rawFr = (pz - cam.y) / cs
      // Match the iso render's camera EXACTLY: it clamps ONLY in play mode (render's clampCamera). In dev
      // mode the render uses the RAW focus (so drag pans freely), so this MUST too — otherwise clicks and
      // the toolbar desync from what's drawn and nothing selects.
      const { fc, fr } = playModeRef.current ? isoCameraFocus(rawFc, rawFr, pPad, qPad, grid.cols, grid.rows) : { fc: rawFc, fr: rawFr }
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

  // Grid cell → viewport screen coords (the FORWARD of screenToCell above). Used to
  // glue the on-canvas quick-action toolbar over the selected element for the ACTIVE
  // view. Returns the cell CENTRE (col+0.5, row+0.5) in viewport pixels, or null when
  // there's no canvas/grid yet. Kept in lockstep with screenToCell's clamped camera so
  // the toolbar sits exactly where the selection highlight draws.
  const cellToScreen = (col: number, row: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return null

    const rect = canvas.getBoundingClientRect()
    const cs = grid.cellSize
    const px = playerRef.current.x
    const pz = playerRef.current.z
    const cam = camOffsetRef.current
    const cc = col + 0.5
    const rr = row + 0.5

    let x: number
    let y: number

    if (topViewMode) {
      const tileSize = 16 * zoomRef.current
      const fCol = clampCameraAxis(px / cs - cam.x / tileSize, canvas.width / tileSize / 2, grid.cols)
      const fRow = clampCameraAxis(pz / cs - cam.y / tileSize, canvas.height / tileSize / 2, grid.rows)
      x = cc * tileSize + (canvas.width / 2 - fCol * tileSize)
      y = rr * tileSize + (canvas.height / 2 - fRow * tileSize)
    } else if (viewTypeRef.current === '2d') {
      const tileW = 24 * zoomRef.current
      const camCol = clampCameraAxis(px / cs - cam.x / tileW, canvas.width / tileW / 2, grid.cols)
      const camRow = clampCameraAxis(pz / cs - cam.y / tileW, canvas.height / tileW / 2, grid.rows)
      x = canvas.width / 2 + (cc - camCol) * tileW
      y = canvas.height / 2 + (rr - camRow) * tileW
    } else {
      const eff = grid.isoScale * isoZoomRef.current
      const S = eff * 0.71
      const T = eff * 0.36
      const pPad = canvas.width / (2 * cs * S)
      const qPad = canvas.height / (2 * cs * T)
      // Same iso focus as the render + screenToCell (isoCameraFocus, not the stale clampCameraAxis) so
      // the quick-action toolbar sits exactly over the selected element.
      const rawFc = (px - cam.x) / cs
      const rawFr = (pz - cam.y) / cs
      // Match the iso render's camera EXACTLY: it clamps ONLY in play mode (render's clampCamera). In dev
      // mode the render uses the RAW focus (so drag pans freely), so this MUST too — otherwise clicks and
      // the toolbar desync from what's drawn and nothing selects.
      const { fc, fr } = playModeRef.current ? isoCameraFocus(rawFc, rawFr, pPad, qPad, grid.cols, grid.rows) : { fc: rawFc, fr: rawFr }
      const a = ((cc - fc) - (rr - fr)) * cs
      const b = ((cc - fc) + (rr - fr)) * cs
      x = a * S + canvas.width / 2
      y = b * T + canvas.height / 2
    }

    // canvas backing store == CSS size (both = window inner size), so scale is ~1, but
    // account for it + the canvas offset anyway to stay correct if the layout changes.
    const scaleX = canvas.width ? rect.width / canvas.width : 1
    const scaleY = canvas.height ? rect.height / canvas.height : 1
    return { x: rect.left + x * scaleX, y: rect.top + y * scaleY }
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

    // ALL views (iso/2d/top): LEFT-click + drag pans the camera — UNLESS a placement tool is armed
    // (entity / building / connector), OR SHIFT is held (shift+drag bulk-SELECTS cells in every view).
    // Plain left-drag pans, shift+drag selects — the SAME gesture everywhere (top view no longer
    // hijacks plain drag for select, which is why the screen wouldn't move). Middle/right-drag also pans.
    if (e.button === 0 && !entityTool && !buildingTool && !connectorMode && !e.shiftKey) {
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
      setSelectedEntityId(null) // editing a connector → the Inspector morphs to it
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

    // No tool armed: clicking a unit selects it — view-aware, so clicking the standing FIGURE works
    // (not just its foot cell). Top view: the unit is on its cell; iso/2d: the figure stands above it.
    const view = topViewMode ? 'top' : viewTypeRef.current === '2d' ? '2d' : 'iso'
    // Hit-test the PLAYER at its LIVE cell: its sprite tracks playerRef, but the player entity's
    // col/row is frozen at spawn (only syncPlayerEntity writes it), so use withPlayerCell or the
    // walked hero is unselectable.
    const clickedEntity = entityAtClick(withPlayerCell(entitiesRef.current, livePlayerCell()), cell.col, cell.row, view)
    if (clickedEntity) {
      setSelectedEntityId(clickedEntity.id)
      return
    }

    // Selecting cells makes the CELL the Inspector's subject — drop any unit selection
    // so the panel morphs to the cell instead of lingering on the last-clicked entity.
    setSelectedEntityId(null)
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
    // Hover targeting (#24): hit-test the unit under the cursor — view-aware, the SAME test the click-select
    // uses (withPlayerCell so the walked hero is hittable) — and stash its id in a REF. The RAF loop reads
    // it to draw a dim white hover reticle. A ref (not state) so a mousemove never triggers a React render.
    const hoverCell = screenToCell(e.clientX, e.clientY)
    const hoverView = topViewMode ? 'top' : viewTypeRef.current === '2d' ? '2d' : 'iso'
    hoveredEntityIdRef.current = hoverCell
      ? (entityAtClick(withPlayerCell(entitiesRef.current, livePlayerCell()), hoverCell.col, hoverCell.row, hoverView)?.id ?? null)
      : null

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

    if (!isSelecting || !selectionStart) return // drag-select the cell rectangle (top view, or shift+drag in iso/2d)
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
    // A no-drag click in a play view (iso/2d) selects the unit under it — view-aware so clicking the
    // standing FIGURE (drawn above its foot cell) selects it, not only a click on the exact cell.
    if (isPanning && !dragMovedRef.current && downCellRef.current) {
      const c = downCellRef.current
      const clickView = topViewMode ? 'top' : viewTypeRef.current === '2d' ? '2d' : 'iso'
      // Player is hit-tested at its LIVE cell (see withPlayerCell) — the entity's stored cell is
      // frozen at spawn, so without this the walked hero can't be selected in a play view.
      const hit = entityAtClick(withPlayerCell(entitiesRef.current, livePlayerCell()), c.col, c.row, clickView)
      if (hit) {
        setSelectedEntityId(hit.id)
      } else {
        // Empty ground in a play view → select THAT CELL (not just clear), so it becomes the Inspector's
        // subject and you can replace/clear it (Tile Library) right there — cell editing works in iso/2d too.
        setSelectedEntityId(null)
        setSelectedCells(new Set([`${c.col},${c.row}`]))
      }
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
    setPaintMode(false)
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
    setPaintMode(false)
    setEntityTool(null)
    setConnectorMode(false)
    setEditingConnector(null)
    deselectBuilding()
  }

  /** Clear any armed tile so a Select-mode click inspects instead of painting. */
  const clearPaintTile = () => {
    setSelectedTile(null)
    setSelectedComposite(null)
    setSelectedMultiAsset(null)
    setHeightEditMode(false)
  }

  /** Switch the left tool-rail mode. Each mode arms the matching existing tool
   *  state (so the canvas handlers behave exactly as before) and disarms the rest;
   *  unit/building arm a sensible default sub-tool, kept if one is already chosen. */
  const selectMode = (m: EditorMode) => {
    setEditingConnector(null)
    if (m === 'select') {
      setPaintMode(false)
      setEntityTool(null)
      setBuildingTool(null)
      setConnectorMode(false)
      deselectBuilding()
      clearPaintTile()
      return
    }
    if (m === 'paint') {
      setPaintMode(true)
      setEntityTool(null)
      setBuildingTool(null)
      setConnectorMode(false)
      deselectBuilding()
      return
    }
    if (m === 'unit') {
      setPaintMode(false)
      setBuildingTool(null)
      setConnectorMode(false)
      deselectBuilding()
      clearPaintTile()
      setEntityTool(prev => prev ?? 'enemy')
      return
    }
    if (m === 'building') {
      setPaintMode(false)
      setEntityTool(null)
      setConnectorMode(false)
      clearPaintTile()
      setBuildingTool(prev => prev ?? 'select')
      return
    }
    // connector
    setPaintMode(false)
    setEntityTool(null)
    setBuildingTool(null)
    deselectBuilding()
    clearPaintTile()
    setConnectorMode(true)
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
    setSelectedEntityId(null) // the building becomes the Inspector's subject
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
    setSelectedEntityId(null) // the fresh building becomes the Inspector's subject
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

  /** Grow/shrink the selected building's FACADE LENGTH by `delta` cells (3–8), re-extruded in place —
   *  "put a house tile and make it 4 or 6 cells long". Keeps the footprint centred; skips if blocked. */
  const resizeSelectedBuilding = (delta: number) => {
    const grid = gridRef.current
    const idx = selectedBuildingIndexRef.current
    if (!grid || idx == null) return
    const old = grid.buildings[idx]
    if (!old) return
    const nextLen = Math.min(8, Math.max(3, facadeLength(old) + delta))
    if (nextLen === facadeLength(old)) return
    if (!tryReplaceBuilding(grid, idx, old, resizeBuilding(old, nextLen))) {
      toast('Cannot resize — no room for the new footprint here', 'warning')
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

  // ── Art-style overrides (stage D) — pin/clear a per-element tile ───
  /** The current selection's override id (entity's, or the first selected cell's asset's). */
  const selectedOverride = (() => {
    if (selectedEntityId) return entities.find(e => e.id === selectedEntityId)?.tileOverride ?? null
    const grid = gridRef.current
    if (grid && selectedCells.size > 0) {
      const [c, r] = Array.from(selectedCells)[0].split(',').map(Number)
      return grid.getAssetsAtCell(c, r)[0]?.tileOverride ?? null
    }
    return null
  })()

  /** Pin (or clear, with null) a Library tile id on the selected element — an entity, or the
   *  asset(s) under the selected cell(s). Rides the asset/entity through the codec (clone),
   *  so it saves + reloads with the template. Buildings reskin via the global style only. */
  const setSelectionOverride = (tileId: string | null) => {
    if (selectedEntityId) {
      setEntities(prev => prev.map(e => (e.id === selectedEntityId ? { ...e, tileOverride: tileId ?? undefined } : e)))
      return
    }
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) return
    for (const key of selectedCells) {
      const [c, r] = key.split(',').map(Number)
      const assets = grid.getAssetsAtCell(c, r)
      if (assets.length > 0) {
        for (const a of assets) a.tileOverride = tileId ?? undefined
      } else if (tileId) {
        // A BARE ground cell (no asset to pin) → drop a decoration asset locked to the chosen tile, so
        // you can replace ANY cell with any tile, not just cells that already hold a tree/prop.
        const v = visualForTileId(tileId)
        grid.placeAsset([v?.kind === 'glyph' ? v.char : '?'], c, r, { type: 'decoration', tileOverride: tileId })
      }
    }
    bumpBuildingVersion() // nudge a re-render (assets mutate in place)
  }

  // Editor debug/validation hooks on window (same family as __ISO_NOCACHE / __isoRenderMs):
  //  __setArtStyle(id)      → flip the active global style without the dropdown
  //  __selectFirstTreeCell()→ select the first tree's cell (returns {col,row}) so the real
  //                           Inspector ◰ Art + Tile Library flow can be driven deterministically.
  // Editor-only; harmless in production.
  useEffect(() => {
    const win = window as unknown as {
      __setArtStyle?: (id: string) => void
      __selectFirstTreeCell?: () => { col: number; row: number } | null
      __setView?: (v: 'iso' | '2d' | 'top') => void
      __gridKinds?: () => unknown
      __entityInfo?: () => unknown
      __entityScreens?: () => Array<{ id: string; kind: string; variant: string | null; x: number | null; y: number | null }>
      __selectEntity?: (id: string) => string
      __setEntitySize?: (id: string, size: number) => number
      __scatter?: () => void
      __selectedEntityInfo?: () => unknown
      __placeBuilding?: (type: string, col: number, row: number) => void
      __selectBuilding?: (i: number) => number | null
      __resizeBuilding?: (delta: number) => void
      __selectedBuildingLen?: () => number | null
      __cellSel?: () => { count: number; first: string | null }
      __selectCells?: (keys: string[]) => number
      __applyCellTile?: (tileId: string | null) => void
      __clearRegion?: (col0: number, row0: number, col1: number, row1: number) => void
      __setDebug?: (v: boolean) => void
      __cellLabels?: (col0: number, row0: number, col1: number, row1: number) => unknown
      __camOffset?: () => { x: number; y: number }
    }
    win.__camOffset = () => ({ ...camOffsetRef.current })
    // Debug-overlay + tileset-label validation seams: toggle the label overlay, and DUMP the
    // `<TYPE> <POSITION>` label of every cell in a region (terrain autotile label overridden by an
    // asset caption) — so "every cell carries a consistent tileset label" is validated as DATA.
    win.__setDebug = (v: boolean) => setDebugMode(!!v)
    win.__cellLabels = (col0: number, row0: number, col1: number, row1: number) => {
      const grid = gridRef.current
      if (!grid) return null
      const caps = cellCaptionMap(grid.ground, grid.assets)
      const out: { col: number; row: number; label: string; type: string; blocked: boolean }[] = []
      for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) {
        const cap = caps.get(`${c},${r}`)
        out.push({ col: c, row: r, label: cap?.text ?? '(none)', type: cap?.type ?? 'none', blocked: grid.isBlocked(c, r) })
      }
      return out
    }
    // Cell-editing validation seams: read the current cell selection, set it, and pin a tile to it — so
    // "select any cell + replace it" is validated deterministically (independent of click/drag timing).
    win.__cellSel = () => ({ count: selectedCellsRef.current.size, first: Array.from(selectedCellsRef.current)[0] ?? null })
    win.__selectCells = (keys: string[]) => { setSelectedCells(new Set(keys)); setSelectedEntityId(null); return keys.length }
    win.__applyCellTile = (tileId: string | null) => setSelectionOverride(tileId)
    win.__clearRegion = (col0: number, row0: number, col1: number, row1: number) => {
      const g = gridRef.current
      if (!g) return
      for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) { g.setGround(c, r, 'grass'); g.setCollision(c, r, false) }
      g.assets = g.assets.filter(a => !(a.col >= col0 && a.col <= col1 && a.row >= row0 && a.row <= row1))
      g.buildings = g.buildings.filter(bd => !(bd.col >= col0 - 4 && bd.col <= col1 && bd.row >= row0 - 4 && bd.row <= row1 + 4))
    }
    // Building-tool validation seams: place a house, resize it, read its facade length — so house-sizing
    // ("make a house 4 or 6 cells long, iso re-extrudes") is validated in the real editor deterministically.
    win.__placeBuilding = (type: string, col: number, row: number) => placeNewBuilding(type as BuildingType, col, row)
    win.__selectBuilding = (i: number) => {
      const g = gridRef.current
      if (!g || !g.buildings[i]) return null
      setSelectedEntityId(null)
      selectedBuildingIndexRef.current = i
      setSelectedBuildingIndex(i)
      return facadeLength(g.buildings[i])
    }
    win.__resizeBuilding = (delta: number) => resizeSelectedBuilding(delta)
    win.__selectedBuildingLen = () => {
      const g = gridRef.current
      const i = selectedBuildingIndexRef.current
      return g && i != null && g.buildings[i] ? facadeLength(g.buildings[i]) : null
    }
    // Read the live entity roster's kind + variant — so we can VALIDATE that randomized npcs actually
    // carry male/female variants in the DATA (the female-units question), not just eyeball the render.
    win.__entityInfo = () => {
      const ents = entitiesRef.current
      const byVariant: Record<string, number> = {}
      for (const e of ents) { const key = e.variant ?? 'none'; byVariant[key] = (byVariant[key] ?? 0) + 1 }
      return { count: ents.length, byVariant, entities: ents.map(e => ({ id: e.id, kind: e.kind, variant: e.variant ?? null, name: e.name, col: e.col, row: e.row, anims: e.animations?.length ?? 0 })) }
    }
    // Each entity's SCREEN position in the current view (via the same cellToScreen the click path uses) —
    // so a validation click lands exactly on a figure, and we can tell click-mapping from inspector bugs.
    win.__entityScreens = () => entitiesRef.current.map(e => ({ id: e.id, kind: e.kind, variant: e.variant ?? null, ...(cellToScreen(e.col, e.row) ?? { x: null, y: null }) }))
    // Select an entity DIRECTLY (bypassing the click hit-test) to isolate whether selection-display works
    // from whether click-MAPPING works.
    win.__selectEntity = (id: string) => { setSelectedEntityId(id); return id }
    // Set an entity's render SIZE by id (a boss) — automation/validation hook, mirrors the Inspector's
    // Size control (rescales stats by the same ratio). Same family as __resizeBuilding.
    win.__setEntitySize = (id: string, size: number) => { resizeEntityById(id, size); return size }
    win.__scatter = () => randomizeEntities() // scatter enemies + an npc (mirrors the ⤳ Scatter button)
    // What the inspector currently considers selected + its animation frames (the exact thing the user sees).
    win.__selectedEntityInfo = () => {
      const id = selectedEntityIdRef.current
      const e = entitiesRef.current.find(x => x.id === id)
      if (!e) return { selectedId: id, found: false }
      return { selectedId: id, found: true, kind: e.kind, variant: e.variant ?? null, name: e.name, animations: (e.animations ?? []).map(a => ({ name: a.name, frames: a.frames.map(f => f.char ?? f.tileId ?? '(base)') })) }
    }
    win.__setArtStyle = (id: string) => setActiveStyleId(id)
    // Flip the active VIEW without the toolbar — for validation screenshots across iso/2d/top.
    win.__setView = (v: 'iso' | '2d' | 'top') => {
      if (v === 'top') return selectTopView()
      if (v === '2d') return select2DView()
      return selectIsoView()
    }
    // GRID-based mixing audit: classify every ground cell + asset under the ACTIVE style and report
    // which tile types fall through to ASCII (kind==='ascii'). In emoji mode this must be EMPTY — any
    // entry is a real cell rendering an ascii glyph next to emoji. Validates the grid, not a screenshot.
    win.__gridKinds = () => {
      const grid = gridRef.current
      const style = activeStyleRef.current
      if (!grid) return null
      const ascii: Record<string, number> = {}
      let total = 0
      let emoji = 0
      const tally = (falls: boolean, tag: string) => {
        total++
        if (falls) ascii[tag] = (ascii[tag] ?? 0) + 1
        else emoji++
      }
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const t = grid.ground[r]?.[c] || 'grass'
          const k = groundKind(t)
          tally(resolveVisual(k, style).kind === 'ascii', `ground:${t}→${k}`)
        }
      }
      for (const a of grid.assets) {
        const k = assetKind(a)
        tally(resolveVisual(k, style, a.tileOverride).kind === 'ascii', `asset:${a.type}/${a.label ?? '-'}→${k}`)
      }
      return { style: style.id, total, emoji, asciiCount: total - emoji, asciiKinds: Object.entries(ascii).sort((x, y) => y[1] - x[1]) }
    }
    win.__selectFirstTreeCell = () => {
      const grid = gridRef.current
      if (!grid) return null
      const pc = playerRef.current.x / grid.cellSize
      const pr = playerRef.current.z / grid.cellSize
      // the tree NEAREST the player (so it's on-screen for a validation screenshot)
      let best: { col: number; row: number } | null = null
      let bestD = Infinity
      for (const a of grid.assets) {
        if (a.type !== 'tree') continue
        const d = (a.col - pc) ** 2 + (a.row - pr) ** 2
        if (d < bestD) { bestD = d; best = { col: a.col, row: a.row } }
      }
      if (!best) return null
      setSelectedEntityId(null)
      setSelectedCells(new Set([`${best.col},${best.row}`]))
      return best
    }
    return () => { delete win.__setArtStyle; delete win.__selectFirstTreeCell; delete win.__setView; delete win.__gridKinds; delete win.__entityInfo; delete win.__entityScreens; delete win.__selectEntity; delete win.__setEntitySize; delete win.__scatter; delete win.__selectedEntityInfo; delete win.__placeBuilding; delete win.__selectBuilding; delete win.__resizeBuilding; delete win.__selectedBuildingLen; delete win.__cellSel; delete win.__selectCells; delete win.__applyCellTile; delete win.__clearRegion; delete win.__setDebug; delete win.__cellLabels }
  }, [])

  // ── Selected-entity inspector actions ─────────────────────────────
  const patchSelectedEntity = (patch: Partial<Entity>) => {
    if (!selectedEntityId) return
    setEntities(prev => prev.map(e => (e.id === selectedEntityId ? { ...e, ...patch } : e)))
  }
  /** Set an entity's render SIZE (a boss draws bigger). Rescales the stat block by the size RATIO so the
   *  figure and its stats stay in step (makeEnemy scales at creation; this keeps an in-editor change
   *  consistent). size 1 drops the field (a normal-sized entity carries no size). */
  const resizeEntityById = (id: string, nextSize: number) => {
    setEntities(prev => prev.map(e => {
      if (e.id !== id) return e
      const ratio = nextSize / (e.size ?? 1)
      const s = e.baseStats
      const baseStats = ratio === 1 ? s : {
        ...s,
        maxHp: Math.round(s.maxHp * ratio),
        strength: Math.round(s.strength * ratio),
        intelligence: Math.round(s.intelligence * ratio),
        defense: Math.round(s.defense * ratio),
      }
      const next = { ...e, baseStats }
      if (nextSize > 1) next.size = nextSize
      else delete next.size
      return next
    }))
  }
  const setSelectedEntitySize = (nextSize: number) => {
    if (selectedEntityId) resizeEntityById(selectedEntityId, nextSize)
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

  /** Bulk-CLEAR the selected cells: reset ground to grass, drop any assets, flatten height — an easy
   *  eraser over a rectangle selection (there was no way to bulk-clean the grid before). */
  const clearSelectedCells = () => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) return
    selectedCells.forEach(key => {
      const [col, row] = key.split(',').map(Number)
      grid.setGround(col, row, 'grass')
      grid.setHeight(col, row, 0)
      grid.setCollision(col, row, false)
    })
    grid.assets = grid.assets.filter(a => !selectedCells.has(`${a.col},${a.row}`))
    setSelectedCells(new Set())
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
    // TREES keep their 🌲 shape and are RECOLOURED to the season by the renderer (asset.color = the zone
    // canopy shade), so autumn trees are amber, winter frosted — NOT replaced with a flower/leaf. Only the
    // subtle floor-litter swaps to a season tile (was ugly ascii specks): 🍂 autumn, ❄️ winter, 🌾 desert.
    const decorTile = ZONE_DECOR_TILE[stage.zone]
    for (const a of paint.assets) {
      const override = a.type === 'ground_decor' ? decorTile : undefined
      grid.placeAsset([a.char], a.col, a.row, { type: a.type, blocking: a.blocking, color: a.color, label: a.label, baseShadow: a.baseShadow, buildingType: a.buildingType, edge: a.edge, footprint: a.footprint, cellPart: a.label, tileOverride: override })
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

  /** Promote the generators' decorative ☺ NPC assets into REAL npc entities: a generated town's
   *  wanderers become SELECTABLE units that carry a male/female variant (alternating), instead of
   *  genderless ☺ props that always render neutral (the "no female units" gap). The bare `type:'npc'`
   *  assets are removed and entities take their place, rendering through the gendered entity path.
   *  Real saved entities (type 'nebulith:entity') are never matched, so this never touches them. */
  const promoteNpcAssetsToEntities = (grid: IsometricGrid): Entity[] => {
    const bare = grid.assets.filter(a => a.type === 'npc')
    if (bare.length === 0) return []
    grid.assets = grid.assets.filter(a => a.type !== 'npc')
    return bare.map((a, i) => ({
      ...makeNpc(mintEntityId('npc'), a.col, a.row, { name: `Wanderer ${i + 1}` }),
      variant: (i % 2 === 0 ? 'male' : 'female') as 'male' | 'female',
    }))
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
    // Populate with real, SELECTABLE, gendered npc entities. Any ☺ props get promoted; on top of that,
    // SETTLED stages (forest/town/city) carry NO npcs from the generator, so scatter gendered townsfolk
    // onto walkable cells — else a "town" has no townspeople (and no females). Dungeons (cave/temple)
    // get enemies instead (below). A (re)generate RESETS the roster to just the player — drop any
    // enemies + wanderers left from a previous generate so they don't stack up, then re-randomize.
    const promotedNpcs = promoteNpcAssetsToEntities(grid)
    const settled = variant !== 'cave' && variant !== 'temple'
    const townCount = variant === 'city' ? 14 : variant === 'town' ? 8 : 5
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r)),
    )
    setEntities(prev => {
      const kept = byKind(prev, 'player')
      const townsfolk = settled
        ? scatterEntities({ collision, occupied: kept.map(e => ({ col: e.col, row: e.row })), count: townCount, kinds: ['npc'], idPrefix: `town-${prev.length}` })
        : []
      return [...kept, ...promotedNpcs, ...townsfolk]
    })
    if (variant === 'cave') seedStageEnemies(grid, CAVE_ENEMY_TYPES, 'cave') // bats/spiders/skeletons
    if (variant === 'temple') seedStageEnemies(grid, TEMPLE_ENEMY_TYPES, 'temple') // skeletons/guardians/wraiths
    setSelectedCells(new Set())
    deselectBuilding() // building indices were rebuilt → drop any stale selection
  }

  // Scatter archetype-appropriate enemies onto a freshly-generated dungeon floor (grouped by
  // type via the shared spawner), spaced from the player + any existing entities. The play
  // loop lazily gives each a combat runtime the first frame it's seen. Shared by cave + temple.
  const seedStageEnemies = (grid: IsometricGrid, enemyTypes: readonly string[], prefix: string) => {
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r)),
    )
    setEntities(prev => {
      const occupied = prev.map(e => ({ col: e.col, row: e.row }))
      const spawned = scatterEntities({
        collision,
        occupied,
        count: 10,
        kinds: ['enemy'],
        enemyTypes, // each type grouped into its own map zone
        idPrefix: `${prefix}-${prev.length}`,
      })
      return [...prev, ...spawned]
    })
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
    grid.buildings = [] // rebuilt below as STRUCTURED buildings (walls+roof), populated in STEP 6
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

      // Weighted building types — mostly houses, a few bigger/civic — so a village reads as homes.
      // Mostly homes, then civic + a rare landmark (temple/cathedral/castle) so a town has variety.
      const HOUSE_TYPES: BuildingType[] = ['house', 'house', 'house', 'big-house', 'store', 'hospital', 'temple', 'cathedral', 'castle']
      for (let i = 0; i < numBuildings && validSpots.length > 0; i++) {
        const spotIdx = Math.floor(Math.random() * validSpots.length)
        const spot = validSpots.splice(spotIdx, 1)[0]
        // A real STRUCTURED building (walls + roof + door), NOT a flat brick block: iso extrudes a 3D
        // house and 2D draws a proper facade. The type sets the size; face the nearest road so the door
        // fronts it. canPlaceBuilding rejects overlaps/roads/water/out-of-bounds (skip → fewer, never bad).
        const type = HOUSE_TYPES[Math.floor(Math.random() * HOUSE_TYPES.length)]
        const b = makeBuilding(type, nearestRoadFacing(grid, spot.x, spot.y), spot.x, spot.y)
        if (!canPlaceBuilding(buildingPlacementEnv(grid, -1, new Set()), b)) continue
        stampBuildingCells(grid, b, genZoneRef.current)
        grid.buildings.push(b)
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
    // The village's ☺ wanderers become real, SELECTABLE, gendered npc entities (male/female
    // alternating) instead of genderless props — the "no female units when randomizing" fix.
    const promotedNpcs = promoteNpcAssetsToEntities(grid)
    // Reset the roster to just the player before re-scattering, so regenerating doesn't stack
    // enemies/wanderers from a previous generate on top of the fresh map.
    setEntities(prev => [...byKind(prev, 'player'), ...promotedNpcs])
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
      // Tab cycles the target through the ENEMIES CLOSE to the player (living enemies within RANGED_RANGE),
      // nearest first — not every unit on the map, and never NPCs or the player. Shift+Tab goes back.
      // preventDefault so Tab doesn't shift DOM focus / scroll.
      if (e.key === 'Tab' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        const pc = livePlayerCell()
        const nearby = entitiesRef.current.filter(en => en.kind === 'enemy' && isLivingEnemy(en, enemyRuntimeRef.current))
        const ids = unitsInRange(nearby, pc.col, pc.row, RANGED_RANGE)
        const next = cycleSelection(ids, selectedEntityIdRef.current, e.shiftKey ? -1 : 1)
        if (next) setSelectedEntityId(next)
        return
      }
      // Esc resets the WHOLE selection — the target AND any selected cells. Guarded so it only fires when
      // something IS selected; otherwise Esc falls through to whatever else wants it (menus, build editor).
      if (e.key === 'Escape' && (selectedEntityIdRef.current || selectedCellsRef.current.size > 0)) {
        setSelectedEntityId(null)
        setSelectedCells(new Set())
        return
      }
      // Normalize letter keys to lowercase: holding SHIFT makes 'w' arrive as 'W' on keydown but
      // 'w' on keyup (or vice-versa), so an un-normalized key never clears → the player runs forever
      // (the stuck-Shift bug). Single-char keys → lowercase; named keys (ArrowUp, Shift) unchanged.
      keysRef.current[e.key.length === 1 ? e.key.toLowerCase() : e.key] = true
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false
    }
    // Losing focus (alt-tab / clicking a field) can drop a keyup → clear all held keys so movement
    // doesn't stick.
    const handleBlur = () => { keysRef.current = {} }
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
    window.addEventListener('blur', handleBlur)
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
      if (jumpDown && !jumpDownRef.current) beginJump(player, grid, use2DMovement, jump, time, pressedFacing !== null, !!keys['Shift'])
      jumpDownRef.current = jumpDown

      // Entities block movement across their FULL footprint: NPCs + living enemies are
      // solid, the player's own marker + dead enemies are not. Recomputed each frame so
      // it follows patrols and clears the moment an enemy dies. Used by both the player
      // collision below and the patrol stepper.
      const entityBlocked = entityCollisionCells(
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
      // Update player - slower speed for 16px cells. Holding Shift while moving SPRINTS (faster +
      // the run animation frame 🏃 instead of the walk 🚶).
      const running = !!keys['Shift']
      const speed = 80 * (dt / 1000) * (running ? 1.7 : 1)
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
      // Running = actually moving with Shift down (drives the 🏃 run frame; idle/still → not running).
      player.running = running && player.moving

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
          // Unified triggers: fire this cell's `on enter` triggers (win / spawn / message
          // / goto / …). Additive to connectors — both can live on the same map.
          const enterTrigs = triggersAtCell(cellTriggersRef.current, curCol, curRow)
          if (enterTrigs.length > 0) {
            for (const eff of fireTriggers('enter', enterTrigs, { at: { col: curCol, row: curRow } })) {
              applyTriggerEffectRef.current(eff)
            }
          }
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
          // Unified triggers: fire this cell's `on interact` triggers too (additive —
          // never blocks the connector/quest path above).
          const interactTrigs = triggersAtCell(cellTriggersRef.current, curCol, curRow)
          for (const eff of fireTriggers('interact', interactTrigs, { at: { col: curCol, row: curRow } })) {
            applyTriggerEffectRef.current(eff)
          }
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

        // ── On-defeat triggers ──
        // The combat module stamps a death time in runtime.diedAt when an enemy is
        // killed. Newly-present ids (not dead last frame) died THIS frame → fire that
        // entity's `on defeat` triggers exactly once. Comparing against prevDiedRef
        // (reset to the current dead set each frame) also re-arms after a respawn clears
        // the id, so a boss killed twice fires twice.
        const diedNow = runtime.diedAt
        const prevDied = prevDiedRef.current
        if (diedNow.size > 0) {
          for (const id of diedNow.keys()) {
            if (prevDied.has(id)) continue
            const ent = entitiesRef.current.find(e => e.id === id)
            if (!ent?.triggers?.length) continue
            for (const eff of fireTriggers('defeat', ent.triggers, { at: { col: ent.col, row: ent.row } })) {
              applyTriggerEffectRef.current(eff)
            }
          }
        }
        prevDiedRef.current = new Set(diedNow.keys())

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
      // Debug/profiling seam (like window.__isoRenderMs): the live player cell + entity
      // count, read by dev tooling and the trigger play-mode smoke. No behavior effect.
      if (typeof window !== 'undefined') {
        ;(window as unknown as { __nebulith?: unknown }).__nebulith = {
          playerCol: Math.floor(player.x / grid.cellSize),
          playerRow: Math.floor(player.z / grid.cellSize),
          entityCount: entitiesRef.current.length,
        }
      }
      // Re-read the held weapon/shield pose from the tileset EVERY frame, so the Pose editor's sliders
      // retune the equipped weapon live in-scene — the pose is DATA in the tileset, not a cached snapshot.
      const poseStyleNow = activeStyleRef.current.id === 'ascii' ? 'ascii' : 'emoji'
      player.weaponPose = weaponPose(playerWeaponRef.current?.kind, poseStyleNow)
      player.shieldPose = weaponPose(playerShieldRef.current?.kind, poseStyleNow)
      // Bare-handed swing → a 👊 fist at the hand (emoji styles only), read from the same tileset each
      // frame so a tuned fist pose is live too. Armed or ASCII → '' (the weapon / ASCII swing takes over).
      const punch = punchTile(poseStyleNow)
      player.punchGlyph = punch.glyph
      player.punchPose = punch.pose
      if (flowViewMode) {
        // Flow view is handled by React overlay, just clear canvas
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      } else if (topViewMode) {
        renderTopView(ctx, canvas.width, canvas.height, grid, player, zoomRef.current, selectedCellsRef.current, connectorsRef.current, connectorModeRef.current, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, questsRef.current, dayNightRef.current, activeStyleRef.current)
      } else if (viewTypeRef.current === '2d') {
        render2D(ctx, canvas.width, canvas.height, grid, player, time, zoomRef.current, camOffsetRef.current, renderEntities, runtime.combat, connectorsRef.current, questsRef.current, dayNightRef.current, attackAnimsRef.current, hitMarkersRef.current, projectilesRef.current, weaponReach(playerWeaponRef.current), activeStyleRef.current, selectedEntityIdRef.current, hoveredEntityIdRef.current)
      } else {
        render(ctx, canvas.width, canvas.height, grid, player, time, camOffsetRef.current, renderEntities, runtime.combat, hitMarkersRef.current, time, isoZoomRef.current, attackAnimsRef.current, connectorsRef.current, questsRef.current, projectilesRef.current, dayNightRef.current, weaponReach(playerWeaponRef.current), activeStyleRef.current, playModeRef.current, selectedEntityIdRef.current, hoveredEntityIdRef.current)
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
      window.removeEventListener('blur', handleBlur)
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
        ...styleToAssets(activeStyleId), // active art style rides as one off-grid marker (ASCII → none)
        ...cellTriggersToAssets(cellTriggers), // cell triggers (enter/interact) ride as off-grid markers
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
  const loadTemplate = async (id: string, spawnOverride?: { col: number; row: number }, opts?: { resetToSpawn?: boolean }) => {
    setIsLoading(true)
    // #87: capture where the player IS *before* any resize/deserialize can move them, so reloading
    // the map they're already in can KEEP that position instead of jumping to the last-saved spawn.
    const preloadCell = livePlayerCell()
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
      const loadedStyle = styleFromAssets(gridRef.current!.assets) // active art style marker (null → ASCII)
      const loadedCellTriggers = cellTriggersFromAssets(gridRef.current!.assets) // cell triggers (enter/interact)
      gridRef.current!.assets = gridRef.current!.assets.filter(
        a => !isEntityAsset(a) && !isQuestAsset(a) && !isBuildingAsset(a) && !isStyleAsset(a) && !isTriggerAsset(a),
      )
      setActiveStyleId(styleById(loadedStyle).id) // restore the saved global skin (defaults to ASCII)
      setCellTriggers(loadedCellTriggers) // restore the authored cell triggers
      // Restore the grouped buildings so iso/2D/top render the upright model, not the per-cell fallback.
      gridRef.current!.buildings = loadedBuildings
      setEntities(loadedEntities)
      setQuests(loadedQuests)

      // Move player to valid spawn. Priority: a connector teleport override, else the
      // placed PLAYER entity's cell (player=entity: the placed player defines the spawn),
      // else the template's default spawn.
      const playerEntity = (template.entities ?? []).find(e => e.kind === 'player')
      const tgt = gridRef.current!
      // #87: reloading the map you're ALREADY in keeps your CURRENT position — a load must not yank
      // you back to the last-saved spawn. A connector/trigger teleport or a deliberate reset
      // (restart / play-a-level, opts.resetToSpawn) still uses the target spawn.
      const keptCell = !spawnOverride && !opts?.resetToSpawn && id === currentTemplateId ? preloadCell : null
      // Priority (teleport → keep-current → saved marker → template spawn), clamped to the target so a
      // stale/off-map spawn (e.g. a legacy fixed 25,25 on a smaller map) never lands off the map (#88).
      const spawn = resolveSpawnCell(
        {
          override: spawnOverride,
          keptCell,
          playerMarker: playerEntity ? { col: playerEntity.col, row: playerEntity.row } : null,
          templateSpawn: { col: template.spawnCol, row: template.spawnRow },
        },
        tgt.cols,
        tgt.rows,
      )
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
      // Keep the clickable player MARKER with the live player: reposition it when we preserved the
      // current position (#87); otherwise leave a saved marker where it loaded.
      syncPlayerEntity(landedCell.col, landedCell.row, !!keptCell)

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
  const loadMostRecentTemplate = async (): Promise<string | null> => {
    try {
      const { templates } = await listTemplates({ limit: 50 })
      if (templates.length === 0) {
        router.replace('/personal-projects/game-engine') // nothing saved yet → gallery
        return null
      }
      const mostRecent = [...templates].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0]
      await loadTemplate(mostRecent.id)
      return mostRecent.id // caller reflects it in the URL (replace, no history entry)
    } catch (error) {
      console.error('Failed to load last saved template:', error)
      router.replace('/personal-projects/game-engine')
      return null
    }
  }

  /** Open a saved template by routing THROUGH the URL (?id=…), so the address bar reflects the
   *  open map and the deep-link effect runs the single load. Shallow + push = no full reload and
   *  Back/Forward steps between opened templates. The effect's handledQueryRef dedupes, so pushing
   *  a new ?id loads exactly once. */
  const openTemplate = (id: string) => {
    // Reopening the template you're already in: the URL key is unchanged, so the deep-link effect
    // would no-op (handledQueryRef dedupe) — reload it directly, KEEPING the current position (#87).
    // A different template routes through the URL and loads at its own spawn.
    if (id === currentTemplateId) { loadTemplate(id); return }
    router.push({ pathname: router.pathname, query: { id } }, undefined, { shallow: true })
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

  /** Spawn `count` enemies of `enemyType` on free cells spiralling out from (col,row).
   *  Only appends to the entities list — the combat module lazily seeds each new enemy's
   *  runtime the first frame it sees it (syncEnemyRuntime). Skips blocked / occupied /
   *  out-of-bounds cells so enemies never stack or land in a wall. */
  const spawnEnemiesNear = (col: number, row: number, enemyType: string, count: number) => {
    const grid = gridRef.current
    if (!grid) return
    const type = enemyType.trim() || 'enemy'
    const archetype = archetypeForEnemyType(type)
    const blocked = (c: number, r: number) => grid.isBlocked(c, r)
    setEntities(prev => {
      let next = prev
      let placed = 0
      for (let ring = 0; ring <= 6 && placed < count; ring++) {
        for (let dc = -ring; dc <= ring && placed < count; dc++) {
          for (let dr = -ring; dr <= ring && placed < count; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue // walk the ring perimeter only
            const c = col + dc, r = row + dr
            if (!canPlaceEntity(next, c, r, grid.cols, grid.rows, blocked)) continue
            next = placeEntity(next, { ...makeEnemy(mintEntityId('enemy'), c, r, type, { archetype }), hittable: true })
            placed++
          }
        }
      }
      return next
    })
  }

  /** Apply one resolved trigger effect (the loop calls this via applyTriggerEffectRef).
   *  `goto` reuses the SAME teleport path as connectors, so a trigger's goto == today's
   *  connector; the rest drive spawn / bag / message / win-lose overlays. */
  const applyTriggerEffect = (effect: TriggerEffect) => {
    if (effect.kind === 'goto') {
      if (teleportingRef.current || !effect.templateId) return
      teleportingRef.current = true
      loadTemplate(effect.templateId, { col: effect.spawnCol ?? 0, row: effect.spawnRow ?? 0 })
        .finally(() => { teleportingRef.current = false })
    } else if (effect.kind === 'spawn') {
      spawnEnemiesNear(effect.col, effect.row, effect.enemyType, effect.count)
    } else if (effect.kind === 'give') {
      setInventory(prev => addItem(prev, itemFromReward({ kind: 'item', amount: 1, itemId: effect.itemId }, mintItemId())))
      toast(`Received: ${effect.itemId || 'item'}`, 'success')
    } else if (effect.kind === 'message') {
      setTriggerMessage(effect.text || '…')
    } else if (effect.kind === 'win') {
      setEndState('win')
    } else if (effect.kind === 'lose') {
      setEndState('lose')
    }
  }

  // ── Inspector trigger authoring (cell + entity) ─────────────────────
  /** Replace the triggers on one cell — drops the group entirely when it goes empty. */
  const setTriggersForCell = (col: number, row: number, next: Trigger[]) => {
    setCellTriggers(prev => {
      const rest = prev.filter(g => !(g.col === col && g.row === row))
      return next.length > 0 ? [...rest, { col, row, triggers: next }] : rest
    })
  }
  /** Replace an entity's on-defeat triggers (undefined when empty, so it stays additive). */
  const setTriggersForEntity = (id: string, next: Trigger[]) => {
    setEntities(prev => prev.map(e => (e.id === id ? { ...e, triggers: next.length > 0 ? next : undefined } : e)))
  }
  /** Templates a `go to level` trigger can target (every saved map but this one). */
  const gotoTargets = savedTemplates.filter(t => t.id !== currentTemplateId).map(t => ({ id: t.id, name: t.name }))

  /** Restart after a win/lose overlay: clear the end-state, refill the player's HP, and
   *  reload the current map so enemies/spawn reset for a clean run. */
  const restartLevel = () => {
    setEndState(null)
    setTriggerMessage(null)
    prevDiedRef.current = new Set()
    playerCombatRef.current = { ...playerCombatRef.current, hp: playerStatsRef.current.maxHp }
    if (currentTemplateId) loadTemplate(currentTemplateId, undefined, { resetToSpawn: true }) // restart → back to spawn
  }

  // Keep the game loop's trigger callbacks pointed at the latest closure
  // (the loop is mounted once, so it must call through a ref).
  useEffect(() => {
    triggerConnectorRef.current = triggerConnector
    applyTriggerEffectRef.current = applyTriggerEffect
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
      setCellTriggers([])
      generateRandomMap()
      setTemplateName(`Template ${new Date().toLocaleDateString()}`)
    } else {
      // No id, not new → restore the user's LAST SAVED template (falls back to the gallery) and
      // reflect it in the URL with a REPLACE (no history entry). Pre-mark the resulting ?id key as
      // handled so that replace doesn't re-fire this effect into a second load.
      loadMostRecentTemplate().then(loadedId => {
        if (!loadedId) return
        handledQueryRef.current = `id:${loadedId}`
        router.replace({ pathname: router.pathname, query: { id: loadedId } }, undefined, { shallow: true })
      })
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
          onMouseLeave={() => { hoveredEntityIdRef.current = null; handleCanvasMouseUp() }}
          onContextMenu={handleContextMenu}
          style={{ cursor: isPanning ? 'grabbing' : topViewMode ? 'default' : 'grab' }}
        />

        {/* On-canvas quick-actions (stage C): a small floating toolbar over the SELECTED
            element with its hottest verbs. Each verb just opens + scrolls the matching
            Inspector section (deep edit stays in the panel); ✕ deselects. Hidden in play
            mode / overlays / when nothing is selected. Same selection precedence as the
            Inspector morph: unit → building → connector → cell. */}
        {showSidebars && !playMode && !showFlowView && !showGamesView && (() => {
          const selEntity = entities.find(e => e.id === selectedEntityId)
          const selBuilding = selectedBuildingIndex != null ? gridRef.current?.buildings[selectedBuildingIndex] : undefined

          let anchor: { col: number; row: number } | null = null
          let actions: QuickAction[] = []
          let onDeselect = () => {}

          if (selEntity) {
            anchor = { col: selEntity.col, row: selEntity.row }
            actions = [
              { key: 'animate', glyph: '✦', label: 'Animate', onClick: () => focusInspectorSection('animation') },
              { key: 'trigger', glyph: '⚡', label: 'Trigger', onClick: () => focusInspectorSection('trigger') },
              { key: 'style', glyph: '◰', label: 'Style', onClick: () => { focusInspectorSection('art'); setTileLibraryOpen(true) } },
            ]
            // ✕ is a clean full deselect — also drop any cell selection that lingered from
            // the click that selected this unit, so the toolbar truly hides (not a cell fallback).
            onDeselect = () => { setWaypointMode(false); setSelectedEntityId(null); setSelectedCells(new Set()) }
          } else if (selBuilding) {
            anchor = buildingFootprintCells(selBuilding).door
            actions = [
              { key: 'animate', glyph: '✦', label: 'Animate', onClick: () => focusInspectorSection('animation') },
              { key: 'style', glyph: '◰', label: 'Style', onClick: () => { focusInspectorSection('art'); setTileLibraryOpen(true) } },
            ]
            onDeselect = deselectBuilding
          } else if (editingConnector) {
            anchor = { col: editingConnector.col, row: editingConnector.row }
            actions = [
              { key: 'connect', glyph: '↗', label: 'Connect', onClick: () => focusInspectorSection('connect') },
              { key: 'when', glyph: '⚡', label: 'Trigger', onClick: () => focusInspectorSection('when') },
            ]
            onDeselect = () => { setEditingConnector(null); setSelectedCells(new Set()) }
          } else if (selectedCells.size > 0) {
            const [c, r] = Array.from(selectedCells)[0].split(',').map(Number)
            anchor = { col: c, row: r }
            actions = [
              { key: 'style', glyph: '◰', label: 'Style', onClick: () => { focusInspectorSection('tile'); setTileLibraryOpen(true) } },
              { key: 'animate', glyph: '✦', label: 'Animate', onClick: () => focusInspectorSection('animation') },
              { key: 'trigger', glyph: '⚡', label: 'Trigger', onClick: () => focusInspectorSection('trigger') },
            ]
            onDeselect = () => setSelectedCells(new Set())
          }

          if (!anchor) return null
          const cell = anchor
          return (
            <QuickActionToolbar
              key={`qa-${selectedEntityId ?? ''}-${selectedBuildingIndex ?? ''}-${editingConnector ? `${editingConnector.col},${editingConnector.row}` : ''}-${selectedCells.size}`}
              actions={actions}
              onDeselect={onDeselect}
              getPos={() => cellToScreen(cell.col, cell.row)}
            />
          )
        })()}

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

        {/* Trigger message popup — a small dismissible text box (show message action). */}
        {triggerMessage !== null && (
          <div className="fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-white/15 bg-black/90 px-4 py-3 font-mono shadow-lg shadow-black/50">
            <div className="flex items-start gap-3">
              <p className="max-w-xs text-sm text-gray-100">{triggerMessage}</p>
              <button
                onClick={() => setTriggerMessage(null)}
                aria-label="Dismiss message"
                className="rounded bg-gray-700 px-1.5 py-0.5 text-xs font-bold text-gray-200 hover:bg-gray-600"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Win / Lose end-state overlay — fired by a win/lose trigger. */}
        {endState !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 font-mono">
            <div className="flex flex-col items-center gap-4 rounded-xl border border-white/10 bg-black/80 px-10 py-8 shadow-2xl shadow-black/60">
              <p className={`text-4xl font-black tracking-widest ${endState === 'win' ? 'text-emerald-300' : 'text-red-400'}`}>
                {endState === 'win' ? 'YOU WIN' : 'YOU LOSE'}
              </p>
              <p className="text-xs text-gray-400">{endState === 'win' ? 'the map is cleared' : 'better luck next run'}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={restartLevel} className="rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600">↻ Restart</button>
                <button onClick={() => { setEndState(null); exitPlayMode() }} className="rounded bg-gray-700 px-4 py-2 text-sm font-bold text-white hover:bg-gray-600">⨯ Exit</button>
              </div>
            </div>
          </div>
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
              openTemplate(id) // through the URL so the address bar updates + Back/Forward works
            }}
          />
        )}

        {/* GAMES view — list playable flows + the game editor; ▶ plays from a level. */}
        {showGamesView && (
          <GamesViewOverlay
            savedTemplates={savedTemplates}
            onPlayLevel={playGameLevel}
            onClose={() => setShowGamesView(false)}
          />
        )}

        {/* TOP BAR — brand · view toggle · ⚡ Generate · 🎨 Style · ▶ Play · 💾 Save · Load · ⋯ More */}
        {showSidebars && !showGamesView && !playMode && (
        <nav className="fixed left-4 right-4 top-4 z-20 flex items-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-black/90 px-3 py-2 font-mono text-sm text-white shadow-lg shadow-black/40">
          <span className="shrink-0 select-none text-sm font-bold tracking-widest text-yellow-400">NEBULITH</span>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          {/* view toggle */}
          <div className="flex shrink-0 gap-1">
            <ViewButton label="↖ ISO" active={activeView === 'iso'} activeClass="bg-yellow-600" onClick={selectIsoView} />
            <ViewButton label="2D" active={activeView === '2d'} activeClass="bg-blue-600" onClick={select2DView} />
            <ViewButton label="Top" active={activeView === 'top'} activeClass="bg-blue-600" onClick={selectTopView} />
            <ViewButton label="Flow" active={activeView === 'flow'} activeClass="bg-purple-600" onClick={toggleFlowView} />
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          {/* ⚡ Generate — the stage-preset zone/variant controls as a dropdown */}
          <Dropdown
            label={<>⚡ Generate</>}
            title="Generate a randomized stage"
            btnClass="bg-purple-700 hover:bg-purple-600"
            panelClass="w-72"
          >
            {close => (
              <GenerateControls
                zone={genZone}
                onZone={setGenZone}
                onGenerate={(z, v) => { generateStageInEditor(z, v); close() }}
              />
            )}
          </Dropdown>
          {/* 🎨 Style — the global art-skin switch: pick a style → the whole world reskins */}
          <Dropdown label={<>🎨 Style: {activeStyle.name}</>} title="Art style" panelClass="w-56">
            {close => <StylePicker activeId={activeStyleId} onPick={setActiveStyleId} onClose={close} />}
          </Dropdown>
          <div className="flex-1" />
          {/* ▶ Play — enter the clean play view */}
          <button
            onClick={enterPlayMode}
            aria-label="Execute game"
            title="Play the game"
            className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow hover:bg-emerald-500"
          >
            ▶ Play
          </button>
          {/* 💾 Save — name + save/update */}
          <input
            type="text"
            value={templateName}
            onChange={e => setTemplateName(e.target.value)}
            placeholder="Template name…"
            aria-label="Template name"
            className="w-32 shrink-0 rounded bg-gray-800 px-2 py-1 text-xs"
          />
          <button
            onClick={saveCurrentTemplate}
            disabled={isSaving || !templateName.trim()}
            aria-label="Save template"
            className="shrink-0 rounded bg-green-700 px-3 py-1 text-xs font-bold hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500"
          >
            {isSaving ? '…' : `💾 ${currentTemplateId ? 'Update' : 'Save'}`}
          </button>
          {/* Load — measured fixed popover (escapes the nav's overflow clipping) */}
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
              <div
                style={{ position: 'fixed', top: loadMenuPos.top, left: loadMenuPos.left }}
                className="z-40 max-h-72 w-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl"
              >
                {savedTemplates.length === 0 && <p className="text-[10px] text-gray-500">No saved templates.</p>}
                {savedTemplates.map(t => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-1 rounded p-1 text-xs ${currentTemplateId === t.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'}`}
                  >
                    <button onClick={() => { openTemplate(t.id); setShowTemplateList(false) }} className="flex-1 truncate text-left" disabled={isLoading}>{t.name}</button>
                    <button onClick={() => handleDeleteTemplate(t.id)} aria-label={`Delete ${t.name}`} className="px-1 text-red-400 hover:text-red-300">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* ⋯ More — the remaining entry points kept reachable in an overflow menu */}
          <Dropdown label={<>⋯ More</>} align="right" panelClass="w-52">
            {close => (
              <div className="space-y-1 text-xs">
                <button onClick={() => { openGamesView(); close() }} className="block w-full rounded bg-indigo-700 px-2 py-1.5 text-left font-bold hover:bg-indigo-600">Games</button>
                <button onClick={() => { exportLayers(); close() }} className="block w-full rounded bg-orange-700 px-2 py-1.5 text-left font-bold hover:bg-orange-600">Export</button>
                <Link href="/personal-projects/game-engine" onClick={close} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">← Templates</Link>
                <Link href="/personal-projects/game-engine/templates?new=1" onClick={close} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">＋ New template</Link>
                <Link href="/" onClick={close} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">CV / Portfolio</Link>
              </div>
            )}
          </Dropdown>
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

        {/* LEFT — tool-rail: the editor modes (Select / Paint / Unit / Building / Connector) */}
        {showSidebars && !showGamesView && !playMode && (
          <ToolRail mode={editorMode} onPick={selectMode} />
        )}

        {/* LEFT MODE PANEL — the active mode's tools, docked next to the rail */}
        {showSidebars && !showGamesView && !playMode && (
          <aside
            className={`fixed z-10 flex flex-col gap-3 overflow-y-auto pr-1 font-mono text-white ${
              isMobile
                ? 'left-20 right-4 top-[4.75rem] max-h-[40vh]'
                : 'left-[4.75rem] top-20 bottom-4 w-72'
            }`}
            aria-label="Tool panel"
          >
            {editorMode === 'select' && (
              <Card title="Select" accent="yellow">
                <p className="text-[11px] leading-tight text-gray-400">
                  Click an element on the canvas to select it — its settings appear in the Inspector on the right.
                </p>
                <p className="mt-2 text-[10px] leading-tight text-gray-500">
                  Pick a tool on the left rail to paint tiles, place units or buildings, or draw connectors. Stage settings (Generate, grid, day/night) live in the Inspector.
                </p>
              </Card>
            )}

            {editorMode === 'paint' && (
              <Card title="Paint — tiles & ground" accent="cyan">
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

                {/* Bulk clear the current selection back to grass */}
                <button
                  onClick={clearSelectedCells}
                  disabled={selectedCells.size === 0}
                  className="mb-2 w-full rounded bg-red-800 px-2 py-1.5 text-xs font-bold transition-colors enabled:hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-800/60 disabled:text-gray-600"
                  title="Reset the selected cells to grass and remove assets/height"
                >
                  ⌫ Clear selected cells ({selectedCells.size})
                </button>

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
            )}

            {editorMode === 'unit' && (
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
            )}

            {editorMode === 'building' && (
              <Card title="Buildings" accent="orange">
                <p className="mb-2 text-[10px] text-gray-500">
                  Select a building to move (arrow keys), rotate (R), or delete. Place a new one with a type tool.
                </p>
                <div className="grid grid-cols-6 gap-1">
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
                    label="Temple"
                    glyph="🏛"
                    active={buildingTool === 'place-temple'}
                    activeClass="bg-amber-600 text-black"
                    onClick={() => toggleBuildingTool('place-temple')}
                  />
                  <EntityToolButton
                    label="Manor"
                    glyph="⌂"
                    active={buildingTool === 'place-big-house'}
                    activeClass="bg-amber-800"
                    onClick={() => toggleBuildingTool('place-big-house')}
                  />
                  <EntityToolButton
                    label="Cathedral"
                    glyph="⛪"
                    active={buildingTool === 'place-cathedral'}
                    activeClass="bg-purple-700"
                    onClick={() => toggleBuildingTool('place-cathedral')}
                  />
                  <EntityToolButton
                    label="Castle"
                    glyph="🏰"
                    active={buildingTool === 'place-castle'}
                    activeClass="bg-stone-600"
                    onClick={() => toggleBuildingTool('place-castle')}
                  />
                  <EntityToolButton
                    label="Delete"
                    glyph="✕"
                    active={buildingTool === 'delete'}
                    activeClass="bg-red-700"
                    onClick={() => toggleBuildingTool('delete')}
                  />
                </div>

                {/* A selected building's settings (rotate / delete / door side) now live in the
                    right Inspector — the left panel keeps only the place/select/delete tools. */}
                <p className="mt-3 border-t border-white/10 pt-2 text-[10px] leading-tight text-gray-500">
                  {selectedBuildingIndex != null
                    ? 'Selected — its settings are in the Inspector on the right.'
                    : buildingTool === 'select' ? 'Click a building to select it — its settings open in the Inspector.' : 'No building selected.'}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-gray-400">
                  <span>{gridRef.current?.buildings.length ?? 0} buildings</span>
                </div>
              </Card>
            )}

            {editorMode === 'connector' && (
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

                {/* The connector FORM (target / when / spawn cell) now lives in the right
                    Inspector — click a cell (or a saved connector below) to open it there. */}
                {editingConnector && (
                  <p className="mb-2 rounded bg-gray-800 p-2 text-[10px] leading-tight text-yellow-400">
                    {selectedCells.size > 1 ? `${selectedCells.size} cells selected` : `(${editingConnector.col}, ${editingConnector.row})`} — edit its target, when &amp; spawn cell in the Inspector on the right.
                  </p>
                )}

                {connectors.length > 0 && (
                  <div className="max-h-32 space-y-1 overflow-y-auto">
                    {connectors.map((c, i) => (
                      <button
                        key={`${c.cells[0]?.col},${c.cells[0]?.row},${i}`}
                        type="button"
                        className="flex w-full items-center justify-between rounded bg-gray-800 p-1 text-left text-xs hover:bg-gray-700"
                        onClick={() => {
                          setSelectedEntityId(null)
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
            )}
          </aside>
        )}

        {/* RIGHT — Inspector: stage settings when nothing is selected, else the selection */}
        {showSidebars && !showGamesView && !playMode && (
          <aside
            className={`fixed right-4 z-10 flex flex-col gap-3 overflow-y-auto pl-1 font-mono text-white ${
              isMobile
                ? 'bottom-4 left-4 max-h-[40vh]'
                : 'top-20 bottom-4 w-72'
            }`}
            aria-label="Inspector"
          >
            <div className="rounded-lg border border-white/10 bg-black/60 p-3 shadow-lg shadow-black/40">
              <h2 className="text-sm font-bold uppercase tracking-widest text-yellow-400">Inspector</h2>
              <p className="text-[10px] text-gray-500">{templateName || 'New Template'}</p>
            </div>

            {(() => {
              // Stage B — the Inspector MORPHS to the current selection. Precedence:
              // unit → building → connector → cell → nothing. Each branch renders the SAME
              // edit bodies/handlers the old modals/left-cards used, now inline + collapsible.
              // Nothing selected falls through to the stage settings below.
              const selEntity = entities.find(e => e.id === selectedEntityId)
              const selBuilding = selectedBuildingIndex != null ? gridRef.current?.buildings[selectedBuildingIndex] : undefined

              // ── UNIT (player / enemy / npc) ───────────────────────
              if (selEntity) {
                const isPlayer = selEntity.kind === 'player'
                const isEnemy = selEntity.kind === 'enemy'
                const isNpc = selEntity.kind === 'npc'
                // The player's held EMOJI weapon is pose-driven — tunable right here so the sword/bow etc.
                // orientation is fixed live in-hand (poses are emoji-only, so gate on a non-ASCII style).
                // Read the ACTUALLY-held weapon (playerWeaponRef — the same source the render draws in-hand;
                // it prefers the loadout's weapon over inventory.equippedWeapon), so selecting the hero always
                // surfaces the pose card for whatever weapon is really equipped. Bare hands → no card.
                const heldWeapon = playerWeaponRef.current
                const heldWeaponKind = isPlayer && activeStyleId !== 'ascii' && heldWeapon && heldWeapon.kind !== 'unarmed' ? heldWeapon.kind : undefined
                // The entity's OWN resolved figure (gendered) — the animation editor previews an empty
                // "base" frame AS this, and gendered char frames, so the preview matches what renders.
                const selFigVisual = resolveVisual(entityKind(selEntity.kind), activeStyle, selEntity.tileOverride)
                const selFigure = genderize(selFigVisual.kind === 'glyph' ? selFigVisual.char : (isEnemy ? '👾' : '🧍'), selEntity.variant)
                const libBtn = 'w-full rounded bg-gray-700 px-2 py-1.5 text-left text-xs font-bold transition-colors hover:bg-gray-600'
                return (
                  <>
                    <SelectionHeader kind={selEntity.kind} label={`${selEntity.name || selEntity.kind} (${selEntity.kind})`} coords={`@ ${selEntity.col},${selEntity.row}`} />
                    <Card title="Identity & stats" accent="orange">
                      <EntityIdentityStatsBody entity={selEntity} onPatch={patchSelectedEntity} />
                      {isPlayer && <div className="mt-3"><CombatHud hud={playerHud} /></div>}
                    </Card>
                    <Card title="Art / sprite" accent="cyan" sectionId="art" focus={sectionFocus}>
                      <ArtSection override={selEntity.tileOverride} styleName={activeStyle.name} onOpen={() => setTileLibraryOpen(true)} />
                      {heldWeaponKind && EMOJI_TILESET[heldWeaponKind] && (
                        <div className="mt-2">
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                            🗡️ Held weapon — {heldWeaponKind} <span className="font-normal text-gray-500">(drag to retune it live in-hand)</span>
                          </p>
                          <PoseControls
                            kind={heldWeaponKind}
                            pose={EMOJI_TILESET[heldWeaponKind]?.pose}
                            isWeapon={WEAPON_KINDS.has(heldWeaponKind)}
                            onChange={p => writeTilePose(heldWeaponKind, p)}
                            onReset={() => writeTilePose(heldWeaponKind, undefined)}
                          />
                          <button onClick={saveEmojiPoses} disabled={savingPoses} className="mt-1.5 w-full rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-40">
                            {savingPoses ? 'Saving…' : '⭳ Save poses to backend'}
                          </button>
                        </div>
                      )}
                      {isPlayer && activeStyleId === 'ascii' && playerWeaponRef.current?.kind && playerWeaponRef.current.kind !== 'unarmed' && (
                        <p className="mt-2 text-[10px] text-gray-500">Weapon pose tuning lives in the Emoji style — ASCII weapons draw their own glyph and aren&apos;t pose-driven yet.</p>
                      )}
                    </Card>
                    <Card title="Animation" accent="cyan" defaultOpen={false} sectionId="animation" focus={sectionFocus}>
                      <div className="mb-3 flex items-center gap-2 text-[11px]">
                        <span className="text-gray-400">Figure</span>
                        {(['', 'male', 'female', 'old', 'child', 'alien', 'robot'] as const).map(v => (
                          <button
                            key={v || 'neutral'}
                            type="button"
                            onClick={() => patchSelectedEntity({ variant: (v || undefined) as EntityVariant | undefined })}
                            className={`rounded px-2 py-0.5 font-bold transition-colors ${
                              (selEntity.variant ?? '') === v ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                          >
                            {v || 'neutral'}
                          </button>
                        ))}
                      </div>
                      <div className="mb-3 flex items-center gap-2 text-[11px]">
                        <span className="text-gray-400">Size</span>
                        {[1, 2, 3].map(sz => (
                          <button
                            key={sz}
                            type="button"
                            onClick={() => setSelectedEntitySize(sz)}
                            title={sz > 1 ? `${sz}× — a boss: bigger figure + ~${sz}× stats` : 'normal size'}
                            className={`rounded px-2 py-0.5 font-bold transition-colors ${
                              (selEntity.size ?? 1) === sz ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                          >
                            {sz}×
                          </button>
                        ))}
                      </div>
                      <AnimationEditor
                        animations={selEntity.animations ?? []}
                        category="units"
                        styleId={activeStyleId}
                        baseGlyph={selFigure}
                        variant={selEntity.variant}
                        onChange={next => patchSelectedEntity({ animations: next })}
                      />
                    </Card>
                    {isEnemy && (
                      <Card title="Attacks / abilities" accent="orange" defaultOpen={false}>
                        <EntityAttackBody entity={selEntity} onPatch={patchSelectedEntity} />
                      </Card>
                    )}
                    {(isEnemy || isNpc) && (
                      <Card title="Movement pattern" accent="cyan" defaultOpen={false}>
                        <EntityMovementBody
                          entity={selEntity}
                          onPatch={patchSelectedEntity}
                          waypointMode={waypointMode}
                          onToggleWaypointMode={() => setWaypointMode(v => !v)}
                        />
                      </Card>
                    )}
                    {(isPlayer || isNpc) && (
                      <Card title="Library" accent="purple" defaultOpen={false}>
                        {isPlayer && <button className={libBtn} onClick={() => setEntityModal('inventory')}>🎒 Inventory &amp; abilities…</button>}
                        {isNpc && <button className={libBtn} onClick={() => setEntityModal('quests')}>❒ Quests…</button>}
                      </Card>
                    )}
                    <Card title="Trigger" accent="yellow" defaultOpen={false} sectionId="trigger" focus={sectionFocus}>
                      <TriggerEditor
                        triggers={selEntity.triggers ?? []}
                        events={['defeat']}
                        templates={gotoTargets}
                        enemyTypes={ENEMY_TYPES}
                        onChange={next => setTriggersForEntity(selEntity.id, next)}
                      />
                    </Card>
                    <div className="flex gap-1">
                      <button onClick={deleteSelectedEntity} className="flex-1 rounded bg-red-800 px-2 py-1.5 text-xs font-bold hover:bg-red-700">Delete</button>
                      <button onClick={() => { setWaypointMode(false); setSelectedEntityId(null) }} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Deselect</button>
                    </div>
                  </>
                )
              }

              // ── BUILDING ──────────────────────────────────────────
              if (selBuilding) {
                const facing = gridBuildingFacing(selBuilding)
                const door = buildingFootprintCells(selBuilding).door
                return (
                  <div key={`bld-insp-${selectedBuildingIndex}-${buildingVersion}`} className="flex flex-col gap-3">
                    <SelectionHeader kind="building" label={`${selBuilding.type} (building)`} coords={`facing ${facing}`} />
                    <Card title="Type & door side" accent="orange">
                      <div className="space-y-2 text-xs">
                        <p className="text-[10px] text-gray-400">
                          footprint {selBuilding.length}×{selBuilding.height} · facade {facadeLength(selBuilding)} · depth {selBuilding.depth} · door @ {door.col},{door.row}
                        </p>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-gray-400">Length</span>
                          <button onClick={() => resizeSelectedBuilding(-1)} disabled={facadeLength(selBuilding) <= 3} className="rounded bg-orange-700 px-2 py-1 text-xs font-bold enabled:hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-800/60 disabled:text-gray-600" title="Make the house shorter (min 3 cells)">−</button>
                          <span className="w-14 text-center text-xs font-bold tabular-nums">{facadeLength(selBuilding)} cells</span>
                          <button onClick={() => resizeSelectedBuilding(1)} disabled={facadeLength(selBuilding) >= 8} className="rounded bg-orange-700 px-2 py-1 text-xs font-bold enabled:hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-800/60 disabled:text-gray-600" title="Make the house longer (max 8 cells) — iso re-extrudes it">＋</button>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={rotateSelectedBuilding} className="flex-1 rounded bg-orange-700 px-2 py-1 text-xs font-bold hover:bg-orange-600" title="Rotate the door side south→east→north→west (R)">⟳ Rotate door</button>
                          <button onClick={deleteSelectedBuilding} className="flex-1 rounded bg-red-800 px-2 py-1 text-xs font-bold hover:bg-red-700" title="Delete this building (Del)">Delete</button>
                          <button onClick={deselectBuilding} className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600">Deselect</button>
                        </div>
                        <p className="text-[10px] text-gray-500">Arrow keys nudge it a cell · R rotates · −/＋ resize · Del removes.</p>
                      </div>
                    </Card>
                    <Card title="Art (walls / roof)" accent="cyan" defaultOpen={false} sectionId="art" focus={sectionFocus}>
                      <p className="text-[10px] leading-tight text-gray-500">
                        Walls, roof, doors &amp; windows follow the global <span className="font-bold text-cyan-300">{activeStyle.name}</span> style
                        (switch it in the top bar 🎨). Per-building tile overrides land in a later update.
                      </p>
                    </Card>
                    <Card title="Animation" accent="cyan" defaultOpen={false} sectionId="animation" focus={sectionFocus}>
                      <p className="text-[10px] leading-tight text-gray-500">
                        Building animation presets ride in with the art system — coming in a later update.
                      </p>
                    </Card>
                  </div>
                )
              }

              // ── CONNECTOR (migrated from the left panel form) ─────
              if (editingConnector) {
                const coordLabel = selectedCells.size > 1 ? `${selectedCells.size} cells` : `(${editingConnector.col}, ${editingConnector.row})`
                const actionType = connectorForm.action?.type ?? 'teleport'
                return (
                  <>
                    <SelectionHeader kind="connector" label="connector" coords={coordLabel} />
                    <Card title="Target level" accent="purple" sectionId="connect" focus={sectionFocus}>
                      <div className="space-y-1 text-xs">
                        <select
                          value={actionType}
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
                          className="w-full rounded bg-gray-800 p-1 text-xs"
                        >
                          <option value="teleport">Go to template (teleport)</option>
                          <option value="goto_region">Move within stage (uses Arrive-at)</option>
                          <option value="collect">Collect item</option>
                          <option value="content">Reveal content</option>
                        </select>
                        {connectorForm.action?.type === 'collect' && (
                          <input
                            type="text"
                            placeholder="Item id to grant"
                            aria-label="Item id to collect"
                            value={connectorForm.action.itemId}
                            onChange={e => setConnectorForm(f => ({ ...f, action: { type: 'collect', itemId: e.target.value, qty: 1 } }))}
                            className="w-full rounded bg-gray-800 p-1 text-xs"
                          />
                        )}
                        {connectorForm.action?.type === 'content' && (
                          <input
                            type="text"
                            placeholder="Section id to reveal"
                            aria-label="Section id to reveal"
                            value={connectorForm.action.sectionId}
                            onChange={e => setConnectorForm(f => ({ ...f, action: { type: 'content', sectionId: e.target.value } }))}
                            className="w-full rounded bg-gray-800 p-1 text-xs"
                          />
                        )}
                        {actionType === 'teleport' && (
                          <select
                            value={connectorForm.targetTemplateId || ''}
                            onChange={e => setConnectorForm(f => ({ ...f, targetTemplateId: e.target.value }))}
                            aria-label="Target template"
                            className="w-full rounded bg-gray-800 p-1 text-xs"
                          >
                            <option value="">Target template…</option>
                            {savedTemplates.filter(t => t.id !== currentTemplateId).map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </Card>
                    <Card title="When" accent="purple" sectionId="when" focus={sectionFocus}>
                      <select
                        value={connectorForm.interaction || 'walk'}
                        onChange={e => setConnectorForm(f => ({ ...f, interaction: e.target.value as Connector['interaction'] }))}
                        aria-label="How the player triggers this connector"
                        className="w-full rounded bg-gray-800 p-1 text-xs"
                      >
                        <option value="walk">Walk onto it</option>
                        <option value="interact">Press E on it</option>
                        <option value="auto">Auto on enter</option>
                      </select>
                    </Card>
                    <Card title="Spawn cell" accent="purple">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="whitespace-nowrap text-gray-400">Arrive at</span>
                        <input
                          type="number"
                          min={0}
                          aria-label="Spawn column in target template"
                          value={connectorForm.spawnCol ?? 0}
                          onChange={e => setConnectorForm(f => ({ ...f, spawnCol: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                          className="w-14 rounded bg-gray-800 p-1 text-xs"
                        />
                        <span className="text-gray-500">,</span>
                        <input
                          type="number"
                          min={0}
                          aria-label="Spawn row in target template"
                          value={connectorForm.spawnRow ?? 0}
                          onChange={e => setConnectorForm(f => ({ ...f, spawnRow: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                          className="w-14 rounded bg-gray-800 p-1 text-xs"
                        />
                        <span className="whitespace-nowrap text-gray-400">in target</span>
                      </div>
                    </Card>
                    <div className="flex gap-1">
                      <button onClick={saveConnector} disabled={!connectorForm.targetTemplateId && !connectorForm.action} className="flex-1 rounded bg-green-700 px-2 py-1.5 text-xs font-bold hover:bg-green-600 disabled:bg-gray-700">Save</button>
                      <button onClick={() => deleteConnector(editingConnector.col, editingConnector.row)} className="rounded bg-red-800 px-2 py-1.5 text-xs hover:bg-red-700">Del</button>
                      <button onClick={() => setEditingConnector(null)} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Cancel</button>
                    </div>
                  </>
                )
              }

              // ── CELL(S) ───────────────────────────────────────────
              if (selectedCells.size > 0) {
                const first = Array.from(selectedCells)[0].split(',')
                const cellLabel = selectedCells.size > 1 ? `${selectedCells.size} cells` : `(${first[0]}, ${first[1]})`
                const animReady = authorFrames.length >= 2
                // Cell triggers attach to the FIRST selected cell (the one the label shows).
                const trigCol = parseInt(first[0], 10)
                const trigRow = parseInt(first[1], 10)
                // The tile KIND under this cell (an asset pinned there wins, else the ground kind) — its
                // POSE is what the editor retunes. Only kinds present in the emoji tileset are tunable.
                const poseGrid = gridRef.current
                const cellAsset = poseGrid?.getAssetsAtCell(trigCol, trigRow)[0]
                const poseKind = cellAsset ? assetKind(cellAsset) : groundKind(poseGrid?.ground[trigRow]?.[trigCol] ?? 'grass')
                return (
                  <>
                    <SelectionHeader kind="cell" label="cell" coords={cellLabel} />
                    <Card title="Tile / ground" accent="cyan" sectionId="tile" focus={sectionFocus}>
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
                      <PaletteGroup label="Nature" color="text-green-400">
                        {NATURE_TILE_KEYS.map(key => (
                          <AssetTileSwatch key={key} tileKey={key} selectedTile={selectedTile} onPlace={placeTile} />
                        ))}
                      </PaletteGroup>
                      <p className="mt-1 text-[10px] leading-tight text-gray-500">Pick a tile to paint the selected cell(s).</p>
                    </Card>
                    <Card title="Art / style override" accent="cyan" sectionId="art" focus={sectionFocus}>
                      <ArtSection override={selectedOverride} styleName={activeStyle.name} onOpen={() => setTileLibraryOpen(true)} />
                      {poseKind && EMOJI_TILESET[poseKind] && (
                        <div className="mt-2">
                          <PoseControls
                            kind={poseKind}
                            pose={EMOJI_TILESET[poseKind]?.pose}
                            isWeapon={WEAPON_KINDS.has(poseKind)}
                            onChange={p => writeTilePose(poseKind, p)}
                            onReset={() => writeTilePose(poseKind, undefined)}
                          />
                          <button onClick={saveEmojiPoses} disabled={savingPoses} className="mt-1.5 w-full rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-40">
                            {savingPoses ? 'Saving…' : '⭳ Save poses to backend'}
                          </button>
                        </div>
                      )}
                    </Card>
                    <Card title="Height" accent="cyan">
                      <div className="flex items-center gap-2">
                        <button onClick={() => placeHeight(Math.max(0, selectedHeight - 1))} className="h-6 w-6 rounded bg-gray-700 text-xs font-bold hover:bg-gray-600" aria-label="Lower height">−</button>
                        <div className="flex gap-0.5">
                          {[0, 1, 2, 3, 4, 5].map(h => (
                            <button key={h} onClick={() => placeHeight(h)} className={`h-6 w-6 rounded text-xs font-bold ${selectedHeight === h && heightEditMode ? 'bg-cyan-500 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}>{h}</button>
                          ))}
                        </div>
                        <button onClick={() => placeHeight(Math.min(9, selectedHeight + 1))} className="h-6 w-6 rounded bg-gray-700 text-xs font-bold hover:bg-gray-600" aria-label="Raise height">+</button>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight text-gray-500">Set the terrain height of the selected cell(s).</p>
                    </Card>
                    <Card title="Animation" accent="purple" defaultOpen={false} sectionId="animation" focus={sectionFocus}>
                      <p className="mb-2 text-[10px] leading-tight text-gray-500">One-click a preset, then Apply it to an asset in the selected cell(s). The full frame builder lives in the Paint tool.</p>
                      <div className="mb-2 flex flex-wrap gap-1">
                        {CELL_ANIM_PRESETS.map(p => (
                          <button key={p.id} onClick={() => loadAuthorPreset(p)} className="rounded bg-gray-800 px-2 py-1 text-[10px] text-gray-200 transition-colors hover:bg-fuchsia-800 hover:text-white">{p.name}</button>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => attachAuthorAnim(false)} disabled={!animReady} className="flex-1 rounded bg-gray-700 py-1 text-[10px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-40">Preview</button>
                        <button onClick={() => attachAuthorAnim(true)} disabled={!animReady} className="flex-1 rounded bg-fuchsia-700 py-1 text-[10px] font-bold text-white transition-all hover:opacity-80 disabled:opacity-40">Apply</button>
                      </div>
                      {authorStatus && <p className="mt-1 text-[9px] text-amber-300">{authorStatus}</p>}
                    </Card>
                    <Card title="Trigger" accent="yellow" defaultOpen={false} sectionId="trigger" focus={sectionFocus}>
                      <TriggerEditor
                        triggers={triggersAtCell(cellTriggers, trigCol, trigRow)}
                        events={['enter', 'interact']}
                        templates={gotoTargets}
                        enemyTypes={ENEMY_TYPES}
                        onChange={next => setTriggersForCell(trigCol, trigRow, next)}
                      />
                    </Card>
                    <button onClick={() => setSelectedCells(new Set())} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Clear selection</button>
                  </>
                )
              }

              return (
                <>
                  <Card title="Style" accent="cyan">
                    <StylePicker activeId={activeStyleId} onPick={setActiveStyleId} />
                  </Card>

                  <Card title="Stage" accent="yellow">
                    <div className="mb-3">
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

                    <button
                      onClick={() => setDayNight(d => (d === 'day' ? 'night' : 'day'))}
                      aria-pressed={dayNight === 'night'}
                      className={`mt-1 w-full rounded px-2 py-1 text-xs font-bold transition-colors ${
                        dayNight === 'night' ? 'bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      Night mode {dayNight === 'night' ? 'on' : 'off'}
                    </button>
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
                      onClick={toggleCollisions}
                      aria-pressed={showCollisions}
                      className={`mt-2 w-full rounded px-2 py-1 text-xs font-bold transition-colors ${
                        showCollisions ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      Show collisions {showCollisions ? 'on' : 'off'}
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
                    <p className="mt-2 text-[10px] text-gray-500">WASD / arrows move · Space jumps · E interacts</p>
                  </Card>
                </>
              )
            })()}
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
          const selEntity = selectedEntityId ? entities.find(e => e.id === selectedEntityId) : undefined
          // The player ENTITY and the '__player__' loadout are the SAME character: when the player is
          // selected, resolve to '__player__' so the panel shows the REAL equipped gear (matching the
          // footer + the render), not a separate empty per-entity loadout. Other entities key on their id.
          const activeId = selEntity?.kind === 'player' ? '__player__' : (selectedEntityId ?? '__player__')
          const current = loadouts[activeId] ?? (activeId === '__player__' ? seededPlayerLoadout() : createLoadout())
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

        {/* ◰ TILE LIBRARY (stage D) — lists the active style's tiles by category; picking one pins
            it to the selected element (a per-element override). Reachable from the Inspector ◰ Art
            section AND the on-canvas ◰ Style quick-action. */}
        {tileLibraryOpen && (() => {
          const close = () => setTileLibraryOpen(false)
          const scope = selectedEntityId
            ? 'unit'
            : selectedCells.size > 0
            ? (selectedCells.size > 1 ? `${selectedCells.size} cells` : 'cell')
            : null
          return (
            <Modal title={`Tile Library — ${activeStyle.name}${scope ? ` · ${scope}` : ''}`} accent="cyan" wide onClose={close}>
              {scope ? (
                <TileLibraryBody
                  styleId={activeStyleId}
                  styleName={activeStyle.name}
                  override={selectedOverride}
                  onPick={setSelectionOverride}
                />
              ) : (
                <p className="text-xs leading-relaxed text-gray-400">
                  Select a unit or a cell first (↖ Select tool), then reopen the Library to pin a tile to it.
                  The global style switch lives in the top bar 🎨.
                </p>
              )}
            </Modal>
          )
        })()}

        {/* LIBRARY modals — the per-element SETTINGS moved inline into the Inspector;
            these two stay modal (the player equipment/abilities + the NPC quest authoring). */}
        {entityModal && (() => {
          const selected = entities.find(e => e.id === selectedEntityId)
          if (!selected) return null
          const who = selected.name || selected.kind
          const close = () => setEntityModal(null)
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


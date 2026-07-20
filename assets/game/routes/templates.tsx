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
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { type GridAsset, IsometricGrid } from '@/engine/IsometricGrid'
import { getStack, type TileEntry, type TileSource } from '@/engine/cellStack'
import { type AttackAnim, isAnimDone } from '@/engine/attackAnimations'
import { type BuildingType } from '@/engine/buildingTypes'
import { BUILDING_PLACE_LENGTH, buildingCompositionKind, buildingFootprint, canPlaceBuildingComposition, isRoadGround, nearestRoadFacing, planComposition } from '@/engine/buildingCatalog'
import { buildCompositionPalette, type CompositionPaletteGroup } from '@/engine/compositionCatalog'
import { findTriggeredConnector, normalizeConnector } from '@/engine/connectors'
import { entityPalette, punchTile, weaponEmoji, weaponGlyph, weaponPose } from '@/engine/entityArt'
import { StageData, VariantId, type LayerId, generateStage, stagePaint } from '@/engine/stageGenerator'
import { type Action as TriggerAction, resolveAction } from '@/engine/triggers'
import { stagePropTileOverride, ZoneId, ROCK_SHADES, MUSHROOM_TONES, ZONE_FLOWERS, DEFAULT_FLOWERS } from '@/engine/zones'
import { varyIntensity } from '@/engine/colors'
import { type AbilityBinding, DEFAULT_ABILITY_LOADOUT } from '@/game/abilities'
import { startingCombatState } from '@/game/combat'
import { DEFAULT_PLAYER_STATS, byKind, canPlaceEntity, entityAt, entityAtClick, entityAtFootprint, entityCollisionCells, makeEnemy, makeNpc, makePlayer, mintEntityId, placeEntity, removeEntity, withPlayerCell } from '@/game/entities'
import { cycleSelection, unitsInRange } from '@/game/unitSelection'
import { addItem, equipArmor, equipWeapon, itemFromReward, mintItemId, starterInventory, useConsumable } from '@/game/inventory'
import { createLoadout, loadoutBonuses, seededPlayerLoadout, setSpecial } from '@/game/loadout'
import { TEMPLATE_PRESETS, type TemplateTheme } from '@/game/presets'
import { type Projectile } from '@/game/projectiles'
import { type QuestEvent, acceptQuest, recordEvent, turnIn } from '@/game/quests'
import { BARE_HANDS, type HitMarker, type PlayerHud, type ProjectileContext, playerHudFrom, stepCombat, tickProjectiles, triggerAbility } from '@/game/runtime/combat'
import { type PlayerState, aimFromKeys, facingFromKeys, playerDisplayName, resolveSpawnCell } from '@/game/runtime/player'
import { activeQuest, applyQuestEvent, questAnchorScreenPos, questForGiver, reachableQuestGiver, rewardSummary, upsertQuest } from '@/game/runtime/quest'
import { type EnemyRuntime, isLivingEnemy, makeEnemyRuntime, RANGED_RANGE } from '@/game/runtime/targeting'
import { ENEMY_TYPES, CAVE_ENEMY_TYPES, TEMPLE_ENEMY_TYPES, archetypeForEnemyType, scatterEntities } from '@/game/spawner'
import { type CombatState, type Entity, type EntityKind, type Inventory, type Item, type Loadout, type MovementPattern, type Quest, type Reward, type Stats, type TalentPath, type Weapon } from '@/game/types'
import { weaponReach } from '@/game/weapons'
import { VILLAGE_CONFIG } from '@/levels/village'
import { Connector, TemplateListItem, createTemplate, deleteTemplate, deserializeToGrid, getTemplate, listTemplates, serializeGrid, updateTemplate, updateGame } from '@/lib/api'
import { type CellTriggerGroup, ENTITY_GLYPH, cellTriggersFromAssets, cellTriggersToAssets, entitiesFromAssets, entitiesToAssets, groundColorFromAssets, groundColorToAssets, groundDimsFromAssets, groundDimsToAssets, isEntityAsset, isGroundColorAsset, isGroundDimsAsset, isQuestAsset, isStyleAsset, isTriggerAsset, questsFromAssets, questsToAssets, styleFromAssets, styleToAssets, triggersAtCell } from '@/lib/gridCodec'
import type { GroundCellDims } from '@/engine/groundDims'
import { type Trigger, type TriggerEffect, fireTriggers } from '@/game/runtime/trigger'
import { ASCII_STYLE, type Style, type TileCategory, type TileDef, type Visual, styleById, groundKind, assetKind, entityKind, entityStyleOverride, genderize, resolveVisual, visualForTileId, tilesForStyle } from '@/game/artStyle'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { render, render2D, renderTopView, clampCameraAxis, isoCameraFocus, entityMotion, ENEMY_MOVE_MS, isDebugMode, setDebugMode, isShowCollisions, setShowCollisions as setCollisionsFlag, cellCaptionMap, pickIsoTilesAt, pickTwoDTilesAt, isoRecordedGeom, twoDRecordedGeom, nextPickIndex, ISO_BLOCK_H_FRAC, depthCells, tileGeomPolygon, tileGeomCentroid, tileHandlePoints, handleAtPoint, dragOutwardPx, scaleFromDrag, depthFromDrag, drawTileHandles, polyBBox, HANDLE_HIT_RADIUS, type TileHandle, type HandleId, type CompositionGhost, type DayNight, type DepthDir } from '@/engine/render'
import { loadTilesetsFromBackend, saveTilesetToBackend } from '@/engine/tileset/tilesetLoader'
import { ASCII_TILESET } from '@/engine/tileset/asciiTileset'
import { EMOJI_TILESET, setTilePose } from '@/engine/tileset/emojiTileset'
import { type TilePose } from '@/engine/tileset/pose'
import { type AssetLight, type TileDisplay, type TileShape } from '@/engine/tileset/tileset'
import { type QuestDraft, emptyQuestDraft, questFromDraft } from '@/game/runtime/questDraft'
import { seedCharacterAnimations, needsAnimationReseed, entityAnimationsFromUnit, unitAnimationsFromEntity, randomMovementAnimation } from '@/game/runtime/entityAnimation'
import { stampBuildingComposition, stampBuildingKind, stampComposition } from '@/game/runtime/composition'
import { type Cursor, type JumpState, JUMP_MS, JUMP_PEAK_PX, advanceEnemyMovement, beginJump, tickCannons } from '@/game/runtime/movement'
import { playSwoosh } from '@/game/runtime/audio'
import { Card, EntityToolButton, ViewButton } from '@/components/game/controls'
import { AbilityBar, CombatHud, QuestHud } from '@/components/game/hud'
import { EquipmentPanel, InventoryCard, QuestAuthoringCard, QuestLogPanel } from '@/components/game/panels'
import { ConnectorsPanelBody, EntityAttackBody, FloatingPanel, Modal, QuestGiveBody, SettingsPanelBody, UnitSettingsSection } from '@/components/game/modals'
import { FlowViewOverlay, GamesViewOverlay } from '@/components/game/games'
import { type BuildingTool, type EditorMode, type EntityTool } from '@/components/game/editorConfig'
import { useDayNight, useFloatingPanels, useIsMobile } from '@/components/game/editorHooks'
import { CompositionPalette, Dropdown, FpsReadout, GenerateControls, PoseControls, PropertiesPanel, type TileControlModel, SelectionHeader, StylePicker, TileAnimationEditor, TileLibraryBody, TilePalette, ToolRail, TriggerEditor, UnitPicker, WEAPON_KINDS } from '@/components/game/editorChrome'
import type { Animation as TileAnim } from '@/engine/animation/tileAnimation'
import { useFps } from '@/components/useFps'
import { commonValue, commonBool, cellsFromKeys, removeSelectedBlock } from '@/game/editor/selectionEdit'
import { applyRectSelection, applyCellSelection } from '@/game/editor/selection'
import { entityKindForUnitSlug, placementFor, tileSlug } from '@/game/editor/tilePlacement'
import { clearGroundTile, placeGroundTile, removeTopAsset, removeAssetAtLevel, stackAssetTile } from '@/game/editor/tileBrush'
import { connectorEditFromSelection } from '@/game/editor/connectors'
import { useEditorHistory } from '@/game/editor/useEditorHistory'


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

/** Forward-seed the default character animation set onto any person (player/npc) that has none, so the
 *  animation list follows the UNIT across templates and persists on save (#88 — persons saved before
 *  animation-seeding existed load with an empty list even though they play the default set). */
function withSeededPersonAnimations(list: Entity[]): Entity[] {
  return list.map(e =>
    (e.kind === 'player' || e.kind === 'npc') && needsAnimationReseed(e.animations)
      ? { ...e, animations: seedCharacterAnimations() }
      : e,
  )
}

/**
 * When the editor is opened INSIDE a game (route /games/[id]) it receives this context instead of
 * reading a template id off the URL. `startTemplateId` is the template to open first (the game's
 * last-watched); switching templates within the game writes the new one back as `lastTemplateId`.
 */
export interface EditorGameContext {
  gameId: string
  templateIds: string[]
  startTemplateId: string | null
  play: boolean
}

function TemplateEditor({ gameContext }: { gameContext?: EditorGameContext } = {}) {
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
  // Which tile in the selected cell's stack the inspector edits: a 0-based index into getStack (0 = floor,
  // 1.. = stacked). Set from the iso block you click (its level) and moved by the TILE header's ▲▼ stepper.
  const [selectedTileLevel, setSelectedTileLevel] = useState(0)
  const selectedTileLevelRef = useRef(0)
  // An in-progress canvas resize-handle drag on the selected tile (Task: "control its size with mouse").
  // Captured at grab time so the drag stays stable while the tile repaints under it each frame.
  const handleDragRef = useRef<{
    id: HandleId
    i: number
    startCx: number; startCy: number // grab point, canvas-internal px
    sx: number; sy: number           // client→canvas scale at grab time
    startScaleX: number; startScaleY: number; startDepth: number
    baseHalfWpx: number; baseHalfHpx: number // px per 1.0 of scaleX / scaleY (silhouette-derived)
  } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionStart, setSelectionStart] = useState<{ col: number; row: number } | null>(null)
  const selectionBaseRef = useRef<Set<string>>(new Set()) // selection at drag-start; a shift+drag MERGES the rectangle into THIS (additive, no restart)
  const additiveSelectRef = useRef<boolean>(false)         // was shift held when the drag-select started
  const selectedCellsRef = useRef<Set<string>>(new Set())
  // Camera panning with mouse drag
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  // Click-vs-drag in the play views: a clean click selects the entity under it, a drag pans.
  const dragMovedRef = useRef(false)
  const downCellRef = useRef<{ col: number; row: number; level?: number; source?: TileSource } | null>(null)
  const downAltRef = useRef(false) // Alt held on mouse-DOWN — mouse-up reads it to select the CELL under a unit (instead of the unit)
  const [camOffset, setCamOffset] = useState({ x: 0, y: 0 })
  const camOffsetRef = useRef({ x: 0, y: 0 })
  // The ARMED placement brush — a full catalog TileDef (from the Paint palette). Minecraft-style: pick a
  // tile, then each LEFT-click on the map places it (⌥Alt-click removes the top asset); one brush at a
  // time; clicking it again / Esc / Disarm clears it. Replaces the old cell-first {char,type} paint tile.
  const [armedTile, setArmedTile] = useState<TileDef | null>(null)
  const armedTileRef = useRef<TileDef | null>(null) // live mirror for the mounted-once keydown handler (Esc disarms)
  useEffect(() => { armedTileRef.current = armedTile }, [armedTile])
  // ◈ Unit placement (top-nav): the picked creature tile, whether we ADD (click) or SCATTER (randomize), and
  // whether a placed unit is STATIC or wandering with a randomized movement animation. Height/opacity used to
  // live in the Paint sidebar — they're Inspector-only now (per-tile), so the paint brush places at full size.
  const [unitTile, setUnitTile] = useState<TileDef | null>(null)
  const [unitPlaceMode, setUnitPlaceMode] = useState<'add' | 'scatter'>('add')
  const [unitAnimated, setUnitAnimated] = useState(false)
  const [hideEntities, setHideEntities] = useState(false)
  const hideEntitiesRef = useRef(false)
  useEffect(() => {
    hideEntitiesRef.current = hideEntities
  }, [hideEntities])
  // Day/Night: the render loop reads the ref each frame; default day.
  const { dayNight, setDayNight, dayNightRef } = useDayNight('day')
  const [initialized, setInitialized] = useState(false)

  // Template limits
  const isProd = process.env.NODE_ENV === 'production'
  const maxTemplates = isProd ? MAX_TEMPLATES_PROD : Infinity

  // Template management state
  const [savedTemplates, setSavedTemplates] = useState<TemplateListItem[]>([])
  // When editing inside a game, the templates linked to it (the many-to-many). Kept in sync as
  // connections are made so the game always contains the flow it opens.
  const [gameTemplateIds, setGameTemplateIds] = useState<string[]>(gameContext?.templateIds ?? [])
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
  // The Connectors flow now lives in a draggable FloatingPanel opened from a RIGHT-SIDEBAR button (its entry
  // moved off the left tool-rail). Opening it arms authoring; closing it disarms + drops the edited connector.
  const [connectorPanelOpen, setConnectorPanelOpen] = useState(false)
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
  // UI-only flag: the left tool-rail's "Paint" mode (reveals the tile palette). It only decides which
  // mode the rail highlights / which left panel shows; canvas placement is gated by `armedTile` (the
  // brush picked from the palette). The other rail modes derive straight from the tool state below.
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
  const hoveredCellRef = useRef<{ col: number; row: number; level?: number } | null>(null) // CELL/BLOCK under the cursor (level = the stacked block in iso) — RAF draws a dim hover cube on EVERY cell, lifted onto the SAME block the click selects
  // Which Inspector section a quick-action asked to focus. `n` is a nonce so clicking
  // the same verb twice still re-opens + re-scrolls that section (see Card `focus`).
  const [sectionFocus, setSectionFocus] = useState<{ id: string; n: number } | null>(null)
  // Which entity-action modal is open (Inventory / Quests).
  const [entityModal, setEntityModal] = useState<'inventory' | 'quests' | null>(null)
  // The unit's ✦ Animate… opens the SAME TileAnimationEditor modal a tile opens — BOTH the settings AND sprite
  // kinds. A unit stores the unified `Animation[]` in `unitAnimations`; the render projection `animations`
  // (EntityAnimation[]) is kept in sync from its sprite subset. Kept off the card so the sidebar stays short.
  const [animEditorOpen, setAnimEditorOpen] = useState(false)
  // The TILE animation modal (Phase 4) — authors GridAsset.animations for the selected asset tile.
  const [tileAnimatorOpen, setTileAnimatorOpen] = useState(false)
  // The TILE settings modal — hosts the full TileControls body (colour/size/pose/z…) so the inspector stays
  // a compact summary. Same open/close pattern as the animation modal above.
  const [tileSettingsOpen, setTileSettingsOpen] = useState(false)
  // The UNIT settings panel — hosts the SAME FloatingPanel + shared settings body a tile uses (colour/scale/
  // pose). The unit's identity/vitals/inventory live on the CARD now, so this modal is tile-only for a unit.
  const [unitSettingsOpen, setUnitSettingsOpen] = useState(false)
  // The TRIGGERS modal — a floating panel (like settings) to manage the selected cell's or unit's triggers.
  const [triggersOpen, setTriggersOpen] = useState(false)
  // The enemy ATTACKS modal — the attack/ability pattern editor, folded off the card into a floating panel.
  const [unitAttacksOpen, setUnitAttacksOpen] = useState(false)
  // Close any entity modal whenever the selection changes, so clicks on a new entity select it
  // (not show a stale modal for the previous one).
  useEffect(() => {
    selectedEntityIdRef.current = selectedEntityId
    setEntityModal(null)
    setAnimEditorOpen(false)
    setUnitSettingsOpen(false)
    setTriggersOpen(false)
    setUnitAttacksOpen(false)
  }, [selectedEntityId])
  // ── Floating-panel geometry (backend-owned editor settings) ─────────
  // Each movable/resizable modal (settings / animation / triggers / attacks / tileAnimation) remembers its
  // position + size in nebulith. Load the whole map once on mount; on every move/resize END, upsert the one
  // key (debounced). The backend owns this, so panel geometry is never hardcoded in the frontend.
  // FloatingPanel props for a modal id: restore its saved geometry (else `def`) + persist on move/resize end.
  const floatingProps = useFloatingPanels()
  const [npcName, setNpcName] = useState('')
  const entitiesRef = useRef<Entity[]>([])

  // ── Tile-composition PLACE tool state ───────────────────────────────
  // The tool STAMPS a backend COMPOSITION (building / tree / fountain / lamp post / …) as per-cell tiles, the
  // SAME path trees use — there is no whole-composition select / move / rotate / resize / delete. Individual
  // cells/blocks are edited with the normal cell/tile selection + paint. `buildingTool` holds the armed
  // composition KIND (a string like `house_4`, `fountain`, `lamp_post`), or null. `buildingVersion` is bumped
  // after a stamp to nudge a React re-render (the canvas is live via the loop).
  const [buildingTool, setBuildingTool] = useState<BuildingTool>(null)
  const [buildingVersion, setBuildingVersion] = useState(0)
  const buildingToolRef = useRef<BuildingTool>(null)
  const genZoneRef = useRef<ZoneId>(genZone)
  const bumpBuildingVersion = useCallback(() => setBuildingVersion(v => v + 1), [])
  // Undo / redo (Ctrl+Z / Ctrl+Y): a BOUNDED snapshot ring of the MAP (grid + entities). checkpointHistory()
  // is called at the START of each map-mutating edit (before it mutates); the hook binds the keys and restores
  // exactly. resetHistory() clears it when the whole map is replaced (stage gen / template load).
  const { checkpoint: checkpointHistory, reset: resetHistory } = useEditorHistory({
    gridRef,
    entitiesRef,
    setEntities,
    onRestore: bumpBuildingVersion,
  })
  // The grouped list of EVERY backend composition (buildings + trees + props) the palette lists — filled once
  // the tileset loads from the server (compositions arrive with it). Empty until then → the palette shows a
  // "loading" note. Data-driven, so the palette is never a hardcoded building-only subset.
  const [compositionPalette, setCompositionPalette] = useState<CompositionPaletteGroup[]>([])
  // The armed composition's placement GHOST — a translucent footprint drawn at the hovered cell BEFORE the
  // click. Recomputed on mouse-move (not every frame → cheap) from the SAME planComposition the click stamps,
  // stashed in a ref so the RAF render loop reads it without a React re-render. Null when nothing is armed.
  const ghostRef = useRef<CompositionGhost | null>(null)

  // Clear a pending quick-action section focus whenever the SELECTION itself changes, so
  // a section opened on one element doesn't auto-open on the next. Done during render
  // (not a post-commit effect) so the freshly-mounted Inspector cards never see the stale
  // focus. Keyed by a value string — selectedCells is a fresh Set each update.
  const selectionKey = `${selectedEntityId ?? ''}|${editingConnector ? `${editingConnector.col},${editingConnector.row}` : ''}|${Array.from(selectedCells).sort().join(';')}`
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
  const jumpRef = useRef<JumpState>({ active: false, start: 0 })
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
  const fps = useFps() // #86 — one sampler feeds the nav readout (edit/show) + the play-mode floating box
  // TILESET LOADING GATE — the frontend ships NO bundled tile data, so the map cannot be drawn until the
  // backend tileset is installed. `tilesetReady` gates the RAF render (via tilesetReadyRef) AND the canvas
  // overlay below: until it flips true we show a loader (never a frontend-tile flash); on an empty/failed
  // load `tilesetError` shows a retry state. This is the "loader → correct DB style, nothing in between"
  // the user asked for — there is deliberately no fallback to frontend tiles.
  const [tilesetReady, setTilesetReady] = useState(false)
  const [tilesetError, setTilesetError] = useState(false)
  const tilesetReadyRef = useRef(false) // live flag the gameLoop reads each frame (mirrors tilesetReady)
  useEffect(() => { tilesetReadyRef.current = tilesetReady }, [tilesetReady])

  // Fetch + install the tilesets from the nebulith Elixir backend — the ONLY source of runtime tiles. On
  // success (>=1 style installed) we open the gate; on an empty/failed load we surface the error state (a
  // retry) and keep the render gated. We NEVER fall back to frontend tiles.
  const loadTiles = useCallback(() => {
    setTilesetError(false)
    loadTilesetsFromBackend()
      .then((loaded) => {
        if (loaded.length === 0) { setTilesetError(true); return }
        // Build the Tile-composition palette from the just-loaded tileset — EVERY composition the backend
        // serves (buildings + trees + fountains + lamp posts…), grouped for the panel. Data-driven, so a new
        // backend composition appears in the palette with no frontend change.
        setCompositionPalette(buildCompositionPalette(ASCII_TILESET))
        setTilesetReady(true)
      })
      .catch(() => setTilesetError(true))
  }, [])
  useEffect(() => { loadTiles() }, [loadTiles])
  const isMobile = useIsMobile()

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
    setConnectorPanelOpen(false)
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

  // Keep the selected stack-level ref in sync so the RAF loop + the mouse handlers can find which tile shows
  // resize handles without a stale closure.
  useEffect(() => {
    selectedTileLevelRef.current = selectedTileLevel
  }, [selectedTileLevel])

  // Keep the building-tool ref in sync (read by the once-mounted click handler + loop)
  useEffect(() => { buildingToolRef.current = buildingTool }, [buildingTool])
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
    // Map the click from CSS/display pixels to INTERNAL canvas pixels — the projection below is in
    // canvas.width/height space. This is the exact inverse of cellToScreen's `* rect.width/canvas.width`
    // scaling; without it, clicks desync from the drawing whenever the canvas is displayed at a different
    // size than its backing store (layout change / window resize / browser zoom), and the error grows as
    // the tiles shrink — which is why it read as "inaccurate, especially when zooming".
    const scaleX = rect.width ? canvas.width / rect.width : 1
    const scaleY = rect.height ? canvas.height / rect.height : 1
    const x = (clientX - rect.left) * scaleX
    const y = (clientY - rect.top) * scaleY
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

  // INVERTED TILE PICK: hit-test the ACTUAL rendered TILE the user points at (its transform-aware silhouette,
  // recorded by the renderer as it drew — honouring scaleY/zoom/pose/zOffset/depth/single-display/heightLevel)
  // and cascade to its cell. This replaces the old "cursor → cell → topmost tile" resolution: we pick the tile
  // you SEE and derive its cell, so the pick + highlight match the visual even for a tall / slid / lifted tile.
  // ISO and 2D both use their own frame record (top = footprint, the flat cell already matches — untouched).
  // Returns null (→ the caller falls back to the flat screenToCell) when no tile is under the pointer. Reads the
  // LAST frame's record (the RAF loop re-renders every frame). Converts client → canvas-internal pixels.
  const renderedTilesUnder = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    if (topViewMode) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width ? canvas.width / rect.width : 1
    const scaleY = rect.height ? canvas.height / rect.height : 1
    const x = (clientX - rect.left) * scaleX
    const y = (clientY - rect.top) * scaleY
    const tiles = viewTypeRef.current === '2d' ? pickTwoDTilesAt(x, y) : pickIsoTilesAt(x, y) // topmost (front) first
    return { tiles, x, y }
  }

  // The frontmost rendered tile under a point (what hover previews + a first click selects), or null. Its cell
  // + stack level cascade from the picked tile so the inspector still edits the correct backend cell/asset.
  const pickIsoBlockAt = (clientX: number, clientY: number): { col: number; row: number; level: number; source: TileSource } | null => {
    const hit = renderedTilesUnder(clientX, clientY)?.tiles[0]
    return hit ? { col: hit.col, row: hit.row, level: hit.level, source: hit.source } : null
  }

  // The cell a click SELECTS/edits: the rendered tile under the pointer first (so a click on a tall/lifted tile
  // picks THAT tile, not the ground under it), else the flat screenToCell — unchanged for empty cells, 2D, top.
  const pickCellForSelect = (clientX: number, clientY: number): { col: number; row: number; level?: number; source?: TileSource } | null => {
    const tile = pickIsoBlockAt(clientX, clientY)
    if (tile) return tile
    const flat = screenToCell(clientX, clientY)
    return flat ? { col: flat.col, row: flat.row, source: 'floor' as const } : null
  }

  // Click-to-cycle: repeated clicks on the SAME spot walk front→back through the OVERLAPPING tiles there, so an
  // OCCLUDED tile is reachable without moving the camera (the pick correctly returns the visible top tile — not
  // a geometry bug). ONLY call this from a discrete mousedown; hover must keep using pickCellForSelect (the
  // frontmost), or it would advance the cycle.
  const lastPickRef = useRef<{ x: number; y: number; index: number } | null>(null)
  const PICK_CYCLE_TOL = 8 // canvas px — a click within this of the last one keeps cycling; farther resets to front
  const pickCellForSelectCycling = (clientX: number, clientY: number): { col: number; row: number; level?: number; source?: TileSource } | null => {
    const under = renderedTilesUnder(clientX, clientY)
    if (under && under.tiles.length > 0) {
      const idx = nextPickIndex(lastPickRef.current, under.x, under.y, under.tiles.length, PICK_CYCLE_TOL)
      lastPickRef.current = { x: under.x, y: under.y, index: idx }
      const hit = under.tiles[idx]
      return { col: hit.col, row: hit.row, level: hit.level, source: hit.source }
    }
    lastPickRef.current = null // clicked off any tile → reset the cycle
    const flat = screenToCell(clientX, clientY)
    return flat ? { col: flat.col, row: flat.row, source: 'floor' as const } : null
  }

  // The stack index (0 = floor, 1.. = stacked) the TILE inspector should show for a click. A picked RAISED
  // block maps to its stack position (its heightLevel → its slot in the sorted stack); a flat pick with no
  // specific block defaults to the TOP tile — or the floor (0) when the cell is bare. Drives selectedTileLevel.
  const levelForPickedCell = (c: { col: number; row: number; level?: number; source?: TileSource }): number => {
    const grid = gridRef.current
    if (!grid) return 0
    // Read the SAME unified stack the inspector shows, so a picked block maps 1:1 to its inspector slot.
    const stack = getStack(grid, c.col, c.row, { entities: entitiesRef.current })
    // A picked BLOCK carries its store + heightLevel → its exact slot in the stack (wall/prop/character alike).
    if (c.level !== undefined && c.source && c.source !== 'floor') {
      const idx = stack.findIndex(t => t.source === c.source && (t.heightLevel ?? 0) === c.level)
      if (idx >= 0) return idx
    }
    // Flat ground click → the TOP loose ASSET, or the floor (index 0) for a bare / building-ground cell: a
    // plain ground click never auto-selects a building or character tile — click the raised block for that.
    let top = 0
    stack.forEach((t, i) => { if (t.source === 'asset') top = i })
    return top
  }

  // The 3D selection keys for the COLUMN the pointer picked: every stacked block (heightLevel ≥ 1) at that
  // cell, as "col,row,level" — so a click on a building corner / tree stack highlights the WHOLE column of
  // blocks (the iso highlight raises each onto its real block), not the flat bottom cell. A bare / floor pick
  // (no raised block) stays the single flat "col,row" key. ONE path: buildings, props and characters are all
  // just stack entries here (getStack), no per-type branch — a wall column and a tree column resolve the same.
  const columnKeysAt = (c: { col: number; row: number; level?: number; source?: TileSource }): Set<string> => {
    const grid = gridRef.current
    const flat = new Set([`${c.col},${c.row}`])
    if (!grid || c.level === undefined || c.level < 1 || !c.source || c.source === 'floor') return flat
    const keys = new Set<string>()
    for (const t of getStack(grid, c.col, c.row)) {
      const lvl = t.heightLevel ?? 0
      if (lvl >= 1) keys.add(`${c.col},${c.row},${lvl}`)
    }
    return keys.size ? keys : flat
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

    // RESIZE HANDLE grab (left button, no placement tool): if the pointer is on a grip of the selected tile,
    // start resizing it — takes priority over pan/select so the drag never pans the camera.
    if (e.button === 0 && !entityTool && !buildingTool && !connectorMode && tryStartHandleDrag(e.clientX, e.clientY)) {
      e.preventDefault()
      return
    }

    // ARMED BRUSH (Paint mode): a palette tile is picked → LEFT-click PLACES it (⌥Alt-click removes the
    // top asset), on the current multi-cell selection when there is one, else on the single clicked cell.
    // SHIFT is left to the selection gesture below so a bulk selection can still be built while armed.
    if (e.button === 0 && armedTile && !e.shiftKey) {
      // Block-aware: place onto / ⌥Alt-remove the block you're POINTING at, so a stack no longer paints or
      // erases the wrong bottom cell. Falls back to the flat cell on empty ground / 2D / top (unchanged).
      const pick = pickCellForSelect(e.clientX, e.clientY)
      if (pick) applyArmedBrush(pick, e.altKey)
      return
    }

    // ALL views (iso/2d/top): LEFT-click + drag pans the camera — UNLESS a placement tool is armed
    // (entity / building / connector), OR SHIFT is held (shift+drag bulk-SELECTS cells in every view).
    // Plain left-drag pans, shift+drag selects — the SAME gesture everywhere (top view no longer
    // hijacks plain drag for select, which is why the screen wouldn't move). Middle/right-drag also pans.
    if (e.button === 0 && !entityTool && !buildingTool && !connectorMode && !e.shiftKey) {
      // Defer the decision: clean click → select the entity here; drag → pan (mouse-up decides). Iso uses the
      // block-aware pick so a click on a raised stacked block selects THAT block's cell, not the ground under it.
      downCellRef.current = pickCellForSelectCycling(e.clientX, e.clientY)
      downAltRef.current = e.altKey // Alt+left → resolve to the CELL under any unit (mouse-up reads this)
      dragMovedRef.current = false
      setIsPanning(true)
      setPanStart({ x: e.clientX, y: e.clientY })
      return
    }

    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return

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

    // No tool armed: select the EXACT cell under the pointer — a unit is picked only when its OWN
    // footprint covers this cell (no walk), so a click never grabs a neighbouring unit. The player is
    // hit-tested at its LIVE cell (withPlayerCell) since its entity col/row is frozen at spawn.
    // Alt+click always prefers the CELL — skip the entity hit-test so a unit's floor tile stays editable.
    const clickedEntity = e.altKey ? null : entityAtFootprint(withPlayerCell(entitiesRef.current, livePlayerCell()), cell.col, cell.row)
    if (clickedEntity) {
      setSelectedEntityId(clickedEntity.id)
      return
    }

    // Selecting cells makes the CELL the Inspector's subject — drop any unit selection
    // so the panel morphs to the cell instead of lingering on the last-clicked entity.
    setSelectedEntityId(null)
    setIsSelecting(true)
    setSelectionStart(cell)
    // Capture the base selection + additive intent at drag-start so a shift+drag MERGES its rectangle into the
    // existing selection (select 4, then 4 more → 8; no restart). Plain click = a fresh single-cell selection.
    additiveSelectRef.current = e.shiftKey
    selectionBaseRef.current = e.shiftKey ? new Set(selectedCellsRef.current) : new Set()
    setSelectedCells(prev => applyCellSelection(prev, `${cell.col},${cell.row}`, e.shiftKey))
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    // An in-progress resize-handle drag owns the pointer: map it to the tile's new size and skip hover/pan.
    if (handleDragRef.current) {
      applyHandleDrag(e.clientX, e.clientY)
      return
    }
    // Hover targeting (#24): hit-test the unit under the cursor — view-aware, the SAME test the click-select
    // uses (withPlayerCell so the walked hero is hittable) — and stash its id in a REF. The RAF loop reads
    // it to draw a dim white hover reticle. A ref (not state) so a mousemove never triggers a React render.
    const hoverCell = screenToCell(e.clientX, e.clientY)
    const hoverView = topViewMode ? 'top' : viewTypeRef.current === '2d' ? '2d' : 'iso'
    hoveredEntityIdRef.current = hoverCell
      ? (entityAtClick(withPlayerCell(entitiesRef.current, livePlayerCell()), hoverCell.col, hoverCell.row, hoverView)?.id ?? null)
      : null
    // Cell/BLOCK-hover indicator: resolve the SAME cell/block the CLICK will select (pickCellForSelect —
    // block-aware in iso, the flat cell in 2D/top), UNCONDITIONALLY on every move, so the dim hover cube
    // previews the EXACT thing you'll select and rides onto a stacked block instead of the flat ground cell
    // behind it (fixes the hover-vs-selection offset). RAF draws it on all cells, in addition to the unit reticle.
    hoveredCellRef.current = pickCellForSelect(e.clientX, e.clientY)

    // Composition placement GHOST: when a Tile-composition is armed, PLAN where it would land at the FLAT hover
    // cell (the SAME cell the click stamps from) and stash its footprint + validity so the RAF loop draws a
    // translucent shadow before the click. Computed only on move (not every frame) → cheap; cleared when nothing
    // is armed or the pointer is off-grid.
    const armedKind = buildingToolRef.current
    const grid = gridRef.current
    if (armedKind && hoverCell && grid) {
      const plan = planComposition(grid, armedKind, hoverCell.col, hoverCell.row)
      ghostRef.current = plan ? { cells: plan.cells, valid: plan.valid, height: plan.height } : null
    } else {
      ghostRef.current = null
    }

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

    if (!isSelecting || !selectionStart) return // drag-select the cell rectangle (shift+drag in every view)
    const cell = screenToCell(e.clientX, e.clientY)
    if (!cell) return
    // The drag rectangle, MERGED into the base captured at drag-start when additive (shift) — so extending a
    // selection keeps what's already there (4 + 4 = 8). Non-additive drag replaces with the fresh rectangle.
    setSelectedCells(applyRectSelection(selectionBaseRef.current, selectionStart, cell, additiveSelectRef.current))
  }

  const handleCanvasMouseUp = () => {
    // End any resize-handle drag first (it owned the gesture — no pan/select to finalise).
    if (handleDragRef.current) {
      handleDragRef.current = null
      setIsPanning(false)
      setPanStart(null)
      return
    }
    // A no-drag click in a play view (iso/2d) selects the unit under it — view-aware so clicking the
    // standing FIGURE (drawn above its foot cell) selects it, not only a click on the exact cell.
    if (isPanning && !dragMovedRef.current && downCellRef.current) {
      const c = downCellRef.current
      // Select the picked TILE as a cell + stack level — the unified Cell inspector then shows THAT tile
      // (floor / prop / building wall) with the SAME controls, no matter what it is.
      const selectCellTile = () => {
        setSelectedEntityId(null)
        // Carry the picked TILE's level into the key ("col,row,level") — INCLUDING level 0 for a flat tile — so
        // the highlight looks up that tile's ACTUAL recorded silhouette and hugs it (scaleY/pose/zOffset/depth
        // aware), instead of the flat ground cell. A floor pick (no tile) stays the 2-part "col,row" ground key.
        const key = c.source && c.source !== 'floor' && c.level !== undefined ? `${c.col},${c.row},${c.level}` : `${c.col},${c.row}`
        setSelectedCells(new Set([key]))
        setSelectedTileLevel(levelForPickedCell(c))
      }
      // ONE resolution, then a tiny route by the tile's STORE (never a geometry re-test — pickIsoBlock already
      // did that uniformly over the stack):
      //  • a picked BUILDING / PROP block → that tile in the Cell inspector (wins over an entity sharing the
      //    cell — you clicked the raised block, not the figure at ground level);
      //  • Alt → always the CELL under the pointer (edit the floor even under a unit);
      //  • a plain flat click stays ENTITY-FIRST (a unit is a billboard drawn above its foot cell), else the cell.
      if (c.source === 'building' || c.source === 'asset') {
        selectCellTile()
      } else if (downAltRef.current) {
        selectCellTile()
      } else {
        const hit = entityAtFootprint(withPlayerCell(entitiesRef.current, livePlayerCell()), c.col, c.row)
        if (hit) {
          setSelectedEntityId(hit.id)
        } else {
          selectCellTile()
        }
      }
    }
    downCellRef.current = null
    downAltRef.current = false
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

  /** Enter the connector editing view for the ACTIVE selection so opening the panel lands straight in the
   *  authoring FORM — no second click. Reuses the SAME routing as a canvas connector click
   *  (`connectorEditFromSelection`): a saved connector overlapping the selection loads, otherwise the
   *  selection itself becomes a fresh connector. No-op with no selection (the panel just stays armed). */
  const beginConnectorForSelection = () => {
    const start = connectorEditFromSelection(cellsFromKeys(selectedCellsRef.current), connectors)
    if (!start) return
    setConnectorForm(start.form)
    setSelectedCells(new Set(start.cells.map(p => `${p.col},${p.row}`)))
    setEditingConnector(start.editing)
  }

  /** Open the right-sidebar Connectors panel: arm click-to-add authoring and drop the other exclusive tools so
   *  a canvas click routes to exactly one editor (mirrors the old rail Connector mode, minus the rail entry).
   *  With a selection active it opens straight into the editing view (`beginConnectorForSelection`) — the user
   *  expects one click, especially with a multi-select, not a second click to reach the form. */
  const openConnectorPanel = () => {
    setSelectedEntityId(null)
    setConnectorPanelOpen(true)
    setConnectorMode(true)
    setPaintMode(false)
    setEntityTool(null)
    setBuildingTool(null)
    setArmedTile(null)
    beginConnectorForSelection()
  }

  /** Close it: disarm authoring and drop the edited connector. */
  const closeConnectorPanel = () => {
    setConnectorPanelOpen(false)
    setConnectorMode(false)
    setConnectorPanelOpen(false)
    setEditingConnector(null)
  }

  // ── Entity placement ───────────────────────────────────────────────
  // A random patrol around a spawn (mirrors spawner.makePatrol, which isn't exported): 3–4 jittered ±2-cell
  // waypoints, keeping only walkable in-bounds cells. Used by the ◈ Unit "Animated" placement so the unit
  // actually wanders (the visible half of "animated"; the walk cycle is the other half).
  const randomPatrol = (col: number, row: number): MovementPattern => {
    const grid = gridRef.current
    const waypoints: { col: number; row: number }[] = [{ col, row }]
    const extra = 3 + Math.floor(Math.random() * 2)
    for (let k = 0; k < extra; k++) {
      const c = col + (Math.floor(Math.random() * 5) - 2)
      const r = row + (Math.floor(Math.random() * 5) - 2)
      if (grid && c >= 0 && r >= 0 && c < grid.cols && r < grid.rows && !grid.isBlocked(c, r)) waypoints.push({ col: c, row: r })
    }
    return { mode: 'random', waypoints }
  }

  /** Pin a placed unit STILL: a stationary single-waypoint pattern (a no-op in the stepper) so it never
   *  inherits the runtime's default wander. The STATIC half of the ◈ Unit motion toggle. */
  const withStaticMotion = <T extends Entity>(ent: T): T => ({ ...ent, movement: { mode: 'sequential', waypoints: [{ col: ent.col, row: ent.row }] } })

  /** Place a unit ANIMATED: a random wandering patrol PLUS a randomized movement animation (authored as
   *  DATA in `unitAnimations`, projected to the render list `animations`) — the ANIMATED half of the toggle. */
  const withRandomMotion = <T extends Entity>(ent: T): T => {
    const anim = randomMovementAnimation()
    return { ...ent, movement: randomPatrol(ent.col, ent.row), animations: [anim], unitAnimations: unitAnimationsFromEntity([anim]) }
  }

  // One builder per placeable kind (dispatch map, not a switch). Each returns a
  // fresh Entity from the pure factory; the orchestrator below guards placement.
  const ENTITY_BUILDERS: Record<EntityKind, (col: number, row: number) => Entity> = {
    player: (col, row) => makePlayer(mintEntityId('player'), col, row),
    // A MANUALLY-placed enemy is STATIC by default — NO auto movement/animation ("added with animation by
    // default" should ONLY happen when SCATTERING). An enemy with NO movement inherits the runtime's
    // DEFAULT_ENEMY_PATROL (advanceEnemyMovement) and wanders — so to keep a hand-placed enemy STILL we pin
    // an explicit STATIONARY pattern (a single waypoint = its own cell → the stepper no-ops). The concrete
    // creature (goblin/wolf/…) + its combat archetype now come from the picked ◈ Unit tile (placeUnitTile);
    // this bare builder is the fallback (rail-armed Unit with no pick) → a plain, still 'enemy'.
    enemy: (col, row) => withStaticMotion(makeEnemy(mintEntityId('enemy'), col, row, 'enemy')),
    npc: (col, row) => makeNpc(mintEntityId('npc'), col, row, { name: npcName.trim() || undefined }),
  }

  /** Arm an entity tool (re-clicking the active one disarms it). Clears the
   *  selection + connector + building modes so placement and selection never fight. */
  const toggleEntityTool = (tool: Exclude<EntityTool, null>) => {
    setEntityTool(prev => (prev === tool ? null : tool))
    setUnitTile(null) // a plain tool (player/npc/erase/collision) drops any picked creature tile
    setPaintMode(false)
    setConnectorMode(false)
    setConnectorPanelOpen(false)
    setEditingConnector(null)
    setSelectedCells(new Set())
    setBuildingTool(null)
  }

  /** Pick WHICH creature the ◈ Unit flow places (re-picking the same tile disarms). The tile's slug decides
   *  the entity KIND (person → npc, monster → enemy, player → player) so one picker serves them all; a canvas
   *  click then places THAT exact figure via placeUnitTile. Clears the other tools so a click routes to one. */
  const pickUnitTile = (tile: TileDef | null) => {
    const next = tile && unitTile?.id === tile.id ? null : tile
    setUnitTile(next)
    setEntityTool(next ? entityKindForUnitSlug(tileSlug(next.id)) : null)
    setPaintMode(false)
    setConnectorMode(false)
    setConnectorPanelOpen(false)
    setEditingConnector(null)
    setSelectedCells(new Set())
    setBuildingTool(null)
  }

  // ── Tile-composition PLACE actions ──────────────────────────────────
  /** Arm a composition PLACE tool by KIND (`house_4`, `fountain`, `lamp_post`… — re-clicking the active one
   *  disarms it). Mutually exclusive with the entity / connector tools so a click routes to exactly one
   *  editor. Clears the placement ghost immediately on disarm so no stale shadow lingers. */
  const toggleBuildingTool = (kind: string) => {
    setBuildingTool(prev => {
      const next = prev === kind ? null : kind
      if (!next) ghostRef.current = null
      return next
    })
    setPaintMode(false)
    setEntityTool(null)
    setConnectorMode(false)
    setConnectorPanelOpen(false)
    setEditingConnector(null)
  }

  /** Clear any armed tile so a Select-mode click inspects instead of painting. */
  const clearPaintTile = () => {
    setArmedTile(null)
  }

  /** Switch the left tool-rail mode. Each mode arms the matching tool state and disarms the rest;
   *  unit/building arm a sensible default sub-tool, kept if one is already chosen. */
  const selectMode = (m: EditorMode) => {
    setEditingConnector(null)
    setConnectorPanelOpen(false) // switching to a rail tool closes the (right-sidebar) Connectors panel
    ghostRef.current = null // drop any placement ghost on a mode switch (recomputed on the next hover if re-armed)
    if (m === 'select') {
      setPaintMode(false)
      setEntityTool(null)
      setBuildingTool(null)
      setConnectorMode(false)
      clearPaintTile()
      return
    }
    if (m === 'paint') {
      setPaintMode(true)
      setEntityTool(null)
      setBuildingTool(null)
      setConnectorMode(false)
      return
    }
    if (m === 'unit') {
      setPaintMode(false)
      setBuildingTool(null)
      setConnectorMode(false)
      clearPaintTile()
      setEntityTool(prev => prev ?? 'enemy')
      return
    }
    if (m === 'building') {
      setPaintMode(false)
      setEntityTool(null)
      setConnectorMode(false)
      clearPaintTile()
      setBuildingTool(prev => prev ?? 'house_4') // default-arm a house composition; keep the chosen one if any
      return
    }
    // connector
    setPaintMode(false)
    setEntityTool(null)
    setBuildingTool(null)
    clearPaintTile()
    setConnectorMode(true)
  }

  /** Stamp a pre-built building of `type` at the clicked cell — its backend composition's per-cell tiles,
   *  rotated to face the nearest road. A building is NOT a unit: this just paints its wall/window/door/roof
   *  tiles (the SAME stamp trees/props use), and each cell is then editable with the normal cell/tile tools.
   *  The click is treated as the footprint CENTRE. */
  const placeNewBuilding = (type: BuildingType, col: number, row: number): number =>
    // A building IS a composition — route it through the SAME replace-anything path (rotate to the road, clear
    // the footprint, stamp), so hand-placing a building overwrites whatever's there just like any composition.
    placeComposition(buildingCompositionKind(type, BUILDING_PLACE_LENGTH[type]), col, row)

  /** Stamp composition `kind` with the clicked cell as its footprint CENTRE — the generic path for ANY
   *  composition (building / tree / fountain / lamp post…). Uses the SAME planComposition the ghost preview
   *  draws, so what you saw is exactly what lands: buildings rotate to face the nearest road, props/trees drop
   *  as-is, and each stamped cell is then editable with the normal cell/tile tools. */
  const placeComposition = (kind: string, col: number, row: number): number => {
    const grid = gridRef.current
    if (!grid) return 0
    const plan = planComposition(grid, kind, col, row)
    if (!plan) { toast('Composition tiles are still loading — try again in a moment', 'info'); return 0 }
    if (!plan.valid) {
      // Red ONLY when it doesn't fit — the footprint runs off the map (not enough cells/blocks).
      toast('Not enough room here — the composition runs off the map', 'warning')
      return 0
    }
    checkpointHistory() // snapshot the pre-edit map so Ctrl+Z restores it exactly
    // REPLACE: a composition overwrites whatever it lands on (Alexander: "replace anything if I want to … if
    // there's a building in a place and I want to put another in the same place, I should be able to"). Clear
    // every footprint cell first so no stray stacked remnant survives under the new stamp, then stamp clean.
    for (const { col: c, row: r } of plan.cells) grid.clearAssetsAtCell(c, r)
    const placed = stampComposition(grid, kind, plan.anchorCol, plan.anchorRow, genZoneRef.current, 0, plan.rotation)
    bumpBuildingVersion()
    return placed
  }

  /** Apply the armed Tile-composition tool at (col,row): stamp the armed composition's cells. */
  const applyBuildingTool = (col: number, row: number) => {
    if (buildingTool) placeComposition(buildingTool, col, row)
  }

  /** Place or erase an entity at (col,row) for the armed tool, via the pure module. */
  const applyEntityTool = (col: number, row: number) => {
    const grid = gridRef.current
    if (!grid || !entityTool) return
    checkpointHistory() // placing / erasing a unit or toggling collision is a map edit → snapshot for Ctrl+Z

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

    // A picked ◈ Unit tile places THAT exact figure — kind derived from the slug (person→npc, monster→enemy,
    // player→player). placeUnitTile guards + pins the art (tileOverride); the motion toggle picks static vs
    // a randomized wandering animation. This supersedes the generic player/builder path when a tile is armed.
    if (unitTile) {
      if (!placeUnitTile(col, row, unitTile, { animated: unitAnimated })) {
        toast('Cell is blocked, out of bounds, or already occupied', 'warning')
      }
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
      // The pinned tile of the SELECTED stack level: a stacked asset carries its own tileOverride; the floor
      // (level 0) follows the global style (no override).
      if (selectedTileLevel >= 1) {
        const stacked = [...grid.getAssetsAtCell(c, r)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
        return stacked[selectedTileLevel - 1]?.tileOverride ?? null
      }
      return null
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
      if (selectedTileLevel >= 1) {
        // Swap ONLY the SELECTED stack level's tile — the block the user picked (top/middle/bottom).
        const stacked = [...grid.getAssetsAtCell(c, r)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
        const a = stacked[selectedTileLevel - 1]
        if (a) a.tileOverride = tileId ?? undefined
        continue
      }
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

  // ── Universal PROPERTY panel: apply an edit to EVERY selected cell (floor colour / object colour /
  //    collision / terrain height / size), then bump a redraw. Assets + ground mutate in place; the RAF
  //    loop re-reads the grid every frame, and bumpBuildingVersion re-reads the shared values into the panel. ──
  const applyToSelectedCells = (fn: (col: number, row: number, grid: IsometricGrid) => void) => {
    const grid = gridRef.current
    if (!grid) return
    for (const { col, row } of cellsFromKeys(selectedCells)) fn(col, row, grid)
    bumpBuildingVersion()
  }
  const setFloorColor = (color: string | null) => applyToSelectedCells((col, row, grid) => grid.setGroundColor(col, row, color))
  const setCellCollision = (blocked: boolean) => applyToSelectedCells((col, row, grid) => grid.setCollision(col, row, blocked))
  // A cell's stacked tiles in the SAME order the cell-stack adapter (getStack) projects them — sorted by
  // heightLevel — so the inspector's per-tile index maps to the right asset on both read and write.
  const stackedAssetsAt = (grid: IsometricGrid, col: number, row: number): GridAsset[] =>
    [...grid.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
  // Per-tile sprite scale (#77/#78): Width/Height/Depth are per-axis, Zoom is uniform. Dispatch the UI
  // axis to the asset field it writes; the renderers read these back per view (assetDimensions.ts).
  const DIM_FIELD = { width: 'scaleX', height: 'scaleY', depth: 'scaleZ', zoom: 'scale' } as const
  // Write the i-th stacked TILE of every selected cell (per-tile, not "all assets in the cell at once").
  const setAssetDim = (i: number, axis: keyof typeof DIM_FIELD, v: number) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a[DIM_FIELD[axis]] = v })
  const setAssetColor = (i: number, color: string) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a.color = color })
  // "Z Width" (directional depth): the i-th stacked TILE spans `cells` blocks along asset.depthDir, extruded as
  // a long iso box (isoDepthBox). A box needs a direction to grow — default to 'right-up' ("right top", the
  // user's Image #28 arrow) when raising it past 1 with none set, so the extrusion shows immediately.
  const setAssetDepth = (i: number, cells: number) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      a.depth = Math.max(1, Math.round(cells))
      if (a.depth > 1 && !a.depthDir) a.depthDir = 'right-up'
    })
  const setAssetDepthDir = (i: number, dir: DepthDir) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a.depthDir = dir })
  // PER-ASSET pose (x/y/rotate/flip) and "z position" (ISO-DIAGONAL slide) — written to THIS placed tile
  // (persists with the map), not the shared tileset kind. The render reads asset.pose / asset.zOffset / asset.zDir
  // in every view.
  const setAssetPose = (i: number, pose: TilePose | undefined) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a.pose = pose })
  // "z position": SLIDE the tile along an iso diagonal (NOT a vertical lift). Default the direction to 'right-up'
  // ("right top", the user's +z = up-right) the first time z is set with none, so the slide has a direction to
  // move along immediately — mirrors setAssetDepth defaulting depthDir when depth grows past 1.
  const setAssetZOffset = (i: number, v: number) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      a.zOffset = v
      if (v !== 0 && !a.zDir) a.zDir = 'right-up'
    })
  const setAssetZDir = (i: number, dir: DepthDir) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a.zDir = dir })
  // PER-ASSET "z-index" (draw-priority, CSS z-index style) — a higher value draws on top / in front, overriding
  // the positional depth sort. Written to THIS placed tile (persists with the map); the render reads asset.zIndex.
  const setAssetZIndex = (i: number, v: number) =>
    applyToSelectedCells((col, row, grid) => { const a = stackedAssetsAt(grid, col, row)[i]; if (a) a.zIndex = Math.round(v) })
  // PER-ASSET "display" mode (all-faces / single) — how the tile is painted on its block. Written into THIS
  // placed tile's `settings` (persists with the map via the full-asset serialize) alongside the generic
  // fade/cutaway keys; the render reads asset.settings.display. 'all-faces' clears the key so a reset stays
  // byte-identical to a tile that never opted in.
  const setAssetDisplay = (i: number, mode: TileDisplay) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      const rest = { ...(a.settings ?? {}) }
      if (mode === 'single') a.settings = { ...rest, display: 'single' }
      else { delete rest.display; a.settings = rest }
    })
  // PER-ASSET render SHAPE ('square' cube / 'circle' ball) — written to THIS placed tile (persists with the map
  // via the full-asset serialize, like scaleX/pose). The render dispatches on asset.shape in every view.
  // 'square' clears the field so a reset stays byte-identical to a tile that never opted in (like Display).
  const setAssetShape = (i: number, shape: TileShape) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      if (shape === 'square') delete a.shape
      else a.shape = shape
    })
  // PER-ASSET LIGHT setting (intensity/distance/colour/on) — the warm night ground GLOW POOL this tile casts,
  // written to THIS placed tile (persists with the map via the full-asset serialize, like shape). Fans out to
  // the i-th stacked tile of every selected cell. Passing `undefined` clears the setting (back to no pool).
  const setAssetLight = (i: number, light: AssetLight | undefined) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      if (light) a.light = light
      else delete a.light
    })
  // PER-ASSET tile ANIMATIONS (Phase 4) — the LIST authored in the animation modal, written to THIS placed
  // tile (persists with the map via the full-asset serialize, like cellAnim). Anchor start/loop delays at
  // placedAt=0 so a load-triggered loop plays from the clock origin (performance.now() = ms-since-load), the
  // same anchor the composition-default fountain uses. An empty list clears the key so a reset stays
  // byte-identical to a tile that never opted in.
  const setAssetAnimations = (i: number, animations: TileAnim[]) =>
    applyToSelectedCells((col, row, grid) => {
      const a = stackedAssetsAt(grid, col, row)[i]; if (!a) return
      if (animations.length) { a.animations = animations; if (a.placedAt == null) a.placedAt = 0 }
      else { delete a.animations }
    })
  // Inspector "Remove tile" → delete the EXACT selected block (never the floor — removeSelectedBlock no-ops
  // at level 0) from every selected cell, then step the level down so the panel doesn't point past the
  // (now shorter) stack.
  const removeSelectedTile = () => {
    const grid = gridRef.current
    if (!grid) return
    removeSelectedBlock(grid, cellsFromKeys(selectedCells), selectedTileLevel)
    bumpBuildingVersion()
    setSelectedTileLevel(l => Math.max(0, l - 1))
  }

  // ── CANVAS RESIZE HANDLES (Task: "control its size with mouse") ──────────────────────────────────────
  // Drag small grips on the SELECTED tile to resize it directly on the canvas: width→scaleX, height→scaleY,
  // and (iso only) z-width→depth. The grips ride the tile's real recorded silhouette, and every writer here
  // is the SAME one the modal sliders call (setAssetDim / setAssetDepth) — one source of truth, so a drag and
  // the sliders stay in sync live.
  const DIM_DRAG_RANGE = { min: 0.25, max: 5 } as const // matches DimRow's slider (Width/Height)
  const ZWIDTH_DRAG_RANGE = { min: 1, max: 8 } as const // matches ZWidthRow's slider
  const ZWIDTH_PX_PER_CELL = 28 // drag ~28px to add one cell of directional depth

  // The ONE selected ASSET tile that shows resize handles: the focus cell of the selection, at the selected
  // stack level. Handles are for placed asset tiles only (the floor / building blocks / entities size elsewhere)
  // and only in the iso + 2D play views (top view has no recorded silhouette). null → no handles.
  const resizeHandleTarget = (): { col: number; row: number; i: number; asset: GridAsset; heightLevel: number } | null => {
    const grid = gridRef.current
    if (!grid || topViewMode) return null
    const firstKey = selectedCellsRef.current.values().next().value as string | undefined
    if (!firstKey) return null
    const [col, row] = firstKey.split(',').map(Number)
    const stack = getStack(grid, col, row, { entities: entitiesRef.current })
    const lvl = Math.min(Math.max(selectedTileLevelRef.current, 0), stack.length - 1)
    if (lvl < 1 || stack[lvl]?.source !== 'asset') return null
    const i = lvl - 1
    const asset = stackedAssetsAt(grid, col, row)[i]
    if (!asset) return null
    return { col, row, i, asset, heightLevel: asset.heightLevel ?? 0 }
  }

  // The selected tile's handle grips (canvas-internal px) this frame, or null. Reuses the recorded silhouette
  // (tileGeomPolygon) so a grip can never drift from the drawn tile. Read by the RAF draw + the grab hit-test.
  const selectedTileHandles = (): { handles: TileHandle[]; poly: ReturnType<typeof tileGeomPolygon> } | null => {
    const target = resizeHandleTarget()
    if (!target) return null
    const iso = viewTypeRef.current !== '2d'
    const geom = iso ? isoRecordedGeom(target.col, target.row, target.heightLevel) : twoDRecordedGeom(target.col, target.row, target.heightLevel)
    if (!geom) return null
    const poly = tileGeomPolygon(geom)
    return { handles: tileHandlePoints(poly, { zWidth: iso }), poly }
  }

  // Try to GRAB a resize handle at the pointer. On a hit, capture the drag origin + the tile's current scales
  // and its silhouette half-extents (px per 1.0 of scale, so the dragged edge tracks the cursor) and return
  // true — the caller then suppresses pan/select for this gesture.
  const tryStartHandleDrag = (clientX: number, clientY: number): boolean => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const found = selectedTileHandles()
    const target = resizeHandleTarget()
    if (!found || !target) return false
    const rect = canvas.getBoundingClientRect()
    const sx = rect.width ? canvas.width / rect.width : 1
    const sy = rect.height ? canvas.height / rect.height : 1
    const cx = (clientX - rect.left) * sx
    const cy = (clientY - rect.top) * sy
    const hit = handleAtPoint(found.handles, cx, cy, HANDLE_HIT_RADIUS)
    if (!hit) return false
    const b = polyBBox(found.poly)
    const scaleX = target.asset.scaleX ?? 1
    const scaleY = target.asset.scaleY ?? 1
    handleDragRef.current = {
      id: hit.id, i: target.i,
      startCx: cx, startCy: cy, sx, sy,
      startScaleX: scaleX, startScaleY: scaleY, startDepth: target.asset.depth ?? 1,
      baseHalfWpx: Math.max(1, (b.width / 2) / scaleX),
      baseHalfHpx: Math.max(1, (b.height / 2) / scaleY),
    }
    return true
  }

  // Apply an in-progress handle drag: map the pointer delta to the new dimension and write it through the SAME
  // setters the sliders use, so the tile repaints live and the panel reflects it.
  const applyHandleDrag = (clientX: number, clientY: number): void => {
    const d = handleDragRef.current
    const canvas = canvasRef.current
    if (!d || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = (clientX - rect.left) * d.sx
    const cy = (clientY - rect.top) * d.sy
    const outward = dragOutwardPx(d.id, cx - d.startCx, cy - d.startCy)
    if (d.id === 'width') setAssetDim(d.i, 'width', scaleFromDrag(d.baseHalfWpx, d.startScaleX, outward, DIM_DRAG_RANGE))
    else if (d.id === 'height') setAssetDim(d.i, 'height', scaleFromDrag(d.baseHalfHpx, d.startScaleY, outward, DIM_DRAG_RANGE))
    else setAssetDepth(d.i, depthFromDrag(ZWIDTH_PX_PER_CELL, d.startDepth, outward, ZWIDTH_DRAG_RANGE))
  }

  // Draw the selected tile's resize grips on top of the frame (called right after render/render2D). No-op when
  // nothing resizable is selected.
  const drawSelectedTileHandles = (ctx: CanvasRenderingContext2D): void => {
    const found = selectedTileHandles()
    if (found) drawTileHandles(ctx, found.handles)
  }
  // Per-CELL floor dims + pose — the SAME Width/Height/Depth/Zoom, but written to grid.groundDims so they
  // size/pose THIS floor tile (every tile, not just props). setGroundDims merges + bumps groundVersion.
  const setGroundDim = (axis: keyof typeof DIM_FIELD, v: number) =>
    applyToSelectedCells((col, row, grid) => grid.setGroundDims(col, row, { [DIM_FIELD[axis]]: v } as Partial<GroundCellDims>))
  const setGroundPose = (pose: TilePose) =>
    applyToSelectedCells((col, row, grid) => grid.setGroundDims(col, row, { pose }))
  const clearGroundPose = () =>
    applyToSelectedCells((col, row, grid) => grid.setGroundDims(col, row, { pose: undefined }))

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
      __placeComposition?: (kind: string, col: number, row: number) => number
      __armComposition?: (kind: string | null) => void
      __cellSel?: () => { count: number; first: string | null }
      __selectCells?: (keys: string[]) => number
      __applyCellTile?: (tileId: string | null) => void
      __clearRegion?: (col0: number, row0: number, col1: number, row1: number) => void
      __setDebug?: (v: boolean) => void
      __cellLabels?: (col0: number, row0: number, col1: number, row1: number) => unknown
      __stackAt?: (col: number, row: number) => Array<{ label: string; type: string; heightLevel: number; h: number; source: string }>
      __camOffset?: () => { x: number; y: number }
      __stackAsset?: (col: number, row: number, n?: number) => number | null
      __paintTile?: (tileId: string, col: number, row: number) => unknown
      __isoBlockScreen?: (col: number, row: number, level: number) => { x: number; y: number } | null
      __genVillage?: () => { buildings: number }
      __genStage?: (zone: string, variant: string) => { buildings: number }
      __randomizeLayer?: (layer: string) => { buildings: number }
      __randomizeSelected?: () => boolean
      __centerOn?: (col: number, row: number) => void
      __setHero?: (col: number, row: number) => void
      __setDepth?: (col: number, row: number, depth: number, dir: DepthDir) => { col: number; row: number; depth: number; depthDir: DepthDir; cells: { col: number; row: number }[] } | null
      __setZPos?: (col: number, row: number, z: number, dir: DepthDir) => { col: number; row: number; zOffset: number; zDir: DepthDir } | null
      __setShape?: (col: number, row: number, shape: TileShape) => { col: number; row: number; shape: TileShape } | null
      __setDisplay?: (col: number, row: number, mode: TileDisplay) => { col: number; row: number; mode: TileDisplay } | null
      __setLight?: (col: number, row: number, light: AssetLight | null) => { col: number; row: number; light: AssetLight | null } | null
      __pickTileAt?: (clientX: number, clientY: number) => { col: number; row: number; level: number | null; source: string | null } | null
      __cellScreen?: (col: number, row: number, level?: number) => { x: number; y: number } | null
      __tileCentroid?: (col: number, row: number, level?: number) => { x: number; y: number } | null
      __tileHandles?: (col: number, row: number, level?: number) => { id: HandleId; x: number; y: number }[] | null
    }
    win.__camOffset = () => ({ ...camOffsetRef.current })
    // ISO-STACK picking validation seams (same family as __entityScreens, which lands validation clicks via
    // the real cellToScreen). __stackAsset pushes N boulders onto a cell so it becomes a real lifted stack;
    // __isoBlockScreen returns the VIEWPORT pixel a given stack level is drawn at (mirroring the iso render's
    // projection + isoStackLift) so a validation click can land dead-centre on the top block and prove the
    // height-aware pick selects the STACKED cell, not the ground cell under it.
    win.__stackAsset = (col: number, row: number, n = 1) => {
      const g = gridRef.current
      if (!g) return null
      for (let k = 0; k < n; k++) {
        const top = g.getAssetsAtCell(col, row).reduce((m, a) => Math.max(m, a.heightLevel ?? 0), -1)
        g.placeAsset(['🪨'], col, row, { type: 'rock', blocking: true, color: '#8a8a8a', tileOverride: 'emoji:boulder', heightLevel: top + 1 })
      }
      return g.getAssetsAtCell(col, row).length
    }
    // PAINT validation seam: place a palette tile (by id) through the SAME brush the armed click uses
    // (placementFor → placeGroundTile / stackAssetTile), so "a painted tile is a real editable block" is
    // proved deterministically without a flaky headless canvas click. Returns the topmost placed asset's
    // render-relevant fields (height/type/tileOverride/settings/depth) for a data assertion.
    win.__paintTile = (tileId: string, col: number, row: number) => {
      const g = gridRef.current
      if (!g) return null
      const style = activeStyleRef.current
      const groups = tilesForStyle(style.id)
      const tile = ([] as TileDef[]).concat(groups.terrain, groups.buildings, groups.units, groups.nature).find(t => t.id === tileId)
      if (!tile) return { error: `no palette tile ${tileId} in ${style.id}` }
      const route = placementFor(tile)
      if (route === 'terrain') placeGroundTile(g, col, row, tile)
      else if (route === 'asset') stackAssetTile(g, col, row, tile)
      bumpBuildingVersion()
      const a = g.getAssetsAtCell(col, row).at(-1)
      return {
        route,
        tileHeight: tile.height ?? null,
        tileSettings: tile.settings ?? null,
        asset: a ? { type: a.type, label: a.label ?? null, height: a.height ?? null, tileOverride: a.tileOverride ?? null, depth: a.depth ?? null, depthDir: a.depthDir ?? null, settings: a.settings ?? null, blocking: a.blocking ?? false } : null,
      }
    }
    win.__isoBlockScreen = (col: number, row: number, level: number) => {
      const canvas = canvasRef.current
      const grid = gridRef.current
      if (!canvas || !grid) return null
      const cs = grid.cellSize
      const eff = grid.isoScale * isoZoomRef.current
      const S = eff * 0.71
      const T = eff * 0.36
      const pPad = canvas.width / (2 * cs * S)
      const qPad = canvas.height / (2 * cs * T)
      const rawFc = (playerRef.current.x - camOffsetRef.current.x) / cs
      const rawFr = (playerRef.current.z - camOffsetRef.current.y) / cs
      const { fc, fr } = playModeRef.current ? isoCameraFocus(rawFc, rawFr, pPad, qPad, grid.cols, grid.rows) : { fc: rawFc, fr: rawFr }
      const wx = col * cs - fc * cs
      const wz = row * cs - fr * cs
      const px = canvas.width / 2 + (wx - wz) * S
      const py = canvas.height / 2 + (wx + wz) * T
      const cy = py - grid.getHeight(col, row) * (cs * eff * 0.4) - level * (cs * S) * ISO_BLOCK_H_FRAC
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width ? rect.width / canvas.width : 1
      const sy = canvas.height ? rect.height / canvas.height : 1
      return { x: rect.left + px * sx, y: rect.top + cy * sy }
    }
    // INVERTED-PICK validation seams: `__pickTileAt` resolves a client pixel to the TILE the pick returns (the
    // SAME pickCellForSelect a click uses — the transform-aware recorded silhouette), so a validation click can
    // prove pixel→tile in ANY view. `__cellScreen` returns the on-screen pixel of a tile's body at (col,row,level)
    // in the ACTIVE view (iso reuses __isoBlockScreen; 2D lifts the cell centre by the level stack) so a click
    // can be aimed at a raised tile in either view.
    win.__pickTileAt = (clientX: number, clientY: number) => {
      const r = pickCellForSelect(clientX, clientY)
      return r ? { col: r.col, row: r.row, level: r.level ?? null, source: r.source ?? null } : null
    }
    win.__cellScreen = (col: number, row: number, level = 0) => {
      if (!topViewMode && viewTypeRef.current !== '2d') return win.__isoBlockScreen!(col, row, level) // iso
      const base = cellToScreen(col, row)
      if (!base) return null
      if (viewTypeRef.current === '2d') return { x: base.x, y: base.y - level * (24 * zoomRef.current * 0.9) } // lift onto the stacked tile body
      return base
    }
    // The EXACT screen centre (client coords) of the tile RENDERED at (col,row,level) this frame — the centroid
    // of its recorded silhouette. Guarantees a validation click lands dead-on the tile (iso or 2D), regardless of
    // its transform. null when the tile wasn't drawn (off-screen / wrong view).
    win.__tileCentroid = (col: number, row: number, level = 0) => {
      const canvas = canvasRef.current
      if (!canvas || topViewMode) return null
      const geom = viewTypeRef.current === '2d' ? twoDRecordedGeom(col, row, level) : isoRecordedGeom(col, row, level)
      if (!geom) return null
      const { x: cx, y: cy } = tileGeomCentroid(geom) // the SAME centre the lamp-glow anchor uses (one source of truth)
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width ? rect.width / canvas.width : 1
      const sy = canvas.height ? rect.height / canvas.height : 1
      return { x: rect.left + cx * sx, y: rect.top + cy * sy }
    }
    // RESIZE-HANDLE validation seam: the CLIENT-coord grip points on the tile at (col,row,level) this frame —
    // the SAME points the RAF draws + the mouse grab hit-tests (from the recorded silhouette). Lets a
    // validation drag grab a handle dead-on and prove the drag→size mapping. null when the tile isn't drawn.
    win.__tileHandles = (col: number, row: number, level = 0) => {
      const canvas = canvasRef.current
      if (!canvas || topViewMode) return null
      const iso = viewTypeRef.current !== '2d'
      const geom = iso ? isoRecordedGeom(col, row, level) : twoDRecordedGeom(col, row, level)
      if (!geom) return null
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width ? rect.width / canvas.width : 1
      const sy = canvas.height ? rect.height / canvas.height : 1
      return tileHandlePoints(tileGeomPolygon(geom), { zWidth: iso }).map(h => ({ id: h.id, x: rect.left + h.x * sx, y: rect.top + h.y * sy }))
    }
    // UNIFIED-TILE picking validation seams: generate a REAL town (has buildings) and dump each building's
    // footprint so a validation click can land on an actual WALL block / the door — proving the building's
    // blocks pick as tiles through the SAME path as a prop, not a synthetic rock stack.
    // `buildings` counts the stamped building-composition TILES (a town stamps many) — buildings are plain
    // tiles now, so this proves a town has them without a grouped-building metadata array.
    const countBuildingTiles = (g: IsometricGrid | null): number =>
      g ? g.assets.filter(a => /^(house|big_house|store|hospital|temple|cathedral|castle)_\d+$/.test(a.type)).length : 0
    win.__genVillage = () => { generateStageInEditor('spring', 'town'); return { buildings: countBuildingTiles(gridRef.current) } }
    win.__genStage = (zone: string, variant: string) => { generateStageInEditor(zone as ZoneId, variant as VariantId); return { buildings: countBuildingTiles(gridRef.current) } }
    // Re-roll ONE generation layer over the current map (the Generate menu's scoped randomize) — a
    // validation seam mirroring the menu buttons: layout / buildings / nature / decor / units.
    win.__randomizeLayer = (layer: string) => { randomizeLayerInEditor(layer as LayerId); return { buildings: countBuildingTiles(gridRef.current) } }
    // Re-roll the current SELECTION's random attributes (Stage 3 micro-randomize) — validation seam.
    win.__randomizeSelected = () => { randomizeSelected(); return true }
    // Centre the iso camera on a cell so a validation click lands on-screen (the same camOffset the render +
    // pick read); mirrors the raw dev-mode focus fc=(playerX-camOffsetX)/cs.
    win.__centerOn = (col: number, row: number) => {
      const grid = gridRef.current
      if (!grid) return
      const cs = grid.cellSize
      const off = { x: playerRef.current.x - col * cs, y: playerRef.current.z - row * cs }
      camOffsetRef.current = off
      setCamOffset(off)
    }
    // Move the hero to a cell — validates proximity-driven render (building fade + roof cutaway) deterministically.
    win.__setHero = (col: number, row: number) => {
      const grid = gridRef.current
      if (!grid) return
      playerRef.current.x = col * grid.cellSize + grid.cellSize / 2
      playerRef.current.z = row * grid.cellSize + grid.cellSize / 2
    }
    // DIRECTIONAL-DEPTH validation seam: set `depth` + `depthDir` on the TOPMOST block at (col,row) so it
    // extrudes into a long iso box along one of the four diagonals, mark collision on every covered cell
    // (walk into any = blocked; anchor stays the base cell), and bump a redraw. Returns what it set + the
    // covered cells, so the render can be driven deterministically in all four directions. Same family as
    // __stackAsset / __setHero (mutates the grid in place, then bumpBuildingVersion re-renders from it).
    win.__setDepth = (col: number, row: number, depth: number, dir: DepthDir) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1) // topmost stacked asset at the cell
      if (!a) return null
      a.depth = depth
      a.depthDir = dir
      const cells = depthCells(col, row, depth, dir)
      for (const c of cells) g.setCollision(c.col, c.row, true)
      bumpBuildingVersion()
      return { col, row, depth, depthDir: dir, cells }
    }
    // Z-POSITION validation seam: set `zOffset` (magnitude in cells) + `zDir` (which iso diagonal) on the TOPMOST
    // block at (col,row) so it SLIDES along that diagonal (+z toward dir, −z opposite), then bump a redraw.
    // Returns what it set so the render can be driven deterministically in all four directions. Same family as
    // __setDepth (mutates the grid in place, then bumpBuildingVersion re-renders from it).
    win.__setZPos = (col: number, row: number, z: number, dir: DepthDir) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1) // topmost stacked asset at the cell
      if (!a) return null
      a.zOffset = z
      a.zDir = dir
      bumpBuildingVersion()
      return { col, row, zOffset: z, zDir: dir }
    }
    // SHAPE validation seam: set `shape` on the TOPMOST block at (col,row) so it renders as a ball ('circle')
    // instead of a cube, then bump a redraw — the deterministic hook the shape-render validation drives. Same
    // family as __setDepth/__setZPos (mutates the grid in place, then bumpBuildingVersion re-renders from it).
    win.__setShape = (col: number, row: number, shape: TileShape) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1) // topmost stacked asset at the cell
      if (!a) return null
      if (shape === 'square') delete a.shape
      else a.shape = shape
      bumpBuildingVersion()
      return { col, row, shape }
    }
    // Per-instance DISPLAY validation seam (sibling of __setShape): set the topmost asset's Display mode
    // (all-faces vs single) so a headless render can prove Display actually applies to a painted block.
    win.__setDisplay = (col: number, row: number, mode: TileDisplay) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1)
      if (!a) return null
      const rest = { ...(a.settings ?? {}) }
      if (mode === 'single') a.settings = { ...rest, display: 'single' }
      else { delete rest.display; a.settings = Object.keys(rest).length ? rest : undefined }
      bumpBuildingVersion()
      return { col, row, mode }
    }
    // Per-instance LIGHT validation seam (sibling of __setShape): set/clear the topmost asset's night glow
    // pool light so a headless render can prove distance/intensity drive the pool. Mirrors setAssetLight.
    win.__setLight = (col: number, row: number, light: AssetLight | null) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1)
      if (!a) return null
      if (light) a.light = light
      else delete a.light
      bumpBuildingVersion()
      return { col, row, light }
    }
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
    // Dump a cell's tile STACK (getStack — the SAME projection select/edit read): label + heightLevel + block
    // height per entry, so "is this tile a selectable BLOCK (heightLevel≥1 / h≥1) or a flat prop" is DATA, not a guess.
    win.__stackAt = (col: number, row: number) => {
      const grid = gridRef.current
      if (!grid) return []
      return getStack(grid, col, row).map(t => ({ label: t.label ?? t.slug ?? '', type: t.type ?? String(t.source), heightLevel: t.heightLevel ?? 0, h: t.h ?? 0, source: String(t.source) }))
    }
    win.__cellSel = () => ({ count: selectedCellsRef.current.size, first: Array.from(selectedCellsRef.current)[0] ?? null })
    win.__selectCells = (keys: string[]) => { setSelectedCells(new Set(keys)); setSelectedEntityId(null); return keys.length }
    win.__applyCellTile = (tileId: string | null) => setSelectionOverride(tileId)
    win.__clearRegion = (col0: number, row0: number, col1: number, row1: number) => {
      const g = gridRef.current
      if (!g) return
      checkpointHistory() // clearing a region is a map edit → snapshot so Ctrl+Z brings it back
      for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) { g.setGround(c, r, 'grass'); g.setCollision(c, r, false) }
      g.removeAssetsWhere(a => a.col >= col0 && a.col <= col1 && a.row >= row0 && a.row <= row1)
      bumpBuildingVersion()
    }
    // Building validation seams: stamp a pre-built building COMPOSITION (place tool) or any composition
    // directly — so "add a pre-built building = stamp its cells like a tree" is validated in the real editor.
    win.__placeBuilding = (type: string, col: number, row: number) => placeNewBuilding(type as BuildingType, col, row)
    // Route the validation hook through the REAL place path (clicked cell = footprint CENTRE, replace-anything,
    // history checkpoint) so the demo exercises exactly what a user click does — not a raw anchor-stamp.
    win.__placeComposition = (kind: string, col: number, row: number) => placeComposition(kind, col, row)
    // Arm (or disarm) the Tile-composition tool by KIND — switches into the composition mode (editorMode derives
    // from a truthy buildingTool) so the palette shows + the ghost previews on hover. For the demo/validation.
    win.__armComposition = (kind: string | null) => { setPaintMode(false); setEntityTool(null); setConnectorMode(false); setBuildingTool(kind); if (!kind) ghostRef.current = null }
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
      // `animations` is the render projection (sprite subset); `unitAnimations` is the unified authored list a
      // unit now stores (settings + sprite kinds) — reported so validation can confirm a settings anim persisted.
      return {
        selectedId: id, found: true, kind: e.kind, variant: e.variant ?? null, name: e.name,
        animations: (e.animations ?? []).map(a => ({ name: a.name, frames: a.frames.map(f => f.char ?? f.tileId ?? '(base)') })),
        unitAnimations: (e.unitAnimations ?? []).map(a => ({ name: a.name, kind: a.kind })),
      }
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
        if (!a.type?.startsWith('tree')) continue // tree_small / tree_dead composition cells
        const d = (a.col - pc) ** 2 + (a.row - pr) ** 2
        if (d < bestD) { bestD = d; best = { col: a.col, row: a.row } }
      }
      if (!best) return null
      setSelectedEntityId(null)
      setSelectedCells(new Set([`${best.col},${best.row}`]))
      return best
    }
    return () => { delete win.__setArtStyle; delete win.__selectFirstTreeCell; delete win.__setView; delete win.__gridKinds; delete win.__entityInfo; delete win.__entityScreens; delete win.__selectEntity; delete win.__setEntitySize; delete win.__scatter; delete win.__selectedEntityInfo; delete win.__placeBuilding; delete win.__placeComposition; delete win.__armComposition; delete win.__cellSel; delete win.__selectCells; delete win.__applyCellTile; delete win.__clearRegion; delete win.__setDebug; delete win.__cellLabels; delete win.__stackAt; delete win.__camOffset; delete win.__stackAsset; delete win.__paintTile; delete win.__isoBlockScreen; delete win.__genVillage; delete win.__genStage; delete win.__randomizeLayer; delete win.__randomizeSelected; delete win.__centerOn; delete win.__setHero; delete win.__pickTileAt; delete win.__cellScreen; delete win.__tileCentroid; delete win.__tileHandles; delete win.__setShape; delete win.__setDisplay; delete win.__setLight }
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

  // ◈ Unit → Scatter: randomize several of the PICKED creature into the free space (each with the picked art
  // pinned + a real patrol from the spawner, so they wander). No pick → the mixed enemies+NPCs scatter above.
  const scatterUnits = () => {
    const grid = gridRef.current
    if (!grid) return
    if (!unitTile) { checkpointHistory(); randomizeEntities(); return }
    const slug = tileSlug(unitTile.id)
    const kind = entityKindForUnitSlug(slug)
    if (kind === 'player') { toast('Only one player — use Add to place the hero', 'warning'); return }
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r)),
    )
    checkpointHistory() // a scatter adds many units at once → snapshot so one Ctrl+Z removes the whole batch
    setEntities(prev => {
      const occupied = prev.map(e => ({ col: e.col, row: e.row }))
      const spawned = scatterEntities({
        collision,
        occupied,
        count: 8,
        kinds: kind === 'npc' ? ['npc'] : ['enemy'],
        enemyTypes: kind === 'npc' ? undefined : [slug], // a single home zone of the picked enemy type
        idPrefix: `scatter-${slug}-${prev.length}`,
      }).map(e => ({ ...e, tileOverride: unitTile.id })) // pin the picked figure's exact art
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

  // ── Minecraft-style tile brush (Paint mode) ─────────────────────────
  // Pick a tile from the DB catalog palette → it becomes the ARMED brush; each canvas LEFT-click PLACES
  // it, routed by the tile's CATEGORY through the pure tilePlacement module. One general path for every
  // content type (terrain / nature / buildings / units). The exact tile always renders because we pin
  // `tileOverride = tile.id` on the placed asset/entity (terrain resolves via its slug's groundKind).

  /** Arm a palette tile as the placement brush; clicking the SAME tile again (or Disarm / Esc) clears it.
   *  One brush at a time. */
  const armTile = (tile: TileDef | null) => {
    setArmedTile(prev => (tile && prev?.id === tile.id ? null : tile))
  }

  /** units → place an ENTITY (player / npc / enemy by slug), pinning the exact figure via tileOverride.
   *  Reuses the entity factories + the canPlaceEntity guard. `animated` places it wandering with a randomized
   *  movement animation; otherwise it's pinned STILL (the ◈ Unit motion toggle). Returns whether it placed. */
  const placeUnitTile = (col: number, row: number, tile: TileDef, opts?: { animated?: boolean }): boolean => {
    const grid = gridRef.current
    if (!grid) return false
    const slug = tileSlug(tile.id)
    const kind = entityKindForUnitSlug(slug)
    const collisionFn = (c: number, r: number) => !!grid.collision[r]?.[c]
    // The hero is the controlled character — motion is authored, not randomized — so the toggle is ignored here.
    if (kind === 'player') {
      const base = entitiesRef.current.filter(e => e.kind !== 'player')
      if (!canPlaceEntity(base, col, row, grid.cols, grid.rows, collisionFn)) return false
      setEntities(placeEntity(base, { ...makePlayer(mintEntityId('player'), col, row), tileOverride: tile.id }))
      movePlayerToValidSpawn(col, row)
      return true
    }
    const motion = <T extends Entity>(ent: T): T => (opts?.animated ? withRandomMotion(ent) : withStaticMotion(ent))
    let placed = false
    setEntities(prev => {
      if (!canPlaceEntity(prev, col, row, grid.cols, grid.rows, collisionFn)) return prev
      const base: Entity = kind === 'enemy'
        ? { ...makeEnemy(mintEntityId('enemy'), col, row, slug, { archetype: archetypeForEnemyType(slug) }), tileOverride: tile.id }
        : { ...makeNpc(mintEntityId('npc'), col, row, {}), tileOverride: tile.id }
      placed = true
      return placeEntity(prev, motion(base))
    })
    return placed
  }

  /** Place a tile on ONE cell, routed by its category via placementFor. Terrain + asset stacking delegate to
   *  the pure tileBrush module (reuses the grid primitives); units place an entity here. Defaults to the armed
   *  brush tile (the left Paint tool), but takes an explicit `tile` so the right-sidebar "paint the selection"
   *  flow lands through the EXACT SAME path — no fork. */
  const placeArmedTileAt = (col: number, row: number, tile: TileDef | null = armedTile) => {
    const grid = gridRef.current
    if (!grid || !tile) return
    const route = placementFor(tile)
    if (route === 'terrain') { placeGroundTile(grid, col, row, tile); return }
    if (route === 'entity') { placeUnitTile(col, row, tile); return }
    stackAssetTile(grid, col, row, tile)
  }

  /** Deliverable #4 — PAINT a chosen tile onto the whole selected area from the right sidebar. Reuses the
   *  SAME per-cell placement the left Paint tool runs (`placeArmedTileAt`), so the two coexist and behave
   *  identically; only the ENTRY differs (a Tile Library pick vs. an armed-brush click). Snapshots history so
   *  Ctrl+Z reverts the whole fill, and keeps the selection so the button relabels Add→Replace and you can
   *  keep painting. */
  const paintTileOnSelection = (tile: TileDef) => {
    const grid = gridRef.current
    const cells = cellsFromKeys(selectedCells)
    if (!grid || cells.length === 0) return
    checkpointHistory()
    for (const { col, row } of cells) placeArmedTileAt(col, row, tile)
    bumpBuildingVersion()
  }

  /** Deliverable #1 — CLEAR every tile off the selected cell(s) so they go BARE: pop each stacked asset via
   *  the SAME erase primitive ⌥Alt-click uses (`removeTopAsset`, which re-derives collision) AND clear the
   *  cell's GROUND/floor tile (a road/terrain/plaza is a floor tile too — `clearGroundTile` resets it to the
   *  bare default, uniformly, with NO branch on tile type). Then reset collision to walkable, so the cell is
   *  the same bare state a freshly-initialised one has (mirrors __clearRegion). Snapshots history first, so
   *  Ctrl+Z restores BOTH the stacked tiles and the cleared road. */
  const clearTilesOnSelection = () => {
    const grid = gridRef.current
    const cells = cellsFromKeys(selectedCells)
    if (!grid || cells.length === 0) return
    checkpointHistory()
    for (const { col, row } of cells) {
      while (removeTopAsset(grid, col, row)) { /* pop the stacked assets until none remain */ }
      clearGroundTile(grid, col, row) // clear the road/ground tile too, so the cell is truly EMPTY
      grid.setCollision(col, row, false) // a bare cell is walkable
    }
    bumpBuildingVersion()
    setSelectedTileLevel(0)
  }

  /** ⌥Alt-click removal for the armed brush. With a `level` (a single click that landed on a raised block)
   *  → remove THAT block, not blindly the top; without one (a bulk selection) → remove the cell's top asset.
   *  Collision is re-derived by the tileBrush module either way. */
  const removeAssetAt = (col: number, row: number, level?: number) => {
    const grid = gridRef.current
    if (!grid) return
    if (level !== undefined) removeAssetAtLevel(grid, col, row, level)
    else removeTopAsset(grid, col, row)
  }

  /** The armed-brush action for a canvas click: apply to the whole multi-cell SELECTION when there is one
   *  (bulk — "select a tile, multi-select 4 cells → 4 trees"), else to the single clicked cell. Alt removes
   *  the top asset; otherwise it places. The brush STAYS armed (keep clicking); a bulk fill then clears the
   *  selection so the next single click paints just one cell. */
  const applyArmedBrush = (cell: { col: number; row: number; level?: number }, alt: boolean) => {
    if (!armedTile) return
    checkpointHistory() // paint / stack / alt-erase is a map edit → snapshot so Ctrl+Z reverts the stroke
    const selected = cellsFromKeys(selectedCellsRef.current)
    const targets: { col: number; row: number; level?: number }[] = selected.length ? selected : [cell]
    for (const t of targets) {
      // A bulk selection has no per-cell level → removeAssetAt pops the top (unchanged); a single click on a
      // raised block carries its level → that exact block is removed.
      if (alt) removeAssetAt(t.col, t.row, t.level)
      else placeArmedTileAt(t.col, t.row)
    }
    if (selected.length) setSelectedCells(new Set())
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
    grid.clearAssets()

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
        grid.removeAssetsWhere(a => {
          const inClearing = a.col >= cx - 4 && a.col < cx + 5 && a.row >= cy - 4 && a.row < cy + 5
          return inClearing && a.type === 'tree'
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
        grid.removeAssetsWhere(a => {
          const atGate = a.col >= cx - 2 && a.col < cx + 3 && a.row >= rows - 5
          return atGate
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
        grid.removeAssetsWhere(a => {
          const inVillage = a.col >= cx - 5 && a.col < cx + 6 && a.row >= cy - 5 && a.row < cy + 6
          return inVillage && a.type === 'tree'
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
  // `buildingSalt` shifts the per-footprint material/roof/wall-colour hash so a "randomize buildings
  // only" re-roll repaints the town's buildings (new materials + roof/wall tones) while the geometry
  // — a plot decision — stays put. 0 (the default) reproduces the un-salted look.
  const applyStageToGrid = (stage: StageData, grid: IsometricGrid, buildingSalt = 0) => {
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        grid.setGround(c, r, stage.ground[r]?.[c] ?? 'ash')
        grid.setHeight(c, r, 0)
        grid.setCollision(c, r, !!stage.collision[r]?.[c])
      }
    }
    grid.clearAssets()
    const paint = stagePaint(stage)
    for (const g of paint.ground) {
      if (grid.ground[g.row]?.[g.col] !== undefined) grid.setGround(g.col, g.row, g.type)
    }
    // Pin each generated prop to the SAME curated catalog tile the palette brush uses, per zone + role
    // (trees, flowers, floor-litter, rocks, mushrooms) — instead of the generic per-kind EMOJI_TILESET
    // fallback — so the RANDOMIZER's assets MATCH what the palette offers. VISUAL-ONLY: the override
    // reskins the glyph; the prop's own collision/height are untouched.
    // Trade-off: trees now wear the SEASON's curated species tile (🌸 spring / 🌳 summer / 🍁 autumn /
    // 🪾 winter / 🌵 desert / 🌴 beach) rather than one 🌲 recoloured per season — so per-tree seasonal
    // TONAL variety is dropped in favour of a distinct, palette-matching species per season.
    for (const a of paint.assets) {
      const override = stagePropTileOverride(stage.zone, a.type)
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
    // A BUILDING is just TILES: stamp each GENERATED building as its backend COMPOSITION's per-cell tiles by
    // its authoritative kind (stampBuildingKind → one asset per cell+level of house_4 / store_5 / …), rotated
    // to face its road — the SAME stamp trees use. b.col + b.row are the footprint TOP-LEFT-col and BOTTOM row,
    // so back the row off its height to anchor the composition at the footprint top-left.
    // A building uses ONE wall material — variety is BETWEEN buildings, not within one. A RESIDENTIAL building
    // (house / big-house) picks its material at generation from the palette; store/hospital/office/civic keep
    // their FIXED identity material. The pick is derived from the footprint position so a re-stamp of the same
    // stage is stable (no per-frame flicker) while neighbours still differ.
    const HOUSE_MATERIALS = ['wall_brick', 'wall_wood', 'wall_stone']
    // Colour is a per-tile SETTING that FILTERS the baked tile (composition.ts / render tintedImage), so we
    // recolour buildings by their colour value — no new tiles. ROOF colour randomizes for every type EXCEPT
    // the two FIXED-identity buildings; WALL colour randomizes for RESIDENTIAL only (others keep their
    // material's own tone). store/hospital get FIXED colours so they stay identifiable. Every roll is derived
    // from the footprint position (like the material roll) so a re-stamp of the same stage is stable, while
    // neighbours differ — and roof/wall use DIFFERENT hashes so a house's roof and walls vary independently.
    const ROOF_COLORS = ['#b5533a', '#5a636b', '#5c4433', '#4a6a7a'] // terracotta, slate-grey, brown, blue-grey
    const WALL_COLORS = ['#9e4b3b', '#c9a66b', '#e8dcc0', '#8a8580', '#a89f7a'] // brick, sandstone, cream, warm-grey, olive-beige
    const STORE_ROOF = '#235a96', HOSPITAL_ROOF = '#2f7e50', FIXED_WALL = '#f0f0ea' // store blue / hospital green / white walls
    const pick = (arr: string[], seed: number): string => arr[(((seed % arr.length) + arr.length) % arr.length)]
    for (const b of stage.buildings) {
      const anchorRow = b.row - (b.height - 1)
      const residential = b.type === 'house' || b.type === 'big-house'
      const material = residential ? pick(HOUSE_MATERIALS, b.col * 31 + b.row * 17 + buildingSalt) : undefined
      let roofColor: string | undefined
      let wallColor: string | undefined
      if (b.type === 'store') { roofColor = STORE_ROOF; wallColor = FIXED_WALL }
      else if (b.type === 'hospital') { roofColor = HOSPITAL_ROOF; wallColor = FIXED_WALL }
      else {
        roofColor = pick(ROOF_COLORS, b.col * 13 + b.row * 7 + buildingSalt)
        wallColor = residential ? pick(WALL_COLORS, b.col * 23 + b.row * 29 + buildingSalt) : undefined
      }
      // Stamp by the building's AUTHORITATIVE composition kind (derived from the facade length at plan time),
      // NOT re-derived from b.length: b.length is the grid COL-SPAN, which for an east/west-facing plot is the
      // DEPTH, not the facade length — deriving the kind from it asks for a non-existent composition
      // (hospital_4 / big_house_4 / temple_4) → 0 cells stamped → a foundation with NO building (Image #42).
      stampBuildingKind(grid, b.kind, b.col, anchorRow, stage.zone, b.facing, material, roofColor, wallColor)
    }
    // A TREE is just TILES too: stamp each recorded tree ANCHOR as a rich stacked composition
    // (stampComposition → one asset per cell+level of tree_small / tree_dead), the SAME per-block path
    // buildings use — so every generated tree is 100% backend DB tiles AND each tile is individually
    // selectable. The generator recorded anchors (stage.trees) instead of baking flat tree props (TreeAnchor).
    for (const t of stage.trees ?? []) stampComposition(grid, t.kind, t.col, t.row, stage.zone, t.variant)
    // A FOUNTAIN is just TILES too: stamp each recorded composition ANCHOR (the plaza fountain — rim +
    // water + jets) through the SAME path, so it's per-cell backend tiles, not a special drawer/prop.
    for (const c of stage.compositions ?? []) stampComposition(grid, c.kind, c.col, c.row, stage.zone, c.variant ?? 0)
  }

  /** Promote the generators' decorative ☺ NPC assets into REAL npc entities: a generated town's
   *  wanderers become SELECTABLE units that carry a male/female variant (alternating), instead of
   *  genderless ☺ props that always render neutral (the "no female units" gap). The bare `type:'npc'`
   *  assets are removed and entities take their place, rendering through the gendered entity path.
   *  Real saved entities (type 'nebulith:entity') are never matched, so this never touches them. */
  const promoteNpcAssetsToEntities = (grid: IsometricGrid): Entity[] => {
    const bare = grid.assets.filter(a => a.type === 'npc')
    if (bare.length === 0) return []
    grid.removeAssetsWhere(a => a.type === 'npc')
    return bare.map((a, i) => ({
      ...makeNpc(mintEntityId('npc'), a.col, a.row, { name: `Wanderer ${i + 1}` }),
      variant: (i % 2 === 0 ? 'male' : 'female') as 'male' | 'female',
    }))
  }

  // ── macro RANDOMIZE: whole map + per-layer scopes (GENERATION-SPEC §5) ──────
  // The recipe of the last full generate — zone/variant/size + the per-layer SEEDS. Re-rolling one
  // layer changes only that layer's seed and regenerates: the rest, fed the same seeds, reproduce.
  const lastGenRef = useRef<{ zone: ZoneId; variant: VariantId; cols: number; rows: number; seeds: Record<'layout' | 'buildings' | 'nature' | 'decor', number> } | null>(null)
  // Salts the per-building material/roof/wall-colour hash so "randomize buildings only" repaints.
  const buildingSaltRef = useRef(0)
  const randSeed = (): number => (Math.random() * 0x7fffffff) | 0

  /** Strip a full stage down to just its LAYOUT — roads + reserved plots — dropping every structure
   *  and all nature, and rebuilding collision to block ONLY the plot footprints. This is the user's
   *  "randomize just the MAP which contains the distribution of things without actual structures nor
   *  nature": you see the streets + the plots the buildings would sit on, nothing stamped on them. */
  const stripToLayout = (stage: StageData): StageData => {
    const collision = stage.collision.map(row => row.map(() => false))
    for (const b of stage.buildings) {
      const top = b.row - (b.height - 1)
      const doors = new Set(b.doorCells.map(d => `${d.col},${d.row}`))
      for (let r = top; r <= b.row; r++) {
        for (let c = b.col; c < b.col + b.length; c++) {
          if (r >= 0 && r < stage.rows && c >= 0 && c < stage.cols && !doors.has(`${c},${r}`)) collision[r][c] = true
        }
      }
    }
    return { ...stage, collision, buildings: [], trees: [], compositions: [], props: [] }
  }

  /** Re-scatter ONLY the units layer over the current map: drop the previous enemies/townsfolk (keep
   *  the player), then re-seed the archetype-appropriate roster — the "randomize units only" scope. */
  const reseedUnits = (grid: IsometricGrid, variant: VariantId) => {
    const settled = variant !== 'cave' && variant !== 'temple'
    const townCount = variant === 'city' ? 14 : variant === 'town' ? 8 : 5
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r)),
    )
    setEntities(prev => {
      const kept = byKind(prev, 'player')
      const townsfolk = settled
        ? scatterEntities({ collision, occupied: kept.map(e => ({ col: e.col, row: e.row })), count: townCount, kinds: ['npc'], idPrefix: `town-${Date.now()}` })
        : []
      return [...kept, ...townsfolk]
    })
    if (variant === 'cave') seedStageEnemies(grid, CAVE_ENEMY_TYPES, 'cave')
    if (variant === 'temple') seedStageEnemies(grid, TEMPLE_ENEMY_TYPES, 'temple')
  }

  /**
   * Re-roll ONE generation layer over the current map, leaving the others intact (the Generate ▾
   * scoped randomize). Only the requested layer's seed changes; the untouched layers, fed the same
   * seeds, regenerate identically, so visually only that layer moves. `units` re-scatters entities
   * without regenerating the map. Non-settlement archetypes (forest/cave/temple/boss) aren't
   * decomposed into layers, so any scope there re-rolls the whole archetype via its layout rng.
   */
  const randomizeLayerInEditor = (layer: LayerId) => {
    const grid = gridRef.current
    const recipe = lastGenRef.current
    if (!grid) return
    if (!recipe) { generateStageInEditor(genZone, 'town'); return } // nothing generated yet → a full town
    if (layer === 'units') { reseedUnits(grid, recipe.variant); bumpBuildingVersion(); return }

    const isSettlement = recipe.variant === 'town' || recipe.variant === 'city'
    // Non-settlement archetypes read only the layout rng, so route every scope through it there.
    const engineLayer = isSettlement ? layer : 'layout'
    const seeds = { ...recipe.seeds, [engineLayer]: randSeed() }
    lastGenRef.current = { ...recipe, seeds }
    if (layer === 'buildings' && isSettlement) buildingSaltRef.current = randSeed() // repaint the buildings

    const full = generateStage({ zone: recipe.zone, variant: recipe.variant, cols: recipe.cols, rows: recipe.rows, seeds })
    const stage = layer === 'layout' && isSettlement ? stripToLayout(full) : full
    applyStageToGrid(stage, grid, buildingSaltRef.current)
    // Keep the player on walkable ground (new trees/plots may sit where they stood); entities stay put.
    const here = livePlayerCell()
    movePlayerToValidSpawn(here.col, here.row)
    setSelectedCells(new Set())
    bumpBuildingVersion()
  }

  // ── micro RANDOMIZE: re-roll the random attributes of the SELECTION (Stage 3) ──────
  // The person-figure variants a unit can wear (EntityVariant); a re-roll picks a DIFFERENT one.
  const PERSON_VARIANTS = ['male', 'female', 'old', 'child', 'alien', 'robot'] as const
  /** A new colour for a placed tile drawn from ITS OWN role palette (never an arbitrary colour): rock
   *  shades, mushroom tones, the zone's flowers; anything else gets a coherent tonal variant of its
   *  current colour (the same per-cell tinting the generator uses). Null → leave the colour alone. */
  const rerollTileColor = (asset: GridAsset, zone: ZoneId, rand: () => number): string | null => {
    const pickFrom = (arr: readonly string[]): string => arr[Math.floor(rand() * arr.length)]
    const t = asset.type ?? ''
    if (t === 'rock') return pickFrom(ROCK_SHADES)
    if (t === 'mushroom') return pickFrom(MUSHROOM_TONES)
    if (t === 'flower') return pickFrom((ZONE_FLOWERS[zone] ?? DEFAULT_FLOWERS).map(f => f.color))
    return asset.color ? varyIntensity(asset.color, rand()) : null // a tonal variant of the tile's own tone
  }

  /** Re-roll a UNIT's random attributes: a different person variant (NPCs) + a fresh wander animation
   *  (reuses randomMovementAnimation). The player is left alone (its figure/animation are hero-driven). */
  const randomizeSelectedUnit = (id: string, rand: () => number) => {
    setEntities(prev => prev.map(e => {
      if (e.id !== id || e.kind === 'player') return e
      const anim = randomMovementAnimation()
      const others = PERSON_VARIANTS.filter(v => v !== e.variant)
      const variant = e.kind === 'npc' ? others[Math.floor(rand() * others.length)] : e.variant
      return { ...e, variant, animations: [anim], unitAnimations: unitAnimationsFromEntity([anim]) }
    }))
  }

  /** Re-roll each SELECTED cell's active tile: a new palette colour + a chance to flip its render shape
   *  (cube ↔ ball). Reads the live selection ref (safe from a stale keydown closure). */
  const randomizeSelectedTiles = (rand: () => number) => {
    const grid = gridRef.current
    if (!grid) return
    const zone = lastGenRef.current?.zone ?? genZone
    for (const { col, row } of cellsFromKeys(selectedCellsRef.current)) {
      const stack = stackedAssetsAt(grid, col, row)
      const a = stack[selectedTileLevelRef.current] ?? stack[stack.length - 1] // the active-level tile
      if (!a) continue
      const color = rerollTileColor(a, zone, rand)
      if (color) a.color = color
      if (rand() < 0.5) { if (a.shape === 'circle') delete a.shape; else a.shape = 'circle' }
    }
    bumpBuildingVersion()
  }

  /** THE selection re-roll: a unit if one is selected, else every selected tile. Works for 1 or many. */
  const randomizeSelected = () => {
    const rand = Math.random
    const entId = selectedEntityIdRef.current
    if (entId) { randomizeSelectedUnit(entId, rand); return }
    if (selectedCellsRef.current.size === 0) return
    randomizeSelectedTiles(rand)
  }

  const generateStageInEditor = (zone: ZoneId, variant: VariantId) => {
    resetHistory() // a freshly generated stage replaces the whole map → start its undo history clean
    // A city is a big settlement — give it a markedly larger grid (~1.7× town linear) so it READS
    // bigger on screen, on top of the denser street grid + ~4× building cap in villageLayout. Town,
    // forest and the rest stay on the modest default grid.
    const big = variant === 'city'
    const cols = big ? 52 + Math.floor(Math.random() * 20) : 30 + Math.floor(Math.random() * 16) // city 52–71, else 30–45
    const rows = big ? 42 + Math.floor(Math.random() * 16) : 24 + Math.floor(Math.random() * 12) // city 42–57, else 24–35
    resizeGrid(cols, rows)
    const grid = gridRef.current
    if (!grid) return
    // Capture a per-layer SEED set so the Generate menu can later re-roll a SINGLE layer (buildings /
    // trees / decor / layout) while the rest — fed these same seeds — reproduce identically.
    const seeds = { layout: randSeed(), buildings: randSeed(), nature: randSeed(), decor: randSeed() }
    lastGenRef.current = { zone, variant, cols: grid.cols, rows: grid.rows, seeds }
    buildingSaltRef.current = randSeed()
    const stage = generateStage({ zone, variant, cols: grid.cols, rows: grid.rows, seeds })
    applyStageToGrid(stage, grid, buildingSaltRef.current)
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
    grid.clearAssets()
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
      // A house rolls its LENGTH (3/4/5) so the town shows MATERIAL variety — house_3 brick, house_4 wood,
      // house_5 stone — instead of every home being the single default length. Other types keep their size.
      const HOUSE_LENGTHS = [3, 4, 5]
      for (let i = 0; i < numBuildings && validSpots.length > 0; i++) {
        const spotIdx = Math.floor(Math.random() * validSpots.length)
        const spot = validSpots.splice(spotIdx, 1)[0]
        // Stamp a pre-built building COMPOSITION (its wall/window/door/roof tiles), rotated to face the
        // nearest road — the SAME data-driven stamp trees + the town generator use, no procedural unit.
        // canPlaceBuildingComposition rejects overlaps/roads/water/out-of-bounds (skip → fewer, never bad).
        const type = HOUSE_TYPES[Math.floor(Math.random() * HOUSE_TYPES.length)]
        const length = type === 'house' ? HOUSE_LENGTHS[Math.floor(Math.random() * HOUSE_LENGTHS.length)] : BUILDING_PLACE_LENGTH[type]
        const kind = buildingCompositionKind(type, length)
        const facing = nearestRoadFacing(grid, spot.x, spot.y)
        const fp = buildingFootprint(kind, facing)
        if (!fp) continue // composition not loaded yet
        const anchorCol = spot.x - Math.floor(fp.w / 2)
        const anchorRow = spot.y - Math.floor(fp.h / 2)
        if (!canPlaceBuildingComposition(grid, kind, anchorCol, anchorRow, facing)) continue
        stampBuildingComposition(grid, type, length, anchorCol, anchorRow, genZoneRef.current, facing)
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
      // R re-rolls the SELECTION's random attributes (Stage 3) — the selected unit, or every selected
      // tile — only when there IS a selection and we're not typing.
      if ((e.key === 'r' || e.key === 'R') && tag !== 'INPUT' && tag !== 'TEXTAREA' && (selectedEntityIdRef.current || selectedCellsRef.current.size > 0)) {
        e.preventDefault()
        randomizeSelected()
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
      // Esc DISARMS the placement brush first (so the next click inspects instead of painting).
      if (e.key === 'Escape' && armedTileRef.current) {
        setArmedTile(null)
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

      // TILESET GATE — until the backend tileset is installed, paint a clean loading background and skip ALL
      // simulation + render, so no frontend/default tile can ever flash before the DB style loads. The React
      // loader overlay sits on top of this; together they guarantee loader → correct DB style, nothing between.
      if (!tilesetReadyRef.current) {
        ctx.fillStyle = '#0a0a12'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        animFrame = requestAnimationFrame(gameLoop)
        return
      }

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

      // Jump trigger (edge): start the visual hop if not already airborne. The player keeps moving
      // normally during it (see below), so the hop follows the current speed + direction.
      const jumpDown = !!keys[' ']
      if (jumpDown && !jumpDownRef.current) beginJump(jump, time)
      jumpDownRef.current = jumpDown

      // Entities are WALK-THROUGH by default — only a character with `blocksMovement` on
      // (the per-unit toggle) obstructs, across its feet row. The player's own marker and
      // dead enemies never block. Recomputed each frame so it follows patrols and clears
      // the moment an enemy dies. Used by both the player collision below and the patrol stepper.
      const entityBlocked = entityCollisionCells(
        entitiesRef.current,
        e => e.kind === 'player' || !e.blocksMovement || (e.kind === 'enemy' && !isLivingEnemy(e, enemyRuntimeRef.current)),
      )
      const blockedCell = (x: number, z: number): boolean =>
        entityBlocked.has(`${Math.floor(x / grid.cellSize)},${Math.floor(z / grid.cellSize)}`)

      // Jump = a visual HOP that PRESERVES momentum: the player keeps moving (WASD at their current
      // speed + direction) while arcing up, so a running-right jump goes up-and-right AT run speed —
      // instead of a fixed leap that froze the horizontal movement and read as "straight up" (#34).
      if (jump.active) {
        const t = Math.min(1, (time - jump.start) / JUMP_MS)
        player.jumpHeight = Math.sin(Math.PI * t) * JUMP_PEAK_PX
        if (t >= 1) { player.jumpHeight = 0; jump.active = false }
      } else {
        player.jumpHeight = 0
      }

      // Update player - slower speed for 16px cells. Holding Shift while moving SPRINTS (faster +
      // the run animation frame 🏃 instead of the walk 🚶). Runs EVERY frame (incl. mid-jump).
      const running = !!keys['Shift']
      const speed = 80 * (dt / 1000) * (running ? 1.7 : 1)
      player.moving = false

      let newX = player.x
      let newZ = player.z

      const mkeys: Record<string, boolean> = keys

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

      // Collision — the player is a BODY, not a point: reject a move if ANY corner of its footprint
      // would land on a blocked cell, so it can't slip through a wall while its centre sits on the open
      // cell next to it (blocked until it's completely OUT of the wall cell). Resolved per-axis so it
      // slides along a wall instead of sticking.
      const pr = grid.cellSize * 0.42 // player collision half-extent
      const clearAt = (x: number, z: number): boolean =>
        !grid.isWorldBlocked(x, z) && !blockedCell(x, z)
      const footprintClear = (x: number, z: number): boolean =>
        clearAt(x - pr, z - pr) && clearAt(x + pr, z - pr) && clearAt(x - pr, z + pr) && clearAt(x + pr, z + pr)
      if (footprintClear(newX, player.z)) player.x = newX
      if (footprintClear(player.x, newZ)) player.z = newZ

      // Bounds
      player.x = Math.max(0, Math.min(player.x, grid.cols * grid.cellSize))
      player.z = Math.max(0, Math.min(player.z, grid.rows * grid.cellSize))

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
        renderTopView({
          ctx, w: canvas.width, h: canvas.height, grid, player,
          zoom: zoomRef.current,
          selectedCells: selectedCellsRef.current,
          connectors: connectorsRef.current,
          connectorMode: connectorModeRef.current,
          camOffset: camOffsetRef.current,
          entities: renderEntities,
          enemyCombat: runtime.combat,
          hitMarkers: hitMarkersRef.current,
          now: time,
          quests: questsRef.current,
          dayNight: dayNightRef.current,
          style: activeStyleRef.current,
          hoveredCell: hoveredCellRef.current,
          ghost: ghostRef.current, // armed-composition placement shadow (top-down footprint)
        })
      } else if (viewTypeRef.current === '2d') {
        render2D({
          ctx, w: canvas.width, h: canvas.height, grid, player, time,
          zoom: zoomRef.current,
          camOffset: camOffsetRef.current,
          entities: renderEntities,
          enemyCombat: runtime.combat,
          connectors: connectorsRef.current,
          quests: questsRef.current,
          dayNight: dayNightRef.current,
          attackAnims: attackAnimsRef.current,
          hitMarkers: hitMarkersRef.current,
          projectiles: projectilesRef.current,
          attackReach: weaponReach(playerWeaponRef.current),
          style: activeStyleRef.current,
          targetId: selectedEntityIdRef.current,
          hoverId: hoveredEntityIdRef.current,
          selectedCells: selectedCellsRef.current,
          hoveredCell: hoveredCellRef.current,
        })
        drawSelectedTileHandles(ctx) // resize grips on the selected tile (reads the frame's recorded silhouette)
      } else {
        render({
          ctx, w: canvas.width, h: canvas.height, grid, player, time,
          camOffset: camOffsetRef.current,
          entities: renderEntities,
          enemyCombat: runtime.combat,
          hitMarkers: hitMarkersRef.current,
          now: time,
          zoom: isoZoomRef.current,
          attackAnims: attackAnimsRef.current,
          connectors: connectorsRef.current,
          quests: questsRef.current,
          projectiles: projectilesRef.current,
          dayNight: dayNightRef.current,
          attackReach: weaponReach(playerWeaponRef.current),
          style: activeStyleRef.current,
          clampCamera: playModeRef.current,
          targetId: selectedEntityIdRef.current,
          hoverId: hoveredEntityIdRef.current,
          selectedCells: selectedCellsRef.current,
          hoveredCell: hoveredCellRef.current,
          ghost: ghostRef.current, // armed-composition placement shadow (iso footprint + massing)
        })
        drawSelectedTileHandles(ctx) // resize grips on the selected tile (reads the frame's recorded silhouette)
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

  // ── Game membership (many-to-many) ─────────────────────────────────────────
  // Link templates into the current game, persisting the join. Idempotent — a template already in the
  // game is a no-op. Only meaningful inside a game (route /games/[id]); a plain editor session skips it.
  const linkTemplatesToGame = async (ids: string[]) => {
    if (!gameContext) return
    const additions = ids.filter(id => id && !gameTemplateIds.includes(id))
    if (additions.length === 0) return
    const next = [...gameTemplateIds, ...additions]
    setGameTemplateIds(next)
    await updateGame(gameContext.gameId, { templateIds: next }).catch(err => console.warn('Failed to link templates to game', err))
  }

  // Create a fresh, blank template (same dimensions as the current map) so a connection can target it.
  // The user opens it later to build it out. Returns the new id, or null on failure.
  const createBlankTemplate = async (name: string): Promise<string | null> => {
    const grid = gridRef.current
    if (!grid) return null
    const blank = new IsometricGrid({ cols: grid.cols, rows: grid.rows, cellSize: grid.cellSize, isoScale: grid.isoScale })
    const { groundData, heightData, assetsData } = serializeGrid(blank)
    try {
      const created = await createTemplate({
        name,
        groundData,
        heightData,
        assetsData,
        cols: blank.cols,
        rows: blank.rows,
        cellSize: blank.cellSize,
        isoScale: blank.isoScale,
        spawnCol: Math.floor(blank.cols / 2),
        spawnRow: Math.floor(blank.rows / 2),
      })
      await loadTemplateList()
      return created.id
    } catch {
      toast('Failed to create template', 'error')
      return null
    }
  }

  // Connector picker "＋ New": make a new template, select it as this connector's target, and (in a game)
  // link it. Lets the user branch the flow to a fresh room without leaving the connection form.
  const handleNewConnectorTarget = async () => {
    const name = window.prompt('New template name?')?.trim()
    if (!name) return
    const id = await createBlankTemplate(name)
    if (!id) return
    setConnectorForm(f => ({ ...f, targetTemplateId: id }))
    await linkTemplatesToGame([id])
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
        ...styleToAssets(activeStyleId), // active art style rides as one off-grid marker (ASCII → none)
        ...cellTriggersToAssets(cellTriggers), // cell triggers (enter/interact) ride as off-grid markers
        ...groundColorToAssets(grid.groundColor), // per-cell floor colours ride as one off-grid marker
        ...groundDimsToAssets(grid.groundDims), // per-cell floor dims (W/H/D/Zoom + pose) ride as one off-grid marker
      ]

      let savedTemplateId = currentTemplateId
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
        savedTemplateId = created.id
      }

      await loadTemplateList()
      // Inside a game: keep the join in sync — this template and everything it connects to belong to the game.
      if (savedTemplateId) {
        await linkTemplatesToGame([savedTemplateId, ...connectors.map(c => c.targetTemplateId)])
      }
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
      // A person entity (player/npc) authored BEFORE animation-seeding existed loads with no animations,
      // so its Inspector list reads empty even though it PLAYS the default character set (#88 — the Forest
      // hero vs Village hero mismatch). Forward-seed the default set onto any person that has none, so the
      // animation list follows the UNIT consistently and persists on the next save.
      const loadedEntities = withSeededPersonAnimations(entitiesFromAssets(gridRef.current!.assets))
      const loadedQuests = questsFromAssets(gridRef.current!.assets)
      const loadedStyle = styleFromAssets(gridRef.current!.assets) // active art style marker (null → ASCII)
      const loadedCellTriggers = cellTriggersFromAssets(gridRef.current!.assets) // cell triggers (enter/interact)
      const loadedGroundColor = groundColorFromAssets(gridRef.current!.assets) // per-cell floor colours
      const loadedGroundDims = groundDimsFromAssets(gridRef.current!.assets) // per-cell floor dims (W/H/D/Zoom + pose)
      gridRef.current!.removeAssetsWhere(
        a => isEntityAsset(a) || isQuestAsset(a) || isStyleAsset(a) || isTriggerAsset(a) || isGroundColorAsset(a) || isGroundDimsAsset(a),
      )
      // Restore per-cell floor colours: clear any stale overrides (a reused grid keeps the last map),
      // then apply the saved ones. setGroundColor bumps groundVersion so the cached ground layer rebuilds.
      {
        const g = gridRef.current!
        for (let r = 0; r < g.rows; r++)
          for (let c = 0; c < g.cols; c++) if (g.groundColor[r]?.[c]) g.setGroundColor(c, r, null)
        for (const [key, color] of Object.entries(loadedGroundColor)) {
          const [c, r] = key.split(',').map(Number)
          g.setGroundColor(c, r, color)
        }
      }
      // Restore per-cell floor dims the same way: clear the stale sparse map, then apply the saved one.
      // setGroundDims bumps groundVersion so the 2D + iso ground caches rebuild with the loaded dims; if the
      // loaded map has NO dims but the reused grid did, the clear itself bumps so the caches drop them too.
      {
        const g = gridRef.current!
        let cleared = false
        for (let r = 0; r < g.rows; r++) if (g.groundDims[r]?.length) { g.groundDims[r] = []; cleared = true }
        if (cleared) g.groundVersion++
        for (const [key, dims] of Object.entries(loadedGroundDims)) {
          const [c, r] = key.split(',').map(Number)
          g.setGroundDims(c, r, dims)
        }
      }
      setActiveStyleId(styleById(loadedStyle).id) // restore the saved global skin (defaults to ASCII)
      setCellTriggers(loadedCellTriggers) // restore the authored cell triggers
      // Buildings are just their stamped per-cell tiles now (regular assets, like trees), so they
      // deserialize with the rest of grid.assets — no grouped-building marker to restore.
      setEntities(loadedEntities)
      setQuests(loadedQuests)
      resetHistory() // fresh map loaded → drop undo history so Ctrl+Z can't drag back the previous map

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
      setEntities(withSeededPersonAnimations(template.entities ?? []))
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
    // Inside a game the route is /games/[gameId], where `id` is the PATH segment (the game id) — routing
    // through `query:{ id }` would overwrite it with the template id and land on /games/<templateId>
    // ("game not found"). Switch the template in memory instead; lastTemplateId persists via its effect.
    if (gameContext) { loadTemplate(id); return }
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
    if (!gridRef.current) return
    // Opened INSIDE a game (route /games/[id]) — drive the first load from the game context, not the URL
    // (the [id] path segment is the GAME id, not a template). Open the game's last-watched template.
    if (gameContext) {
      const startId = gameContext.startTemplateId
      const key = startId ? `game:${startId}${gameContext.play ? ':play' : ''}` : 'game:empty'
      if (handledQueryRef.current === key) return
      handledQueryRef.current = key
      if (startId && gameContext.play) {
        loadTemplate(startId, undefined, { resetToSpawn: true }).then(() => enterPlayMode())
      } else if (startId) {
        loadTemplate(startId)
      }
      setInitialized(true)
      return
    }
    if (!router.isReady) return
    const { id, new: isNew, play } = router.query
    const wantPlay = play === '1' // deep-link straight into the play view (from the Games route ▶ Play)
    const key = typeof id === 'string' ? `id:${id}${wantPlay ? ':play' : ''}` : isNew === '1' ? 'new' : 'recent'
    if (handledQueryRef.current === key) return
    handledQueryRef.current = key

    if (typeof id === 'string') {
      if (wantPlay) {
        // ▶ Play a game level: load the template at its spawn and enter play mode (mirrors playGameLevel).
        loadTemplate(id, undefined, { resetToSpawn: true }).then(() => enterPlayMode())
      } else {
        loadTemplate(id) // sets currentTemplateId
      }
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
  }, [router.isReady, router.query, gameContext])

  // Inside a game, remember the last template watched so reopening the game resumes here. Skip the very
  // first render (the load we just kicked off) — only persist once the user actually SWITCHES templates.
  const lastSavedTemplateRef = useRef<string | null>(gameContext?.startTemplateId ?? null)
  useEffect(() => {
    if (!gameContext || !currentTemplateId) return
    if (currentTemplateId === lastSavedTemplateRef.current) return
    lastSavedTemplateRef.current = currentTemplateId
    updateGame(gameContext.gameId, { lastTemplateId: currentTemplateId }).catch(() => {})
  }, [currentTemplateId, gameContext])

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
          onMouseLeave={() => { hoveredEntityIdRef.current = null; hoveredCellRef.current = null; ghostRef.current = null; handleCanvasMouseUp() }}
          onContextMenu={handleContextMenu}
          style={{ cursor: isPanning ? 'grabbing' : topViewMode ? 'default' : 'grab' }}
        />

        {/* TILESET LOADER GATE — the map is NEVER painted until the backend tileset installs (the RAF loop
            paints only a dark background until then), so on a fresh load this overlay is the ONLY thing
            visible: a spinner while fetching, a retry on failure. No frontend-tile / wrong-style flash can
            slip through, because there is no bundled frontend tile data to draw. */}
        {!tilesetReady && (
          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-[#0a0a12] font-mono text-white">
            {!tilesetError ? (
              <>
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-yellow-400" />
                <p className="text-sm tracking-widest text-gray-300">LOADING TILES…</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-red-400">Couldn&apos;t load the tileset</p>
                <p className="max-w-xs text-center text-xs text-gray-400">
                  The tile server didn&apos;t respond. The editor renders only backend tiles — nothing is drawn
                  from the frontend — so it waits here until the tileset loads.
                </p>
                <button
                  onClick={loadTiles}
                  className="rounded bg-yellow-600 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500"
                >
                  ↻ Retry
                </button>
              </>
            )}
          </div>
        )}

        {/* (Removed the on-canvas floating quick-actions toolbar — Style/Animate/Trigger live in the
            right-sidebar Inspector cards now, so the game view stays uncluttered.) */}

        {/* Multi-select hint — plain drag pans, so bulk cell-select needs Shift. Shown only while idle in
            select mode (nothing picked yet) so it nudges without cluttering once you're working. */}
        {showSidebars && !playMode && !showFlowView && !showGamesView && editorMode === 'select'
          && selectedCells.size === 0 && !selectedEntityId && !editingConnector && (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[11px] text-gray-300 shadow-lg shadow-black/40">
            <span className="font-bold text-yellow-300">⇧ Shift + drag</span> to select cells · plain drag pans
          </div>
        )}

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
                onRandomizeLayer={layer => { randomizeLayerInEditor(layer as LayerId); close() }}
              />
            )}
          </Dropdown>
          {/* 🎨 Style — the global art-skin switch: pick a style → the whole world reskins */}
          <Dropdown label={<>🎨 Style: {activeStyle.name}</>} title="Art style" panelClass="w-56">
            {close => <StylePicker activeId={activeStyleId} onPick={setActiveStyleId} onClose={close} />}
          </Dropdown>
          {/* ◈ Unit — place units. The enemy/creature PICKER lives here now (the paint palette no longer lists
              units): pick WHICH creature from the DB `units` tiles, choose Add (click to place) or Scatter, and
              place it static or with a randomized movement animation. Player/NPC/Erase/Collision stay as utility
              tools. Arming derives editorMode → 'unit', so canvas clicks place exactly as before. */}
          <Dropdown
            label={<>◈ Unit</>}
            title="Place units — pick a creature, then Add or Scatter"
            btnClass={entityTool || unitTile ? 'bg-orange-600 text-black' : 'bg-gray-700 hover:bg-gray-600'}
            panelClass="w-64"
          >
            {() => {
              // Placeable figures only — FX/projectile `units` tiles (arrows, bolts…) resolve to assets, not entities.
              const unitTiles = tilesForStyle(activeStyleId).units.filter(t => placementFor(t) === 'entity')
              return (
                <div className="space-y-2">
                  {/* utility tools — default player/npc figures + erase/collision. The Enemy tool is gone: the
                      picker below replaces it (pick the exact creature tile). */}
                  <div className="grid grid-cols-4 gap-1">
                    <EntityToolButton label="Player" glyph={ENTITY_GLYPH.player} active={entityTool === 'player' && !unitTile} activeClass="bg-yellow-600 text-black" onClick={() => toggleEntityTool('player')} />
                    <EntityToolButton label="NPC" glyph={ENTITY_GLYPH.npc} active={entityTool === 'npc' && !unitTile} activeClass="bg-cyan-600 text-black" onClick={() => toggleEntityTool('npc')} />
                    <EntityToolButton label="Erase" glyph="✕" active={entityTool === 'erase'} activeClass="bg-gray-500" onClick={() => toggleEntityTool('erase')} />
                    <EntityToolButton label="Collision" glyph="▦" active={entityTool === 'collision'} activeClass="bg-red-700" onClick={() => toggleEntityTool('collision')} />
                  </div>
                  {entityTool === 'npc' && !unitTile && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-cyan-400">NPC name (optional)</span>
                      <input type="text" value={npcName} onChange={e => setNpcName(e.target.value)} placeholder="Villager" aria-label="NPC name" className="w-full rounded bg-gray-800 p-1.5 text-xs" />
                    </label>
                  )}
                  {/* the enemy/creature picker + place modes + motion toggle */}
                  <div className="border-t border-white/10 pt-2">
                    <UnitPicker
                      units={unitTiles}
                      pickedId={unitTile?.id ?? null}
                      onPick={pickUnitTile}
                      mode={unitPlaceMode}
                      onMode={setUnitPlaceMode}
                      animated={unitAnimated}
                      onAnimated={setUnitAnimated}
                      onScatter={scatterUnits}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[10px] text-gray-400">
                    <span>{entities.length} placed</span>
                    {entities.length > 0 && (
                      <button onClick={() => { checkpointHistory(); setEntities([]) }} className="rounded bg-red-900 px-2 py-1 font-bold text-red-200 hover:bg-red-800">Clear all</button>
                    )}
                  </div>
                </div>
              )
            }}
          </Dropdown>
          {/* ⚙ Stage — grid size + view toggles (night / debug / collisions / hide entities). Lives in the
              top nav so it's ALWAYS reachable, even with an element selected (it used to hide in the sidebar). */}
          <Dropdown label={<>⚙ Stage</>} title="Stage settings" panelClass="w-64">
            {() => (
              <div className="space-y-2">
                <div>
                  <p className="mb-1 text-xs font-bold text-gray-400">Grid {viewType === '2d' ? '(W × H)' : '(Cols × Rows)'}</p>
                  <div className="flex items-center gap-2">
                    <input type="number" aria-label="Grid columns" value={gridSize.cols} onChange={(e) => setGridSize(s => ({ ...s, cols: parseInt(e.target.value) || 10 }))} className="w-14 rounded bg-gray-800 p-1 text-center text-xs" min="10" max="100" />
                    <span className="text-xs text-gray-400">×</span>
                    <input type="number" aria-label="Grid rows" value={gridSize.rows} onChange={(e) => setGridSize(s => ({ ...s, rows: parseInt(e.target.value) || 10 }))} className="w-14 rounded bg-gray-800 p-1 text-center text-xs" min="10" max="100" />
                    <button onClick={() => resizeGrid(gridSize.cols, gridSize.rows)} className="rounded bg-red-800 px-2 py-1 text-xs font-bold hover:bg-red-700">Apply</button>
                  </div>
                </div>
                <button onClick={() => setDayNight(d => (d === 'day' ? 'night' : 'day'))} aria-pressed={dayNight === 'night'} className={`w-full rounded px-2 py-1 text-xs font-bold transition-colors ${dayNight === 'night' ? 'bg-indigo-700' : 'bg-gray-700 hover:bg-gray-600'}`}>Night mode {dayNight === 'night' ? 'on' : 'off'}</button>
                <button onClick={toggleDebug} aria-pressed={showDebug} className={`w-full rounded px-2 py-1 text-xs font-bold transition-colors ${showDebug ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Debug overlay {showDebug ? 'on' : 'off'}</button>
                <button onClick={toggleCollisions} aria-pressed={showCollisions} className={`w-full rounded px-2 py-1 text-xs font-bold transition-colors ${showCollisions ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}>Show collisions {showCollisions ? 'on' : 'off'}</button>
                <button onClick={() => setHideEntities(h => !h)} aria-pressed={hideEntities} className={`w-full rounded px-2 py-1 text-xs font-bold transition-colors ${hideEntities ? 'bg-amber-600' : 'bg-gray-700 hover:bg-gray-600'}`}>{hideEntities ? 'Entities hidden' : 'Hide entities'}</button>
                <p className="text-[10px] text-gray-500">WASD / arrows move · Space jumps · E interacts</p>
              </div>
            )}
          </Dropdown>
          <FpsReadout fps={fps} variant="nav" />
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
        {playMode && <FpsReadout fps={fps} variant="floating" />}

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
            {editorMode === 'paint' && (
              <Card title="Paint — tiles & ground" accent="cyan">
                {/* DB tile catalog — the FULL tileset (terrain / buildings / units / nature) for the active
                    art style, straight from tilesForStyle. Pick one to ARM it as the brush, then click the
                    map to place; the exact tile is pinned per-cell so it survives a style switch too. */}
                <TilePalette
                  styleId={activeStyleId}
                  styleName={activeStyle.name}
                  armedId={armedTile?.id ?? null}
                  onArm={armTile}
                />
              </Card>
            )}

            {editorMode === 'building' && (
              <Card title="Tile compositions" accent="orange">
                {/* EVERY composition the backend serves — the same set the world randomizer stamps (buildings,
                    trees/bushes, fountains, wells, lamp posts…), grouped + labelled with their footprint size.
                    Pick one to ARM it, then move over the map to see a ghost footprint, and click to stamp its
                    cells. Data-driven from the loaded tileset — never a hardcoded building-only list. */}
                <p className="mb-2 text-[10px] leading-tight text-gray-400">
                  Pick a composition, then hover the map to preview its footprint and click to place it.
                </p>
                <CompositionPalette
                  catalog={compositionPalette}
                  armedKind={buildingTool}
                  onArm={toggleBuildingTool}
                />
              </Card>
            )}

            {/* The Connectors tool moved OFF the left rail — its entry is a button in the RIGHT sidebar that
                opens a draggable Connectors modal (see the Inspector). */}
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

            {/* ↗ Connectors — the tool's entry, moved off the left rail. Opens a draggable/resizable modal
                (like the settings one) hosting the whole connector flow. Highlights while it's open. */}
            <button
              onClick={() => (connectorPanelOpen ? closeConnectorPanel() : openConnectorPanel())}
              aria-pressed={connectorPanelOpen}
              title="Connectors — link cells to other levels & actions"
              className={`w-full rounded-lg px-3 py-2 text-xs font-bold shadow transition-colors ${connectorPanelOpen ? 'bg-purple-600 text-white' : 'bg-purple-800/80 text-purple-100 hover:bg-purple-700'}`}
            >
              ↗ Connectors{connectors.length ? ` (${connectors.length})` : ''}
            </button>

            {(() => {
              // Stage B — the Inspector MORPHS to the current selection. Precedence:
              // unit → connector → cell → nothing. Each branch renders the SAME edit bodies/handlers the old
              // modals/left-cards used, now inline + collapsible. A building is NOT a selectable unit — its
              // individual cells are edited through the CELL inspector below. Nothing selected falls through
              // to the stage settings.
              const selEntity = entities.find(e => e.id === selectedEntityId)

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
                // The base VISUAL for the animation modal's empty "base" frame (frame 0 = the unit as-is): the
                // unit's own baked tile (its override / per-variant / per-enemy image, the SAME the renderer
                // draws) so it previews as an IMAGE, not a glyph. Falls back to the resolved figure, then a glyph.
                const selBaseTileId = selEntity.tileOverride ?? entityStyleOverride(selEntity, activeStyle)
                const selBaseVisual: Visual = (selBaseTileId && visualForTileId(selBaseTileId))
                  || (selFigVisual.kind !== 'ascii' ? selFigVisual : { kind: 'glyph', char: selFigure })
                // SHARED settings model for the unit — the SAME TileControlModel a tile feeds TileControls /
                // PropertiesPanel, so the unit's card + settings panel (colour / scale / pose) look + work
                // identically. A unit has ONE uniform scale (`size`), so all three scale axes drive it; colour →
                // entity.color. x/y/rotate/flip ride entity.pose (persisted via the codec). Asset-only controls
                // (Z Width, Z-Index, Display, Shape, Light, z-slide) get NO writer, so TileControls hides each of
                // those rows for a unit — same conditional split a floor tile already uses. onOpenAnimator wires
                // the card's "✦ Animate…" button to the frame-by-frame character editor (a floating panel now).
                const unitScale = selEntity.size ?? 1
                const unitTileModel: TileControlModel = {
                  key: `unit-${selEntity.id}`,
                  label: selEntity.name || selEntity.kind,
                  dims: { width: unitScale, height: unitScale, depth: unitScale, zoom: unitScale },
                  color: selEntity.color ?? null,
                  colorFallback: '#ffffff',
                  onDim: (_axis, v) => patchSelectedEntity({ size: v > 1 ? v : undefined }), // size 1 drops the field
                  onColor: c => patchSelectedEntity({ color: c }),
                  onClearColor: () => patchSelectedEntity({ color: undefined }),
                  override: selEntity.tileOverride ?? null,
                  styleName: activeStyle.name,
                  onOpenLibrary: () => setTileLibraryOpen(true),
                  pose: selEntity.pose,
                  onPose: p => patchSelectedEntity({ pose: p }),
                  onPoseReset: () => patchSelectedEntity({ pose: undefined }),
                  onOpenAnimator: () => setAnimEditorOpen(true),
                }
                return (
                  <>
                    <SelectionHeader kind={selEntity.kind} label={`${selEntity.name || selEntity.kind} (${selEntity.kind})`} coords={`@ ${selEntity.col},${selEntity.row}`} />
                    {selEntity.kind !== 'player' && (
                      <button
                        onClick={randomizeSelected}
                        title="Re-roll this unit's random attributes — a new figure variant + a fresh wander animation (hotkey R)"
                        className="w-full rounded bg-indigo-700 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-indigo-600"
                      >
                        🎲 Randomize unit
                      </button>
                    )}
                    {/* ONE card — the SAME PropertiesPanel a tile uses, with the unit's data folded IN via
                        `unitSection`. No parallel unit sidebar: identity/vitals/inventory/quests/attacks live
                        UNDER the shared tile summary; Animate + Triggers are buttons that open floating modals;
                        the settings sliders open from "Edit settings…" exactly like a tile. */}
                    <Card title={`Unit — ${selEntity.name || selEntity.kind}`} accent="orange">
                      <PropertiesPanel
                        collision={null}
                        onCollision={() => {}}
                        tile={unitTileModel}
                        level={1}
                        levelCount={1}
                        onLevel={() => {}}
                        onOpenSettings={() => setUnitSettingsOpen(true)}
                        onOpenTriggers={() => setTriggersOpen(true)}
                        triggerCount={selEntity.triggers?.length ?? 0}
                        unitSection={
                          <div className="space-y-3">
                            {/* appearance (figure/size) + identity/vitals + inventory (player) / quests (NPC) /
                                attacks (enemy) — the extras a tile never has, folded onto the shared card. */}
                            <UnitSettingsSection
                              unit={{
                                entity: selEntity,
                                onPatch: patchSelectedEntity,
                                onSize: setSelectedEntitySize,
                                onOpenInventory: isPlayer ? () => setEntityModal('inventory') : undefined,
                                onOpenQuests: isNpc ? () => { if (selEntity.kind !== 'enemy') setQuestDraft(d => ({ ...d, giverId: selEntity.id })); setEntityModal('quests') } : undefined,
                                onOpenAttacks: isEnemy ? () => setUnitAttacksOpen(true) : undefined,
                              }}
                            />
                            {isPlayer && <CombatHud hud={playerHud} />}
                            {heldWeaponKind && EMOJI_TILESET[heldWeaponKind] && (
                              <div className="border-t border-white/10 pt-3">
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
                              <p className="text-[10px] text-gray-500">Weapon pose tuning lives in the Emoji style — ASCII weapons draw their own glyph and aren&apos;t pose-driven yet.</p>
                            )}
                          </div>
                        }
                      />
                    </Card>
                    <div className="flex gap-1">
                      <button onClick={deleteSelectedEntity} className="flex-1 rounded bg-red-800 px-2 py-1.5 text-xs font-bold hover:bg-red-700">Delete</button>
                      <button onClick={() => setSelectedEntityId(null)} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Deselect</button>
                    </div>
                    {/* Animate — the IDENTICAL shared modal a tile opens (the user: "both unit and tiles should
                        use the same animations modal"), opened by the card's "✦ Animate…" button; geometry persists
                        under id "animation". A unit carries the SAME unified `Animation[]` a tile does in
                        `unitAnimations` (settings-kind AND sprite-kind), so the modal offers BOTH the settings and
                        sprite add-buttons. Source of truth is `unitAnimations` (bridged live from the legacy
                        `animations` when a unit predates the field); on change we write `unitAnimations` AND keep the
                        render projection `animations` (its sprite subset) in sync for the untouched frame renderer. */}
                    {animEditorOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Animation`} accent="cyan" onClose={() => setAnimEditorOpen(false)} {...floatingProps('animation', { w: 380, h: 520 })}>
                        <TileAnimationEditor
                          animations={selEntity.unitAnimations ?? unitAnimationsFromEntity(selEntity.animations)}
                          elementType="Character"
                          elementLabel={selEntity.name || selEntity.kind}
                          spriteContext={{ category: 'units', styleId: activeStyleId, baseVisual: selBaseVisual, variant: selEntity.variant }}
                          onChange={next => patchSelectedEntity({ unitAnimations: next, animations: entityAnimationsFromUnit(next) })}
                        />
                      </FloatingPanel>
                    )}
                    {/* Unit settings — the SAME floating panel + shared body a tile opens. Tile-only here: the
                        unit's identity/inventory live on the CARD now, not in this modal. Geometry id "settings". */}
                    {unitSettingsOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Settings`} accent="cyan" onClose={() => setUnitSettingsOpen(false)} {...floatingProps('settings')}>
                        <SettingsPanelBody tile={unitTileModel} />
                      </FloatingPanel>
                    )}
                    {/* Triggers — a floating modal (like settings) to manage this unit's on-defeat triggers. */}
                    {triggersOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Triggers`} accent="yellow" onClose={() => setTriggersOpen(false)} {...floatingProps('triggers', { w: 360, h: 380 })}>
                        <TriggerEditor
                          triggers={selEntity.triggers ?? []}
                          events={['defeat']}
                          templates={gotoTargets}
                          enemyTypes={ENEMY_TYPES}
                          onChange={next => setTriggersForEntity(selEntity.id, next)}
                        />
                      </FloatingPanel>
                    )}
                    {/* Attacks — folded off the card into a floating modal (enemies only). */}
                    {isEnemy && unitAttacksOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Attacks`} accent="orange" onClose={() => setUnitAttacksOpen(false)} {...floatingProps('attacks', { w: 340, h: 420 })}>
                        <EntityAttackBody entity={selEntity} onPatch={patchSelectedEntity} />
                      </FloatingPanel>
                    )}
                  </>
                )
              }


              // ── CONNECTOR ─────────────────────────────────────────
              // Editing a connector: the authoring form now lives in the draggable Connectors panel (opened
              // from the ↗ Connectors button above), so the Inspector just points there instead of morphing —
              // this keeps the connector selection distinct from a plain cell selection.
              if (editingConnector) {
                const coordLabel = selectedCells.size > 1 ? `${selectedCells.size} cells` : `(${editingConnector.col}, ${editingConnector.row})`
                return (
                  <>
                    <SelectionHeader kind="connector" label="connector" coords={coordLabel} />
                    <p className="rounded-lg border border-purple-500/20 bg-black/40 px-3 py-2 text-[11px] leading-tight text-gray-400">
                      Editing this connector in the <span className="font-bold text-purple-300">↗ Connectors</span> panel — set its target, when &amp; spawn cell there.
                    </p>
                  </>
                )
              }

              // ── CELL(S) ───────────────────────────────────────────
              if (selectedCells.size > 0) {
                const first = Array.from(selectedCells)[0].split(',')
                const cellLabel = selectedCells.size > 1 ? `${selectedCells.size} cells` : `(${first[0]}, ${first[1]})`
                // Cell triggers attach to the FIRST selected cell (the one the label shows).
                const trigCol = parseInt(first[0], 10)
                const trigRow = parseInt(first[1], 10)
                return (
                  <>
                    {/* ONE consolidated Cell card — EXACTLY TWO sections. A CELL is a fixed slot; its only
                        tunable prop is collision (grid elevation stays a cell prop, painted with the terrain-
                        height tool). The TILE section shows the ONE SELECTED tile in the cell's stack (the floor
                        is the height-0 tile; a wall/prop is a stacked block) as a single group — name + Open Tile
                        Library + colour + Width/Height/Depth/Zoom + x/y/rotate/flip — with a ▲▼ level stepper to
                        reach every block. The redundant `▸ CELL (coords)` header pill was removed; the coords now
                        ride this card's title so there's ONE cell header, not two. */}
                    <button
                      onClick={randomizeSelected}
                      title="Re-roll the random attributes (palette colour / cube↔ball shape) of the selected tile(s) — hotkey R"
                      className="mb-2 w-full rounded bg-indigo-700 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-indigo-600"
                    >
                      🎲 Randomize selected {selectedCells.size > 1 ? `(${selectedCells.size})` : ''}
                    </button>
                    <Card title={`Cell ${cellLabel}`} accent="cyan">
                      {(() => {
                        const grid = gridRef.current
                        const cells = cellsFromKeys(selectedCells)
                        if (!grid || cells.length === 0) return null
                        void buildingVersion // re-read shared values after an edit (bumpBuildingVersion)
                        const fc = cells[0]
                        // Drive the inspector off the ONE unified stack: index 0 = the floor (a height-0 tile),
                        // then loose props, then this cell's BUILDING blocks (wall/window/door/roof) and any
                        // CHARACTER on it — the SAME model select/pick use, so a clicked wall or unit lands on a
                        // real tile here with NO per-type branch. The SELECTED level (selectedTileLevel, clamped)
                        // picks the ONE tile shown; floor/asset values stay shared across the whole selection.
                        const stack = getStack(grid, fc.col, fc.row, { entities })
                        const levelCount = stack.length
                        const lvl = Math.min(Math.max(selectedTileLevel, 0), levelCount - 1)
                        // The tile-add button names itself by CELL STATE (no tile-type branch): a bare cell (floor
                        // only) reads "Add tile", a cell that already holds a stacked tile reads "Replace tile".
                        const libraryLabel = levelCount > 1 ? 'Replace tile' : 'Add tile'
                        // A tile's baked art for the Inspector thumbnail — pinned override first, else the style's
                        // tile for that slug. Undefined (ascii/none) → the preview shows a neutral placeholder.
                        const previewFor = (id: string | null | undefined, slug: string): Visual | undefined =>
                          (id ? visualForTileId(id) : undefined) ?? visualForTileId(`${activeStyleId}:${slug}`) ?? undefined
                        // Shared floor dim across the selection (grid.groundDims; unset→1; null = mixed).
                        const gdim = (read: (d: GroundCellDims | undefined) => number) => commonValue(cells.map(({ col, row }) => read(grid.groundDims?.[row]?.[col])))
                        // Shared value of the i-th stacked tile's field across the cells that HAVE it.
                        const adim = (i: number, read: (a: GridAsset) => number) => {
                          const vals = cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]).filter((a): a is GridAsset => !!a).map(read)
                          return vals.length ? commonValue(vals) : 1
                        }

                        let tile: TileControlModel
                        // Context for the Phase-4 tile-animation modal — set only for an asset tile (the sole
                        // tile that owns GridAsset.animations). Read at the return so the modal can render in scope.
                        let animatorCtx: { i: number; label: string; animations: TileAnim[]; category: TileCategory; baseVisual: Visual } | null = null
                        if (lvl === 0) {
                          // FLOOR (height-0 tile): per-cell dims/colour + a REAL per-cell pose.
                          const groundSlug = grid.ground[fc.row]?.[fc.col] ?? 'grass'
                          const floorDimsFc = grid.groundDims?.[fc.row]?.[fc.col]
                          tile = {
                            key: 'floor',
                            label: groundKind(groundSlug),
                            dims: {
                              width: gdim(d => d?.scaleX ?? 1),
                              height: gdim(d => d?.scaleY ?? 1),
                              depth: gdim(d => d?.scaleZ ?? 1),
                              zoom: gdim(d => d?.scale ?? 1),
                            },
                            color: commonValue(cells.map(({ col, row }) => grid.groundColor?.[row]?.[col] ?? null)),
                            colorFallback: '#3a7d34',
                            onDim: setGroundDim,
                            onColor: setFloorColor,
                            onClearColor: () => setFloorColor(null),
                            override: selectedOverride,
                            styleName: activeStyle.name,
                            preview: previewFor(selectedOverride, groundSlug),
                            libraryLabel,
                            onOpenLibrary: () => setTileLibraryOpen(true),
                            pose: floorDimsFc?.pose,
                            onPose: setGroundPose,
                            onPoseReset: clearGroundPose,
                          }
                        } else if (stack[lvl]?.source === 'asset') {
                          // STACKED prop tile: per-index dims/colour writers, plus PER-ASSET transforms — Z Width
                          // (directional depth), x/y/rotate/flip pose, and z (vertical lift) — all written to THIS
                          // placed tile (persist with the map), NOT the shared tileset kind. The render reads them
                          // back in every view. Assets occupy indices 1..A right after the floor, so the slot is lvl-1.
                          const i = lvl - 1
                          const a0 = stackedAssetsAt(grid, fc.col, fc.row)[i]
                          const kind = a0 ? assetKind(a0) : (stack[lvl]?.slug || `tile ${lvl}`)
                          const posable = !!a0
                          tile = {
                            key: `tile-${i}`,
                            label: kind,
                            dims: {
                              width: adim(i, a => a.scaleX ?? 1),
                              height: adim(i, a => a.scaleY ?? 1),
                              depth: adim(i, a => a.scaleZ ?? 1),
                              zoom: adim(i, a => a.scale ?? 1),
                            },
                            color: commonValue(cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]?.color ?? '#ffffff')),
                            colorFallback: '#ffffff',
                            onDim: (axis, v) => setAssetDim(i, axis, v),
                            onColor: c => setAssetColor(i, c),
                            override: selectedOverride,
                            styleName: activeStyle.name,
                            preview: previewFor(a0?.tileOverride ?? selectedOverride, stack[lvl]?.slug ?? kind),
                            libraryLabel,
                            onOpenLibrary: () => setTileLibraryOpen(true),
                            zWidth: adim(i, a => a.depth ?? 1),
                            zDir: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.depthDir ?? null) as DepthDir | null)),
                            onZWidth: v => setAssetDepth(i, v),
                            onZDir: dir => setAssetDepthDir(i, dir),
                            zPos: adim(i, a => a.zOffset ?? 0),
                            onZPos: posable ? (v => setAssetZOffset(i, v)) : undefined,
                            zPosDir: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.zDir ?? null) as DepthDir | null)),
                            onZPosDir: posable ? (dir => setAssetZDir(i, dir)) : undefined,
                            zIndex: adim(i, a => a.zIndex ?? 0),
                            onZIndex: posable ? (v => setAssetZIndex(i, v)) : undefined,
                            display: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.settings?.display ?? 'all-faces') as TileDisplay)),
                            onDisplay: posable ? (mode => setAssetDisplay(i, mode)) : undefined,
                            shape: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.shape ?? 'square') as TileShape)),
                            onShape: posable ? (shape => setAssetShape(i, shape)) : undefined,
                            light: a0?.light,
                            onLight: posable ? (l => setAssetLight(i, l)) : undefined,
                            pose: posable ? a0?.pose : undefined,
                            onPose: posable ? (p => setAssetPose(i, p)) : undefined,
                            onPoseReset: posable ? (() => setAssetPose(i, undefined)) : undefined,
                            isWeapon: WEAPON_KINDS.has(kind),
                            animations: a0?.animations,
                            onOpenAnimator: posable ? (() => setTileAnimatorOpen(true)) : undefined,
                          }
                          if (posable) {
                            // Sprite-frame picker context for THIS tile: its own tileset category (so a lamp's
                            // frames come from nature tiles, a wall's from buildings — fallback nature) and its
                            // own baked visual for the empty "base" frame. Emoji is the authored style; ascii
                            // frames stay glyphs anyway.
                            const slug = stack[lvl]?.slug ?? ''
                            const tileCat = (EMOJI_TILESET[slug]?.category as TileCategory | undefined) ?? 'nature'
                            const baseV = visualForTileId(`${activeStyleId}:${slug}`) ?? resolveVisual(assetKind(a0!), activeStyle, a0!.tileOverride)
                            const baseVisual: Visual = baseV.kind === 'ascii' ? { kind: 'glyph', char: '·' } : baseV
                            animatorCtx = { i, label: kind, animations: a0?.animations ?? [], category: tileCat, baseVisual }
                          }
                        } else {
                          // A BUILDING block (wall / window / door / roof) or a CHARACTER on the cell — shown as a
                          // TILE with the SAME group as a tree: its name, Open Tile Library, colour, W/H/D/Zoom.
                          // A building block is now a plain stacked ASSET (like a tree cell) and a unit lives in
                          // the entities store; DISPLAY-ONLY for now — writing size/colour BACK to the asset/entity
                          // is the next step, so the dim/colour handlers are deliberately inert (not faked) so
                          // selection + display are honest and no edit silently no-ops into the floor.
                          const entry = stack[lvl] as TileEntry | undefined
                          tile = {
                            key: `${entry?.source ?? 'tile'}-${lvl}`,
                            label: entry?.slug || `tile ${lvl}`,
                            dims: {
                              width: entry?.w ?? 1,
                              height: entry?.scaleY ?? 1,
                              depth: entry?.d ?? 1,
                              zoom: entry?.zoom ?? 1,
                            },
                            color: entry?.color ?? null,
                            colorFallback: entry?.color ?? '#8a8a8a',
                            onDim: () => {}, // write-back to the asset / entity store → next step
                            onColor: () => {}, // write-back to the asset / entity store → next step
                            override: entry?.tileId ?? selectedOverride,
                            styleName: activeStyle.name,
                            preview: previewFor(entry?.tileId ?? selectedOverride, entry?.slug ?? ''),
                            libraryLabel,
                            onOpenLibrary: () => setTileLibraryOpen(true),
                          }
                        }

                        return (
                          <>
                            <PropertiesPanel
                              collision={commonBool(cells.map(({ col, row }) => grid.isBlocked(col, row)))}
                              onCollision={setCellCollision}
                              tile={tile}
                              level={lvl + 1}
                              levelCount={levelCount}
                              onLevel={setSelectedTileLevel}
                              onOpenSettings={() => setTileSettingsOpen(true)}
                              onOpenTriggers={() => setTriggersOpen(true)}
                              triggerCount={triggersAtCell(cellTriggers, trigCol, trigRow).length}
                              onRemove={lvl >= 1 ? removeSelectedTile : undefined}
                              onClearTiles={clearTilesOnSelection}
                            />
                            {/* Tile-settings panel — the full TileControls body (colour/size/pose/z/display),
                                opened from the inspector's "Edit settings…". A FLOATING panel (not a modal): no
                                backdrop, so you drag it aside and WATCH the tile repaint as you edit. The writers
                                already fan out to the i-th stacked tile of every selected cell (setAssetDim/Pose/…).
                                Geometry persists in the backend under id "settings". */}
                            {tileSettingsOpen && (
                              <FloatingPanel title={`${tile.label} — Settings`} accent="cyan" onClose={() => setTileSettingsOpen(false)} {...floatingProps('settings')}>
                                {/* SAME shared body a unit uses (no `unit` → no unit section), so tile + unit settings are one component. */}
                                <SettingsPanelBody tile={tile} />
                              </FloatingPanel>
                            )}
                            {/* Phase-4 tile-animation panel — authors THIS asset tile's GridAsset.animations
                                (e.g. the fountain water). A movable/resizable FLOATING panel like the settings one;
                                geometry persists under id "tileAnimation". Writes fan out to the i-th stacked tile
                                of every selected cell via setAssetAnimations. */}
                            {tileAnimatorOpen && animatorCtx && (
                              <FloatingPanel title={`${animatorCtx.label} — Animation`} accent="purple" onClose={() => setTileAnimatorOpen(false)} {...floatingProps('tileAnimation', { w: 460, h: 560 })}>
                                <TileAnimationEditor
                                  animations={animatorCtx.animations}
                                  elementType="Tile"
                                  elementLabel={animatorCtx.label}
                                  spriteContext={{ category: animatorCtx.category, styleId: activeStyleId, baseVisual: animatorCtx.baseVisual }}
                                  onChange={next => setAssetAnimations(animatorCtx!.i, next)}
                                />
                              </FloatingPanel>
                            )}
                            {/* Triggers — the cell's enter/interact triggers, managed in a floating modal (like
                                settings), opened by the card's "⚑ Triggers…" button. Geometry id "triggers". */}
                            {triggersOpen && (
                              <FloatingPanel title={`Cell ${cellLabel} — Triggers`} accent="yellow" onClose={() => setTriggersOpen(false)} {...floatingProps('triggers', { w: 360, h: 380 })}>
                                <TriggerEditor
                                  triggers={triggersAtCell(cellTriggers, trigCol, trigRow)}
                                  events={['enter', 'interact']}
                                  templates={gotoTargets}
                                  enemyTypes={ENEMY_TYPES}
                                  onChange={next => setTriggersForCell(trigCol, trigRow, next)}
                                />
                              </FloatingPanel>
                            )}
                          </>
                        )
                      })()}
                      {/* Discoverable save right where you edit — persists floor colour, element colour & dims
                          with the template. Unnamed map → a toast, not a silent no-op (spec §4). */}
                      <button
                        onClick={() => { if (!templateName.trim()) { toast('Name your map in the top bar to save', 'warning'); return } void saveCurrentTemplate() }}
                        disabled={isSaving}
                        aria-label="Save map"
                        className="mt-2 w-full rounded bg-green-700 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-green-600 disabled:opacity-40"
                      >
                        {isSaving ? 'Saving…' : '💾 Save map'}
                      </button>
                    </Card>
                    <button onClick={() => setSelectedCells(new Set())} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Clear selection</button>
                  </>
                )
              }

              // Nothing selected — a compact hint (the redundant STYLE card is gone; style lives in the top-nav
              // 🎨 Style dropdown). Click an element and this Inspector morphs to its controls.
              return (
                <p className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] leading-tight text-gray-500">
                  Nothing selected — click an element on the canvas to edit it here.
                </p>
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

        {/* ↗ CONNECTORS — the whole connector flow in a DRAGGABLE/RESIZABLE floating panel (geometry persisted
            under id "connectors"), opened from the right-sidebar ↗ Connectors button. Same controls as before
            (Edit/Exit authoring, the saved list, and the target/when/spawn form) — just relocated. */}
        {connectorPanelOpen && !playMode && !showGamesView && (
          <FloatingPanel title="Connectors" accent="purple" onClose={closeConnectorPanel} {...floatingProps('connectors', { w: 320, h: 440 })}>
            <ConnectorsPanelBody
              connectorMode={connectorMode}
              onToggleMode={() => { setConnectorMode(m => !m); setEditingConnector(null) }}
              editing={editingConnector}
              editingLabel={editingConnector ? (selectedCells.size > 1 ? `${selectedCells.size} cells` : `(${editingConnector.col}, ${editingConnector.row})`) : ''}
              form={connectorForm}
              setForm={setConnectorForm}
              templates={savedTemplates.filter(t => t.id !== currentTemplateId)}
              onNewTarget={handleNewConnectorTarget}
              onSave={saveConnector}
              onDelete={() => { if (editingConnector) deleteConnector(editingConnector.col, editingConnector.row) }}
              onCancel={() => setEditingConnector(null)}
              connectors={connectors}
              onSelectConnector={c => {
                setSelectedEntityId(null)
                setConnectorForm(c)
                setEditingConnector({ col: c.cells[0].col, row: c.cells[0].row })
                setSelectedCells(new Set(c.cells.map(p => `${p.col},${p.row}`)))
                setConnectorMode(true)
              }}
            />
          </FloatingPanel>
        )}

        {/* ◰ TILE LIBRARY — lists the active style's tiles by category. A DRAGGABLE/RESIZABLE floating panel
            (geometry persisted under id "tileLibrary"), opened from the Inspector's "Add tile / Replace tile"
            button (which sits below Colour). For a UNIT it PINS the picked tile as a figure override; for a
            CELL selection it PAINTS the picked tile onto the selection via the SAME path as the left Paint
            tool (paintTileOnSelection). */}
        {tileLibraryOpen && (() => {
          const close = () => setTileLibraryOpen(false)
          const isUnit = !!selectedEntityId
          const cellPaint = !isUnit && selectedCells.size > 0
          const scope = isUnit
            ? 'unit'
            : cellPaint
            ? (selectedCells.size > 1 ? `${selectedCells.size} cells` : 'cell')
            : null
          // For a cell selection, picking a tile PAINTS it (resolve the TileDef by id, then reuse the left
          // paint path); for a unit it pins the figure override.
          const paintFromLibrary = (tileId: string | null) => {
            if (!tileId) return
            const picked = (Object.values(tilesForStyle(activeStyleId)).flat() as TileDef[]).find(t => t.id === tileId)
            if (picked) paintTileOnSelection(picked)
          }
          return (
            <FloatingPanel title={`Tile Library — ${activeStyle.name}${scope ? ` · ${scope}` : ''}`} accent="cyan" onClose={close} {...floatingProps('tileLibrary', { w: 420, h: 520 })}>
              {scope ? (
                <TileLibraryBody
                  styleId={activeStyleId}
                  styleName={activeStyle.name}
                  override={selectedOverride}
                  paint={cellPaint}
                  onPick={cellPaint ? paintFromLibrary : setSelectionOverride}
                />
              ) : (
                <p className="text-xs leading-relaxed text-gray-400">
                  Select a unit or a cell first (↖ Select tool), then reopen the Library to add / replace a tile.
                  The global style switch lives in the top bar 🎨.
                </p>
              )}
            </FloatingPanel>
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

/** The error-boundary fallback for the editor: a friendly card (never a blank white screen) + a one-shot
 *  toast, shown only if the editor throws while rendering. A render crash means we can't re-show the live
 *  builder, so we offer a reload — the data-load failures (tileset/game down) degrade to the usable default
 *  builder instead and never reach here. */
function EditorErrorFallback() {
  const { toast } = useToast()
  useEffect(() => {
    toast('The builder hit an unexpected error — reload to try again.', 'error')
  }, [toast])
  return (
    <div className="min-h-screen bg-gray-900 text-white font-mono flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-xl">Something went wrong loading the builder.</p>
      <p className="max-w-md text-sm text-gray-400">The editor hit an unexpected error. Your saved maps are safe — reload to try again.</p>
      <button
        onClick={() => window.location.reload()}
        className="rounded bg-gray-700 px-4 py-2 hover:bg-gray-600"
      >
        Reload
      </button>
    </div>
  )
}

/**
 * The page's real default export — the editor wrapped in an error boundary so a render-time crash from
 * missing/bad backend data shows the fallback + notification instead of an uncaught JS error / white screen.
 * `games/[id]` imports this default too, so the game view is covered by the same net.
 */
export default function TemplateEditorPage(props: { gameContext?: EditorGameContext } = {}) {
  return (
    <ErrorBoundary fallback={<EditorErrorFallback />}>
      <TemplateEditor {...props} />
    </ErrorBoundary>
  )
}


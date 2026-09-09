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
import { setTilePose, styleCatalog, styleTile, styleTiles } from '@/engine/tileset/styleTiles'
import Head from 'next/head'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { type GridAsset, IsometricGrid, FLOOR_TYPE } from '@/engine/IsometricGrid'
import { getStack, setTileHeight, setCellActAsTile, type TileEntry, type TileSource, unitStandLevel } from '@/engine/cellStack'
import { type AttackAnim, isAnimDone } from '@/engine/attackAnimations'
import { type BuildingType } from '@/engine/buildingTypes'
import { buildingCompositionKind, buildingPlaceLength, planComposition } from '@/engine/buildingCatalog'
import { buildCompositionPalette, type CompositionPaletteGroup } from '@/engine/compositionCatalog'
import { findTriggeredConnector, normalizeConnector } from '@/engine/connectors'
import { entityPalette, punchTile, weaponEmoji, weaponGlyph, weaponPose } from '@/engine/entityArt'
import { StageData, VariantId, type LayerId, type ForestLayout, generateStage, stagePaint, generatedPropRender } from '@/engine/stageGenerator'
import { type Action as TriggerAction, resolveAction } from '@/engine/triggers'
import { stagePropTileOverride, ZoneId, ROCK_SHADES, MUSHROOM_TONES, ZONE_FLOWERS, DEFAULT_FLOWERS } from '@/engine/zones'
import { varyIntensity } from '@/engine/colors'
import { type AbilityBinding, defaultAbilityLoadout, loadAbilityRegistry } from '@/game/abilities'
import { startingCombatState } from '@/game/combat'
import { DEFAULT_PLAYER_STATS, byKind, canPlaceEntity, entityAt, entityAtClick, entityAtFootprint, entityCollisionCells, makeEnemy, makeNpc, makePlayer, mintEntityId, placeEntity, removeEntity, withPlayerCell } from '@/game/entities'
import { cycleSelection, unitsInRange } from '@/game/unitSelection'
import { addItem, equipArmor, equipWeapon, itemFromReward, mintItemId, starterInventory, useConsumable } from '@/game/inventory'
import { createLoadout, loadoutBonuses, seededPlayerLoadout, setSpecial } from '@/game/loadout'
import { type Projectile } from '@/game/projectiles'
import { type QuestEvent, acceptQuest, turnIn } from '@/game/quests'
import { BARE_HANDS, type HitMarker, type PlayerHud, type ProjectileContext, playerHudFrom, stepCombat, tickProjectiles, triggerAbility } from '@/game/runtime/combat'
import { type PlayerState, aimFromKeys, facingFromKeys, playerDisplayName, resolveSpawnCell } from '@/game/runtime/player'
import { moveWorldDelta } from '@/game/runtime/cameraMovement'
import { MOVE_KEYS, isTypingTarget, matchEditorAction, type EditorActionId } from '@/game/shortcuts'
import { nextLevelName } from '@/game/autoNaming'
import { activeQuest, applyQuestEvent, questAnchorScreenPos, questForGiver, reachableQuestGiver, rewardSummary, upsertQuest } from '@/game/runtime/quest'
import { type EnemyRuntime, isLivingEnemy, makeEnemyRuntime, RANGED_RANGE } from '@/game/runtime/targeting'
import { ENEMY_TYPES, archetypeForEnemyType, scatterEntities } from '@/game/spawner'
import { type CombatState, type Entity, type EntityKind, type Inventory, type Loadout, type MovementPattern, type Quest, type Reward, type Stats, type TalentPath, type Weapon } from '@/game/types'
import { weaponReach } from '@/game/weapons'
import { VILLAGE_CONFIG } from '@/levels/village'
import { Connector, TemplateListItem, createTemplate, deleteTemplate, deserializeToGrid, getTemplate, listTemplates, serializeGrid, updateTemplate, updateGame } from '@/lib/api'
import { foldUnitData, splitUnitData } from '@/lib/unitDataPersistence'
import { type CellTriggerGroup, ENTITY_GLYPH, cellTriggersFromAssets, cellTriggersToAssets, entitiesFromAssets, entitiesToAssets, isEntityAsset, isQuestAsset, isStyleAsset, isTriggerAsset, questsFromAssets, questsToAssets, styleFromAssets, styleToAssets, triggersAtCell } from '@/lib/gridCodec'
import { type Trigger, type TriggerEffect, fireTriggers } from '@/game/runtime/trigger'
import { ASCII_STYLE, assetKind, entityKind, entityStyleOverride, genderize, groundKind, resolveVisual, styleById, TILE_CATEGORIES, tilesForStyle, type Style, type TileCategory, type TileDef, type Visual, visualForTileId } from '@/game/artStyle'
import { cellStackTop } from '@/engine/cellStack'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { render, render2D, renderTopView, clampCameraAxis, entityMotion, ENEMY_MOVE_MS, isDebugMode, setDebugMode, isShowCollisions, setShowCollisions as setCollisionsFlag, cellCaptionMap, pickIsoTilesAt, pickTwoDTilesAt, renderedTilesInRect, renderedTwoDTilesInRect, isoRecordedGeom, twoDRecordedGeom, nextPickIndex, ISO_BLOCK_H_FRAC, depthCells, tileGeomPolygon, tileGeomCentroid, tileHandlePoints, handleAtPoint, dragOutwardPx, scaleFromDrag, depthFromDrag, drawTileHandles, polyBBox, HANDLE_HIT_RADIUS, type TileHandle, type HandleId, type CompositionGhost, type DepthDir } from '@/engine/render'
import { isoWorldCellToScreen, setIsoCameraFacing, setIsoCameraTurn, isoCameraTurn } from '@/engine/render/iso'
import { type Orientation } from '@/engine/render/isoOrientation'
import { isoEditorCamera, isoEditorCellAt, isoEditorCellAnchor, type IsoEditorView } from '@/game/editor/isoEditorCamera'
import { loadTilesetsFromBackend, saveTilesetToBackend } from '@/engine/tileset/tilesetLoader'
import { loadItemCatalog } from '@/game/itemCatalog'
import { loadEntitiesFromBackend } from '@/engine/entity/entityLoader'
import { resolveTileHeight } from '@/engine/tileset/tileHeight'
import { type TilePose } from '@/engine/tileset/pose'
import { type AssetLight, type TileDisplay, type TileShape } from '@/engine/tileset/tileset'
import { type QuestDraft, emptyQuestDraft, questFromDraft } from '@/game/runtime/questDraft'
import { seedCharacterAnimations, needsAnimationReseed, entityAnimationsFromUnit, unitAnimationsFromEntity, randomMovementAnimation } from '@/game/runtime/entityAnimation'
import { stampBuildingKind, stampComposition } from '@/game/runtime/composition'
import { type Cursor, type JumpState, JUMP_MS, JUMP_PEAK_PX, advanceEnemyMovement, beginJump, tickCannons } from '@/game/runtime/movement'
import { playSwoosh } from '@/game/runtime/audio'
import { Card, EntityToolButton, ViewButton } from '@/components/game/controls'
import { CameraRotateButton, PlayerRangeControl, normalizePlayerViewRange, panKeepingCenter } from '@/components/game/cameraControls'
import { AbilityBar, CombatHud, QuestHud } from '@/components/game/hud'
import { EquipmentPanel, QuestAuthoringCard, QuestLogPanel } from '@/components/game/panels'
import { buildUnitModel, ConnectorsPanelBody, EntityAttackBody, FloatingPanel, Modal, QuestGiveBody, UnitSettingsSection, UnitStatsBody } from '@/components/game/modals'
import { FlowViewOverlay, GamesViewOverlay } from '@/components/game/games'
import { type BuildingTool, type EditorMode, type EntityTool, type RailEntry, type RailId, EDITOR_RAIL_STARTERS, RAIL_BY_MODE } from '@/components/game/editorConfig'
import { CanvasModeChip, HelpButton, HelpSheet } from '@/components/game/editorHelp'
import { canvasOverlayVisible, chromeRestoreVisible, chromeVisible } from '@/components/game/chromeVisibility'
import { useConfirm, usePrompt } from '@/components/game/useConfirm'
import { LevelStepper } from '@/components/game/levelStepper'
import { GameMenu } from '@/components/game/gameMenu'
import { describeSaveState } from '@/game/editor/saveState'
import { useDayNight, useFloatingPanels, useGeneratorCatalog, useInspectorSections, useIsMobile, usePlayerViewRange, useSaveState } from '@/components/game/editorHooks'
import { findGenerator, rollGridSize, type GeneratorBuildings, type GeneratorCatalog, type GeneratorDef } from '@/lib/generatorCatalog'
import { clampMapSize, type MapSize } from '@/lib/mapSize'
import { applyStageToGrid } from '@/game/editor/applyStage'
import { makeRng } from '@/lib/math'
import { RulesWorkspace } from '@/components/game/rulesWorkspace'
import { connectionRows, questBlockedReason, questRows, triggerBlockedReason, triggerRows, type RulesTabId } from '@/game/editor/rulesWorkspace'
import { CompositionPalette, Dropdown, UnitPlacementBody, FpsReadout, GenerateControls, PoseControls, PropertiesPanel, type TileControlModel, SelectionHeader, StylePicker, TileAnimationEditor, TileLibraryBody, TilePalette, ToolRail, TriggerEditor, UnitPicker, WEAPON_KINDS, ViewBar } from '@/components/game/editorChrome'
import type { Animation as TileAnim } from '@/engine/animation/tileAnimation'
import { useFps, useRenderMs } from '@/components/useFps'
import { commonValue, commonBool, cellsFromKeys, removeSelectedBlock, resolveSelectionTargets } from '@/game/editor/selectionEdit'
import { editMap } from '@/game/editor/mapEdit'
import { applyRectSelection, applyCellSelection, blockKeyForPick } from '@/game/editor/selection'
import { copyTiles, pasteTiles, type TileClip } from '@/game/editor/clipboard'
import { entityKindForUnitTile, isCharacterTile, placementFor, tileSlug } from '@/game/editor/tilePlacement'
import { clearGroundTile, placeGround, placeGroundTile, removeTopAsset, removeAssetAtLevel, stackAssetTile, replaceTileInPlace, visualChar } from '@/game/editor/tileBrush'
import { ArtStyleControl } from '@/components/game/shell/ArtStyleControl'
import { LevelMinimap } from '@/components/game/shell/LevelMinimap'
import { GuidesPanel } from '@/components/game/shell/GuidesPanel'
import { MapPreview } from '@/components/game/shell/MapPreview'
import { type PreviewContext } from '@/components/game/shell/PreviewThumb'
import { type SectionPresenter } from '@/components/game/editorInspector'
import { subjectFor } from '@/engine/preview/previewScene'
import { SwapTilePanel } from '@/components/game/shell/SwapTilePanel'
import { NO_ZONES_SHUT, ZoneCollapse, zoneClasses, type EditorZoneId, type EditorZoneShut } from '@/components/game/shell/ZoneCollapse'
import { HudOverlay, PlayerUiPanel, useHudLayout } from '@/components/game/shell/PlayerUiPanel'
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
  /** The game's name — §4.4's `🎮 Boss ▾`. §3.2 measured that the editor showed no game identity at all. */
  gameName: string
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
  // §4.3's view bar reads `🔍 100%`. The RAF loop owns the zoom in a ref (so it never re-renders per frame);
  // this mirrors it for the bar only, on the wheel, which is the only thing that changes it.
  const [zoomPct, setZoomPct] = useState(100)
  // The grid's MATRIX VARIABLES, mirrored for the panel: `cols × rows` cells of `cellSize` pixels each.
  const [gridSize, setGridSize] = useState({ cols: 40, rows: 40, cellSize: VILLAGE_CONFIG.cellSize })
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
  const selectionStartPtRef = useRef<{ x: number; y: number } | null>(null) // drag-start CLIENT point — the screen-rect marquee's fixed corner (iso/2d block-aware select)
  const clipboardRef = useRef<TileClip | null>(null)       // Ctrl+C payload — the captured tiles re-stamped by Ctrl+V at the hovered cell
  const selectedCellsRef = useRef<Set<string>>(new Set())
  // Camera panning with mouse drag
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  // Click-vs-drag in the play views: a clean click selects the entity under it, a drag pans.
  const dragMovedRef = useRef(false)
  const downCellRef = useRef<{ col: number; row: number; stackIndex?: number; source?: TileSource; entityId?: string } | null>(null)
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
  // §4.5's `Place as` row. Alexander, 2026-09-08: *"An enemy is just a setting, a unit set as enemy. We can
  // have friendly pets or enemy animals, and the same applies to pretty much all units."* So hostility is a
  // choice about the thing you are PLACING, not a property of the tile: 'auto' takes the catalog's role,
  // 'enemy'/'npc' override it. A bear can be a pet.
  const [placeAs, setPlaceAs] = useState<'auto' | 'enemy' | 'npc'>('auto')
  // §4.5's `★ RECENT` — the last eight tiles placed, newest first. Held by the PAGE so it survives
  // switching rails (the palette unmounts when you leave Terrain), and de-duplicated so re-placing the
  // same tile does not fill the row with one label.
  const [recentTiles, setRecentTiles] = useState<TileDef[]>([])
  const rememberRecent = useCallback((tile: TileDef) => {
    setRecentTiles(prev => [tile, ...prev.filter(t => t.id !== tile.id)].slice(0, 8))
  }, [])
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

  // ISO CAMERA FACING (#75) — which of the map's 4 corners the camera looks from, quarter-turns CW.
  // Alexander: "the rotate button or action … just rotates the map horizontally, changing the front perspective
  // of the map and showing a different side of it" / "4 corners, 4 rotation options, all faces of the map are
  // visible". React owns it (the nav button reads it, the render + every click projection take it); a ref
  // carries it into the once-mounted RAF loop. Only ISO rotates — 2D/Top have no rotation.
  const [cameraFacing, setCameraFacing] = useState<Orientation>(0)
  const cameraFacingRef = useRef<Orientation>(0)

  // PLAYER-CAMERA RANGE (iso only): the radius in cells the iso render culls to (drawing a ring at the edge).
  // DEFAULT OFF (undefined = today's full-window render, no regression). React owns it (the nav control sets it);
  // a ref carries it into the once-mounted RAF loop, like cameraFacing. PERSISTED via /api/editor_settings.
  const { playerViewRange, setPlayerViewRange, playerViewRangeRef } = usePlayerViewRange()

  // Stage generator: selected zone (the variant is chosen per click)
  const [genZone, setGenZone] = useState<ZoneId>('spring')
  // The backend's generator catalog — every map type, its layouts and every knob a generate takes
  // (`GET /api/generators`, T-113 / §3.14b Tier-1 #1). The menu renders from it and every generate READS
  // its config; a ref carries it into the once-mounted debug seams, like genZoneRef.
  const { catalog: generatorCatalog, error: generatorCatalogError } = useGeneratorCatalog()
  const generatorCatalogRef = useRef<GeneratorCatalog>(generatorCatalog)

  // Connector state
  const [connectors, setConnectors] = useState<Connector[]>([])
  // Destructive actions ask through the app's own Modal, never `window.confirm` (§5.1).
  const { confirm, dialog: confirmDialog } = useConfirm()
  const { prompt, dialog: promptDialog } = usePrompt()

  // The `? Help` shortcut sheet (§4.9). Opened by the view-bar button and by `?` / F1; the sheet
  // itself closes on Esc/backdrop (Modal does that).
  const [helpOpen, setHelpOpen] = useState(false)
  const [guidesOpen, setGuidesOpen] = useState(false)

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
    setTilePose(activeStyleId, kind, pose)
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
  const hoveredCellRef = useRef<{ col: number; row: number; stackIndex?: number } | null>(null) // TILE under the cursor (stackIndex = its slot in the cell's stack) — RAF draws a dim hover ring on the SAME tile the click selects
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
  // The UNIT settings panel — hosts the SAME FloatingPanel + shared settings body a tile uses (colour/scale/
  // pose). The unit's identity/vitals/inventory live on the CARD now, so this modal is tile-only for a unit.
  // The UNIT stats panel — the "⛊ Stats…" button's draggable/resizable modal (HP/DEF/STR/INT/DODGE% +
  // hittable + respawn). Name/size stay as rows on the card; collision is the card's Blocked/Walkable toggle.
  const [unitStatsOpen, setUnitStatsOpen] = useState(false)
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
    setUnitStatsOpen(false)
    setTriggersOpen(false)
    setUnitAttacksOpen(false)
  }, [selectedEntityId])
  // ── Floating-panel geometry (backend-owned editor settings) ─────────
  // Each movable/resizable modal (settings / animation / triggers / attacks / tileAnimation) remembers its
  // position + size in nebulith. Load the whole map once on mount; on every move/resize END, upsert the one
  // key (debounced). The backend owns this, so panel geometry is never hardcoded in the frontend.
  // FloatingPanel props for a modal id: restore its saved geometry (else `def`) + persist on move/resize end.
  const floatingProps = useFloatingPanels()
  // ⚑ RULES (§4.8) — which tab of the Logic workspace is open. Local: it is a view preference within one
  // panel, not something a reload needs to restore.
  const [rulesTab, setRulesTab] = useState<RulesTabId>('triggers')
  // The rules the LEVEL holds, from both stores at once — §4.8 lists cell rules and character rules
  // together, because a person thinks in rules, not in which store one happens to live in.
  const npcsOnLevel = useMemo(() => entities.filter(e => e.kind === 'npc'), [entities])
  const ruleTriggerRows = useMemo(
    () => triggerRows({
      cells: cellTriggers.map(g => ({ col: g.col, row: g.row, triggers: g.triggers })),
      units: entities
        .filter(e => e.triggers?.length)
        .map(e => ({ id: e.id, name: e.name || e.kind, col: e.col, row: e.row, triggers: e.triggers ?? [] })),
    }),
    [cellTriggers, entities],
  )

  // Quest authoring opened from the RULES panel rather than from a selected NPC. §3.8 measured the old
  // route as a silent dead end: the only way in was Select → click an NPC → scroll its card, so a level
  // with no NPC offered no entry and no explanation.
  const [questPanelOpen, setQuestPanelOpen] = useState(false)

  // Which inspector sections are open (§4.7) — remembered per section in the backend's editor-settings store.
  const { isOpen: inspectorSectionOpen, toggle: toggleInspectorSection } = useInspectorSections()

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
  // `undo`/`redo` were already returned and simply never taken — the hook binds Ctrl+Z/Ctrl+Y itself, so
  // the top bar's ↶/↷ needed no new code, only these two names.
  const { checkpoint: rawCheckpoint, reset: resetHistory, undo: undoEdit, redo: redoEdit } = useEditorHistory({
    gridRef,
    entitiesRef,
    setEntities,
    onRestore: bumpBuildingVersion,
  })
  // Does the open map have unsaved edits? (§4.4, and Week 3's prerequisite per §5.3 — the level switcher may
  // not step away from work without asking.) Every map mutation ALREADY announces itself by taking an undo
  // checkpoint first, so the dirty flag rides that one seam instead of inventing a second notion of
  // "changed" that a future call site could forget to update.
  const { saveState, markEdited, markSaving, markSaved, markLoaded, saveStateRef } = useSaveState()
  const checkpointHistory = useCallback(() => { rawCheckpoint(); markEdited() }, [rawCheckpoint, markEdited])
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
  // Mirror the whole loadout map for the save path (which reads refs, not state), so a save folds every
  // unit's CURRENT gear onto its entity (lib/unitDataPersistence.foldUnitData).
  const loadoutsRef = useRef<Record<string, Loadout>>(loadouts)
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
    __player__: defaultAbilityLoadout(),
  })
  const playerAbilityLoadoutRef = useRef<readonly AbilityBinding[]>(defaultAbilityLoadout())
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

  // Keep the camera facing in sync with BOTH consumers: the RAF loop's ref and the engine's module seam, so
  // `window.__cameraFacing()` and a param-less render() report the facing the UI is actually showing.
  useEffect(() => {
    cameraFacingRef.current = cameraFacing
    setIsoCameraFacing(cameraFacing)
  }, [cameraFacing])

  // Rotate the camera and KEEP THE VIEW ANCHORED: rotate the pan by the facing delta so the world point you
  // were looking at stays centred (the map turns around it, no jump). Pure math in `panKeepingCenter`.
  // The in-flight turn ANIMATION's rAF id (null = settled). "Driving setIsoCameraTurn from an animation frame IS
  // the rotation animation" (iso.ts): render() reads the CONTINUOUS module turn every frame, so easing it makes
  // the world visibly SPIN to the next corner instead of snapping. The discrete facing is committed only on
  // settle, so every facing-derived read (spans, clamp dims, movement) stays exact.
  const turnAnimRef = useRef<number | null>(null)
  useEffect(() => () => { if (turnAnimRef.current !== null) cancelAnimationFrame(turnAnimRef.current) }, [])

  const rotateCameraTo = (to: Orientation) => {
    const from = isoCameraTurn() // the LIVE continuous turn — re-clicking mid-spin continues from where it is
    const delta = (((to - from) % 4) + 4) % 4 // always the CW way round, matching the button's +1 step
    if (delta === 0) return
    const pan0 = camOffsetRef.current
    const pan1 = panKeepingCenter(pan0, cameraFacingRef.current, to)
    if (turnAnimRef.current !== null) cancelAnimationFrame(turnAnimRef.current)
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
    const t0 = now()
    const DURATION_MS = 260
    const step = () => {
      const k = Math.min(1, (now() - t0) / DURATION_MS)
      const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2 // easeInOutQuad — spins out, settles in
      setIsoCameraTurn(from + delta * e)
      // The pan eases WITH the turn so the point you were looking at stays centred through the whole spin.
      camOffsetRef.current = { x: pan0.x + (pan1.x - pan0.x) * e, y: pan0.y + (pan1.y - pan0.y) * e }
      if (k < 1) { turnAnimRef.current = requestAnimationFrame(step); return }
      turnAnimRef.current = null
      camOffsetRef.current = pan1
      setCamOffset(pan1)
      setCameraFacing(to) // settle EXACTLY on the corner (the effect writes the whole turn)
    }
    turnAnimRef.current = requestAnimationFrame(step)
  }

  // Carry the player-camera range into the RAF loop's ref, and expose the same debug seam idiom as the camera
  // facing (`window.__setPlayerViewRange(n)` / `__playerViewRange()`): a Playwright/QA probe can set or read the
  // range without touching the DOM control. A non-positive/invalid `n` turns it OFF (undefined = full render).
  useEffect(() => {
    playerViewRangeRef.current = playerViewRange
    const win = window as unknown as {
      __setPlayerViewRange?: (n: number | undefined | null) => number | undefined
      __playerViewRange?: () => number | undefined
    }
    win.__setPlayerViewRange = (n) => { const next = normalizePlayerViewRange(n); setPlayerViewRange(next); return next }
    win.__playerViewRange = () => playerViewRangeRef.current
  }, [playerViewRange])

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
  // rAF (and therefore `fps`) is capped by the display refresh — 60 on a 60Hz screen no matter how much
  // headroom the engine has. The active view's per-frame COST is the number that shows real performance.
  const renderMs = useRenderMs(viewType === '2d' ? '__2dRenderMs' : '__isoRenderMs')
  // TILESET LOADING GATE — the frontend ships NO bundled tile data, so the map cannot be drawn until the
  // backend tileset is installed. `tilesetReady` gates the RAF render (via tilesetReadyRef) AND the canvas
  // overlay below: until it flips true we show a loader (never a frontend-tile flash); on an empty/failed
  // load `tilesetError` shows a retry state. This is the "loader → correct DB style, nothing in between"
  // the user asked for — there is deliberately no fallback to frontend tiles.
  const [tilesetReady, setTilesetReady] = useState(false)
  const [tilesetError, setTilesetError] = useState(false)
  const tilesetReadyRef = useRef(false) // live flag the gameLoop reads each frame (mirrors tilesetReady)
  useEffect(() => { tilesetReadyRef.current = tilesetReady }, [tilesetReady])

  // Fetch + install the backend DATA the render needs — the tilesets (the ONLY source of runtime tiles)
  // AND the entity resolution (enemyType/variant → baked slug). BOTH must be ready before the gate opens:
  // the render resolves entities in the same pass, so opening on tiles alone would flash enemies with no
  // per-type figure. "Ready" for the tilesets means the baked PNG IMAGES are DECODED too, not just the JSON
  // installed — loadTilesetsFromBackend awaits preloadTileImages before it resolves, so the first painted
  // frame draws every tile as its image (no brick-glyph / crate-hero flash while rasters decode). On an
  // empty/failed load of EITHER we surface the error state (a retry) and keep the render gated. We NEVER
  // fall back to frontend data.
  const loadTiles = useCallback(() => {
    setTilesetError(false)
    // The ITEM catalog rides along (§3.14b #1): the bag, the equip panel and the starter kits all read it,
    // and it is backend data like the tiles. It does NOT gate the render — a map draws fine with an empty
    // bag, so a failed item load must not black out the editor.
    void loadItemCatalog()
    void loadAbilityRegistry()
    Promise.all([loadTilesetsFromBackend(), loadEntitiesFromBackend()])
      .then(([loaded, entitiesLoaded]) => {
        if (loaded.length === 0 || !entitiesLoaded) { setTilesetError(true); return }
        // Build the Tile-composition palette from the just-loaded tileset — EVERY composition the backend
        // serves (buildings + trees + fountains + lamp posts…), grouped for the panel. Data-driven, so a new
        // backend composition appears in the palette with no frontend change.
        setCompositionPalette(buildCompositionPalette(styleCatalog('ascii')))
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

  /**
   * Navigate AWAY from the editor, asking first if that would lose work (§3.15: "`+ New template` /
   * `<- Templates` navigate out of the game without warning — an unsaved map is lost with no prompt").
   * One helper, so every exit gets the same guard instead of each `<Link>` deciding for itself.
   */
  const leaveTo = async (href: string) => {
    if (saveStatus.wouldLoseWork) {
      const leave = await confirm({
        title: 'Leave the editor?',
        body: `"${templateName || 'This level'}" has unsaved changes. They will be lost.`,
        confirmLabel: 'Leave without saving',
      })
      if (!leave) return
    }
    void router.push(href)
  }

  // Renaming the GAME (§4.4). A rename genuinely needs input, so it asks — through the app's own prompt,
  // never `window.prompt` (§5.1). Optimistic: the bar shows the new name immediately and the PUT follows.
  const [gameNameOverride, setGameNameOverride] = useState<string | null>(null)
  const renameGame = async () => {
    if (!gameContext) return
    const current = gameNameOverride ?? gameContext.gameName
    const next = await prompt({
      title: 'Rename game',
      body: 'What should this game be called?',
      label: 'Game name',
      initial: current,
      confirmLabel: 'Rename',
    })
    if (!next || next === current) return
    setGameNameOverride(next)
    await updateGame(gameContext.gameId, { name: next }).catch(err => {
      setGameNameOverride(current) // the write failed — put the name the server still holds back on screen
      console.warn('Failed to rename the game', err)
      toast('Could not rename the game', 'error')
    })
  }

  // This game's levels, IN ORDER — the ids the game owns, resolved to the names the user knows them by.
  // A member template that no longer exists is dropped rather than rendered as a mystery row.
  const gameLevels = gameTemplateIds
    .map(id => { const t = savedTemplates.find(x => x.id === id); return t ? { id, name: t.name } : null })
    .filter((l): l is { id: string; name: string } => l !== null)
  // Re-described each render so "Saved 12s ago" actually counts up as the page re-renders (§4.4).
  const saveStatus = describeSaveState(saveState, Date.now())

  // §5.2's prerequisite for the Week-2 bar split: ONE answer to "is the editor chrome on screen".
  // It was asked in six places in three shapes; splitting the top bar into a PROJECT bar and a VIEW bar
  // doubles the regions that must agree, and a condition copied seven times is one that will drift.
  const chrome = { showSidebars, playMode, showGamesView, showFlowView }
  const isChromeVisible = chromeVisible(chrome)
  const isCanvasOverlayVisible = canvasOverlayVisible(chrome)

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

  // The placeable CHARACTER tiles of the active style — the library §4.5 gives the rail. One derivation, so
  // the rail panel and the (transitional) top-bar dropdown can never show different creatures.
  const unitTiles = tilesForStyle(activeStyleId).units.filter(t => placementFor(t) === 'entity')

  // §4.5 (Week 4): the rail is the ONE switcher for everything you place, plus the workspaces that are not
  // tools. `generate` and `rules` open a PANEL rather than arming anything, so the rail's selection is a
  // RailId — not the tool state — and the two are mapped in one place instead of inferred at each call.
  const [railPanel, setRailPanel] = useState<RailId | null>(null)
  // The ⋯ More menu, and the player's-UI mode. Both belong to the shell and nothing else reads them.
  const [moreOpen, setMoreOpen] = useState(false)
  const [hudMode, setHudMode] = useState(false)
  const hudLayout = useHudLayout()
  // The level map. Shown by default because it answers "where am I?" — the question you have most often —
  // and hideable, which is how the HUD version will work too.
  const [levelMapOpen, setLevelMapOpen] = useState(true)
  /**
   * What the open library is pointing at, and whether the placement panel is up.
   *
   * The hovered/armed label lives HERE rather than in the library because the PREVIEW is a different zone
   * now. Alexander, 2026-09-09: *"why do we have the preview in the same panel and not a separate panel next
   * to the selected element?"* — stacking it above the grid left the grid as a clipped sliver.
   */
  const [libraryHover, setLibraryHover] = useState<string | null>(null)
  const [placementOpen, setPlacementOpen] = useState(false)


  // Which zones are folded away. Alexander, 2026-09-08: *"all sidebards and panels should be collapsable."*
  const [zoneShut, setZoneShut] = useState<EditorZoneShut>(NO_ZONES_SHUT)
  const toggleZone = (zone: EditorZoneId) => setZoneShut(z => ({ ...z, [zone]: !z[zone] }))
  /**
   * THE one answer to "is anything selected". The inspector's own precedence is unit → connector → cell, so
   * this is that same list, asked once. Alexander: *"we don't need the right panel if there's nothing
   * selected"* — with nothing selected the zone has nothing to say, so it is not rendered at all and the
   * map takes its 300px. That is different from COLLAPSING it, which leaves a strip to reopen: there is
   * nothing to reopen here, and it comes back the moment you click something.
   */
  const hasSelection = selectedEntityId !== null || editingConnector !== null || selectedCells.size > 0
  // THE one answer to "which rail panel is showing". Every panel below gates on THIS, and nothing else.
  //
  // Alexander, 2026-09-08: *"when I click an option in the sidebar, it opens below the previous opened
  // option"*. The cause was two gating variables: the three LIBRARY panels tested `editorMode` (a canvas
  // mode — what a click does) while the three WORKSPACE panels tested `railPanel` (which panel is open).
  // Opening Characters set the mode to `unit`; opening Generate then set `railPanel` and left the mode
  // alone, so BOTH cards rendered — Characters first, Generate below it and off-screen past 67 creatures.
  // Every rail option after the first one looked broken, and it hid controls that exist (the tile search).
  const activeRailId: RailId = railPanel ?? RAIL_BY_MODE[editorMode]

  /**
   * The counts the rail shows. Read from the loaded catalog, so they are the real numbers and cannot drift
   * from what the panel then lists. `units` splits: a figure with a `unitRole` is a CHARACTER, and the
   * twelve without one (arrow, nova, fire-slash…) are what a POWER draws — they are not characters and are
   * counted with the tiles, where they are at least findable.
   */
  /** Which library is open, in the preview's vocabulary. Null when the panel is not a library. */
  const libraryKind: 'tiles' | 'objects' | 'chars' | null =
    activeRailId === 'terrain' ? 'tiles' : activeRailId === 'objects' ? 'objects' : activeRailId === 'characters' ? 'chars' : null
  /** The label the preview shows: what the cursor is over, else whatever is armed. */
  const previewLabel =
    libraryHover ??
    (activeRailId === 'objects' ? buildingTool
      : activeRailId === 'characters' ? (unitTile ? tileSlug(unitTile.id) : null)
      : armedTile ? tileSlug(armedTile.id) : null)
  /** The preview takes the right zone only while a library is open and nothing on the map is selected. */
  /**
   * THE PREVIEW is a movable panel beside the LEFT panel, not a sidebar zone.
   *
   * Alexander, 2026-09-09: *"we reused th right sidebar for previews, which wasn't what I requested, i
   * requested a movable preview modal next to the left panel..."* The right-zone version is deleted — it
   * reproduced exactly the cramming he predicted when he first asked for movable modals.
   */
  const previewSubject = subjectFor(libraryKind, previewLabel, activeStyleId)
  /**
   * How every swatch and the preview panel should draw a thing: the view you are looking through, the zone
   * whose ground it stands on, and the art style. One object so a library takes one prop, not four — and so
   * the swatches and the big preview cannot be handed different answers.
   */
  const previewContext: PreviewContext = {
    // Flow is a graph of levels, not a projection of a tile, so it has no picture of its own — the
    // thumbnails hold the top-down view while you are in it rather than going blank.
    view: activeView === 'flow' ? 'top' : activeView,
    zone: genZone,
    style: activeStyle,
    styleId: activeStyleId,
  }
  const [previewOpen, setPreviewOpen] = useState(true)

  /**
   * WHERE AN INSPECTOR SECTION'S CONTROLS GO — a movable panel beside the inspector.
   *
   * Alexander, 2026-09-09: *"the right sidebar is still too full of stuff, we should have movable modals for
   * each section/group of actions."* The sidebar keeps the six rows and their summaries; opening one lifts
   * its controls into a panel you can drag, resize and leave open while you work on the map.
   *
   * The page supplies this rather than the inspector importing a panel — see `SectionPresenter`. Geometry
   * persists per section under its own key, so each one reopens where it was left.
   */
  const presentInspectorSection: SectionPresenter = (id, title, body, onClose) => (
    <FloatingPanel
      key={id}
      title={title}
      accent="cyan"
      openBeside=".z-insp"
      onClose={onClose}
      {...floatingProps(`inspector.panel.${id}`, { w: 330, h: 380 })}
    >
      {body}
    </FloatingPanel>
  )


  const railCounts = useMemo(() => {
    const groups = tilesForStyle(activeStyleId)
    const characters = groups.units.filter(t => isCharacterTile(t.settings)).length
    const tiles = TILE_CATEGORIES.reduce((n, c) => n + (c === 'units' ? groups.units.length - characters : groups[c].length), 0)
    return { terrain: tiles, objects: compositionPalette.reduce((n, g) => n + g.items.length, 0), characters }
  }, [activeStyleId, compositionPalette, buildingVersion])
  const pickRail = (entry: RailEntry) => {
    // The player's UI is a MODE, not a panel: it puts the editor into the hybrid layout mode where the HUD
    // is dragged on the running game, so it cannot share the one panel slot.
    if (entry.id === 'hud') { setHudMode(on => !on); return }
    setHudMode(false)
    // A workspace entry toggles its panel; a library entry OPENS its panel and switches what a click does.
    if (entry.mode === null) { setRailPanel(id => (id === entry.id ? null : entry.id)); return }
    // The rail records WHICH PANEL is open, including for the libraries. It used to set this to null and let
    // `RAIL_BY_MODE[editorMode]` infer the panel from the armed tool — which only worked while opening a
    // library also armed something. Now that browsing arms nothing (see `selectMode`), an inferred panel
    // would resolve to the resting state and throw you back to New world the moment you opened a library.
    setRailPanel(entry.id)
    selectMode(entry.mode)
  }


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
  useEffect(() => { generatorCatalogRef.current = generatorCatalog }, [generatorCatalog])

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

  // Auto-save unit gear: "all interactions with the objects that can be picked and added to inventory
  // trigger a database save" (Alexander). Every equip/unequip/drop/reorder mutates `loadouts`/`inventory`,
  // so a debounced effect folds the live gear onto the entities and PATCHes JUST the `entities` field — a
  // targeted write, not a full grid re-save. Only fires once a stage is saved (needs an id to patch), and
  // skips the fire the load-restore itself provokes (suppressUnitAutoSaveRef).
  const suppressUnitAutoSaveRef = useRef(false)
  useEffect(() => {
    if (suppressUnitAutoSaveRef.current) {
      suppressUnitAutoSaveRef.current = false
      return
    }
    const id = currentTemplateId
    if (!id) return // nothing to patch until the stage has been saved once
    const handle = setTimeout(() => {
      updateTemplate(id, { entities: foldUnitData(entitiesRef.current, loadouts, inventory) }).catch(err =>
        console.error('Failed to auto-save unit gear:', err),
      )
    }, 600)
    return () => clearTimeout(handle)
  }, [loadouts, inventory, currentTemplateId])

  // Player LOADOUT → combat refs: the equipped weapon, a shield's block%, and gear
  // stat bonuses (str/int/defense/dodge) feed the live fight, so equipping in the
  // inventory panel actually changes how you play.
  useEffect(() => {
    loadoutsRef.current = loadouts // keep the save/auto-save fold reading the live map
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
    playerAbilityLoadoutRef.current = abilityLoadouts['__player__'] ?? defaultAbilityLoadout()
  }, [abilityLoadouts])

  // Keep quests ref in sync so the once-mounted game loop reads the latest quests
  useEffect(() => {
    questsRef.current = quests
  }, [quests])

  // The live ISO camera the click/overlay projections read — built from the SAME refs the RAF loop hands
  // render(), INCLUDING the facing, so a rotated map picks and highlights the cell you actually see. One seam
  // (isoEditorCamera) owns the diamond math for both directions; nothing here re-derives it.
  const isoEditorView = (canvas: HTMLCanvasElement, grid: IsometricGrid): IsoEditorView => ({
    canvasW: canvas.width,
    canvasH: canvas.height,
    cellSize: grid.cellSize,
    isoScale: grid.isoScale * isoZoomRef.current,
    playerX: playerRef.current.x,
    playerZ: playerRef.current.z,
    camOffsetX: camOffsetRef.current.x,
    camOffsetY: camOffsetRef.current.y,
    cols: grid.cols,
    rows: grid.rows,
    facing: cameraFacingRef.current,
    clampCamera: playModeRef.current, // the iso render clamps ONLY in play mode; dev mode pans freely
  })

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
      // Isometric: ONE seam inverts the diamond with the SAME facing-aware camera the render draws with — the
      // #38/#70 edge clamp (play mode only) AND the #75 rotation. Re-deriving it here is what used to let
      // clicks land 3–4 cells off; under rotation it would have picked the un-rotated mirror cell.
      const c = isoEditorCellAt(x, y, isoEditorView(canvas, grid))
      col = c.col
      row = c.row
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
  const pickIsoBlockAt = (clientX: number, clientY: number): { col: number; row: number; stackIndex: number; source: TileSource; entityId?: string } | null => {
    const hit = renderedTilesUnder(clientX, clientY)?.tiles[0]
    return hit ? { col: hit.col, row: hit.row, stackIndex: hit.stackIndex, source: hit.source, entityId: hit.entityId } : null
  }

  // The cell a click SELECTS/edits: the rendered tile under the pointer first (so a click on a tall/lifted tile
  // picks THAT tile, not the ground under it), else the flat screenToCell — unchanged for empty cells, 2D, top.
  const pickCellForSelect = (clientX: number, clientY: number): { col: number; row: number; stackIndex?: number; source?: TileSource; entityId?: string } | null => {
    const tile = pickIsoBlockAt(clientX, clientY)
    if (tile) return tile
    const flat = screenToCell(clientX, clientY)
    return flat ? { col: flat.col, row: flat.row } : null // a bare-cell pick — no tile slot, no tile source
  }

  // Click-to-cycle: repeated clicks on the SAME spot walk front→back through the OVERLAPPING tiles there, so an
  // OCCLUDED tile is reachable without moving the camera (the pick correctly returns the visible top tile — not
  // a geometry bug). ONLY call this from a discrete mousedown; hover must keep using pickCellForSelect (the
  // frontmost), or it would advance the cycle.
  const lastPickRef = useRef<{ x: number; y: number; index: number } | null>(null)
  const PICK_CYCLE_TOL = 8 // canvas px — a click within this of the last one keeps cycling; farther resets to front
  const pickCellForSelectCycling = (clientX: number, clientY: number): { col: number; row: number; stackIndex?: number; source?: TileSource; entityId?: string } | null => {
    const under = renderedTilesUnder(clientX, clientY)
    if (under && under.tiles.length > 0) {
      const idx = nextPickIndex(lastPickRef.current, under.x, under.y, under.tiles.length, PICK_CYCLE_TOL)
      lastPickRef.current = { x: under.x, y: under.y, index: idx }
      const hit = under.tiles[idx]
      return { col: hit.col, row: hit.row, stackIndex: hit.stackIndex, source: hit.source, entityId: hit.entityId }
    }
    lastPickRef.current = null // clicked off any tile → reset the cycle
    const flat = screenToCell(clientX, clientY)
    return flat ? { col: flat.col, row: flat.row } : null // a bare-cell pick — no tile slot, no tile source
  }

  // The stack index (0 = floor, 1.. = stacked) the TILE inspector should show for a click. A picked RAISED
  // block maps to its stack position (its heightLevel → its slot in the sorted stack); a flat pick with no
  // specific block defaults to the TOP tile — or the floor (0) when the cell is bare. Drives selectedTileLevel.
  const levelForPickedCell = (c: { col: number; row: number; stackIndex?: number; source?: TileSource }): number => {
    // A picked TILE carries its own STACK INDEX (its slot in the cell's ordered stack) — the exact slot the
    // inspector edits. Grass/road/wall/roof/decor all resolve the SAME way: their stack slot IS the answer, so
    // two tiles at the same level no longer collapse to one (the "clicking the column selected the grass" fix).
    if (c.stackIndex !== undefined && c.stackIndex >= 0) return c.stackIndex // -1 = a unit pick → fall to the base logic
    const grid = gridRef.current
    if (!grid) return 0
    // A flat/bare pick (no tile under the pointer) → default the inspector to the TOP loose ASSET, or the base
    // (index 0) on a bare/floor-only cell — a plain ground click never auto-selects a raised block.
    const stack = getStack(grid, c.col, c.row)
    let top = 0
    stack.forEach((t, i) => { if (t.source === 'asset') top = i })
    return top
  }

  // Grid cell → viewport screen coords (the FORWARD of screenToCell above). Used to
  // glue the on-canvas quick-action toolbar over the selected element for the ACTIVE
  // view. Returns the cell CENTRE (col+0.5, row+0.5) in viewport pixels, or null when
  // there's no canvas/grid yet. Kept in lockstep with screenToCell's clamped camera so
  // the toolbar sits exactly where the selection highlight draws.
  // Grid cell CENTRE → CANVAS-INTERNAL pixels (the backing-store space the render registry records tile
  // silhouettes in). This is the CORE projection cellToScreen wraps — cellToScreen just adds the canvas
  // rect offset/scale to reach CLIENT pixels. The block-aware marquee compares cell centres against recorded
  // silhouettes (both canvas-internal), so it reads THIS directly — ONE projection, no drift between the
  // quick-action toolbar (cellToScreen) and the marquee's ground-cell coverage test.
  const cellToCanvas = (col: number, row: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return null

    const cs = grid.cellSize
    const px = playerRef.current.x
    const pz = playerRef.current.z
    const cam = camOffsetRef.current
    const cc = col + 0.5
    const rr = row + 0.5

    if (topViewMode) {
      const tileSize = 16 * zoomRef.current
      const fCol = clampCameraAxis(px / cs - cam.x / tileSize, canvas.width / tileSize / 2, grid.cols)
      const fRow = clampCameraAxis(pz / cs - cam.y / tileSize, canvas.height / tileSize / 2, grid.rows)
      return { x: cc * tileSize + (canvas.width / 2 - fCol * tileSize), y: rr * tileSize + (canvas.height / 2 - fRow * tileSize) }
    }
    if (viewTypeRef.current === '2d') {
      const tileW = 24 * zoomRef.current
      const camCol = clampCameraAxis(px / cs - cam.x / tileW, canvas.width / tileW / 2, grid.cols)
      const camRow = clampCameraAxis(pz / cs - cam.y / tileW, canvas.height / tileW / 2, grid.rows)
      return { x: canvas.width / 2 + (cc - camCol) * tileW, y: canvas.height / 2 + (rr - camRow) * tileW }
    }
    // Same seam, same camera as screenToCell — so the quick-action toolbar and the marquee's coverage test sit
    // exactly over the selected element, at any facing. The anchor keeps the historical (col+0.5, row+0.5)
    // convention (the halves cancel in x and add one tile-height in y); isoEditorCellAnchor owns that.
    return isoEditorCellAnchor(col, row, isoEditorView(canvas, grid))
  }

  const cellToScreen = (col: number, row: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    const p = cellToCanvas(col, row)
    if (!canvas || !p) return null
    // canvas backing store == CSS size (both = window inner size), so scale is ~1, but
    // account for it + the canvas offset anyway to stay correct if the layout changes.
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width ? rect.width / canvas.width : 1
    const scaleY = canvas.height ? rect.height / canvas.height : 1
    return { x: rect.left + p.x * scaleX, y: rect.top + p.y * scaleY }
  }

  // BLOCK-AWARE MARQUEE (shift+drag in iso / 2D): the selection keys for every tile the screen rectangle
  // between the drag-start point and the current point VISUALLY covers. Two parts, unioned:
  //  1) RAISED blocks — from the render registry (renderedTilesInRect): each tile whose recorded silhouette
  //     centroid falls in the box → its OWN "col,row,level" key. THE FIX: a roof/wall block whose flat ground
  //     cell sits behind the building is grabbed by what's DRAWN, so the yellow cage hugs the roof instead of
  //     floating on the offset ground cell a screenToCell-corner rectangle wrongly picked.
  //  2) flat FLOOR cells — a cell whose CENTRE is in the box AND that is NOT occluded by another cell's tile
  //     drawn in front of it (so a ground cell hidden behind a building never re-adds a floating cage). A cell
  //     already carrying a raised block (part 1) is skipped — its block key owns it (no double-count).
  // Top view has no registry / no iso offset, so the caller keeps the flat-rectangle path there. Coords are
  // CANVAS-INTERNAL (the space the registry + cellToCanvas share).
  const marqueeSelectionKeys = (startX: number, startY: number, curX: number, curY: number): Set<string> => {
    const canvas = canvasRef.current
    const grid = gridRef.current
    if (!canvas || !grid) return new Set()
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width ? canvas.width / rect.width : 1
    const scaleY = rect.height ? canvas.height / rect.height : 1
    const x0 = (startX - rect.left) * scaleX, y0 = (startY - rect.top) * scaleY
    const x1 = (curX - rect.left) * scaleX, y1 = (curY - rect.top) * scaleY
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1)
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1)
    const iso = viewTypeRef.current !== '2d' // top view never reaches here
    const keys = new Set<string>()
    const blockedCells = new Set<string>() // "col,row" of cells that already contributed a TILE key → skip their bare-cell fallback
    for (const t of iso ? renderedTilesInRect(x0, y0, x1, y1) : renderedTwoDTilesInRect(x0, y0, x1, y1)) {
      keys.add(blockKeyForPick({ col: t.col, row: t.row, stackIndex: t.stackIndex, source: t.source }))
      blockedCells.add(`${t.col},${t.row}`) // its own tile(s) own this cell — don't ALSO add a bare "col,row" key
    }
    // Occlusion-aware flat ground: add ONLY the VISIBLE bare-ground cells under the box (their own tile on top,
    // or nothing there) — a cell hidden behind another cell's rendered tile is never selected.
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (blockedCells.has(`${c},${r}`)) continue
        const p = cellToCanvas(c, r)
        if (!p || p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue
        const top = iso ? pickIsoTilesAt(p.x, p.y)[0] : pickTwoDTilesAt(p.x, p.y)[0]
        if (top && !(top.col === c && top.row === r)) continue // occluded by another cell's tile → hidden, skip
        keys.add(`${c},${r}`)
      }
    }
    return keys
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
    selectionStartPtRef.current = { x: e.clientX, y: e.clientY } // the screen-rect marquee's fixed corner (iso/2D)
    // Capture the base selection + additive intent at drag-start so a shift+drag MERGES its rectangle into the
    // existing selection (select 4, then 4 more → 8; no restart). Plain click = a fresh single-cell selection.
    additiveSelectRef.current = e.shiftKey
    selectionBaseRef.current = e.shiftKey ? new Set(selectedCellsRef.current) : new Set()
    // Block-aware single ADD: resolve the BLOCK under the cursor with the SAME pick the single-click uses
    // (pickCellForSelectCycling), and add ITS key ("col,row,level" for a raised block, "col,row" for bare
    // ground) via the SAME blockKeyForPick derivation — so a shift+click on a stacked block hits THAT block's
    // key (matching the highlight), not the flat ground cell offset up-and-left of it in iso. A shift+DRAG
    // replaces this with its ground-cell rectangle on the first move (applyRectSelection in mousemove).
    const pick = pickCellForSelectCycling(e.clientX, e.clientY)
    const key = pick ? blockKeyForPick(pick) : `${cell.col},${cell.row}`
    setSelectedCells(prev => applyCellSelection(prev, key, e.shiftKey))
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

    if (!isSelecting || !selectionStart) return // drag-select (shift+drag in every view)
    // TOP view has no per-tile registry and no iso projection offset, so keep the flat cell-rectangle path
    // there (screenToCell corners → rectangle) — unchanged, and correct since top view has no offset.
    if (topViewMode) {
      const cell = screenToCell(e.clientX, e.clientY)
      if (!cell) return
      setSelectedCells(applyRectSelection(selectionBaseRef.current, selectionStart, cell, additiveSelectRef.current))
      return
    }
    // ISO / 2D: BLOCK-AWARE screen-rect marquee — select the TILES the box visually covers (from the render
    // registry), not the offset flat ground cells a screenToCell-corner rectangle grabbed (the floating-cage
    // bug). MERGED into the base captured at drag-start when additive (shift) — extending keeps 4 + 4 = 8.
    const start = selectionStartPtRef.current
    if (!start) return
    const marquee = marqueeSelectionKeys(start.x, start.y, e.clientX, e.clientY)
    setSelectedCells(additiveSelectRef.current ? new Set([...selectionBaseRef.current, ...marquee]) : marquee)
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
        setSelectedCells(new Set([blockKeyForPick(c)]))
        setSelectedTileLevel(levelForPickedCell(c))
      }
      // ONE resolution, then a tiny route by the tile's STORE (never a geometry re-test — pickIsoBlock already
      // did that uniformly over the stack):
      //  • a picked BUILDING / PROP block → that tile in the Cell inspector (wins over an entity sharing the
      //    cell — you clicked the raised block, not the figure at ground level);
      //  • Alt → always the CELL under the pointer (edit the floor even under a unit);
      //  • a plain flat click stays ENTITY-FIRST (a unit is a billboard drawn above its foot cell), else the cell.
      // A UNIT is a tile the picker returns: its billboard silhouette is recorded like any tile, so a click on
      // the figure resolves to source 'entity' and selects the unit — no longer swallowed by the floor under it.
      // Alt still bypasses to edit the CELL/floor beneath the unit (via selectCellTile — the -1 stackIndex keys
      // as the bare cell).
      if (c.source === 'entity' && !downAltRef.current) {
        if (c.entityId) setSelectedEntityId(c.entityId)
        else selectCellTile()
      } else if (c.source === 'building' || c.source === 'asset') {
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
    const groundType = grid.groundAt(col, row)
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

  /** Pick WHICH creature the ◈ Unit flow places (re-picking the same tile disarms). The TILE ROW decides the
   *  entity KIND (`settings.unitRole`: person → npc, enemy → enemy; player → player) so one picker serves them
   *  all; a canvas click then places THAT exact figure via placeUnitTile. Clears the other tools so a click
   *  routes to one. */
  /** What a picked creature places as: the `Place as` choice, else the catalog's own role. */
  const kindForPlacement = (tile: TileDef | null): 'player' | 'npc' | 'enemy' | null => {
    if (!tile) return null
    const auto = entityKindForUnitTile(tile)
    // The hero is the one distinguished unit — an override never turns the player into an enemy.
    if (auto === 'player') return 'player'
    if (placeAs === 'enemy') return 'enemy'
    if (placeAs === 'npc') return 'npc'
    return auto
  }

  const pickUnitTile = (tile: TileDef | null) => {
    const next = tile && unitTile?.id === tile.id ? null : tile
    setUnitTile(next)
    setEntityTool(next ? kindForPlacement(next) : null)
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
      // ARMS NOTHING. Alexander, 2026-09-09: *"the system adds characters even when none is selected."*
      // This used to be `prev ?? 'enemy'`, so merely OPENING the Characters library armed an enemy and the
      // next click on the map spawned one — a character the user never chose. Opening a library is browsing;
      // placing needs a pick. Whatever was already armed is kept.
      return
    }
    if (m === 'building') {
      setPaintMode(false)
      setEntityTool(null)
      setConnectorMode(false)
      clearPaintTile()
      // ARMS NOTHING, for the same reason as `unit` above — this defaulted to `'house_4'`, so opening the
      // Objects library and clicking the map stamped a house nobody picked.
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
  const placeNewBuilding = (type: BuildingType, col: number, row: number): number => {
    // The size is BACKEND data — the baked composition widths decide it, so there is no size to fall back to
    // while the tileset is still loading.
    const length = buildingPlaceLength(type)
    if (length === null) { toast('Composition tiles are still loading — try again in a moment', 'info'); return 0 }
    // A building IS a composition — route it through the SAME replace-anything path (rotate to the road, clear
    // the footprint, stamp), so hand-placing a building overwrites whatever's there just like any composition.
    return placeComposition(buildingCompositionKind(type, length), col, row)
  }

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
    // STACK, never replace (MAP-MODEL §4 "stacked like legos" + EDITOR-INTERACTION-SPEC §12 "the SAME path the
    // generator uses"): a composition stamps its tiles ON TOP of whatever is already in the cell — the floor slab
    // and any existing tiles stay. The old blanket `clearAssetsAtCell` deleted the floor asset too, which is why
    // a placed tree / lamp / building wiped the grass beneath it. (Footprint FIT for a multi-cell composition —
    // it must land on an even/free footprint — is enforced in planComposition, not by wiping the cells here.)
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
      // The pinned tile of the SELECTED stack level. Every tile — the floor included — is a plain asset carrying
      // its own tileOverride, so this reads stackedAssetsAt[selectedTileLevel] uniformly (no floor special case).
      const stacked = [...grid.getAssetsAtCell(c, r)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
      return stacked[selectedTileLevel]?.tileOverride ?? null
    }
    return null
  })()

  /** Pin (or clear, with null) a Library tile id on the selected element — an entity, or the
   *  asset(s) under the selected cell(s). Rides the asset/entity through the codec (clone),
   *  so it saves + reloads with the template. Buildings reskin via the global style only. */
  const setSelectionOverride = (tileId: string | null) => {
    if (selectedEntityId) {
      // Swapping a unit's tile is REPLACING a tile → undoable like any other structural edit.
      editMap(checkpointHistory, () => {
        setEntities(prev => prev.map(e => (e.id === selectedEntityId ? { ...e, tileOverride: tileId ?? undefined } : e)))
      })
      return
    }
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) return
    checkpointHistory() // replacing the selected level's tile is a structural edit → Ctrl+Z restores the old one
    for (const key of selectedCells) {
      const [c, r] = key.split(',').map(Number)
      // Swap the SELECTED stack level's tile — the exact tile the user picked (floor/base, middle, or top),
      // pinned via tileOverride. Every tile is a plain asset, so this is ONE uniform write with no floor branch.
      const stacked = [...grid.getAssetsAtCell(c, r)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
      const a = stacked[selectedTileLevel]
      if (a) { a.tileOverride = tileId ?? undefined; continue }
      // A cleared/empty cell (no tile at this level) → drop a decoration asset locked to the chosen tile, so
      // you can replace ANY cell with any tile, not just cells that already hold a tree/prop.
      if (tileId) {
        // The art fallback goes through the SHARED `tileChar` the paint brush uses — an image tile pins its
        // source glyph, or '' when it has none, and NEVER a literal '?'. This site had its own inline
        // ternary that stamped '?' for every image tile (which is every tile now), so a tile whose picture
        // could not be resolved rendered a question mark on the map — the "fake ascii tiles" report.
        grid.placeAsset([visualChar(visualForTileId(tileId))], c, r, { type: 'decoration', tileOverride: tileId })
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
  const setCellCollision = (blocked: boolean) => applyToSelectedCells((col, row, grid) => grid.setCollision(col, row, blocked))
  // A cell's stacked tiles in the SAME order the cell-stack adapter (getStack) projects them — sorted by
  // heightLevel — so the inspector's per-tile index maps to the right asset on both read and write.
  const stackedAssetsAt = (grid: IsometricGrid, col: number, row: number): GridAsset[] =>
    [...grid.getAssetsAtCell(col, row)].sort((a, b) => (a.heightLevel ?? 0) - (b.heightLevel ?? 0))
  // Fan a per-TILE edit over the selection, resolving EACH selection key to its OWN stack slot — the fix for
  // "edits changed the tile at the bottom instead of the one selected" (#2). A "col,row,stackIndex" key edits
  // that exact tile; a bare "col,row" key (a flat rectangle drag) falls back to `fallbackI` (the inspector's
  // selectedTileLevel). So a multi-select edits each cell's SELECTED tile — never one global level forced onto
  // every cell. Mirrors removeSelectedBlock's per-key resolution; supersedes the old "i-th tile of every cell".
  const applyToSelectedTiles = (fallbackI: number, apply: (asset: GridAsset) => void) => {
    const grid = gridRef.current
    if (!grid) return
    for (const { col, row, index } of resolveSelectionTargets(selectedCells, fallbackI)) {
      const asset = stackedAssetsAt(grid, col, row)[index]
      if (asset) apply(asset)
    }
    grid.assetLevelsChanged() // re-index: a z-width / level / depth edit re-maps the tile's covered cells so the
                              // stack + pick see the whole footprint (Alexander #63: stack on a rectangle's middle)
    bumpBuildingVersion()
  }
  // The same per-key fan-out, for an edit that needs the tile's PLACE (grid + cell + stack slot) rather than
  // just the asset — a height change is a whole-cell stack operation, since it moves the tiles above it too.
  const applyToSelectedTileSlots = (
    fallbackI: number,
    apply: (grid: IsometricGrid, col: number, row: number, index: number) => void,
  ) => {
    const grid = gridRef.current
    if (!grid) return
    for (const { col, row, index } of resolveSelectionTargets(selectedCells, fallbackI)) apply(grid, col, row, index)
    bumpBuildingVersion()
  }
  // Per-tile sprite scale (#77/#78): Width/Height/Depth are per-axis, Zoom is uniform. Dispatch the UI
  // axis to the asset field it writes; the renderers read these back per view (assetDimensions.ts).
  // Width/Depth/Zoom are plain per-axis field writes. HEIGHT is deliberately NOT in here: changing a tile's
  // height is a STACK operation (setTileHeight), because whatever rests on that tile has to move with it.
  const DIM_FIELD = { width: 'scaleX', depth: 'scaleZ', zoom: 'scale' } as const
  type DimAxis = 'height' | keyof typeof DIM_FIELD
  // Write the i-th stacked TILE of every selected cell (per-tile, not "all assets in the cell at once").
  // The tile's BLOCK-HEIGHT (data): its DB height × any per-instance scaleY. This is the ONE "Height" number the
  // inspector shows/edits — a flat tile reads 0.1, a wall 1, a scaleY-collapsed composition column its full span.
  // Read from the active style's DB tile, so height is DATA, never invented.
  const blockHeightOf = (a: GridAsset): number => {
    const kind = assetKind(a)
    const dbTile = activeStyleId === ASCII_STYLE.id ? styleTile('ascii', kind) : styleTile('emoji', kind)
    return resolveTileHeight(dbTile, a) * (a.scaleY ?? 1)
  }
  const setAssetDim = (i: number, axis: DimAxis, v: number) => {
    // "Height" edits the tile's BLOCK-HEIGHT (asset.height) as ONE number — the data — AND lifts everything
    // stacked on that tile by the same change, because all tiles stack like legos and the floor is no
    // different: raise the ground under a house and the house goes up with it (setTileHeight owns that rule,
    // so the editor, tests and any other caller can't drift apart).
    if (axis === 'height') {
      applyToSelectedTileSlots(i, (grid, col, row, index) => setTileHeight(grid, col, row, index, v))
      return
    }
    applyToSelectedTiles(i, (a) => { a[DIM_FIELD[axis]] = v })
  }
  const setAssetColor = (i: number, color: string) =>
    applyToSelectedTiles(i, (a) => { a.color = color })
  // Clear the i-th stacked tile's colour override → fall back to the tile's own resolved colour. The "↺ reset"
  // affordance the base/floor tile shows; the floor is a plain asset, so it clears like any other tile.
  const clearAssetColor = (i: number) =>
    applyToSelectedTiles(i, (a) => { a.color = undefined })
  // "Z Width" (directional depth): the i-th stacked TILE spans `cells` blocks along asset.depthDir, extruded as
  // a long iso box (isoDepthBox). A box needs a direction to grow — default to 'right-up' ("right top", the
  // user's Image #28 arrow) when raising it past 1 with none set, so the extrusion shows immediately.
  const setAssetDepth = (i: number, cells: number) =>
    applyToSelectedTiles(i, (a) => {
      a.depth = Math.max(1, Math.round(cells))
      if (a.depth > 1 && !a.depthDir) a.depthDir = 'right-up'
    })
  const setAssetDepthDir = (i: number, dir: DepthDir) =>
    applyToSelectedTiles(i, (a) => { a.depthDir = dir })
  // BIDIRECTIONAL z-width (#58): extend the SAME tile BACKWARD from its anchor (opposite depthDir) by `cells`, so
  // one roof tile spans both ways. 0 = one-way (today). Needs a depthDir to point the axis (default like depth).
  const setAssetDepthBack = (i: number, cells: number) =>
    applyToSelectedTiles(i, (a) => {
      a.depthBack = Math.max(0, Math.round(cells))
      if ((a.depthBack ?? 0) > 0 && !a.depthDir) a.depthDir = 'right-down'
    })
  // 2-AXIS z-width (Alexander "two sides at the same time"): the PERPENDICULAR extents — forward (depthPerp) +
  // back (depthPerpBack) along rotateDepthDir(depthDir,1). With the primary axis this makes the tile a RECTANGLE.
  const setAssetDepthPerp = (i: number, cells: number) =>
    applyToSelectedTiles(i, (a) => {
      a.depthPerp = Math.max(0, Math.round(cells))
      if (!a.depthDir) a.depthDir = 'right-down'
    })
  const setAssetDepthPerpBack = (i: number, cells: number) =>
    applyToSelectedTiles(i, (a) => {
      a.depthPerpBack = Math.max(0, Math.round(cells))
      if (!a.depthDir) a.depthDir = 'right-down'
    })
  // PER-ASSET pose (x/y/rotate/flip) and "z position" (ISO-DIAGONAL slide) — written to THIS placed tile
  // (persists with the map), not the shared tileset kind. The render reads asset.pose / asset.zOffset / asset.zDir
  // in every view.
  const setAssetPose = (i: number, pose: TilePose | undefined) =>
    applyToSelectedTiles(i, (a) => { a.pose = pose })
  // "z position": SLIDE the tile along an iso diagonal (NOT a vertical lift). Default the direction to 'right-up'
  // ("right top", the user's +z = up-right) the first time z is set with none, so the slide has a direction to
  // move along immediately — mirrors setAssetDepth defaulting depthDir when depth grows past 1.
  const setAssetZOffset = (i: number, v: number) =>
    applyToSelectedTiles(i, (a) => {
      a.zOffset = v
      if (v !== 0 && !a.zDir) a.zDir = 'right-up'
    })
  const setAssetZDir = (i: number, dir: DepthDir) =>
    applyToSelectedTiles(i, (a) => { a.zDir = dir })
  // PER-ASSET "z-index" (draw-priority, CSS z-index style) — a higher value draws on top / in front, overriding
  // the positional depth sort. Written to THIS placed tile (persists with the map); the render reads asset.zIndex.
  const setAssetZIndex = (i: number, v: number) =>
    applyToSelectedTiles(i, (a) => { a.zIndex = Math.round(v) })
  // PER-ASSET "display" mode (all-faces / single) — how the tile is painted on its block. Written into THIS
  // placed tile's `settings` (persists with the map via the full-asset serialize) alongside the generic
  // fade/cutaway keys; the render reads asset.settings.display. 'all-faces' clears the key so a reset stays
  // byte-identical to a tile that never opted in.
  const setAssetDisplay = (i: number, mode: TileDisplay) =>
    applyToSelectedTiles(i, (a) => {
      const rest = { ...(a.settings ?? {}) }
      if (mode === 'single') a.settings = { ...rest, display: 'single' }
      else { delete rest.display; a.settings = rest }
    })
  // PER-ASSET "transparent" block — drop the block SHELL so only the tile's content shows (with display:single,
  // just the centered billboard, in its own colour): "style the flower without colouring the whole block".
  // Written to THIS placed tile's `settings` (persists via the full-asset serialize); off clears the key so a
  // reset stays byte-identical to a tile that never opted in.
  const setAssetTransparent = (i: number, on: boolean) =>
    applyToSelectedTiles(i, (a) => {
      const rest = { ...(a.settings ?? {}) }
      if (on) a.settings = { ...rest, transparent: true }
      else { delete rest.transparent; a.settings = rest }
    })
  // PER-CELL "act as tile" — the cell behaves as if a tile were already inside it, so content stacks ON TOP of
  // this block instead of inside at level 0 (a walk-over floor/road). A STACK operation (setCellActAsTile) like
  // height: toggling it re-lifts whatever rests on the tile by the change in its stacking occupancy, so the
  // change shows immediately, and the setting persists via the full-asset serialize.
  const setAssetActAsTile = (i: number, on: boolean) =>
    applyToSelectedTileSlots(i, (grid, col, row, index) => setCellActAsTile(grid, col, row, index, on))
  // PER-ASSET render SHAPE ('square' cube / 'circle' ball) — written to THIS placed tile (persists with the map
  // via the full-asset serialize, like scaleX/pose). The render dispatches on asset.shape in every view.
  // 'square' clears the field so a reset stays byte-identical to a tile that never opted in (like Display).
  // THICKNESS REACH: how far the i-th tile extends toward ONE world direction inside its own cell — the same
  // question the Footprint asks, in the smaller unit. `dir` arrives already converted from the arrow the user
  // clicked (screen) to the world axis it means, so the stored value survives camera rotation. A full reach
  // (1) is the default and is dropped, so an untouched tile carries no thickness at all.
  const setAssetThicknessReach = (i: number, dir: DepthDir, value: number) =>
    applyToSelectedTiles(i, (a) => {
      const next = { ...(a.thickness ?? {}) }
      if (value >= 1) delete next[dir]
      else next[dir] = Math.max(0.05, value)
      if (Object.keys(next).length === 0) delete a.thickness
      else a.thickness = next
    })
  const setAssetShape = (i: number, shape: TileShape) =>
    applyToSelectedTiles(i, (a) => {
      if (shape === 'square') delete a.shape
      else a.shape = shape
    })
  // PER-ASSET LIGHT setting (intensity/distance/colour/on) — the warm night ground GLOW POOL this tile casts,
  // written to THIS placed tile (persists with the map via the full-asset serialize, like shape). Fans out to
  // the i-th stacked tile of every selected cell. Passing `undefined` clears the setting (back to no pool).
  const setAssetLight = (i: number, light: AssetLight | undefined) =>
    applyToSelectedTiles(i, (a) => {
      if (light) a.light = light
      else delete a.light
    })
  // PER-ASSET tile ANIMATIONS (Phase 4) — the LIST authored in the animation modal, written to THIS placed
  // tile (persists with the map via the full-asset serialize, like cellAnim). Anchor start/loop delays at
  // placedAt=0 so a load-triggered loop plays from the clock origin (performance.now() = ms-since-load), the
  // same anchor the composition-default fountain uses. An empty list clears the key so a reset stays
  // byte-identical to a tile that never opted in.
  const setAssetAnimations = (i: number, animations: TileAnim[]) =>
    applyToSelectedTiles(i, (a) => {
      if (animations.length) { a.animations = animations; if (a.placedAt == null) a.placedAt = 0 }
      else { delete a.animations }
    })
  // Inspector "Remove tile" → delete the EXACT selected tile(s) — one per selection KEY, each key carrying its
  // own stack slot (never the floor: the floor slot is floor-safe). A multi-tile selection removes ALL of them.
  // Then step the level down so the panel doesn't point past the (now shorter) stack.
  const removeSelectedTile = () => {
    const grid = gridRef.current
    if (!grid) return
    // Structural edit → through the map-edit boundary, so Ctrl+Z restores the removed tile (it used to
    // mutate without snapshotting, which is why "I removed a tile, then hit ctrl + z and the tile didn't return").
    editMap(checkpointHistory, () => removeSelectedBlock(grid, selectedCells), bumpBuildingVersion)
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
    const stack = getStack(grid, col, row)
    // `i` is the SELECTED tile's STACK INDEX — the SAME index the inspector's setAsset* writers use
    // (stackedAssetsAt[i]), so a canvas drag and the modal sliders resize the exact same tile. The FLOOR slab is
    // skipped (it sizes elsewhere); any other placed tile — including a base tile on a floorless cell — resizes.
    const i = Math.min(Math.max(selectedTileLevelRef.current, 0), stack.length - 1)
    const asset = stackedAssetsAt(grid, col, row)[i]
    if (!asset || asset.type === FLOOR_TYPE) return null
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
    const heightBase = blockHeightOf(target.asset) // the Height handle drags the tile's BLOCK-HEIGHT, not scaleY
    handleDragRef.current = {
      id: hit.id, i: target.i,
      startCx: cx, startCy: cy, sx, sy,
      startScaleX: scaleX, startScaleY: heightBase, startDepth: target.asset.depth ?? 1,
      baseHalfWpx: Math.max(1, (b.width / 2) / scaleX),
      baseHalfHpx: Math.max(1, (b.height / 2) / heightBase),
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
      __selKeys?: () => string[]
      __marqueeKeys?: (x0: number, y0: number, x1: number, y1: number) => string[]
      __hoverCell?: () => { col: number; row: number; level?: number; source?: string } | null
      __selectCells?: (keys: string[]) => number
      __applyCellTile?: (tileId: string | null) => void
      __clearRegion?: (col0: number, row0: number, col1: number, row1: number) => void
      __setDebug?: (v: boolean) => void
      __cellLabels?: (col0: number, row0: number, col1: number, row1: number) => unknown
      __stackAt?: (col: number, row: number) => Array<{ label: string; type: string; heightLevel: number; h: number; source: string }>
      __collisionAudit?: (col0?: number, row0?: number, col1?: number, row1?: number) => { col: number; row: number; blocked: boolean; standLevel: number; tiles: { label: string; level: number; blocking: boolean }[] }[]
      __floorInfoAt?: (col: number, row: number) => { color: string | null; kind: string | null; depth: number | null; depthDir: string | null; heightLevel: number } | null
      __camOffset?: () => { x: number; y: number }
      __stackAsset?: (col: number, row: number, n?: number) => number | null
      __paletteTiles?: (category?: string) => Array<{ id: string; label: string; category: string; height: number | null }>
      __paintTile?: (tileId: string, col: number, row: number) => unknown
      __isoBlockScreen?: (col: number, row: number, level: number) => { x: number; y: number } | null
      __genVillage?: () => { buildings: number }
      __genStage?: (zone: string, variant: string, layout?: string, seed?: number) => { buildings: number }
      __generatorsReady?: () => boolean
      __randomizeLayer?: (layer: string) => { buildings: number }
      __randomizeSelected?: () => boolean
      __centerOn?: (col: number, row: number) => void
      __setHero?: (col: number, row: number) => void
      __setDepth?: (col: number, row: number, depth: number, dir: DepthDir) => { col: number; row: number; depth: number; depthDir: DepthDir; cells: { col: number; row: number }[] } | null
      __setDepthBack?: (col: number, row: number, back: number, dir?: DepthDir) => { col: number; row: number; depthBack: number; depthDir?: DepthDir } | null
      __setDepthPerp?: (col: number, row: number, fwd: number, backCells?: number) => { col: number; row: number; depthPerp: number; depthPerpBack: number; depthDir?: DepthDir } | null
      __setZPos?: (col: number, row: number, z: number, dir: DepthDir) => { col: number; row: number; zOffset: number; zDir: DepthDir } | null
      __setShape?: (col: number, row: number, shape: TileShape) => { col: number; row: number; shape: TileShape } | null
      __setDisplay?: (col: number, row: number, mode: TileDisplay) => { col: number; row: number; mode: TileDisplay } | null
      __setLight?: (col: number, row: number, light: AssetLight | null) => { col: number; row: number; light: AssetLight | null } | null
      __pickTileAt?: (clientX: number, clientY: number) => { col: number; row: number; stackIndex: number | null; source: string | null } | null
      __cellScreen?: (col: number, row: number, level?: number) => { x: number; y: number } | null
      __tileCentroid?: (col: number, row: number, level?: number) => { x: number; y: number } | null
      __tileHandles?: (col: number, row: number, level?: number) => { id: HandleId; x: number; y: number }[] | null
      __recordedGeom?: (col: number, row: number, level?: number) => { kind: string; extrudePx: number | null; bboxW: number; bboxH: number } | null
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
    // PALETTE-ENUMERATION seam: list the browseable tiles for the active style (optionally one category), so a
    // validation run can drive EVERY nature/decor tile straight from the loaded DB tileset (never a hardcoded list).
    win.__paletteTiles = (category?: string) => {
      const style = activeStyleRef.current
      const all = Object.values(tilesForStyle(style.id)).flat() as TileDef[]
      return all.filter(t => !category || t.category === category).map(t => ({ id: t.id, label: t.label, category: t.category, height: t.height ?? null }))
    }
    win.__paintTile = (tileId: string, col: number, row: number) => {
      const g = gridRef.current
      if (!g) return null
      const style = activeStyleRef.current
      const groups = tilesForStyle(style.id)
      const tile = Object.values(groups).flat().find(t => t.id === tileId)
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
      // The SAME facing-aware camera the click projections + the render use, so a validation click aimed here
      // still lands on the block after the map is rotated.
      const view = isoEditorView(canvas, grid)
      const { x: px, y: py } = isoWorldCellToScreen(col, row, isoEditorCamera(view), grid.cols, grid.rows, view.facing)
      const cy = py - grid.getHeight(col, row) * (cs * eff * 0.4) - level * (cs * eff * 0.71) * ISO_BLOCK_H_FRAC
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
      return r ? { col: r.col, row: r.row, stackIndex: r.stackIndex ?? null, source: r.source ?? null } : null
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
    // RENDER-PATH validation seam: the RECORDED silhouette KIND of the tile drawn at (col,row,level) this frame.
    // 'cube' = it went through the block/slab path (a flat tile is a thin slab → cube geom); 'poly' = a billboard
    // (a UNIT, or an image-less glyph) or a directional-depth box. `extrudePx` = the cube's on-screen extruded
    // height (base-back.y − top-back.y): tiny for a flat SLAB, large for a tall block. null when not drawn.
    win.__recordedGeom = (col: number, row: number, level = 0) => {
      const geom = viewTypeRef.current === '2d' ? twoDRecordedGeom(col, row, level) : isoRecordedGeom(col, row, level)
      if (!geom) return null
      const extrudePx = geom.kind === 'cube' ? geom.base[1].y - geom.top[1].y : null
      const poly = tileGeomPolygon(geom)
      const xs = poly.map(p => p.x), ys = poly.map(p => p.y)
      const bboxW = xs.length ? Math.max(...xs) - Math.min(...xs) : 0
      const bboxH = ys.length ? Math.max(...ys) - Math.min(...ys) : 0
      return { kind: geom.kind, extrudePx, bboxW, bboxH }
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
    // The generator catalog is FETCHED, so a validation harness must wait for it before generating — a
    // generate with no catalog plants nothing (by design) and would look like a broken generator.
    win.__generatorsReady = () => generatorCatalogRef.current.length > 0
    win.__genVillage = () => { generateStageInEditor('spring', 'town'); return { buildings: countBuildingTiles(gridRef.current) } }
    win.__genStage = (zone: string, variant: string, layout?: string, seed?: number) => { generateStageInEditor(zone as ZoneId, variant as VariantId, layout as ForestLayout | undefined, undefined, seed); return { buildings: countBuildingTiles(gridRef.current) } }
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
      g.assetLevelsChanged() // mirror the real editor path: re-index the covered footprint so it stacks
      bumpBuildingVersion()
      return { col, row, depth, depthDir: dir, cells }
    }
    // BIDIRECTIONAL z-width (#58): extend the topmost tile at (col,row) BACKWARD `back` cells too.
    win.__setDepthBack = (col: number, row: number, back: number, dir?: DepthDir) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1)
      if (!a) return null
      a.depthBack = back
      if (dir) a.depthDir = dir
      else if (!a.depthDir) a.depthDir = 'right-down'
      g.assetLevelsChanged() // re-index covered footprint (mirror the editor path)
      bumpBuildingVersion()
      return { col, row, depthBack: back, depthDir: a.depthDir }
    }
    // 2-AXIS z-width validation seam: set the PERPENDICULAR extents (forward + back) on the topmost block, making
    // it a RECTANGLE with the primary depth. Returns what it set so the render can be driven deterministically.
    win.__setDepthPerp = (col: number, row: number, fwd: number, backCells = 0) => {
      const g = gridRef.current
      if (!g) return null
      const a = g.getAssetsAtCell(col, row).at(-1)
      if (!a) return null
      a.depthPerp = fwd
      a.depthPerpBack = backCells
      if (!a.depthDir) a.depthDir = 'right-down'
      g.assetLevelsChanged() // re-index covered footprint (mirror the editor path)
      bumpBuildingVersion()
      return { col, row, depthPerp: fwd, depthPerpBack: backCells, depthDir: a.depthDir }
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
      const caps = cellCaptionMap(grid.groundSlugs(), grid.assets)
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
    win.__floorInfoAt = (col: number, row: number) => {
      const grid = gridRef.current
      if (!grid) return null
      const f = grid.floorAt(col, row)
      return f ? { color: f.color ?? null, kind: f.tileKey ?? null, depth: f.depth ?? null, depthDir: f.depthDir ?? null, heightLevel: f.heightLevel ?? 0 } : null
    }
    // COLLISION AUDIT (QA seam): per cell, what the flat collision map says vs what actually stands there.
    // The map is 2D and means "a unit walking the ground is stopped here", so the only truthful source is a
    // blocking tile at (or below) the level a unit stands at. Anything else is a visible lie — red paint on
    // bare grass, or a wall you can walk through ("collissions don't match structures", Alexander Image #5).
    win.__collisionAudit = (col0 = 0, row0 = 0, col1 = Infinity, row1 = Infinity) => {
      const grid = gridRef.current
      if (!grid) return []
      // Clamp to the REAL grid: `isBlocked` reports true out of bounds (a wall around the world), so an audit
      // window bigger than the grid would count the void as false positives.
      const c1 = Math.min(col1, grid.cols - 1), r1 = Math.min(row1, grid.rows - 1)
      const out: { col: number; row: number; blocked: boolean; standLevel: number; tiles: { label: string; level: number; blocking: boolean }[] }[] = []
      for (let row = Math.max(0, row0); row <= r1; row++) {
        for (let col = Math.max(0, col0); col <= c1; col++) {
          const tiles = grid.getAssetsAtCell(col, row).map(a => ({ label: a.label ?? a.type ?? '', level: a.heightLevel ?? 0, blocking: !!a.blocking }))
          out.push({ col, row, blocked: grid.isBlocked(col, row), standLevel: unitStandLevel(grid, col, row), tiles })
        }
      }
      return out
    }
    win.__cellSel = () => ({ count: selectedCellsRef.current.size, first: Array.from(selectedCellsRef.current)[0] ?? null })
    win.__selKeys = () => Array.from(selectedCellsRef.current) // full selection-key list (block "col,row,level" / flat "col,row") for validation
    // Block-aware MARQUEE validation seam: the keys a shift+drag box (CLIENT coords) selects, computed through
    // the SAME marqueeSelectionKeys the mousemove uses — a deterministic check of the block-aware coverage,
    // independent of React's isSelecting state-commit timing that a simulated drag races.
    win.__marqueeKeys = (x0, y0, x1, y1) => Array.from(marqueeSelectionKeys(x0, y0, x1, y1))
    // The live hovered cell/block (what a Ctrl+V paste anchors at) — so validation can confirm the anchor the
    // real mouse actually set, independent of a direct pick call.
    win.__hoverCell = () => (hoveredCellRef.current ? { ...hoveredCellRef.current } : null)
    win.__selectCells = (keys: string[]) => { setSelectedCells(new Set(keys)); setSelectedEntityId(null); return keys.length }
    win.__applyCellTile = (tileId: string | null) => setSelectionOverride(tileId)
    win.__clearRegion = (col0: number, row0: number, col1: number, row1: number) => {
      const g = gridRef.current
      if (!g) return
      checkpointHistory() // clearing a region is a map edit → snapshot so Ctrl+Z brings it back
      for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) { placeGround(g, c, r, 'grass'); g.setCollision(c, r, false) }
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
          const t = grid.groundAt(c, r)
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
    return () => { delete win.__setArtStyle; delete win.__selectFirstTreeCell; delete win.__setView; delete win.__gridKinds; delete win.__entityInfo; delete win.__entityScreens; delete win.__selectEntity; delete win.__setEntitySize; delete win.__scatter; delete win.__selectedEntityInfo; delete win.__placeBuilding; delete win.__placeComposition; delete win.__armComposition; delete win.__cellSel; delete win.__selKeys; delete win.__marqueeKeys; delete win.__hoverCell; delete win.__selectCells; delete win.__applyCellTile; delete win.__clearRegion; delete win.__setDebug; delete win.__cellLabels; delete win.__stackAt; delete win.__camOffset; delete win.__stackAsset; delete win.__paletteTiles; delete win.__paintTile; delete win.__isoBlockScreen; delete win.__generatorsReady; delete win.__genVillage; delete win.__genStage; delete win.__randomizeLayer; delete win.__randomizeSelected; delete win.__centerOn; delete win.__setHero; delete win.__pickTileAt; delete win.__cellScreen; delete win.__tileCentroid; delete win.__tileHandles; delete win.__setShape; delete win.__setDisplay; delete win.__setLight; delete win.__recordedGeom; delete win.__collisionAudit }
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
    // A unit IS a tile — deleting one is removing a tile, so it snapshots like every other structural edit.
    editMap(checkpointHistory, () => setEntities(prev => removeEntity(prev, selectedEntityId)))
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
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r) || groundKind(grid.groundAt(c, r)) === 'water'),
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
  /** Wipe every character on the level. §5.1 — a destructive action asks first, and names what it destroys;
   *  §4.5 draws the button as `[Clear…]`, and the ellipsis is that promise. Undoable either way. */
  const clearAllEntities = async () => {
    const ok = await confirm({
      title: 'Clear this level\'s characters',
      body: `Remove all ${entities.length} characters from "${templateName || 'this level'}"? Ctrl+Z undoes it.`,
      confirmLabel: `Remove ${entities.length}`,
    })
    if (!ok) return
    checkpointHistory()
    setEntities([])
  }

  const scatterUnits = () => {
    const grid = gridRef.current
    if (!grid) return
    if (!unitTile) { checkpointHistory(); randomizeEntities(); return }
    const slug = tileSlug(unitTile.id)
    const kind = entityKindForUnitTile(unitTile)
    if (kind === 'player') { toast('Only one player — use Add to place the hero', 'warning'); return }
    if (!kind) { toast('That tile is a combat effect, not a character — it cannot be scattered', 'warning'); return }
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r) || groundKind(grid.groundAt(c, r)) === 'water'),
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
  /**
   * Rebuild the grid from its MATRIX VARIABLES.
   *
   * Alexander, 2026-09-08: *"the grid is just a matrix, we must define the matrix variables"* — so a map is
   * `cols × rows` cells, each a square of `cellSize` pixels (`columns = the number of cells per row`). All
   * three already lived on `IsometricGrid`; only cols and rows were reachable from the UI.
   *
   * `cellSize` is what a cell MEASURES, not how big it looks on screen — that is the camera's zoom. It
   * changes the world coordinates the player and every collision run in, which is why it rebuilds the grid
   * like a resize rather than being a view setting.
   */
  const resizeGrid = (cols: number, rows: number, cellSize?: number) => {
    const newConfig = { ...VILLAGE_CONFIG, cols, rows, cellSize: cellSize ?? gridRef.current?.cellSize ?? VILLAGE_CONFIG.cellSize }
    gridRef.current = new IsometricGrid(newConfig)
    // Fill with grass by default
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        placeGround(gridRef.current, c, r, 'grass')
      }
    }
    setGridSize({ cols, rows, cellSize: newConfig.cellSize })
    // Reset player to valid spawn at center
    movePlayerToValidSpawn(Math.floor(cols / 2), Math.floor(rows / 2))
  }

  /** Resize from the Generate panel (§4.6). `resizeGrid` is the raw mechanism — it throws the map away and
   *  is also used by the generator and by loading a level, both of which manage history themselves. The
   *  POLICY belongs here, at the one call site a person can trigger: §3.11 measured that `resizeGrid` never
   *  calls `checkpointHistory`, so a mis-typed width was unrecoverable. Now Ctrl+Z brings the map back. */
  const resizeMapFromPanel = (cols: number, rows: number, cellSize: number) => {
    checkpointHistory()
    resizeGrid(cols, rows, cellSize)
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
    const kind = entityKindForUnitTile(tile)
    if (!kind) return false // an `fx` tile is not a character — placementFor routes it to a decoration asset
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

  /** Deliverable #1 (Image #15) — the Inspector's "Replace tile" must SWAP the selected tile IN PLACE, not stack
   *  a new one on top like the paint brush. For each selected tile (resolved PER KEY to its OWN stack slot, the
   *  same per-key resolution the settings edits use), replaceTileInPlace swaps that exact tile for the picked one
   *  — tiles above/below untouched, stack height unchanged. The one case it can't swap in place — a NON-terrain
   *  tile picked while the FLOOR slab is the selected slot — it refuses, and we fall back to the paint path so the
   *  tile still lands (an "add"). Snapshots history so Ctrl+Z reverts, and keeps the selection so you can keep
   *  editing. */
  const replaceTileOnSelection = (tile: TileDef) => {
    const grid = gridRef.current
    if (!grid || selectedCells.size === 0) return
    checkpointHistory()
    for (const { col, row, index } of resolveSelectionTargets(selectedCells, selectedTileLevelRef.current)) {
      if (!replaceTileInPlace(grid, col, row, index, tile)) placeArmedTileAt(col, row, tile) // floor+block edge → stack
    }
    bumpBuildingVersion()
  }

  /** Deliverable #1 — CLEAR every tile off the selected cell(s) so they go BARE: pop each stacked asset via
   *  the SAME erase primitive ⌥Alt-click uses (`removeTopAsset`, which re-derives collision) AND clear the
   *  cell's GROUND/floor tile (a road/terrain/plaza is a floor tile too — `clearGroundTile` resets it to the
   *  bare default, uniformly, with NO branch on tile type). Then reset collision to walkable, so the cell is
   *  the same bare state a freshly-initialised one has (mirrors __clearRegion). Snapshots history first, so
   *  Ctrl+Z restores BOTH the stacked tiles and the cleared road. */
  const clearTilesAt = (cells: readonly { col: number; row: number }[]) => {
    const grid = gridRef.current
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
  /** The cell-selection entry point for {@link clearTilesAt}. A selected UNIT clears the ONE cell it stands
   *  on through the SAME primitive — same card, same action, no fork. */
  const clearTilesOnSelection = () => clearTilesAt(cellsFromKeys(selectedCells))

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




  // Random map generator using TEMPLATE_PRESETS system
  // Pipeline: grid → roads → buildings around roads → nature → collisions → NPCs
  // ── Stage generation (zone × variant) — randomized on click ──
  // `buildingSalt` shifts the per-footprint material/roof/wall-colour hash so a "randomize buildings
  // only" re-roll repaints the town's buildings (new materials + roof/wall tones) while the geometry
  // — a plot decision — stays put. 0 (the default) reproduces the un-salted look.
  // `palette` is the running generator's own material + colour lists (`/api/generators` → config.buildings,
  // §3.14a). Absent — a generator that ships no palette, or an unreachable catalog — means the stamp passes
  // NO material and NO colour, so each building shows its composition's own served art; the frontend never
  // substitutes a palette of its own.

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
  const lastGenRef = useRef<{ zone: ZoneId; variant: VariantId; layout?: ForestLayout; cols: number; rows: number; seeds: Record<'layout' | 'buildings' | 'nature' | 'decor', number> } | null>(null)
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
  const reseedUnits = (grid: IsometricGrid, generator: GeneratorDef) => {
    const units = generator.config.units
    if (!units) { console.warn(`[generate] the "${generator.key}" generator serves no unit counts — no townsfolk or enemies placed`); return }
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r) || groundKind(grid.groundAt(c, r)) === 'water'),
    )
    setEntities(prev => {
      const kept = byKind(prev, 'player')
      const townsfolk = units.townsfolk > 0
        ? scatterEntities({ collision, occupied: kept.map(e => ({ col: e.col, row: e.row })), count: units.townsfolk, kinds: ['npc'], idPrefix: `town-${Date.now()}` })
        : []
      return [...kept, ...townsfolk]
    })
    seedStageEnemies(grid, units.enemyTypes, units.enemies, generator.key)
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
    const generator = findGenerator(generatorCatalogRef.current, recipe.variant, recipe.layout)
    if (!generator) { console.warn(`[generate] the backend serves no "${recipe.variant}" generator — nothing re-rolled`); return }
    if (layer === 'units') { reseedUnits(grid, generator); bumpBuildingVersion(); return }

    const isSettlement = recipe.variant === 'town' || recipe.variant === 'city'
    // Non-settlement archetypes read only the layout rng, so route every scope through it there.
    const engineLayer = isSettlement ? layer : 'layout'
    const seeds = { ...recipe.seeds, [engineLayer]: randSeed() }
    lastGenRef.current = { ...recipe, seeds }
    if (layer === 'buildings' && isSettlement) buildingSaltRef.current = randSeed() // repaint the buildings

    const full = generateStage({ zone: recipe.zone, variant: recipe.variant, layout: recipe.layout, cols: recipe.cols, rows: recipe.rows, seeds })
    const stage = layer === 'layout' && isSettlement ? stripToLayout(full) : full
    applyStageToGrid(stage, grid, buildingSaltRef.current, generator.config.buildings)
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

  const generateStageInEditor = (
    zone: ZoneId,
    variant: VariantId,
    layout?: ForestLayout,
    /** The size the panel asked for — cell pixels included. Absent = let the generator roll one. */
    requested?: MapSize,
    seed?: number,
  ) => {
    // WHICH world to build is the backend's answer (`/api/generators`, T-113): the map type's grid range,
    // unit counts and building palette all come off this row. No generator → nothing is generated and the
    // console says why; the editor must never invent a world the backend cannot describe.
    const generator = findGenerator(generatorCatalogRef.current, variant, layout)
    if (!generator) {
      console.warn(`[generate] the backend serves no "${variant}" generator${layout ? ` with layout "${layout}"` : ''} — nothing generated`)
      return
    }
    // A fixed SEED (the dev/validation harness only — no UI path passes one) makes the WHOLE generate
    // reproducible: the grid size is rolled from the SAME served range through a seeded rng, and the
    // per-layer seeds derive from it, so a generator can be iterated frame-to-frame against a reference.
    const seeded = seed !== undefined
    // THE SIZE YOU CHOSE WINS. Alexander, 2026-09-09: *"I clicked build this world and it randomized the
    // values I selected on step 4 how big"* — and he was right: this rolled a random size from the
    // generator's served range and then resized over the top of it, so the panel offered a decision it then
    // discarded. That conflict arrived when map size moved INTO this panel.
    //
    // He also asked for *"randomized sizes on the layouts and maps"*, so randomising is not removed — it is
    // made explicit. `requested` absent = roll one (the dev harness and the "surprise me" path); present =
    // that is the size, clamped to what the generator can actually build.
    const rolled = rollGridSize(generator, seeded ? makeRng(seed) : Math.random)
    if (!rolled) {
      console.warn(`[generate] the "${generator.key}" generator serves no grid range — nothing generated`)
      return
    }
    // THE NUMBERS YOU TYPED WIN, held only inside what the ENGINE can build. Alexander, 2026-09-09:
    // *"Again, I picked a specific map size, specified the rows, columns and cell pixels, picked meadow
    // forest, clicked build this world and it didn't built it with the specific sizes I selected."*
    //
    // This used to clamp to the GENERATOR's served range, which for Meadow is rows 24–35 — so a requested
    // 40 became 35 with nothing said. The generator's range steers the random roll and is shown in the
    // panel as guidance; it is not a veto. `cellSize` is honoured too: it was simply dropped before.
    const current: MapSize = {
      cols: gridRef.current?.cols ?? rolled.cols,
      rows: gridRef.current?.rows ?? rolled.rows,
      cellSize: gridRef.current?.cellSize ?? VILLAGE_CONFIG.cellSize,
    }
    const size = requested
      ? clampMapSize(requested, current)
      : { ...rolled, cellSize: current.cellSize }
    resetHistory() // a freshly generated stage replaces the whole map → start its undo history clean
    markEdited()   // …and the server has never seen this map, so it is unsaved work (§4.4)
    resizeGrid(size.cols, size.rows, size.cellSize)
    const grid = gridRef.current
    if (!grid) return
    // Capture a per-layer SEED set so the Generate menu can later re-roll a SINGLE layer (buildings /
    // trees / decor / layout) while the rest — fed these same seeds — reproduce identically.
    const seeds = seeded
      ? { layout: seed, buildings: seed + 1, nature: seed + 2, decor: seed + 3 }
      : { layout: randSeed(), buildings: randSeed(), nature: randSeed(), decor: randSeed() }
    lastGenRef.current = { zone, variant, layout, cols: grid.cols, rows: grid.rows, seeds }
    buildingSaltRef.current = seeded ? seed + 4 : randSeed()
    // THE GENERATOR'S OWN NATURE DENSITIES travel with the call. They were served by the backend and
    // parsed into the catalog since T-113, but `generateStage` never took them, so `groundCover` was dead
    // data — the knob existed at both ends with nothing between. `nature.canopy` is what makes the
    // woodland layout a forest, so this is the wire that carries it.
    const stage = generateStage({ zone, variant, layout, cols: grid.cols, rows: grid.rows, seeds, nature: generator.config.nature })
    applyStageToGrid(stage, grid, buildingSaltRef.current, generator.config.buildings)
    movePlayerToValidSpawn(stage.spawn.col, stage.spawn.row)
    const live = livePlayerCell()
    syncPlayerEntity(live.col, live.row, true) // fresh stage → player entity follows the spawn
    // Populate with real, SELECTABLE, gendered npc entities. Any ☺ props get promoted; on top of that,
    // SETTLED stages (forest/town/city) carry NO npcs from the generator, so scatter gendered townsfolk
    // onto walkable cells — else a "town" has no townspeople (and no females). Dungeons (cave/temple)
    // get enemies instead (below). A (re)generate RESETS the roster to just the player — drop any
    // enemies + wanderers left from a previous generate so they don't stack up, then re-randomize.
    const promotedNpcs = promoteNpcAssetsToEntities(grid)
    // WHO lives here is generator data too: `units.townsfolk` (the old 14/8/5 ternary) and, for a dungeon,
    // `units.enemies` of `units.enemyTypes` (the old CAVE_/TEMPLE_ENEMY_TYPES constants). A generator that
    // serves no unit counts populates nothing rather than borrowing another map type's roster.
    const units = generator.config.units
    if (!units) console.warn(`[generate] the "${generator.key}" generator serves no unit counts — no townsfolk or enemies placed`)
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r) || groundKind(grid.groundAt(c, r)) === 'water'),
    )
    setEntities(prev => {
      const kept = byKind(prev, 'player')
      const townsfolk = units && units.townsfolk > 0
        ? scatterEntities({ collision, occupied: kept.map(e => ({ col: e.col, row: e.row })), count: units.townsfolk, kinds: ['npc'], idPrefix: `town-${prev.length}` })
        : []
      return [...kept, ...promotedNpcs, ...townsfolk]
    })
    if (units) seedStageEnemies(grid, units.enemyTypes, units.enemies, generator.key)
    setSelectedCells(new Set())
  }

  // Scatter the generator's OWN enemy roster onto a freshly-generated floor (grouped by type via the
  // shared spawner), spaced from the player + any existing entities. The play loop lazily gives each a
  // combat runtime the first frame it's seen. Count and roster are both `config.units` DATA now, so an
  // outdoor map (0 enemies, empty roster) simply places none — there is no cave/temple branch left.
  const seedStageEnemies = (grid: IsometricGrid, enemyTypes: readonly string[], count: number, prefix: string) => {
    if (count <= 0 || enemyTypes.length === 0) return
    const collision = Array.from({ length: grid.rows }, (_, r) =>
      Array.from({ length: grid.cols }, (_, c) => grid.isBlocked(c, r) || groundKind(grid.groundAt(c, r)) === 'water'),
    )
    setEntities(prev => {
      const occupied = prev.map(e => ({ col: e.col, row: e.row }))
      const spawned = scatterEntities({
        collision,
        occupied,
        count,
        kinds: ['enemy'],
        enemyTypes, // each type grouped into its own map zone
        idPrefix: `${prefix}-${prev.length}`,
      })
      return [...prev, ...spawned]
    })
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
        const type = grid.groundAt(c, r)
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
        const groundType = grid.groundAt(c, r)
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

  /**
   * Keep the canvas's BACKING STORE matched to the box the grid layout gives it.
   *
   * `screenToCell`/`cellToScreen` already scale between `rect` and `canvas.width`, so the coordinate math
   * needs nothing from this — but the raster does: an undersized backing store is drawn blurry and an
   * oversized one wastes fill. One observer, one write, and the render loop reads the new size on its next
   * frame because it always reads `canvas.width` rather than caching it.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    sizeCanvasToBox(canvas)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => sizeCanvasToBox(canvas))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // The canvas is a PANE in the editor grid now, not a full-bleed backdrop, so its backing store is
    // sized from its own box — see the ResizeObserver effect below, which also fixes the fact that this
    // was previously measured once on mount and never again (resize the window today and the backing store
    // keeps its old size; only screenToCell's rect scaling hides it).
    sizeCanvasToBox(canvas)

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
            const groundType = grid.groundAt(c, r)
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

    // Input handling — the editor's key chords are DISPATCHED from the shortcut table
    // (`matchEditorAction`), not re-tested as a flat if-chain here. That table is also what the
    // `? Help` sheet prints, so the documentation cannot drift from the behaviour (design §4.9),
    // and adding a shortcut is one row there plus one effect below (CODING-STANDARDS §0: dispatch
    // maps over if/else-if). The table owns the guards every chord shares — never while typing in a
    // field, never with Alt held (Alt is the canvas's erase/cell modifier).
    // Each effect returns whether it CONSUMED the key; an unconsumed key falls through to the
    // movement accumulator, so Esc with nothing armed still reaches menus, and Tab still tabs.
    const editorActions: Record<EditorActionId, (e: KeyboardEvent) => boolean> = {
      // Copy the tile SELECTION into the clipboard ref.
      copy: e => {
        const grid = gridRef.current
        if (!grid || selectedCellsRef.current.size === 0) return false
        e.preventDefault()
        const clip = copyTiles(grid, selectedCellsRef.current)
        clipboardRef.current = clip
        toast(`Copied ${clip.tiles.length} tile${clip.tiles.length === 1 ? '' : 's'}`, 'success')
        return true
      },
      // Re-stamp the clipboard at the HOVERED cell (the selection's min corner lands there —
      // follow-cursor, corner-anchored), behind one undo checkpoint so a paste reverts whole.
      paste: e => {
        const grid = gridRef.current
        const clip = clipboardRef.current
        const hover = hoveredCellRef.current
        if (!grid || !hover || !clip || clip.tiles.length === 0) return false
        e.preventDefault()
        checkpointHistory()
        const n = pasteTiles(grid, clip, hover.col, hover.row)
        bumpBuildingVersion() // re-render after the in-place grid mutation
        toast(`Pasted ${n} tile${n === 1 ? '' : 's'}`, 'success')
        return true
      },
      inventory: () => { setInventoryOpen(o => !o); return true },
      quests: () => { setQuestLogOpen(o => !o); return true },
      // Re-roll the SELECTION's random attributes — the selected unit, or every selected tile.
      randomize: e => {
        if (!selectedEntityIdRef.current && selectedCellsRef.current.size === 0) return false
        e.preventDefault()
        randomizeSelected()
        return true
      },
      // Cycle the target through the ENEMIES CLOSE to the player (living enemies within
      // RANGED_RANGE), nearest first — never NPCs or the player. Shift+Tab goes back.
      // preventDefault so Tab doesn't shift DOM focus / scroll.
      cycleTarget: e => {
        e.preventDefault()
        const pc = livePlayerCell()
        const nearby = entitiesRef.current.filter(en => en.kind === 'enemy' && isLivingEnemy(en, enemyRuntimeRef.current))
        const ids = unitsInRange(nearby, pc.col, pc.row, RANGED_RANGE)
        const next = cycleSelection(ids, selectedEntityIdRef.current, e.shiftKey ? -1 : 1)
        if (next) setSelectedEntityId(next)
        return true
      },
      // Esc DISARMS the placement brush first (so the next click inspects instead of painting), and
      // only then clears the selection. With neither armed nor selected it is NOT consumed, so it
      // falls through to whatever else wants it (menus, the build editor).
      escape: () => {
        if (armedTileRef.current) { setArmedTile(null); return true }
        if (selectedEntityIdRef.current || selectedCellsRef.current.size > 0) {
          setSelectedEntityId(null)
          setSelectedCells(new Set())
          return true
        }
        return false
      },
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // `?` / F1 open the shortcut sheet — the answer to "nothing tells the user how to use the
      // editor" (§3.4). Same typing guard as every other chord.
      if ((e.key === '?' || e.key === 'F1') && !isTypingTarget(e.target)) {
        e.preventDefault()
        setHelpOpen(true)
        return
      }
      const action = matchEditorAction(e)
      if (action && editorActions[action](e)) return
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
        setZoomPct(Math.round(isoZoomRef.current * 100))
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

      // Controls are SCREEN-fixed: up always moves toward the top of the screen, at any camera rotation.
      // The camera only rotates the VIEW — `moveWorldDelta` turns the key's screen direction into the world
      // delta that lands there for the current `cameraFacing` (iso only; 2D/top don't rotate). So rotating the
      // camera never changes how the player moves.
      const iso = !use2DMovement
      const step = iso ? speed * 0.707 : speed // iso keys are diagonal unit vectors (√2) → 0.707 nets `speed`
      const facing = cameraFacingRef.current
      // MOVE_KEYS is the shared binding table — the help sheet documents THIS array, so the keys
      // the sheet shows are the keys the player moves with, by construction.
      for (const [keys, dir] of MOVE_KEYS) {
        if (!keys.some(k => mkeys[k])) continue
        const [dc, dr] = moveWorldDelta(dir, facing, iso)
        newX += dc * step
        newZ += dr * step
        player.facing = dir
        player.moving = true
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
          // #75 — the corner the nav's ↻ Rotate button turned to. WHILE TURNING we pass undefined so the
          // render falls through to the LIVE continuous turn (isoCameraTurn) that rotateCameraTo is easing.
          // Passing the discrete corner here was why the spin never showed: the grid stayed on the old corner
          // for the whole animation and snapped at the end, so all you saw was the map sliding sideways.
          cameraFacing: turnAnimRef.current !== null ? undefined : cameraFacingRef.current,
          playerViewRange: playerViewRangeRef.current, // nav Range control — undefined = full render, no cull
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
    // No naming dialog — same reason a new GAME doesn't ask (Alexander: "that's the worst UX ever …
    // just assign a random name … right away"). The level is named from the ones already saved and
    // the top-bar name field renames it in place.
    const id = await createBlankTemplate(nextLevelName(savedTemplates))
    if (!id) return
    setConnectorForm(f => ({ ...f, targetTemplateId: id }))
    await linkTemplatesToGame([id])
  }

  /** The Inspector's discoverable "💾 Save map" action — the SAME handler behind the cell card's and the unit
   *  card's button, so both save identically. An unnamed map warns instead of silently no-opping (spec §4). */
  const saveMapFromInspector = () => {
    if (!templateName.trim()) {
      toast('Name your map in the top bar to save', 'warning')
      return
    }
    void saveCurrentTemplate()
  }

  // Save current map as template
  const saveCurrentTemplate = async () => {
    const grid = gridRef.current
    if (!grid || !templateName.trim()) return
    markSaving() // the status line says "Saving…" while the write is out (§4.4)

    // Check template limit for new templates
    if (!currentTemplateId && savedTemplates.length >= maxTemplates) {
      toast(`Template limit reached (${maxTemplates}). Delete one first.`, 'warning')
      return
    }

    setIsSaving(true)
    try {
      const { groundData, heightData, assetsData } = serializeGrid(grid)

      // Fold every unit's LOADOUT (+ the hero's INVENTORY) onto its entity BEFORE serializing, so a
      // unit's gear rides the unit ("everything is data; what a unit HAS is data"). The folded entities
      // feed BOTH the entities field AND the assets rider, so equip/drop/reorder persist whichever channel
      // load reads (lib/unitDataPersistence).
      const entitiesToSave = foldUnitData(entitiesRef.current, loadoutsRef.current, inventoryRef.current)

      // Entities AND quests have no field in the template schema (api.ts is
      // read-only here), so they ride alongside the assets as marked records and
      // are split back out on load. This keeps both persistent without touching
      // the API layer. NPC↔quest links survive via each entity's own questId.
      const assetsWithEntities = [
        ...assetsData,
        ...entitiesToAssets(entitiesToSave),
        ...questsToAssets(quests),
        ...styleToAssets(activeStyleId), // active art style rides as one off-grid marker (ASCII → none)
        ...cellTriggersToAssets(cellTriggers), // cell triggers (enter/interact) ride as off-grid markers
        // Floor colour + dims now ride the FLOOR ASSET itself (it's in assetsData), so no separate markers.
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
          entities: entitiesToSave,
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
          entities: entitiesToSave,
          quests: questsRef.current,
          cols: grid.cols,
          rows: grid.rows,
          cellSize: grid.cellSize,
          isoScale: grid.isoScale,
          spawnCol: Math.floor(playerRef.current.x / grid.cellSize),
          spawnRow: Math.floor(playerRef.current.z / grid.cellSize),
        })
        suppressUnitAutoSaveRef.current = true // the create already saved the gear; don't immediately re-patch it
        setCurrentTemplateId(created.id)
        savedTemplateId = created.id
      }

      await loadTemplateList()
      // Inside a game: keep the join in sync — this template and everything it connects to belong to the game.
      if (savedTemplateId) {
        await linkTemplatesToGame([savedTemplateId, ...connectors.map(c => c.targetTemplateId)])
      }
      markSaved()
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
      // Floor colour + dims ride the FLOOR ASSET now (restored by deserializeToGrid → setAssets), so there is
      // nothing to reapply here — the floor is a plain level-0 asset that round-trips like every tile.
      gridRef.current!.removeAssetsWhere(
        a => isEntityAsset(a) || isQuestAsset(a) || isStyleAsset(a) || isTriggerAsset(a),
      )
      setActiveStyleId(styleById(loadedStyle).id) // restore the saved global skin (defaults to ASCII)
      setCellTriggers(loadedCellTriggers) // restore the authored cell triggers
      // Buildings are just their stamped per-cell tiles now (regular assets, like trees), so they
      // deserialize with the rest of grid.assets — no grouped-building marker to restore.
      setEntities(loadedEntities)
      setQuests(loadedQuests)
      resetHistory() // fresh map loaded → drop undo history so Ctrl+Z can't drag back the previous map
      markLoaded()   // …and what is on screen IS what the server holds, so there is nothing unsaved

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
      // Split each unit's persisted LOADOUT (+ the hero's INVENTORY) back out of the entities into the
      // editor's maps, so equip/drop/reorder show up exactly as they were saved (order included). Only
      // restore the inventory when the save carried one (older saves keep the current starter bag).
      const restoredUnitData = splitUnitData(template.entities ?? [])
      suppressUnitAutoSaveRef.current = true // this restore must not re-trigger a save of what we just loaded
      setLoadouts(restoredUnitData.loadouts)
      if (restoredUnitData.playerInventory) setInventory(restoredUnitData.playerInventory)
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
  /**
   * ADD a saved template to this game as a level, then open it (§4.4).
   *
   * Outside a game this is still plain "Load". Inside one it is a membership change: the template joins
   * `game.templateIds` — which is what the level stepper reads — and only then opens. Guarded by the dirty
   * tracker, like every other way of leaving the open map.
   */
  const addLevelToGame = async (id: string) => {
    if (!gameContext) { openTemplate(id); return }
    if (saveStatus.wouldLoseWork) {
      const leave = await confirm({
        title: 'Leave this level?',
        body: `"${templateName || 'This level'}" has unsaved changes. They will be lost.`,
        confirmLabel: 'Leave without saving',
      })
      if (!leave) return
    }
    await linkTemplatesToGame([id])
    await loadTemplate(id)
  }

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
    const doomed = savedTemplates.find(t => t.id === id)
    const ok = await confirm({
      title: 'Delete level',
      body: `Delete "${doomed?.name ?? 'this level'}"? This cannot be undone.`,
      confirmLabel: 'Delete level',
    })
    if (!ok) return

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
    // A blank NEW template lays down a generated map, and the generator catalog is a fetch — so wait for it
    // rather than marking the route handled and generating nothing (the catalog is the ONLY source of the
    // grid size + unit counts now). Every other route is unaffected.
    if (key === 'new' && generatorCatalog.length === 0) return
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
      // Lay down a fresh map with the REAL generator — the same one the ⚡ Generate menu drives. (This
      // used to call a second, parallel generator with its own 35-preset catalog and 21 hardcoded colour
      // themes, reachable ONLY from here; it was deleted with the rest of the hardcoded game data.)
      generateStageInEditor(genZone, 'town')
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
  }, [router.isReady, router.query, gameContext, generatorCatalog])

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
      {/* THE EDITOR SHELL — the approved design at :8899 ("PROPOSED — interactive, try it").
          `neb` is the design's token root and `ed` its four-zone grid: top = THE GAME, rail + panel = the
          world and what goes in it, canvas = the map, insp = what is SELECTED, bar = THE VIEW.
          Every dialog and play-mode overlay below stays `position:fixed`, which takes it OUT of grid flow —
          so this is a restyle of the chrome that is already wired, not a second tree. */}
      <main className={`neb ed fixed inset-0${hudMode ? ' edhud' : ''} ${zoneClasses(zoneShut, !hasSelection)}`.trimEnd()}>
        <div className="z-canvas">
          <canvas
            ref={canvasRef}
            className="nebcanvas block cursor-grab"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={() => { hoveredEntityIdRef.current = null; hoveredCellRef.current = null; ghostRef.current = null; handleCanvasMouseUp() }}
            onContextMenu={handleContextMenu}
            style={{ cursor: isPanning ? 'grabbing' : topViewMode ? 'default' : 'grab' }}
          />
          {/* The hybrid mode: the game keeps running underneath and the real HUD is draggable over it. */}
          {hudMode && <HudOverlay state={hudLayout} />}
          {/* THE LEVEL MAP. Inside the canvas pane, so it insets against the level and not the page. */}
          {isChromeVisible && !hudMode && levelMapOpen && (
            <LevelMinimap
              grid={gridRef.current}
              player={playerRef.current}
              entities={entities}
              style={activeStyle}
              camOffset={camOffset}
              zoomPct={zoomPct}
              mainCanvas={canvasRef.current}
              onJumpTo={(col, row) => {
                const grid = gridRef.current
                if (!grid) return
                // The same maths `__centerOn` uses — one notion of "centre the view on a cell".
                const cs = grid.cellSize
                const off = { x: playerRef.current.x - col * cs, y: playerRef.current.z - row * cs }
                camOffsetRef.current = off
                setCamOffset(off)
              }}
              onHide={() => setLevelMapOpen(false)}
            />
          )}
          {isChromeVisible && !hudMode && !levelMapOpen && (
            <button type="button" className="b sm mmshow" title="Show the map of this level" onClick={() => setLevelMapOpen(true)}>
              ▦ Map
            </button>
          )}
        </div>

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

        {/* VIEW BAR (§4.3 / §5.2 — Week 2). Everything about HOW you look at the map, moved OFF the top bar:
            at 1280×800 the nav measured 1763px of content in a 1246px strip, so Save / Play / Load / ⋯ More
            scrolled off the edge with no affordance (§3.3, a P0). Nothing in this bar changes the map. */}
        {isChromeVisible && (
          <ViewBar
            activeView={activeView}
            onIso={selectIsoView}
            on2D={select2DView}
            onTop={selectTopView}
            onFlow={toggleFlowView}
            facing={cameraFacing}
            onFacing={rotateCameraTo}
            playerRange={playerViewRange}
            onPlayerRange={setPlayerViewRange}
            dayNight={dayNight}
            onDayNight={() => setDayNight(d => (d === 'day' ? 'night' : 'day'))}
            showDebug={showDebug}
            onDebug={toggleDebug}
            showCollisions={showCollisions}
            onCollisions={toggleCollisions}
            hideEntities={hideEntities}
            onHideEntities={() => setHideEntities(h => !h)}
            fps={fps}
            renderMs={renderMs}
            onHelp={() => setHelpOpen(true)}
            onGuides={() => setGuidesOpen(true)}
            zoomPct={zoomPct}
          />
        )}

        {/* CANVAS MODE CHIP (§4.9) — sits just under the top bar and states what the next click does.
            It replaces the old select-only "Shift + drag" pill: that pill documented ONE mode and
            vanished the moment you armed a tool, which is exactly when a user needs telling. The chip
            is always on while the editor chrome is, so a mode is visible on the canvas rather than
            implied by whichever panel happens to be open (§4.1.7). */}
        {isCanvasOverlayVisible && (
          <div className="pointer-events-none fixed left-1/2 top-[4.5rem] z-20 -translate-x-1/2">
            <CanvasModeChip
              connectorMode={connectorMode}
              buildingTool={buildingTool}
              entityTool={entityTool}
              armedTileLabel={armedTile?.label ?? null}
            />
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
          <AbilityBar loadout={abilityLoadouts['__player__'] ?? defaultAbilityLoadout()} lastUsedRef={abilityLastUsedRef} />
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

        {/* THE LEVEL MAP — every level placed where its doorways say it is (see `levelMapLayout`).
            Rendered whenever Flow is on, INCLUDING with nothing saved: the gate used to require
            `currentTemplateId`, so on a game with no saved levels clicking Flow drew a black rectangle
            with no explanation of whether it was broken, loading or simply empty. The overlay now owns
            that empty state and says what to do next. */}
        {showFlowView && (
          <FlowViewOverlay
            currentTemplate={currentTemplateId ? { id: currentTemplateId, name: templateName } : null}
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

        {/* PROJECT BAR — §4.4, and ONLY the six things it draws:
              NEBULITH │ 🎮 Boss ▾ │ ◀ Level 3 of 5 · village ▾ ▶ │   ● Saved 12s ago  [💾 Save] [▶ Play]
            §4.3: "The top bar then holds only 6 things (brand, game, level stepper, save state, Save, Play)
            and fits at 1024 px." So `Load (n)` is gone from it (§4.4: "Load (n) disappears from the top bar
            … opening an arbitrary template that isn't in this game is an 'Add a level…' action"), ⚡ Generate
            and ◈ Unit are rail panels, ⚙ Stage is retired, and 🎨 Style moved to the VIEW bar — §4.1's first
            principle puts "how am I looking at it" in the bottom bar, and a reskin changes no map data. */}
        {/* NEVER scrolls — §4.11: "the project bar never scrolls. If it cannot fit, the game name truncates
            and the level label shortens" — and Alexander, 2026-09-08 (Image #8): *"fix bug, top bar
            scrolling, in general, I don't want any internal scrolling"*. `overflow-hidden` makes the
            flexible children TRUNCATE instead of pushing Save/Play off the edge. */}
        {isChromeVisible && (
        <nav className="z z-top">
          <span style={{ fontSize: 18 }} aria-hidden="true">🎮</span>
          {/* ART STYLE leads. Alexander, 2026-09-08: *"I think art style should be on top nav before game
              selector."* It is not a step in building a level — it is the skin the whole product wears, and
              one of the first two things anyone touches. It previews both styles on the same four labels,
              because "ascii" and "emoji" mean nothing to someone who has just arrived. */}
          <ArtStyleControl activeStyleId={activeStyleId} onPick={setActiveStyleId} />
          <span className="vr" aria-hidden="true" />
          <GameMenu
            gameName={gameContext ? (gameNameOverride ?? gameContext.gameName) : null}
            wouldLoseWork={saveStatus.wouldLoseWork}
            confirmLeave={() => confirm({
              title: 'Leave this game?',
              body: `"${templateName || 'This level'}" has unsaved changes. They will be lost.`,
              confirmLabel: 'Leave without saving',
            })}
            onRename={() => void renameGame()}
            onManageLevels={() => setShowGamesView(true)}
            onFlow={toggleFlowView}
            onExport={exportLayers}
            onAllGames={() => router.push('/personal-projects/game-engine/games')}
          />
          {/* §4.4 / §3.2 (P0): the game's OWN levels. They were loaded into state and never rendered — no
              name, no list, no "level 2 of 5" — so from inside the editor a game's levels were invisible.
              Guarded by the dirty-tracker: stepping away from unsaved edits ASKS first (§5.3). */}
          <LevelStepper
            levels={gameLevels}
            currentId={currentTemplateId}
            wouldLoseWork={saveStatus.wouldLoseWork}
            onGo={id => loadTemplate(id)}
            confirmLeave={() => confirm({
              title: 'Leave this level?',
              body: `"${templateName || 'This level'}" has unsaved changes. They will be lost.`,
              confirmLabel: 'Leave without saving',
            })}
            onAddLevel={() => {
              const r = loadBtnRef.current?.getBoundingClientRect()
              setLoadMenuPos(r ? { top: r.bottom + 4, left: r.left } : { top: 64, left: 200 })
              setShowTemplateList(true)
            }}
            onReorder={() => setShowGamesView(true)}
          />
          <button type="button" className="b sm" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undoEdit}>↶</button>
          <button type="button" className="b sm" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redoEdit}>↷</button>
          {gameLevels.length > 0 && <span className="vr" aria-hidden="true" />}
          {/* (view toggle, rotation and the render cull moved to the VIEW BAR — §4.3 / Week 2) */}
          {/* ↻ Rotate — swing the iso camera one quarter-turn so a different side of the map faces you. ISO
              only: 2D (front elevation) and Top (footprint) have no camera to rotate. */}
          <span className="mx-1 h-5 w-px shrink-0 bg-white/15" />
          {/* ⚡ Generate — the stage-preset zone/variant controls as a dropdown */}
          {/* ⚡ Generate retired — it is a rail PANEL now (§4.6 / Week 4), with room to breathe. */}
          {/* 🎨 Style moved to the VIEW bar (§4.1 principle 1: the bottom bar answers "how am I looking at it"). */}
          {/* ◈ Unit — place units. The enemy/creature PICKER lives here now (the paint palette no longer lists
              units): pick WHICH creature from the DB `units` tiles, choose Add (click to place) or Scatter, and
              place it static or with a randomized movement animation. Player/NPC/Erase/Collision stay as utility
              tools. Arming derives editorMode → 'unit', so canvas clicks place exactly as before. */}
          {/* ◈ Unit retired — the Characters LIBRARY is a rail panel now (§4.5 / Week 4). */}
          {/* ⚙ Stage retired (§3.11 / Week 4). It mixed a DESTRUCTIVE grid resize with four view toggles:
              the toggles moved to the view bar's 👁 Overlays (§4.3), map size moved into the Generate panel
              (§4.6) where it warns and takes an undo checkpoint, and the movement hint it carried is in the
              `? Help` sheet — which lists run/attack/special too, and cannot drift from the real bindings. */}
          {/* (FPS + `? Help` moved to the VIEW BAR — §4.3 gave them that home) */}
          {/* Outside a game there is no 🎮 menu and no level stepper, so the level's NAME and the way to
              open one live here. Inside a game the stepper names the level and `＋ Add a level` is in its
              dropdown, exactly as §4.4 draws it. */}
          {!gameContext && (
            <input
              type="text"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="Level name…"
              aria-label="Template name"
              className="w-36 shrink-0 rounded bg-gray-800 px-2 py-1 text-xs"
            />
          )}
          <div className="relative shrink-0">
            {/* The button only exists OUTSIDE a game (§4.4). Inside one, the same picker opens from the
                level dropdown's `＋ Add a level…`, which is what that action means. */}
            {!gameContext && (
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
              {/* §4.4: inside a game this is not navigation — opening a template that is not one of this
                  game's levels ADDS it. The stepper above is how you move BETWEEN levels. */}
              {`Load (${savedTemplates.length})`}
            </button>
            )}
            {showTemplateList && loadMenuPos && (
              <div
                style={{ position: 'fixed', top: loadMenuPos.top, left: loadMenuPos.left }}
                className="z-40 max-h-72 w-60 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-gray-950 p-2 shadow-2xl"
              >
                {savedTemplates.length === 0 && <p className="text-[10px] text-gray-500">No saved templates.</p>}
                {gameContext && (
                  <p className="px-1 pb-1 text-[10px] text-gray-500">Picking one adds it to this game as a level.</p>
                )}
                {savedTemplates
                  // Levels already in the game live in the stepper; listing them here too would offer
                  // "add" for something already added.
                  .filter(t => !gameContext || !gameTemplateIds.includes(t.id))
                  .map(t => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-1 rounded p-1 text-xs ${currentTemplateId === t.id ? 'bg-blue-900' : 'bg-gray-800 hover:bg-gray-700'}`}
                  >
                    <button
                      onClick={() => { void addLevelToGame(t.id); setShowTemplateList(false) }}
                      className="flex-1 truncate text-left"
                      disabled={isLoading}
                    >
                      {t.name}
                    </button>
                    <button onClick={() => handleDeleteTemplate(t.id)} aria-label={`Delete ${t.name}`} className="px-1 text-red-400 hover:text-red-300">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          {/* §4.4: `● Saved 12s ago` — the bar answers "is my work safe?" without being clicked. */}
          <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }} aria-live="polite">
            <span aria-hidden className={SAVE_TONE_DOT[saveStatus.tone]}>●</span>
            <span>{saveStatus.label}</span>
          </span>
          {/* [💾 Save] */}
          <button
            type="button"
            onClick={saveCurrentTemplate}
            disabled={isSaving || !templateName.trim()}
            aria-label="Save template"
            title={saveStatus.label}
            className={`b${saveStatus.wouldLoseWork ? ' pri' : ''}`}
          >
            {isSaving ? 'Saving…' : saveStatus.wouldLoseWork ? 'Save' : 'Saved'}
            {saveStatus.wouldLoseWork && !isSaving && <span className="dot" aria-hidden="true" />}
          </button>
          {/* [▶ Play] */}
          <button type="button" onClick={enterPlayMode} aria-label="Execute game" title="Play the game" className="b go">
            ▶ Play
          </button>
          {/* §4.4: Load (n) DISAPPEARS from the project bar — inside a game, opening a template that is
              not one of its levels is `＋ Add a level…` in the level dropdown, not a navigation action. It
              stays only OUTSIDE a game, where there is no game and no stepper to reach a level through. */}
          {/* ⋯ More — the remaining entry points kept reachable in an overflow menu */}
          <Dropdown label={<>⋯ More</>} align="right" panelClass="w-52">
            {close => (
              <div className="space-y-1 text-xs">
                <button onClick={() => { setShowSidebars(false); close() }} className="block w-full rounded bg-purple-700 px-2 py-1.5 text-left font-bold hover:bg-purple-600">▣ Preview (hide UI)</button>
                {/* Inside a game these live in the 🎮 menu (§4.4); outside one there is no game menu, so they
                    stay reachable here rather than disappearing. */}
                {!gameContext && <button onClick={() => { openGamesView(); close() }} className="block w-full rounded bg-indigo-700 px-2 py-1.5 text-left font-bold hover:bg-indigo-600">Games</button>}
                {!gameContext && <button onClick={() => { exportLayers(); close() }} className="block w-full rounded bg-orange-700 px-2 py-1.5 text-left font-bold hover:bg-orange-600">Export</button>}
                {/* Every exit goes through `leaveTo`, which asks before discarding unsaved work (§3.15). */}
                <button onClick={() => { close(); void leaveTo('/personal-projects/game-engine') }} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">← Templates</button>
                <button onClick={() => { close(); void leaveTo('/personal-projects/game-engine/templates?new=1') }} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">＋ New template</button>
                <button onClick={() => { close(); void leaveTo('/') }} className="block w-full rounded bg-gray-700 px-2 py-1.5 text-left hover:bg-gray-600">CV / Portfolio</button>
              </div>
            )}
          </Dropdown>
        </nav>
        )}

        {/* Bottom-right floating control: the way BACK from preview. Entering preview lives in the top-nav
            "⋯ More" menu, but hiding the UI hides that nav too — so this restore button is the only route
            back and renders ONLY while the UI is hidden. */}
        {chromeRestoreVisible(chrome) && (
          <button
            onClick={() => setShowSidebars(true)}
            aria-pressed
            className="fixed bottom-4 right-4 z-30 rounded-full bg-purple-700 px-4 py-2 font-mono text-xs font-bold text-white shadow-lg hover:bg-purple-600"
          >
            ✎ Edit (show UI)
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
        {playMode && <FpsReadout fps={fps} renderMs={renderMs} variant="floating" />}

        {/* LEFT — tool-rail: the editor modes (Select / Paint / Unit / Building / Connector) */}
        {isChromeVisible && (
          <div className={`z z-rail${zoneShut.rail ? ' shut' : ''}`}>
            <ZoneCollapse name="Tools" shut={zoneShut.rail} side="left" onToggle={() => toggleZone('rail')} />
            <ToolRail activeId={activeRailId} counts={railCounts} hudActive={hudMode} onPick={pickRail} bare />
          </div>
        )}

        {/* LEFT MODE PANEL — the active mode's tools, docked next to the rail */}
        {isChromeVisible && (
          <aside className={`z z-panel${zoneShut.panel ? ' shut' : ''}`} aria-label="Tool panel">
            <ZoneCollapse name={activeRailId === 'generate' ? 'New world' : activeRailId === 'rules' ? 'Rules' : 'Library'} shut={zoneShut.panel} side="left" onToggle={() => toggleZone('panel')} />
            {/* THE PLAYER'S UI. It is a MODE, not a rail panel: the HUD is arranged ON the running game, so
                it takes the panel slot and drops the cell inspector (a HUD element is not a cell). */}
            {hudMode && <PlayerUiPanel state={hudLayout} onDone={() => setHudMode(false)} />}

            {!hudMode && activeRailId === 'terrain' && (
              <>
                {/* DB tile catalog — the FULL tileset (terrain / buildings / units / nature) for the active
                    art style, straight from tilesForStyle. Pick one to ARM it as the brush, then click the
                    map to place; the exact tile is pinned per-cell so it survives a style switch too. */}
                <TilePalette
                  styleId={activeStyleId}
                  styleName={activeStyle.name}
                  armedId={armedTile?.id ?? null}
                  onArm={t => { if (t) rememberRecent(t); armTile(t) }}
                  onHover={setLibraryHover}
                  preview={previewContext}
                  recent={recentTiles}
                />
              </>
            )}

            {!hudMode && activeRailId === 'objects' && (
              <>
                {/* EVERY composition the backend serves — the same set the world randomizer stamps (buildings,
                    trees/bushes, fountains, wells, lamp posts…), grouped + labelled with their footprint size.
                    Pick one to ARM it, then move over the map to see a ghost footprint, and click to stamp its
                    cells. Data-driven from the loaded tileset — never a hardcoded building-only list. */}
                <p className="mb-2 text-[10px] leading-tight text-gray-400">
                  Pick a composition, then hover the map to preview its footprint and click to place it.
                </p>
                <CompositionPalette
                  catalog={compositionPalette}
                  styleId={activeStyleId}
                  preview={previewContext}
                  armedKind={buildingTool}
                  onArm={toggleBuildingTool}
                  onHover={setLibraryHover}
                />
              </>
            )}

            {/* CHARACTERS (§4.5, Week 4) — the creature library, moved out of the ◈ Unit TOP-BAR DROPDOWN.
                §3.6 measured it there: 79 creatures, 4-per-row, in a 256px popover, ordered by nothing. In
                the rail it wears the same header/search/armed-state as the other two libraries, so learning
                one teaches all three (§2 C: "three libraries, one idiom"). */}
            {!hudMode && activeRailId === 'characters' && (
              <>
                {/* WHAT DO YOU WANT TO DO — the four verbs, each named after its EFFECT rather than its
                    mechanism. "Collision" was a tool nobody could read: it paints cells that block movement
                    and draw nothing, so that is what it now says. They sit above the library because they
                    decide what a click DOES; the library below decides what it does it WITH. */}
                <div className="pfix">
                  <div className="sub">What do you want to do</div>
                  <div className="seg" style={{ flexWrap: 'wrap' }} role="group" aria-label="What do you want to do">
                    <button type="button" aria-pressed={entityTool === 'player' && !unitTile}
                      className={entityTool === 'player' && !unitTile ? 'on' : ''}
                      title="Where the player begins — only one" onClick={() => toggleEntityTool('player')}>
                      Set the hero start
                    </button>
                    <button type="button" aria-pressed={entityTool === 'npc' && !unitTile}
                      className={entityTool === 'npc' && !unitTile ? 'on' : ''}
                      title="Drop a plain friendly character" onClick={() => toggleEntityTool('npc')}>
                      Add a villager
                    </button>
                    <button type="button" aria-pressed={entityTool === 'erase'}
                      className={entityTool === 'erase' ? 'on' : ''}
                      title="Click one on the map to delete it" onClick={() => toggleEntityTool('erase')}>
                      Remove a character
                    </button>
                    <button type="button" aria-pressed={entityTool === 'collision'}
                      className={entityTool === 'collision' ? 'on' : ''}
                      title="Blocks movement, draws nothing — the old “Collision” tool"
                      onClick={() => toggleEntityTool('collision')}>
                      Paint invisible walls
                    </button>
                  </div>
                  {entityTool === 'npc' && !unitTile && (
                    <div className="ctl">
                      <span className="l">Name (optional)</span>
                      <input type="text" value={npcName} onChange={e => setNpcName(e.target.value)}
                        placeholder="Villager" aria-label="NPC name" style={{ flex: 1, minWidth: 90 }} />
                    </div>
                  )}
                </div>

                <UnitPicker
                    units={unitTiles}
                    pickedId={unitTile?.id ?? null}
                    onPick={pickUnitTile}
                    mode={unitPlaceMode}
                    onMode={setUnitPlaceMode}
                    animated={unitAnimated}
                    onAnimated={setUnitAnimated}
                    onScatter={scatterUnits}
                    placeAs={placeAs}
                    onPlaceAs={setPlaceAs}
                  autoKindLabel={unitTile ? (entityKindForUnitTile(unitTile) ?? 'nothing') : undefined}
                  onHover={setLibraryHover}
                  onOpenPlacement={() => setPlacementOpen(true)}
                />

                {/* §4.5's footer: "9 characters on this level [Clear…]". The ellipsis is the promise — it opens a
                    dialogue rather than wiping the roster on one click, which is what §5.1 asks of every
                    destructive action. */}
                <div className="pfoot" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>{entities.length} {entities.length === 1 ? 'character' : 'characters'} on this level</span>
                  {entities.length > 0 && (
                    <button
                      onClick={() => void clearAllEntities()}
                      className="rounded bg-red-900 px-2 py-1 font-bold text-red-200 hover:bg-red-800"
                    >
                      Clear…
                    </button>
                  )}
                </div>
              </>
            )}

            {/* GENERATE (§4.6, Week 4) — the world generator as a PANEL, not a dropdown. Its data already
                comes from `/api/generators` (T-113); this gives it the room the dropdown never had. */}
            {!hudMode && activeRailId === 'generate' && (
              <>
                <div className="lhead">
                  <div className="lt"><span>New world</span></div>
                  <div className="ls">a whole level from a preset — replaces what is on this level now</div>
                </div>
                <GenerateControls
                  catalog={generatorCatalog}
                  catalogError={generatorCatalogError}
                  zone={genZone}
                  onZone={z => setGenZone(z as ZoneId)}
                  onGenerate={(z, v, layout, requested) =>
                    generateStageInEditor(z as ZoneId, v as VariantId, layout as ForestLayout | undefined, requested)}
                  onRandomizeLayer={layer => randomizeLayerInEditor(layer as LayerId)}
                  selectedCount={selectedCells.size}
                  onRandomizeSelection={randomizeSelected}
                  size={gridSize}
                  onResize={resizeMapFromPanel}
                  preview={previewContext}
                />
              </>
            )}

            {/* ART STYLE — its own group (Alexander, 2026-09-08). Lists every art style the BACKEND serves
                (a tileset row IS a style), and switching one swaps only the pictures: same labels, same
                names, same heights, different png. */}

            {/* RULES (§4.8, Week 6) — the Logic workspace. Triggers, connections and quests lived in three
                unrelated places (per-selection, a hidden canvas mode, and behind clicking an NPC); this
                lists what the level ALREADY has and states each add-action's prerequisite. */}
            {!hudMode && activeRailId === 'rules' && (
              <>
                <div className="lhead">
                  <div className="lt"><span>Rules</span></div>
                  <div className="ls">doorways, quests and when-then rules</div>
                </div>
                <RulesWorkspace
                  tab={rulesTab}
                  onTab={setRulesTab}
                  triggers={ruleTriggerRows}
                  triggerBlockedReason={triggerBlockedReason(selectedCells.size > 0 || selectedEntityId !== null)}
                  onAddTrigger={() => setTriggersOpen(true)}
                  onOpenTrigger={() => setTriggersOpen(true)}
                  connections={connectionRows(connectors)}
                  placingConnection={connectorMode}
                  onStopPlacing={closeConnectorPanel}
                  onNewConnection={openConnectorPanel}
                  onOpenConnection={openConnectorPanel}
                  quests={questRows(quests, npcsOnLevel)}
                  questBlockedReason={questBlockedReason(npcsOnLevel)}
                  onNewQuest={() => setQuestPanelOpen(true)}
                  onOpenQuest={() => setQuestPanelOpen(true)}
                />
              </>
            )}

            {/* The Connectors tool moved OFF the left rail — its entry is a button in the RIGHT sidebar that
                opens a draggable Connectors modal (see the Inspector). */}
          </aside>
        )}

        {/* RIGHT — Inspector: stage settings when nothing is selected, else the selection */}
        {/* Nothing selected → no inspector. It returns the moment you click something. */}
        {isChromeVisible && !hudMode && hasSelection && (
          <aside className={`z z-insp${zoneShut.insp ? ' shut' : ''}`} aria-label="Inspector">
            <ZoneCollapse name="Selected" shut={zoneShut.insp} side="right" onToggle={() => toggleZone('insp')} />
            {/* The header names WHAT IS SELECTED — that is the object this zone acts on. The level's name
                belongs to the game, and the game lives in the top bar. */}
            <div className="ihd">
              <div className="t">Selected</div>
              <div className="s"><span>{templateName || 'New Template'}</span></div>
            </div>

            {/* ↗ DOORWAYS — the tool's entry, moved off the left rail. Opens a draggable/resizable modal.
                The user-facing word is DOORWAY, from the approved help text: *"What a doorway is — a set of
                cells that takes the player somewhere."* Alexander, 2026-09-09: *"labels sucks across the
                whole UI, they're not clear."* "Connector" names the data structure, not the thing a person
                is making; the `Connector` type keeps its name. */}
            {/* Opens a draggable/resizable modal
                (like the settings one) hosting the whole connector flow. Highlights while it's open. */}
            <button
              onClick={() => (connectorPanelOpen ? closeConnectorPanel() : openConnectorPanel())}
              aria-pressed={connectorPanelOpen}
              title="Doorways — cells that take the player somewhere else"
              className={`b wide sm${connectorPanelOpen ? ' on' : ''}`}
            >
              ↗ Doorways{connectors.length ? ` (${connectors.length})` : ''}
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
                  preview: selBaseVisual, // the tile chip shows the unit's own baked art, like any other tile
                  // A unit ALWAYS carries art, so the tile-add button reads "Replace tile" — the SAME button a
                  // cell uses. Its library lists the character tiles (the `units` category), which is how a
                  // unit's figure is changed now that the Figure variant row is gone.
                  libraryLabel: 'Swap this tile for another…',
                  onOpenLibrary: () => setTileLibraryOpen(true),
                  pose: selEntity.pose,
                  onPose: p => patchSelectedEntity({ pose: p }),
                  onPoseReset: () => patchSelectedEntity({ pose: undefined }),
                  onOpenAnimator: () => setAnimEditorOpen(true),
                  // The old unit card listed the authored animations inline; the unified card's vocabulary
                  // for that is the Animate button's COUNT, so feed it the SAME unified list the modal edits
                  // (a unit minted before `unitAnimations` bridges from its legacy sprite list).
                  animations: selEntity.unitAnimations ?? unitAnimationsFromEntity(selEntity.animations),
                }
                return (
                  <>
                    {selEntity.kind !== 'player' && (
                      <button
                        onClick={randomizeSelected}
                        title="Re-roll this unit's random attributes — a new figure variant + a fresh wander animation (hotkey R)"
                        className="w-full rounded bg-indigo-700 px-2 py-1.5 text-xs font-semibold transition-colors hover:bg-indigo-600"
                      >
                        🎲 Randomize unit
                      </button>
                    )}
                    {/* ONE card — literally the SAME PropertiesPanel a tile uses, with the unit's extras folded
                        IN via `unitSection`. There is no unit menu any more: collision (the unit's "blocks
                        movement"), Clear tiles, the tile chip + colour, Add/Replace tile, Edit settings…,
                        Animate…, Remove tile, Triggers… and Save map are the tile card's own controls; the unit
                        only ADDS its name/size rows and the Stats / Inventory / Quests / Attacks buttons. */}
                    {/* The coords ride the card title exactly as the cell card's do (`Cell (3, 4)`) — the old
                        `▸ PLAYER (PLAYER) @ 32,10` header pill is gone, so there is ONE unit header, not two. */}
                    <>
                      <PropertiesPanel
                        // ONE collision control for everything: for a unit the toggle IS `blocksMovement`
                        // (the old standalone "Blocks movement" checkbox is gone).
                        collision={selEntity.blocksMovement ?? false}
                        onCollision={blocked => patchSelectedEntity({ blocksMovement: blocked })}
                        tile={unitTileModel}
                        level={1}
                        levelCount={1}
                        onLevel={() => {}}
                        sectionOpen={inspectorSectionOpen}
                        onToggleSection={toggleInspectorSection}
                        present={presentInspectorSection}
                        onOpenTriggers={() => setTriggersOpen(true)}
                        triggerCount={selEntity.triggers?.length ?? 0}
                        // Clear tiles targets the cell the unit STANDS on, through the same primitive a cell
                        // selection uses; Remove tile deletes the unit — a unit IS a tile, so no bespoke Delete.
                        onClearTiles={() => clearTilesAt([{ col: selEntity.col, row: selEntity.row }])}
                        onRemove={deleteSelectedEntity}
                        unitSection={
                          <div className="space-y-3">
                            {/* name + size rows and the entry buttons a tile never has. `buildUnitModel` owns
                                which kind gets which: stats + inventory are UNIVERSAL, quests is the NPC's and
                                attacks the enemy's. Each opens its own modal. */}
                            <UnitSettingsSection
                              unit={buildUnitModel(selEntity, {
                                onPatch: patchSelectedEntity,
                                onSize: setSelectedEntitySize,
                                openStats: () => setUnitStatsOpen(true),
                                openInventory: () => setEntityModal('inventory'),
                                openQuests: () => { setQuestDraft(d => ({ ...d, giverId: selEntity.id })); setEntityModal('quests') },
                                openAttacks: () => setUnitAttacksOpen(true),
                              })}
                            />
                            {isPlayer && <CombatHud hud={playerHud} />}
                            {heldWeaponKind && styleTile('emoji', heldWeaponKind) && (
                              <div className="border-t border-white/10 pt-3">
                                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                                  🗡️ Held weapon — {heldWeaponKind} <span className="font-normal text-gray-500">(drag to retune it live in-hand)</span>
                                </p>
                                <PoseControls
                                  kind={heldWeaponKind}
                                  pose={styleTile('emoji', heldWeaponKind)?.pose}
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
                      {/* the SAME discoverable save the cell card carries — one component, one behaviour */}
                      <SaveMapButton saving={isSaving} onSave={saveMapFromInspector} />
                    </>
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
                    {/* unit settings modal retired (§4.7 / Week 5) — every control it hosted is an inline accordion in the inspector now. */}
                    {/* Stats — the "⛊ Stats…" button's draggable/resizable modal: the extra unit settings that
                        are NOT tile settings (HP/DEF/STR/INT/DODGE%, hittable, the enemy's kill-quest tag +
                        respawn). Geometry persists in the backend under id "stats", like every other panel. */}
                    {unitStatsOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Stats`} accent="orange" onClose={() => setUnitStatsOpen(false)} {...floatingProps('stats', { w: 320, h: 400 })}>
                        <UnitStatsBody entity={selEntity} onPatch={patchSelectedEntity} />
                      </FloatingPanel>
                    )}
                    {/* Triggers — a floating modal (like settings) to manage this unit's on-defeat triggers. */}
                    {triggersOpen && (
                      <FloatingPanel title={`${selEntity.name || selEntity.kind} — Rules`} accent="yellow" onClose={() => setTriggersOpen(false)} {...floatingProps('triggers', { w: 360, h: 380 })}>
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
                    <p className="hint">
                      Editing this doorway in the <span className="font-bold text-purple-300">↗ Doorways</span> panel — set where it leads, when it fires and which cell they arrive on.
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
                    <>
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
                        // The library action names itself by WHAT IS SELECTED, not by how full the cell is: if a TILE
                        // sits at the selected slot it gets REPLACED — and the floor slab IS a tile like any other,
                        // so a plain grass cell reads "Replace tile" too. Only an EMPTY slot (a cleared cell, nothing
                        // to swap) reads "Add tile". Counting levels made the one-tile floor read "Add" and hid the
                        // swap entirely.
                        const libraryLabel = stack[lvl] ? 'Swap this tile for another…' : 'Add a tile here'
                        // A tile's baked art for the Inspector thumbnail — pinned override first, else the style's
                        // tile for that slug. Undefined (ascii/none) → the preview shows a neutral placeholder.
                        const previewFor = (id: string | null | undefined, slug: string): Visual | undefined =>
                          (id ? visualForTileId(id) : undefined) ?? visualForTileId(`${activeStyleId}:${slug}`) ?? undefined
                        // Shared value of the i-th stacked tile's field across the cells that HAVE it.
                        const adim = (i: number, read: (a: GridAsset) => number) => {
                          const vals = cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]).filter((a): a is GridAsset => !!a).map(read)
                          return vals.length ? commonValue(vals) : 1
                        }

                        // Set only on the branch whose writers cannot write (§3.13) — see below.
                        let tileNotice: string | undefined
                        let tile: TileControlModel
                        // Context for the Phase-4 tile-animation modal — set only for an asset tile (the sole
                        // tile that owns GridAsset.animations). Read at the return so the modal can render in scope.
                        let animatorCtx: { i: number; label: string; animations: TileAnim[]; category: TileCategory; baseVisual: Visual } | null = null
                        if (stack[lvl]?.source === 'asset') {
                          // EVERY tile in the cell — the FLOOR (a level-0 slab) AND every stacked prop/wall/roof — is
                          // a plain GridAsset, so ONE branch drives them all through the SAME per-index writers with
                          // NO floor special case: the tile maps 1:1 to stackedAssetsAt by its stack index (i = lvl),
                          // and the floor gets the IDENTICAL uniform panel a wall shows (colour, dims, pose, Z Width,
                          // display, shape, light, …). Per-instance transforms persist with the map; the render reads
                          // them back in every view.
                          const i = lvl
                          const a0 = stackedAssetsAt(grid, fc.col, fc.row)[i]
                          const kind = a0 ? assetKind(a0) : (stack[lvl]?.slug || `tile ${lvl}`)
                          const posable = !!a0
                          const isFloorTile = a0?.type === FLOOR_TYPE
                          tile = {
                            key: `tile-${i}`,
                            label: kind,
                            dims: {
                              width: adim(i, a => a.scaleX ?? 1),
                              height: adim(i, a => blockHeightOf(a)), // the tile's real BLOCK-HEIGHT (0.1 flat, 1 wall, …), not the scaleY multiplier
                              depth: adim(i, a => a.scaleZ ?? 1),
                              zoom: adim(i, a => a.scale ?? 1),
                            },
                            color: commonValue(cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]?.color ?? null)),
                            colorFallback: isFloorTile ? '#3a7d34' : '#ffffff',
                            onDim: (axis, v) => setAssetDim(i, axis, v),
                            onColor: c => setAssetColor(i, c),
                            onClearColor: posable ? (() => clearAssetColor(i)) : undefined,
                            override: selectedOverride,
                            styleName: activeStyle.name,
                            preview: previewFor(a0?.tileOverride ?? selectedOverride, stack[lvl]?.slug ?? kind),
                            libraryLabel,
                            onOpenLibrary: () => setTileLibraryOpen(true),
                            zWidth: adim(i, a => a.depth ?? 1),
                            zBack: adim(i, a => a.depthBack ?? 0),
                            zPerp: adim(i, a => a.depthPerp ?? 0),
                            zPerpBack: adim(i, a => a.depthPerpBack ?? 0),
                            zDir: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.depthDir ?? null) as DepthDir | null)),
                            onZWidth: posable ? (v => setAssetDepth(i, v)) : undefined,
                            onZBack: posable ? (v => setAssetDepthBack(i, v)) : undefined,
                            onZPerp: posable ? (v => setAssetDepthPerp(i, v)) : undefined,
                            onZPerpBack: posable ? (v => setAssetDepthPerpBack(i, v)) : undefined,
                            onZDir: posable ? (dir => setAssetDepthDir(i, dir)) : undefined,
                            // The reach MAP across the selection: identical everywhere, or null = mixed.
                            thickness: commonValue(cells.map(({ col, row }) => JSON.stringify(stackedAssetsAt(grid, col, row)[i]?.thickness ?? {}))) as string | null,
                            onThicknessReach: (dir: DepthDir, value: number) => setAssetThicknessReach(i, dir, value),
                            // The camera's quarter-turn, so the direction arrows read in SCREEN space —
                            // Alexander: "I rotated and the direction the propreties in the UI were showing
                            // didn't match the view".
                            facing: cameraFacing,
                            zPos: adim(i, a => a.zOffset ?? 0),
                            onZPos: posable ? (v => setAssetZOffset(i, v)) : undefined,
                            zPosDir: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.zDir ?? null) as DepthDir | null)),
                            onZPosDir: posable ? (dir => setAssetZDir(i, dir)) : undefined,
                            zIndex: adim(i, a => a.zIndex ?? 0),
                            onZIndex: posable ? (v => setAssetZIndex(i, v)) : undefined,
                            display: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.settings?.display ?? 'all-faces') as TileDisplay)),
                            onDisplay: posable ? (mode => setAssetDisplay(i, mode)) : undefined,
                            transparent: commonValue(cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]?.settings?.transparent ?? false)),
                            onTransparent: posable ? (on => setAssetTransparent(i, on)) : undefined,
                            shape: commonValue(cells.map(({ col, row }) => (stackedAssetsAt(grid, col, row)[i]?.shape ?? 'square') as TileShape)),
                            onShape: posable ? (shape => setAssetShape(i, shape)) : undefined,
                            actAsTile: commonValue(cells.map(({ col, row }) => stackedAssetsAt(grid, col, row)[i]?.settings?.actAsTile ?? true)),
                            onActAsTile: posable ? (on => setAssetActAsTile(i, on)) : undefined,
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
                            const tileCat = (styleTile('emoji', slug)?.category as TileCategory | undefined) ?? 'nature'
                            const baseV = visualForTileId(`${activeStyleId}:${slug}`) ?? resolveVisual(assetKind(a0!), activeStyle, a0!.tileOverride)
                            const baseVisual: Visual = baseV.kind === 'ascii' ? { kind: 'glyph', char: '·' } : baseV
                            animatorCtx = { i, label: kind, animations: a0?.animations ?? [], category: tileCat, baseVisual }
                          }
                        } else {
                          // A BUILDING block (wall / window / door / roof) or a CHARACTER on the cell whose stack
                          // entry is NOT an `asset` — so there is nowhere to write a size or a colour back to.
                          // §3.13 called this out as a genuine trap ("the panel shows editable-looking controls
                          // that silently do nothing") and §4.7 settles it: say so. `tileNotice` drops the two
                          // sections those no-op writers would have faked; the tile library, collision, remove
                          // and clear all still work, because those DO write.
                          tileNotice = "This tile is part of a generated object and can't be edited directly yet."
                          const entry = stack[lvl] as TileEntry | undefined
                          tile = {
                            key: `${entry?.source ?? 'tile'}-${lvl}`,
                            label: entry?.slug || `tile ${lvl}`,
                            dims: {
                              width: entry?.w ?? 1,
                              height: (entry?.h ?? 1) * (entry?.scaleY ?? 1), // block-height (data), not the scaleY multiplier
                              depth: entry?.d ?? 1,
                              zoom: entry?.zoom ?? 1,
                            },
                            color: entry?.color ?? null,
                            colorFallback: entry?.color ?? '#8a8a8a',
                            // Required by the model, never reached: `tileNotice` removes every control that
                            // would call them, so an edit can no longer silently vanish.
                            onDim: () => {},
                            onColor: () => {},
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
                              sectionOpen={inspectorSectionOpen}
                              onToggleSection={toggleInspectorSection}
                              present={presentInspectorSection}
                              tileNotice={tileNotice}
                              onOpenTriggers={() => setTriggersOpen(true)}
                              triggerCount={triggersAtCell(cellTriggers, trigCol, trigRow).length}
                              onRemove={removeSelectedTile}
                              onClearTiles={clearTilesOnSelection}
                            />
                            {/* Tile-settings panel — the full TileControls body (colour/size/pose/z/display),
                                opened from the inspector's "Edit settings…". A FLOATING panel (not a modal): no
                                backdrop, so you drag it aside and WATCH the tile repaint as you edit. The writers
                                already fan out to the i-th stacked tile of every selected cell (setAssetDim/Pose/…).
                                Geometry persists in the backend under id "settings". */}
                            {/* tile settings modal retired (§4.7 / Week 5) — every control it hosted is an inline accordion in the inspector now. */}
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
                              <FloatingPanel title={`Cell ${cellLabel} — Rules`} accent="yellow" onClose={() => setTriggersOpen(false)} {...floatingProps('triggers', { w: 360, h: 380 })}>
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
                      <SaveMapButton saving={isSaving} onSave={saveMapFromInspector} />
                    </>
                    <button onClick={() => setSelectedCells(new Set())} className="rounded bg-gray-700 px-2 py-1.5 text-xs hover:bg-gray-600">Clear selection</button>
                  </>
                )
              }

              // Nothing selected. This is the most-seen state in the editor, so it ORIENTS instead of
              // apologising (§4.9): what a click does, what shift+drag does, and where to start from the
              // left rail. The rail rows mirror the rail's own order + glyphs so the two read as one thing.
              return (
                <div className="hint">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-300">Nothing selected</p>
                  <p>
                    Click anything on the map to edit it here — a patch of ground, a wall, a tree,
                    a character.
                  </p>
                  <p>Shift+drag to select several.</p>
                  <p className="pt-1 text-gray-500">Or start from the left:</p>
                  <ul className="space-y-0.5">
                    {EDITOR_RAIL_STARTERS.map(s => (
                      <li key={s.label} className="flex gap-2">
                        <span aria-hidden className="w-4 text-center text-gray-300">{s.glyph}</span>
                        <span className="w-20 font-semibold text-gray-300">{s.label}</span>
                        <span>{s.hint}</span>
                      </li>
                    ))}
                  </ul>
                </div>
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
            className="fixed bottom-16 left-1/2 z-20 -translate-x-1/2 rounded bg-cyan-700 px-3 py-1 font-mono text-xs font-bold text-white shadow-lg hover:bg-cyan-600"
            aria-label="Open inventory (I)"
          >
            ▤ Inventory (I)
          </button>
        )}
        {confirmDialog}
        {promptDialog}
        {/* THE SHORTCUT SHEET (§4.9). It reads the PLAYER's live bindings, so a rebound ability or
            quick slot is documented the moment it changes — the sheet has no key literals of its own. */}
        {/* THE GUIDES — whole jobs, start to finish, in a movable panel so they can sit beside the thing
            they describe. Every step names the control by the words printed on it. */}
        {guidesOpen && (
          <FloatingPanel
            title="Guides"
            accent="purple"
            onClose={() => setGuidesOpen(false)}
            {...floatingProps('guides', { w: 380, h: 460 })}
          >
            <GuidesPanel />
          </FloatingPanel>
        )}

        {helpOpen && (
          <HelpSheet
            onClose={() => setHelpOpen(false)}
            abilities={abilityLoadouts['__player__'] ?? defaultAbilityLoadout()}
            specialKeys={loadouts['__player__']?.shortcuts}
          />
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
              styleId={activeStyleId}
              loadout={current}
              baseStats={baseStats}
              hp={hp}
              onChange={l => setLoadouts(prev => ({ ...prev, [activeId]: l }))}
              onClose={() => setInventoryOpen(false)}
              {...(activeId === '__player__'
                ? {
                    nameValue: playerEntity?.name ?? '',
                    onNameChange: setPlayerName,
                    abilityLoadout: abilityLoadouts['__player__'] ?? defaultAbilityLoadout(),
                    onAbilityChange: (l: readonly AbilityBinding[]) =>
                      setAbilityLoadouts(prev => ({ ...prev, __player__: l })),
                    // §4.10 — the class switch is a header control of the ONE inventory now. Only the
                    // player has a class, so only the player passes it.
                    talentPath,
                    onTalentPath: setArchetype,
                  }
                : {})}
            />
          )
        })()}

        {/* Quest log — open button (also toggled by the Q key) + the panel overlay */}
        {(showSidebars || playMode) && !questLogOpen && !showFlowView && !showGamesView && (
          <button
            onClick={() => setQuestLogOpen(true)}
            className="fixed bottom-16 left-[calc(50%+150px)] z-20 -translate-x-1/2 rounded bg-orange-700 px-3 py-1 font-mono text-xs font-bold text-white shadow-lg hover:bg-orange-600"
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
          <FloatingPanel title="Doorways" accent="purple" onClose={closeConnectorPanel} {...floatingProps('connectors', { w: 320, h: 440 })}>
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
        {/* HOW IT WILL BE PLACED — its own movable panel, as asked. */}
        {/* THE PREVIEW — a MOVABLE panel that opens beside the LEFT panel, showing the thing drawn by the
            map's own renderer in the view you are looking at. Alexander, 2026-09-09: *"i requested a movable
            preview modal next to the left panel..."* and *"also, the preview should be how it looks in the
            map."* Both are the same panel: `MapPreview` stamps the subject into a real grid and calls the
            renderer the view bar has selected, so it cannot disagree with the map. */}
        {!hudMode && libraryKind !== null && previewOpen && (
          <FloatingPanel
            title="Preview"
            accent="cyan"
            openBeside=".z-panel"
            onClose={() => setPreviewOpen(false)}
            {...floatingProps('preview', { w: 330, h: 392 })}
          >
            <MapPreview
              subject={previewSubject}
              view={previewContext.view}
              zone={previewContext.zone}
              style={previewContext.style}
              styleId={previewContext.styleId}
            />
            {/* Only says something when there IS something — `MapPreview` already carries the empty state,
                and both showing it printed "Point at something in the library" twice. */}
            {previewLabel && (
              <div className="hint">
                {`${previewLabel} — drawn by the ${previewContext.view} renderer, on ${genZone} ground.`}
              </div>
            )}
          </FloatingPanel>
        )}

        {placementOpen && activeRailId === 'characters' && (
          <FloatingPanel
            title="Behaviour"
            accent="orange"
            onClose={() => setPlacementOpen(false)}
            {...floatingProps('placement', { w: 372, h: 420 })}
          >
            <UnitPlacementBody
              mode={unitPlaceMode}
              onMode={setUnitPlaceMode}
              animated={unitAnimated}
              onAnimated={setUnitAnimated}
              onScatter={scatterUnits}
              placeAs={placeAs}
              onPlaceAs={setPlaceAs}
              autoKindLabel={unitTile ? (entityKindForUnitTile(unitTile) ?? 'nothing') : undefined}
              pickedLabel={unitTile?.label}
            />
          </FloatingPanel>
        )}

        {tileLibraryOpen && (() => {
          const close = () => setTileLibraryOpen(false)
          const isUnit = !!selectedEntityId
          const cellPaint = !isUnit && selectedCells.size > 0
          const scope = isUnit
            ? 'unit'
            : cellPaint
            ? (selectedCells.size > 1 ? `${selectedCells.size} cells` : 'cell')
            : null
          // The BEFORE picture and the slot's address, read from the same stack the swap will write into —
          // so what the panel shows and what it changes cannot disagree.
          const swapFocus = cellsFromKeys(selectedCells)[0]
          const swapStack = gridRef.current && swapFocus
            ? getStack(gridRef.current, swapFocus.col, swapFocus.row, { entities })
            : []
          const swapEntity = isUnit ? entities.find(e => e.id === selectedEntityId) : undefined
          const swapFromLabel = isUnit
            ? (swapEntity ? (swapEntity.enemyType?.trim().toLowerCase() || swapEntity.kind) : null)
            : (swapStack[selectedTileLevel]?.label ?? swapStack[selectedTileLevel]?.type ?? null)
          const swapWhere = isUnit
            ? (swapEntity ? `${swapEntity.name || swapEntity.kind}` : 'this character')
            : swapFocus
              ? `cell ${swapFocus.col}, ${swapFocus.row} · tile ${Math.min(selectedTileLevel + 1, Math.max(1, swapStack.length))} of ${Math.max(1, swapStack.length)}`
              : 'this cell'
          // For a cell selection, picking a tile lands it by the SAME state that NAMES the button (§13): once the
          // focus cell holds a stacked tile the button reads "Replace tile", so the pick SWAPS the selected tile in
          // place (replaceTileOnSelection); on a bare / floor-only cell it reads "Add tile" and STACKS as before
          // (paintTileOnSelection). Distinguished by the focus cell's stack depth — no new mode. (A unit pins the
          // figure override — handled by setSelectionOverride, not this.)
          const paintFromLibrary = (tileId: string | null) => {
            if (!tileId) return
            const picked = (Object.values(tilesForStyle(activeStyleId)).flat() as TileDef[]).find(t => t.id === tileId)
            if (!picked) return
            const grid = gridRef.current
            const fc = cellsFromKeys(selectedCells)[0]
            const filled = !!grid && !!fc && getStack(grid, fc.col, fc.row, { entities }).length > 1
            if (filled) replaceTileOnSelection(picked)
            else paintTileOnSelection(picked)
          }
          return (
            <FloatingPanel
              title={isUnit ? 'Change figure' : 'Swap this tile'}
              accent="cyan"
              onClose={close}
              {...floatingProps('tileLibrary', { w: 430, h: 560 })}
            >
              {scope ? (
                /* The design's swap panel: BEFORE → AFTER, what carries over, and the one exception. It
                   answers "what happens when I click replace tile?" before you commit to finding out. */
                <SwapTilePanel
                  styleId={activeStyleId}
                  fromLabel={swapFromLabel}
                  where={swapWhere}
                  isCharacter={isUnit}
                  onSwap={tile => {
                    if (isUnit) setSelectionOverride(tile.id)
                    else paintFromLibrary(tile.id)
                    close()
                  }}
                  onCancel={close}
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
            these two stay modal (the unit's equipment/abilities + the NPC quest authoring). */}
        {entityModal && (() => {
          const selected = entities.find(e => e.id === selectedEntityId)
          if (!selected) return null
          const who = selected.name || selected.kind
          const close = () => setEntityModal(null)
          if (entityModal === 'inventory') {
            // The carried BAG + live vitals belong to the hero alone — he is the one unit with a combat
            // state and an item bag. Every OTHER unit carries a loadout (weapon / armour / abilities), which
            // the equipment panel already edits per entity (`loadouts[selectedEntityId]`), so the entry point
            // is the same for all of them and only the bag section is the player's.
            const carriesItemBag = selected.kind === 'player'
            return (
              <Modal title={`${who} — Inventory & abilities`} accent="cyan" wide onClose={close}>
                {carriesItemBag ? (
                  <>
                    <CombatHud hud={playerHud} />
                  </>
                ) : (
                  <p className="text-xs text-gray-400">
                    {who} carries a loadout — weapon, armour and abilities. The carried item bag is the hero&apos;s alone.
                  </p>
                )}
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
        {/* QUESTS, opened from the ⚑ Rules panel — no NPC has to be selected to get here (§3.8: the old
            route was Select → click an NPC → scroll its card, so a level with no NPC had no way in and no
            explanation). The SAME authoring card the NPC route opens, so there is one quest editor. */}
        {questPanelOpen && (
          <Modal title="Quests" accent="orange" wide onClose={() => setQuestPanelOpen(false)}>
            <QuestAuthoringCard
              npcs={npcsOnLevel}
              quests={quests}
              draft={questDraft}
              playerXp={playerXp}
              onDraftChange={setQuestDraft}
              onSave={saveQuest}
            />
          </Modal>
        )}
      </main>
    </>
  )
}

/** The Inspector's "💾 Save map" action — ONE component so the cell card and the unit card carry the exact
 *  same button in the same place ("all tiles behave the same"), instead of two copies drifting apart. */
function SaveMapButton({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <button
      onClick={onSave}
      disabled={saving}
      aria-label="Save map"
      className="mt-2 w-full rounded bg-green-700 px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-green-600 disabled:opacity-40"
    >
      {saving ? 'Saving…' : '💾 Save map'}
    </button>
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
/** Save-status tone → the dot's colour. A warning must never read as an OK. */
const SAVE_TONE_DOT: Record<'ok' | 'warning' | 'busy', string> = {
  ok: 'text-emerald-300',
  warning: 'text-amber-300',
  busy: 'text-cyan-300',
}

/**
 * Match a canvas's backing store to the CSS box it occupies, at device resolution.
 *
 * Pure and idempotent: it writes only when the size actually changed, so a ResizeObserver firing on every
 * layout pass does not blow away the raster (assigning width/height clears the canvas) or restart the frame.
 */
function sizeCanvasToBox(canvas: HTMLCanvasElement): void {
  const box = canvas.getBoundingClientRect()
  // Before first layout the box is 0×0; fall back to the viewport so the very first frame has somewhere to
  // draw, and the observer corrects it as soon as the grid has measured.
  const width = Math.max(1, Math.round(box.width || window.innerWidth))
  const height = Math.max(1, Math.round(box.height || window.innerHeight))
  if (canvas.width === width && canvas.height === height) return
  canvas.width = width
  canvas.height = height
}

export default function TemplateEditorPage(props: { gameContext?: EditorGameContext } = {}) {
  return (
    <ErrorBoundary fallback={<EditorErrorFallback />}>
      <TemplateEditor {...props} />
    </ErrorBoundary>
  )
}


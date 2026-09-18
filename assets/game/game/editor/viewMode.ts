/**
 * WHICH VIEW THE EDITOR IS IN, as ONE value.
 *
 * `CODING-STANDARDS.md` §2: *"No module-level mutable globals for state. Single source of truth in React
 * state (or a ref for imperative/loop state), never both. Anti-example: `templates.tsx` drives view mode
 * through module-level `debugMode`/`topViewMode`/`flowViewMode` AND React state, which desync. Collapse to
 * one `viewMode` state machine."*
 *
 * Four things described one fact: `viewType` ('isometric' | '2d') in React state, `showTopView` and
 * `showFlowView` in React state, and `topViewMode` / `flowViewMode` as module-level mutable globals that the
 * game loop read directly. Every transition had to write two of them in step, by hand, at six call sites.
 * The page already contained the line that proves they are one value:
 *
 *     showFlowView ? 'flow' : showTopView ? 'top' : viewType === '2d' ? '2d' : 'iso'
 *
 * That expression IS the state. This module is it, as a type and a handful of pure transitions, so the
 * decisions can be tested without mounting anything (§3: pure logic out of components).
 */

/** The four views. Exactly one is active. */
export type ViewMode = 'iso' | '2d' | 'top' | 'flow'

/** The two you can PLAY in. Top and flow are authoring views: there is no camera to play behind. */
export type PlayableView = Extract<ViewMode, 'iso' | '2d'>

export const PLAYABLE_VIEWS: readonly ViewMode[] = ['iso', '2d']

/** Is this a view you can drop into play mode from? */
export const isPlayable = (mode: ViewMode): mode is PlayableView => mode === 'iso' || mode === '2d'

/** The top-down authoring view. Several pickers and the movement axis switch on this. */
export const isTopView = (mode: ViewMode): boolean => mode === 'top'

/** The flow/graph view, which draws the connector network instead of the map. */
export const isFlowView = (mode: ViewMode): boolean => mode === 'flow'

/** Does this view use FLAT (grid-aligned) movement and picking, rather than isometric? Both the top view and
 *  the 2D elevation do, which is the condition that used to be spelled `topViewMode || viewType === '2d'`. */
export const isFlatView = (mode: ViewMode): boolean => mode === 'top' || mode === '2d'

/**
 * Entering play from `mode`. Top and flow are not playable, so they drop to iso; a playable view is kept, so
 * the choice between iso and 2D survives a trip through the authoring views.
 */
export const playViewFrom = (mode: ViewMode): PlayableView => (isPlayable(mode) ? mode : 'iso')

/**
 * Toggling the flow view. It is mutually exclusive with everything, so leaving it has to land somewhere:
 * back on the last playable view, which the caller remembers.
 */
export const toggleFlow = (mode: ViewMode, lastPlayable: PlayableView): ViewMode =>
  mode === 'flow' ? lastPlayable : 'flow'

/** What the renderers call this view. They predate the mode and use their own two spellings. */
export const rendererView = (mode: ViewMode): 'top' | '2d' | 'iso' => (mode === 'top' ? 'top' : mode === '2d' ? '2d' : 'iso')

/** The same, in the longer spelling the debug caption and the tile picker use. */
export const rendererViewLong = (mode: ViewMode): 'top' | '2d' | 'isometric' =>
  mode === 'top' ? 'top' : mode === '2d' ? '2d' : 'isometric'

/** The localStorage key the saved view lives under. Kept as it was so a saved preference still loads. */
export const VIEW_STORAGE_KEY = 'village-topview'

/**
 * The view a stored preference means.
 *
 * Only the TOP view was ever persisted, as the string 'true'. Flow is deliberately not restored: it is a
 * transient authoring overlay, and coming back to a saved map inside the graph rather than on the map reads
 * as the editor having failed to load. Anything else starts on iso, which is what an unset key did.
 */
export const storedViewMode = (stored: string | null): ViewMode => (stored === 'true' ? 'top' : 'iso')

/** What to write back for a view. Only the top view is remembered, so every other view stores 'false'. */
export const storedValueFor = (mode: ViewMode): string => String(mode === 'top')

/**
 * THE PLAYER'S UI — the element inventory and the layouts, ported from the approved design at :8899.
 *
 * Alexander, 2026-09-08: *"there's no preview for the HUD either, we should kind of like a hybrid mode
 * between game mode and editor where we can place and see our HUD updates in realtime, like we'd do on wow
 * bartender."*
 *
 * IMPORTANT, and the reason this file holds DEFAULTS rather than reading the backend: configuring the HUD
 * has never existed. `ui_profiles` / `ui_elements` / `ui_bindings` / `ui_bar_slots` return zero hits across
 * the Elixir lib, every migration and the whole frontend — T-115 is a spec and nothing more. What DOES
 * exist is the HUD as FIXED UI (`components/game/hud.tsx`), positioned with hardcoded Tailwind classes.
 *
 * So each element's default anchor and offset below is READ OFF the class it is hardcoded with today (the
 * `now` field records the literal), which makes this a transcription of the product's real layout rather
 * than an invention. Dragging changes it live and it does NOT persist — there is nowhere to save it yet.
 * That is stated in the panel, not hidden.
 */

/** Where an element is pinned: a corner, an edge, or the middle. */
export type HudAnchor = 'TL' | 'TC' | 'TR' | 'ML' | 'MC' | 'MR' | 'BL' | 'BC' | 'BR'

/** One piece of the HUD, as it exists in the product today. */
export interface HudElement {
  k: string
  /** What it is, in the user's words. */
  n: string
  /** The literal positioning it carries TODAY — the evidence behind its default. */
  now: string
  /** When it currently shows. */
  vis: string
}

/** Where a piece sits and how it looks. */
export interface HudPlacement {
  a: HudAnchor
  /** Offset from the anchor, in game pixels — always positive when moving inward. */
  x: number
  y: number
  w: number
  h: number
  /** Size multiplier. */
  s: number
  /** Opacity. */
  o: number
  /** Does it show at all. */
  on: boolean
  /** Draw order. */
  z: number
}

export type HudLayout = Record<string, HudPlacement>

/**
 * anchor → [originX, originY, xSign, ySign].
 *
 * The sign says which way "away from the edge" points, so the numbers a person types are positive when
 * moving inward: a right-anchored piece moves LEFT as x grows. A CENTRED axis has no edge to move away
 * from and keeps the ordinary +1 — the first version put 0 there, which silently discarded every
 * horizontal offset and stacked the whole bottom-centre HUD on one spot.
 */
export const HUD_ANCHORS: Record<HudAnchor, readonly [number, number, number, number]> = {
  TL: [0, 0, 1, 1],
  TC: [0.5, 0, 1, 1],
  TR: [1, 0, -1, 1],
  ML: [0, 0.5, 1, 1],
  MC: [0.5, 0.5, 1, 1],
  MR: [1, 0.5, -1, 1],
  BL: [0, 1, 1, -1],
  BC: [0.5, 1, 1, -1],
  BR: [1, 1, -1, -1],
}

/** What each anchor is called, in plain words. */
export const HUD_ANCHOR_NAMES: Record<HudAnchor, string> = {
  TL: "top left",
  TC: "top centre",
  TR: "top right",
  ML: "left edge",
  MC: "middle",
  MR: "right edge",
  BL: "bottom left",
  BC: "bottom centre",
  BR: "bottom right",
}

/** The window each layout is authored against. A mobile layout is not a squeezed desktop one. */
export const HUD_STAGE = { Desktop: [1280, 720], Mobile: [390, 844] } as const
export type HudForm = keyof typeof HUD_STAGE

/** §1.7’s real element inventory — every one is a hardcoded literal in the product today. */
export const HUD_ELEMENTS: readonly HudElement[] = [
  { k: "vitals", n: "Vitals (health / rage / mana)", now: "fixed bottom-4 left-4 z-20 w-64", vis: "while playing" },
  { k: "action_bar", n: "Action bar", now: "inline, fixed", vis: "while playing" },
  { k: "quest_tracker", n: "Quest tracker", now: "fixed left-1/2 top-20 z-20 w-72", vis: "leaks into the editor" },
  { k: "fps", n: "FPS readout", now: "fixed right-4 top-4 z-30", vis: "while playing" },
  { k: "exit", n: "Exit game", now: "fixed left-4 top-4 z-30", vis: "while playing" },
  { k: "select_hint", n: "Selection hint pill", now: "fixed bottom-6 left-1/2 z-20", vis: "editor, idle" },
  { k: "trigger_msg", n: "Trigger message", now: "fixed bottom-24 left-1/2 z-40", vis: "on a show-message rule" },
  { k: "win_lose", n: "Win / lose overlay", now: "fixed inset-0 z-50", vis: "on win or lose" },
  { k: "bag_btn", n: "Bag button", now: "fixed bottom-4 left-1/2 z-20", vis: "while playing" },
  { k: "journal_btn", n: "Journal button", now: "fixed bottom-4 left-[calc(50%+150px)]", vis: "while playing" },
  { k: "bag_panel", n: "Bag panel", now: "fixed inset-0 z-30", vis: "I key" },
  { k: "journal_panel", n: "Journal panel", now: "fixed overlay", vis: "Q key" },
  { k: "debug_legend", n: "Debug legend", now: "fixed bottom-4 left-4 z-20", vis: "debug on" },
  { k: "nameplate", n: "Nameplates + floating health bars", now: "drawn on the canvas, gap const = 3px", vis: "on engagement" },
]

/** The desktop layout, each entry transcribed from the classes that element carries today. */
export const HUD_DESKTOP: HudLayout = {
  vitals: { a: 'BL', x: 16, y: 16, w: 256, h: 64, s: 1, o: 1, on: true, z: 20 },
  action_bar: { a: 'BC', x: 0, y: 16, w: 208, h: 46, s: 1, o: 1, on: true, z: 20 },
  quest_tracker: { a: 'TC', x: 0, y: 80, w: 288, h: 84, s: 1, o: 1, on: true, z: 20 },
  fps: { a: 'TR', x: 16, y: 16, w: 92, h: 24, s: 1, o: 1, on: true, z: 30 },
  exit: { a: 'TL', x: 16, y: 16, w: 104, h: 30, s: 1, o: 1, on: true, z: 30 },
  select_hint: { a: 'BC', x: 0, y: 74, w: 300, h: 28, s: 1, o: 1, on: false, z: 20 },
  trigger_msg: { a: 'BC', x: 0, y: 108, w: 250, h: 34, s: 1, o: 1, on: false, z: 40 },
  win_lose: { a: 'MC', x: 0, y: 0, w: 290, h: 110, s: 1, o: 1, on: false, z: 50 },
  bag_btn: { a: 'BC', x: 38, y: 16, w: 76, h: 30, s: 1, o: 1, on: true, z: 20 },
  journal_btn: { a: 'BC', x: 197, y: 16, w: 94, h: 30, s: 1, o: 1, on: true, z: 20 },
  bag_panel: { a: 'MC', x: 0, y: 0, w: 320, h: 176, s: 1, o: 1, on: false, z: 30 },
  journal_panel: { a: 'MC', x: 0, y: 0, w: 300, h: 168, s: 1, o: 1, on: false, z: 30 },
  debug_legend: { a: 'BL', x: 16, y: 16, w: 176, h: 58, s: 1, o: 1, on: false, z: 20 },
}

/** The mobile layout, each entry transcribed from the classes that element carries today. */
export const HUD_MOBILE: HudLayout = {
  vitals: { a: 'TL', x: 10, y: 10, w: 150, h: 40, s: 0.85, o: 1, on: true, z: 20 },
  action_bar: { a: 'BC', x: 0, y: 14, w: 190, h: 52, s: 1.1, o: 1, on: true, z: 20 },
  quest_tracker: { a: 'TC', x: 0, y: 58, w: 190, h: 60, s: 0.85, o: 0.9, on: true, z: 20 },
  fps: { a: 'TR', x: 8, y: 8, w: 78, h: 20, s: 0.8, o: 0.7, on: false, z: 30 },
  exit: { a: 'TR', x: 8, y: 34, w: 84, h: 28, s: 1, o: 1, on: true, z: 30 },
  select_hint: { a: 'BC', x: 0, y: 72, w: 200, h: 26, s: 0.9, o: 1, on: false, z: 20 },
  trigger_msg: { a: 'MC', x: 0, y: 60, w: 200, h: 32, s: 1, o: 1, on: false, z: 40 },
  win_lose: { a: 'MC', x: 0, y: 0, w: 220, h: 110, s: 1, o: 1, on: false, z: 50 },
  bag_btn: { a: 'BL', x: 12, y: 14, w: 56, h: 44, s: 1, o: 1, on: true, z: 20 },
  journal_btn: { a: 'BR', x: 12, y: 14, w: 56, h: 44, s: 1, o: 1, on: true, z: 20 },
  bag_panel: { a: 'MC', x: 0, y: 0, w: 230, h: 170, s: 1, o: 1, on: false, z: 30 },
  journal_panel: { a: 'MC', x: 0, y: 0, w: 230, h: 170, s: 1, o: 1, on: false, z: 30 },
  debug_legend: { a: 'BL', x: 10, y: 66, w: 150, h: 50, s: 0.8, o: 0.8, on: false, z: 20 },
}

/** The default layouts, by form factor. A profile carries BOTH; screen size picks which is live. */
export const HUD_DEFAULTS: Record<HudForm, HudLayout> = { Desktop: HUD_DESKTOP, Mobile: HUD_MOBILE }

/** Every bindable action, and the key it is hardcoded to today. */
export const HUD_ACTIONS: readonly (readonly [string, string, string])[] = [
  ["move_up", "movement", "W / ↑"],
  ["move_down", "movement", "S / ↓"],
  ["move_left", "movement", "A / ←"],
  ["move_right", "movement", "D / →"],
  ["run", "movement", "Shift"],
  ["jump", "movement", "Space"],
  ["attack_primary", "combat", "F"],
  ["attack_special", "combat", "G"],
  ["power_1", "combat", "1"],
  ["power_2", "combat", "2"],
  ["power_3", "combat", "3"],
  ["power_4", "combat", "4"],
  ["interact", "world", "E / Enter"],
  ["target_next", "world", "Tab"],
  ["open_bag", "interface", "I"],
  ["open_journal", "interface", "Q"],
  ["select", "mouse", "mouse_left"],
  ["context", "mouse", "mouse_right"],
  ["camera_pan", "mouse", "mouse_middle"],
]

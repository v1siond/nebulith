/**
 * The EMOJI art style, EXTRACTED into plain tileset data — "the same approach as ASCII, plain JSON".
 *
 * Each entry is `kind → { char (emoji glyph), color (fill tint) }` — verbatim the values that used to
 * be hardcoded inline in `EMOJI_STYLE.map`. `artStyle.ts` now BUILDS `EMOJI_STYLE` from this data, so
 * the emoji tileset is loadable plain JSON (like `ASCII_TILESET`), ready to move to the Ecto DB at
 * migration with no render change. (The `[?]` tofu on unsupported Segoe glyphs is unchanged and
 * accepted for now — it dies later when tiles become rasterised image assets.)
 *
 * Pure data: no imports, JSON-serialisable. The one place the emoji glyph+colour for a kind lives.
 */
export interface EmojiTile {
  /** The emoji glyph drawn for this kind. */
  char: string
  /** The fill/tint colour (harmonised with the ASCII palette so a reskin reads as the same world). */
  color: string
}

export let EMOJI_TILESET: Record<string, EmojiTile> = {
  // terrain — `color` is the FILL hue (harmonised with the ASCII GROUND_COLORS); the emoji rides on top.
  grass: { char: '🍀', color: '#5faf4a' },
  water: { char: '🌊', color: '#4a90e2' },
  path: { char: '🟫', color: '#9c7b4d' },
  plaza: { char: '⬜', color: '#cabfa6' },
  sand: { char: '🟨', color: '#e2c86b' },
  snow: { char: '⬜', color: '#e2ecf5' },
  autumn: { char: '🍂', color: '#b5732f' },
  cavefloor: { char: '🪨', color: '#3f3a34' },
  moss: { char: '🌿', color: '#4a6b3a' },
  mountain: { char: '🗻', color: '#8d8d97' },
  // buildings — `color` tints the cube face; the facade door/window fill at their own hue.
  wall: { char: '🧱', color: '#b0603a' },
  roof: { char: '🟥', color: '#c8443c' },
  door: { char: '🚪', color: '#5a3a22' },
  window: { char: '🪟', color: '#7fb4d8' },
  fountain: { char: '⛲', color: '#4a90e2' },
  // nature / props — upright billboards; `color` fills the glyph.
  tree: { char: '🌲', color: '#2f8f3f' },
  flower: { char: '🌸', color: '#e785b5' },
  bush: { char: '🌿', color: '#4fa03f' },
  rock: { char: '🪨', color: '#8a8a8a' },
  crate: { char: '📦', color: '#b5793a' },
  lamp: { char: '💡', color: '#ffd24a' },
  // cave features.
  crystal: { char: '💎', color: '#b48cff' },
  mushroom: { char: '🍄', color: '#d24a4a' },
  // temple / dungeon features.
  pillar: { char: '🏛️', color: '#cbb68c' },
  altar: { char: '🗿', color: '#ffe7a8' },
  torch: { char: '🔥', color: '#ff8a3a' },
  hazard: { char: '🔺', color: '#d0402a' },
  key: { char: '🗝️', color: '#ffd24a' },
  // units — upright billboards. Every PERSON uses the standing figure; enemies get the monster glyph.
  enemy: { char: '👾', color: '#b45ac0' },
  npc: { char: '🧍', color: '#d9a066' },
  player: { char: '🧍', color: '#ffcf3a' },
}

/** Swap the active emoji tileset (the DB-loaded emoji tiles). Call artStyle.rebuildEmojiStyle() after,
 *  so the derived EMOJI_STYLE.map picks up the new data. */
export function setEmojiTileset(tiles: Record<string, EmojiTile>): void {
  EMOJI_TILESET = tiles
}

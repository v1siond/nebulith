/**
 * HUD LAYOUT GEOMETRY — where a piece of the player's UI actually lands, and what collides.
 *
 * Pure functions over the placement data, so the React layer only draws and all of this is testable.
 *
 * The model is anchor + offset, never absolute pixels. "16 up from the bottom-left" still means the
 * bottom-left corner on a phone, on a laptop and on a 4K monitor; "y = 812" means the bottom on exactly one
 * screen and the middle of the map on every other. The product's own HUD is already written this way — as
 * frozen Tailwind literals like `fixed bottom-4 left-4` — so this is that model made editable.
 */
import { HUD_ANCHORS, type HudAnchor, type HudLayout, type HudPlacement } from '@/components/game/shell/playerUi.data'

/** A resolved rectangle on the stage, in game pixels. */
export interface HudRect {
  x: number
  y: number
  w: number
  h: number
}

/** Resolve one placement to a rectangle on a stage of the given size. */
export function hudRect(placement: HudPlacement, stageW: number, stageH: number): HudRect {
  const [originX, originY, signX, signY] = HUD_ANCHORS[placement.a]
  const w = placement.w * placement.s
  const h = placement.h * placement.s
  return {
    x: originX * stageW - originX * w + signX * placement.x,
    y: originY * stageH - originY * h + signY * placement.y,
    w,
    h,
  }
}

/** The overlapping area of two rectangles, in square pixels. Zero when they do not touch. */
export function overlapArea(a: HudRect, b: HudRect): number {
  const wide = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const tall = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return Math.max(0, wide) * Math.max(0, tall)
}

/** Two pieces that cover each other, and by how much. */
export interface HudCollision {
  a: string
  b: string
  area: number
}

/** A few pixels of touching corner is not a collision worth reporting. */
const COLLISION_FLOOR = 120

/**
 * Which pieces of the HUD cover each other, worst first.
 *
 * Measured on the STAGE the layout targets, never on the editor's preview pane — otherwise a narrow preview
 * would report collisions that no player will ever see, and the warning would be noise.
 *
 * A first version compared anchors and offsets for proximity, which is a guess: two pieces can share an
 * anchor and not touch, or have different anchors and overlap completely. This intersects real rectangles.
 *
 * Full-screen overlays anchored at the middle (the bag, the journal, the win/lose banner) are MEANT to cover
 * things, so a pair of them is skipped.
 */
export function hudCollisions(layout: HudLayout, stageW: number, stageH: number): HudCollision[] {
  const keys = Object.keys(layout).filter((k) => layout[k].on || layout[k].a === 'MC')
  const out: HudCollision[] = []
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = layout[keys[i]]
      const b = layout[keys[j]]
      if (a.a === 'MC' && b.a === 'MC') continue
      const area = overlapArea(hudRect(a, stageW, stageH), hudRect(b, stageW, stageH))
      if (area < COLLISION_FLOOR) continue
      out.push({ a: keys[i], b: keys[j], area: Math.round(area) })
    }
  }
  return out.sort((x, y) => y.area - x.area)
}

/** The CSS a placement needs, given how much the stage is scaled to fit its pane. */
export function hudStyle(placement: HudPlacement): React.CSSProperties {
  const [originX, originY, signX, signY] = HUD_ANCHORS[placement.a]
  return {
    left: `${originX * 100}%`,
    top: `${originY * 100}%`,
    width: placement.w,
    height: placement.h,
    opacity: placement.o,
    zIndex: placement.z,
    transform:
      `translate(${-originX * 100}%, ${-originY * 100}%) ` +
      `translate(${signX * placement.x}px, ${signY * placement.y}px) scale(${placement.s})`,
    transformOrigin: `${originX * 100}% ${originY * 100}%`,
  }
}

/** How much a stage must shrink to fit a pane. 1 when it already fits. */
export function stageScale(paneW: number, paneH: number, stageW: number, stageH: number): number {
  if (!paneW || !paneH) return 1
  return Math.min(paneW / stageW, paneH / stageH)
}

/** Move a piece by a screen-pixel delta, converting through the stage scale and snapping. */
export function nudged(placement: HudPlacement, dxScreen: number, dyScreen: number, scale: number, snap: number): { x: number; y: number } {
  const [, , signX, signY] = HUD_ANCHORS[placement.a]
  const factor = scale || 1
  const step = Math.max(1, snap)
  const x = placement.x + (signX * dxScreen) / factor
  const y = placement.y + (signY * dyScreen) / factor
  return { x: Math.round(x / step) * step, y: Math.round(y / step) * step }
}

/** Anchor ids in reading order, for the 3×3 pad. */
export const HUD_ANCHOR_ORDER: readonly HudAnchor[] = ['TL', 'TC', 'TR', 'ML', 'MC', 'MR', 'BL', 'BC', 'BR']

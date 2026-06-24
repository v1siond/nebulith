/**
 * Pure color helpers for the ASCII renderers — parse hex/rgb(a), then darken,
 * lighten, or set alpha. Kept pure + standalone so the renderer's zone/theme
 * tinting (deriving trunk/canopy shades from one asset color) is unit-testable.
 *
 * Every transform is FAIL-SAFE: an unparseable color is returned unchanged, so a
 * stray keyword or gradient can never blank out a tile.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)))

/** Parse '#rgb', '#rrggbb', 'rgb(...)' or 'rgba(...)' to channels, else null. */
export function parseColor(color: string): RGB | null {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
    if (full.length < 6) return null
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    if ([r, g, b].some(Number.isNaN)) return null
    return { r, g, b }
  }
  const parts = color.match(/-?\d+(\.\d+)?/g)
  if (parts && parts.length >= 3) {
    return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]) }
  }
  return null
}

/** Scale every channel toward black by `factor` (0 = black, 1 = unchanged). */
export function darkenColor(color: string, factor = 0.25): string {
  const c = parseColor(color)
  if (!c) return color
  return `rgb(${clampByte(c.r * factor)}, ${clampByte(c.g * factor)}, ${clampByte(c.b * factor)})`
}

/** Blend every channel toward white by `amount` (0 = unchanged, 1 = white). */
export function lightenColor(color: string, amount = 0.3): string {
  const c = parseColor(color)
  if (!c) return color
  const mix = (v: number): number => clampByte(v + (255 - v) * amount)
  return `rgb(${mix(c.r)}, ${mix(c.g)}, ${mix(c.b)})`
}

/** Re-emit `color` as rgba() with the given alpha (channels preserved). */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color)
  if (!c) return color
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`
}

/**
 * Shift a color's INTENSITY for organic variety: `t`∈[0,1) darkens (t<0.5) or lightens
 * (t≥0.5) by up to `range`; t=0.5 leaves it unchanged. Pure + FAIL-SAFE — the stage
 * generator feeds deterministic per-cell noise so a forest's leaves read in many tones of
 * one base color (a few darker, a few lighter) instead of one flat tone.
 */
export function varyIntensity(color: string, t: number, range = 0.32): string {
  const amount = Math.abs(t - 0.5) * 2 * range // 0 at the middle, up to `range` at the ends
  if (amount < 0.002) return color
  return t < 0.5 ? darkenColor(color, 1 - amount) : lightenColor(color, amount)
}

/** A subtle opacity in [min, 1] from a unit value `t` — decorative depth variety so some
 *  leaves/flowers sit back a touch. Pure (2-decimal rounded). */
export function varyOpacity(t: number, min = 0.85): number {
  const clamped = Math.max(0, Math.min(1, t))
  return Math.round((min + (1 - min) * clamped) * 100) / 100
}

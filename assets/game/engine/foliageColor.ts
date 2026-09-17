/**
 * WHAT COLOUR A LEAF IS, from the three things that decide it: the SEASON, the BIOME and the REGION.
 *
 * *"i want colors that follow every single distinct type of forest and region, exactly how the references
 * from real life I shared"*, and *"add more tree variants with colors per biome, per region, per season"*.
 *
 * ## The three axes, and which one owns what
 *
 * | axis | owns | where it comes from |
 * |---|---|---|
 * | SEASON | the TONE and the per-tree VARIANCE | `leaf_center.settings.colors[zone]`, four shades, the tree's `variant` picks one |
 * | BIOME | the HUE and SATURATION identity, and how much the season moves it at all | the generator's `palette.leaf` + `leafSeasonality` |
 * | REGION | a small local shift, light and damp | the sub-zone's own `leafHue` / `leafValue` |
 *
 * The season array is NOT replaced, and that is the whole point of this shape. A previous attempt overwrote
 * the leaf colour with one flat template green per map and the verdict was *"we lost vibe, vibrance, color,
 * contrast ... none of the trees is different color or different tone"*. Four shades per season is where the
 * variance lives, including the pink in a spring wood, so it stays and the biome bends it.
 *
 * ## Seasonality, which is the fact that makes this correct rather than merely colourful
 *
 * An autumn WOODLAND turns orange. An autumn JUNGLE does not, because it is evergreen and tropical. If the
 * biome hue simply won, every autumn would be green and the seasons would vanish; if the season simply won,
 * every biome would look the same again, which is the defect being fixed. So a biome states how seasonal it
 * IS, and the hue is interpolated between the two by that weight. Same instruction as always: *"we need to
 * think of all elements as the real life element they represent."*
 *
 * ## The safety property worth knowing before reading a diff
 *
 * At `seasonality = 1` and `value = 1` this returns the season shade UNCHANGED. Woodland is authored exactly
 * that way, so the biome he already approved renders byte-identical and only the ones that measured wrong
 * move. See `docs/references/SOURCES.md` for the measured deltas (jungle was 50 degrees off, desert served a
 * green where every reference is olive).
 *
 * Hue moves, tone does not: the tile art carries the luminance and a colour setting shifts the hue
 * (`colour-tints-luminance-stays`). `value` here is a deliberate, served, per-biome SCALE on top of that, and
 * it is what makes a jungle read as dark and a beach as bright, which measured as the strongest separator
 * between the references.
 */
import { parseColor, type RGB } from './colors'

/** A biome's foliage identity, served by the generator. */
export interface FoliageBiome {
  /** The biome's canopy hue and saturation, as a hex. Its own value is ignored; `value` below sets brightness. */
  leaf?: string
  /** 0 = evergreen, the season never moves the hue (jungle). 1 = fully deciduous (woodland). */
  seasonality?: number
  /** Brightness multiplier on the season's shade. 1 = unchanged, < 1 darker (jungle), > 1 brighter (beach). */
  value?: number
}

/** A sub-region's local shift, small on purpose: a glade is the same wood in better light. */
export interface FoliageRegion {
  /** Degrees to rotate the hue. */
  leafHue?: number
  /** Added to the final value, so a glade is lighter and a deep wood darker. */
  leafValue?: number
}

interface HSV { h: number; s: number; v: number }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

function toHsv({ r, g, b }: RGB): HSV {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  const s = max === 0 ? 0 : d / max
  if (d === 0) return { h: 0, s, v: max }
  if (max === R) return { h: (60 * ((G - B) / d) + 360) % 360, s, v: max }
  if (max === G) return { h: 60 * ((B - R) / d) + 120, s, v: max }
  return { h: 60 * ((R - G) / d) + 240, s, v: max }
}

function toHex({ h, s, v }: HSV): string {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  const seg = Math.floor(hp) % 6
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg]
  const byte = (n: number): string => Math.round(clamp01(n + m) * 255).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

/**
 * Interpolate two hues the SHORT way round the circle.
 *
 * `MATH-FOUNDATIONS.md` §1.3: lerping raw angles takes the long path whenever they straddle the wrap, so a
 * biome at 350 and a season at 10 would sweep 340 degrees through every wrong colour instead of 20.
 */
export function lerpHue(from: number, to: number, t: number): number {
  const delta = (((to - from) % 360) + 540) % 360 - 180
  return (((from + delta * t) % 360) + 360) % 360
}

/**
 * The colour ONE tree's leaves wear: its season shade, bent toward its biome and shifted by its region.
 *
 * `seasonShade` is the shade the tree's `variant` already picked out of the served per-season array, so the
 * variance across a stand is decided before this is called and is preserved through it.
 *
 * Returns `undefined` when the caller has nothing to say (no biome served, or an unparseable colour), and the
 * tree keeps the composition's own authored colour, which is exactly what every tree did before this existed.
 */
export function foliageColor(
  seasonShade: string | undefined,
  biome: FoliageBiome | undefined,
  region: FoliageRegion | undefined = undefined,
): string | undefined {
  if (!seasonShade) return undefined
  const season = parseColor(seasonShade)
  if (!season) return undefined
  const leaf = biome?.leaf ? parseColor(biome.leaf) : null
  // Nothing served about this biome and nothing about this region leaves the season shade exactly as it was.
  if (!leaf && region?.leafHue === undefined && region?.leafValue === undefined && biome?.value === undefined) {
    return seasonShade
  }

  const s = toHsv(season)
  const b = leaf ? toHsv(leaf) : s
  // A biome that says nothing about how seasonal it is behaves the way every tree behaved before: fully
  // seasonal, so an unconfigured generator cannot silently go evergreen.
  const seasonality = clamp01(biome?.seasonality ?? 1)

  const hue = lerpHue(b.h, s.h, seasonality) + (region?.leafHue ?? 0)
  const sat = clamp01(b.s + (s.s - b.s) * seasonality)
  const val = clamp01(s.v * (biome?.value ?? 1) + (region?.leafValue ?? 0))
  return toHex({ h: hue, s: sat, v: val })
}

/**
 * WEATHER, falling ON THE MAP.
 *
 * and then: *"the rain is not interacting with the map, it shoudl be rain on top of the map only and interacting with
 * it, the rain should show landing on the flor"*.
 *
 * The first version was a screen effect: a field of streaks over the whole canvas, which is why it read as rain on
 * the monitor rather than rain on the world. It falls on the GROUND PLANE now. The renderer hands over the map's four
 * drawn corners, every drop is given a landing point on that floor, and it falls to it and leaves a ripple there. The
 * grey around the map stays dry, and so does the veil.
 *
 * A weather is still a row in a table: how many particles, how fast, at what slant, how long a streak, how far it
 * falls, what it leaves where it lands, and an optional veil. Snow is slower, shorter, white and barely slanted with
 * no ripple; a sandstorm is nearly sideways and tan.
 *
 * Particles are not state. A particle's position is a function of its index and the time, so nothing is allocated per
 * frame and the same moment always draws the same rain.
 */
export type WeatherId = 'clear' | 'rain'

export interface Point { x: number; y: number }

/**
 * The map's drawn ground plane: its four corners on screen, in cell order (0,0), (cols,0), (cols,rows), (0,rows).
 * A rectangle in the top and 2D views, a diamond in iso, and the same four numbers either way.
 */
export interface MapSurface {
  corners: readonly [Point, Point, Point, Point]
}

export interface WeatherEffect {
  /** Particles per 10,000 pixels of the MAP's drawn area (not of the screen). */
  density: number
  /** How fast a particle falls, in screen pixels per second. */
  speed: number
  /** Sideways drift per pixel fallen. 0 falls straight down. */
  slant: number
  /** Streak length in pixels. */
  length: number
  width: number
  color: string
  /** How high above its landing point a particle starts, in pixels. */
  fall: number
  /** What it leaves where it lands. Absent → nothing (snow settles, it does not splash). */
  splash?: { radius: number; color: string; width: number }
  /** A wash over the map, drawn before the particles. */
  veil?: string
}

export const WEATHER: Readonly<Record<Exclude<WeatherId, 'clear'>, WeatherEffect>> = {
  // Brighter and a touch thicker than first drawn: on a pale meadow floor the fainter streaks were easy to miss.
  rain: {
    density: 2.2, speed: 900, slant: 0.18, length: 16, width: 1.5,
    color: 'rgba(205, 225, 250, 0.72)', fall: 210,
    splash: { radius: 4, color: 'rgba(214, 234, 255, 0.55)', width: 1 },
    veil: 'rgba(40, 58, 88, 0.2)',
  },
}

/** What the view bar says for each weather, the way Day/Night names the state it is in. */
export const WEATHER_LABEL: Readonly<Record<WeatherId, string>> = { clear: '⛅ Clear', rain: '🌧 Rain' }

/** The order the view bar steps through, clear first. */
export const WEATHER_ORDER: readonly WeatherId[] = ['clear', 'rain']

export function nextWeather(current: WeatherId): WeatherId {
  const at = WEATHER_ORDER.indexOf(current)
  return WEATHER_ORDER[(at + 1) % WEATHER_ORDER.length]
}

/** The last share of a particle's cycle, spent as a ripple on the floor instead of as a falling streak. */
const LANDED = 0.14

/** A stable 0..1 value per integer: the particle's own randomness, the same every frame. */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** A point on the ground plane, `u` across the map and `v` down it, both 0..1. Bilinear, so it works for the
 *  iso diamond exactly as it does for the top view's rectangle. */
export function onSurface(surface: MapSurface, u: number, v: number): Point {
  const [nw, ne, se, sw] = surface.corners
  const near = { x: nw.x + (ne.x - nw.x) * u, y: nw.y + (ne.y - nw.y) * u }
  const far = { x: sw.x + (se.x - sw.x) * u, y: sw.y + (se.y - sw.y) * u }
  return { x: near.x + (far.x - near.x) * v, y: near.y + (far.y - near.y) * v }
}

/** The drawn area of the ground plane, by the shoelace formula. The particle count is a share of THIS, so a
 *  small map gets a small amount of rain and a zoomed-in one gets more of it. */
export function surfaceArea(surface: MapSurface): number {
  const [a, b, c, d] = surface.corners
  const cross = (p: Point, q: Point) => p.x * q.y - q.x * p.y
  return Math.abs(cross(a, b) + cross(b, c) + cross(c, d) + cross(d, a)) / 2
}

/** Everything after this is drawn on the map and nowhere else. */
function clipToSurface(ctx: CanvasRenderingContext2D, surface: MapSurface): void {
  const [a, b, c, d] = surface.corners
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineTo(c.x, c.y)
  ctx.lineTo(d.x, d.y)
  ctx.closePath()
  ctx.clip()
}

/**
 * Lay `weather` over a finished frame of `w` x `h` pixels at `timeMs`, falling on `surface`. Clear draws nothing.
 *
 * Two paths and two strokes for the whole field, whatever the particle count: the streaks in one, the ripples in
 * the other. Nothing is allocated per particle.
 */
export function drawWeather(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  weather: WeatherId,
  timeMs: number,
  surface: MapSurface,
): void {
  if (weather === 'clear') return
  const fx = WEATHER[weather]
  ctx.save()
  clipToSurface(ctx, surface)
  if (fx.veil) {
    ctx.fillStyle = fx.veil
    ctx.fillRect(0, 0, w, h) // clipped to the map, so the grey around it does not dim
  }

  const count = Math.round((surfaceArea(surface) / 10000) * fx.density)
  const seconds = timeMs / 1000
  const landed: Point[] = []

  ctx.strokeStyle = fx.color
  ctx.lineWidth = fx.width
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const spot = onSurface(surface, hash01(i * 2 + 1), hash01(i * 2 + 2))
    const pace = 0.8 + 0.4 * hash01(i * 3 + 7) // not every drop falls at the same speed
    const cycle = fx.fall / (fx.speed * pace)
    const phase = wrap01(seconds / cycle + hash01(i * 5 + 3))
    if (phase >= 1 - LANDED) {
      if (fx.splash) landed.push(spot)
      continue
    }
    // How far it still has to fall. The streak is clipped at the floor, so a drop never draws through it.
    const above = fx.fall * (1 - phase / (1 - LANDED))
    const y = spot.y - above
    const x = spot.x - above * fx.slant
    const tail = Math.min(y + fx.length, spot.y)
    ctx.moveTo(x, y)
    ctx.lineTo(x + (tail - y) * fx.slant, tail)
  }
  ctx.stroke()

  // THE LANDING. A ripple exactly where the drop met the floor, which is the half he was missing.
  if (fx.splash && landed.length > 0) {
    ctx.strokeStyle = fx.splash.color
    ctx.lineWidth = fx.splash.width
    ctx.beginPath()
    for (const spot of landed) {
      const r = fx.splash.radius
      ctx.moveTo(spot.x - r, spot.y)
      ctx.lineTo(spot.x, spot.y - r * 0.45)
      ctx.lineTo(spot.x + r, spot.y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

const wrap01 = (n: number): number => n - Math.floor(n)

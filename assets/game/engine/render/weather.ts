/**
 * WEATHER, laid over the finished frame the way the night veil is.
 *
 * Alexander, 2026-09-11: *"please add a rain status, which would similar to the night mode, in the sense that we
 * activate it and rain shows up, we'll also implement other clima effects, like snowing, sand storm, etc. but
 * rains it's the basic foundation for all"*.
 *
 * So rain is not a special case, it is the first row of a table. A weather is a field of falling particles (how
 * many, how fast, at what slant, how long a streak, what colour) and an optional veil that dims the light under
 * it. Snow is slower, shorter, white and barely slanted; a sandstorm is nearly sideways, tan, with a heavy veil.
 * Each is a row here, drawn by the one function below in every view, because it is laid over the SCREEN, after
 * the scene and the night pass, not over the map.
 *
 * Particles are not state. Each one's position is a function of its index and the time, so nothing is allocated
 * per frame and the same time always draws the same rain.
 */
export type WeatherId = 'clear' | 'rain'

export interface WeatherEffect {
  /** Particles per 10,000 screen pixels. */
  density: number
  /** How fast a particle falls, in screen pixels per second. */
  speed: number
  /** Sideways drift per pixel fallen. 0 falls straight down. */
  slant: number
  /** Streak length in pixels. */
  length: number
  width: number
  color: string
  /** A wash over the whole frame, drawn before the particles. */
  veil?: string
}

export const WEATHER: Readonly<Record<Exclude<WeatherId, 'clear'>, WeatherEffect>> = {
  // Brighter and a touch thicker than first drawn: on a pale meadow floor the fainter streaks were easy to miss.
  rain: { density: 2.2, speed: 900, slant: 0.18, length: 16, width: 1.5, color: 'rgba(205, 225, 250, 0.72)', veil: 'rgba(40, 58, 88, 0.2)' },
}

/** What the view bar says for each weather, the way Day/Night names the state it is in. */
export const WEATHER_LABEL: Readonly<Record<WeatherId, string>> = { clear: '⛅ Clear', rain: '🌧 Rain' }

/** The order the view bar steps through, clear first. */
export const WEATHER_ORDER: readonly WeatherId[] = ['clear', 'rain']

export function nextWeather(current: WeatherId): WeatherId {
  const at = WEATHER_ORDER.indexOf(current)
  return WEATHER_ORDER[(at + 1) % WEATHER_ORDER.length]
}

/** A stable 0..1 value per integer: the particle's own randomness, the same every frame. */
function hash01(n: number): number {
  const s = Math.sin(n * 12.9898) * 43758.5453
  return s - Math.floor(s)
}

/** Lay `weather` over a finished frame of `w` x `h` pixels at `timeMs`. Clear draws nothing. */
export function drawWeather(ctx: CanvasRenderingContext2D, w: number, h: number, weather: WeatherId, timeMs: number): void {
  if (weather === 'clear') return
  const fx = WEATHER[weather]
  ctx.save()
  if (fx.veil) {
    ctx.fillStyle = fx.veil
    ctx.fillRect(0, 0, w, h)
  }
  const count = Math.round(((w * h) / 10000) * fx.density)
  const fallen = (timeMs / 1000) * fx.speed
  const spanY = h + fx.length
  // Slanted rain enters from beyond the left edge, so the field is wider than the screen by the drift.
  const margin = h * fx.slant + fx.length
  const spanX = w + margin
  ctx.strokeStyle = fx.color
  ctx.lineWidth = fx.width
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < count; i++) {
    const pace = 0.8 + 0.4 * hash01(i * 3 + 7) // not every drop falls at the same speed
    const y = ((hash01(i * 2 + 2) * spanY + fallen * pace) % spanY) - fx.length
    const x = ((((hash01(i * 2 + 1) * spanX + y * fx.slant) % spanX) + spanX) % spanX) - margin
    ctx.moveTo(x, y)
    ctx.lineTo(x + fx.length * fx.slant, y + fx.length)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * THE GROUND, BAKED ONCE PER CHUNK AND BLITTED.
 *
 * `docs/RENDERING.md` measures the case: on a wide city 58% of everything drawn in a frame is flat level-0
 * ground that never changes between frames. Each of those cells costs its own `drawImage` and its own state
 * juggling, every frame, to put back exactly the same pixels.
 *
 * So a fixed square of cells is drawn once into its own canvas and blitted as ONE image. The doc's design,
 * point by point:
 *
 *   1. A chunk is a fixed square of cells, drawn through the SAME call the main loop uses. This module never
 *      draws a tile itself: the renderer hands it the one closure that does, so a change to how ground draws
 *      cannot leave the substrate behind.
 *   2. The canvas carries BLEED, because a tile's silhouette reaches past its own cell. It is sized from the
 *      chunk's own drawn geometry rather than guessed.
 *   3. The key is what changes the picture: the chunk, the camera's facing, the tile size, the art style, and
 *      a signature over the cells themselves.
 *   4. THE PICKER STILL WORKS. Each asset's drawn silhouette is recorded RELATIVE to the chunk's anchor when
 *      the chunk is built, and the anchor's current screen point is added back per frame. Panning moves the
 *      anchor and leaves the relative geometry exactly right; a zoom or a facing change rebuilds the chunk.
 *   5. Blitted before the sorted loop. Every asset in it is level 0 and rises less than a block, which is what
 *      `bakeableGround` is for, so nothing can sort into the middle of one.
 *
 * A chunk is only built once every tile in it has its picture decoded, or it would cache a blank.
 */
import type { GridAsset } from '@/engine/IsometricGrid'
import type { Pt, TileGeom } from './tileHit'

/** How many cells across a chunk is. Big enough that a blit replaces many draws, small enough that a cell
 *  changing does not rebuild the map. */
export const CHUNK = 16

/** One asset's drawn silhouette, in chunk-anchor space. */
interface BakedHit {
  asset: GridAsset
  geom: TileGeom
}

interface Chunk {
  canvas: HTMLCanvasElement
  /** Where to blit, relative to the chunk anchor's screen point. */
  relX: number
  relY: number
  hits: BakedHit[]
  signature: string
  assets: GridAsset[]
}

/** What the renderer lends this module: how to project, how to draw one ground tile, and what is ready. */
export interface SubstrateDeps {
  toScreen: (col: number, row: number) => Pt
  /** Draws ONE asset at a screen anchor and answers its silhouette, exactly as the main loop would. */
  drawOne: (ctx: CanvasRenderingContext2D, ax: number, ay: number, asset: GridAsset) => TileGeom | null
  /** The screen anchor the main loop would draw this asset at. */
  anchorOf: (asset: GridAsset) => Pt
  /** Is this asset's picture decoded? A chunk built from an undecoded tile caches a blank. */
  ready: (asset: GridAsset) => boolean
  /** Everything about the camera and the catalogue that changes the picture. */
  key: string
}

const chunks = new Map<string, Chunk>()

/** Forget every chunk. The editor calls it when the art style or the map is replaced wholesale. */
export function clearSubstrate(): void {
  chunks.clear()
}

/** How many chunks are held, for the diagnostics seam and for a test that wants to know it is working. */
export function substrateSize(): number {
  return chunks.size
}

/**
 * Draws every bakeable ground asset through its chunk and answers what it absorbed.
 *
 * The caller skips the absorbed assets in its own loop and pushes the returned hits, which is the whole
 * contract: this draws them and records them, so the loop does neither.
 */
export function blitSubstrate(
  ctx: CanvasRenderingContext2D,
  ground: readonly GridAsset[],
  deps: SubstrateDeps,
): { absorbed: Set<GridAsset>; hits: Array<{ asset: GridAsset; geom: TileGeom }>; blitted: number } {
  const absorbed = new Set<GridAsset>()
  const hits: Array<{ asset: GridAsset; geom: TileGeom }> = []
  let blitted = 0

  for (const [id, group] of byChunk(ground)) {
    const anchor = deps.toScreen(group.anchorCol, group.anchorRow)
    const signature = signatureOf(group.assets)
    const key = `${id}|${deps.key}`
    const held = chunks.get(key)
    const chunk = held && held.signature === signature ? held : build(group, anchor, signature, deps)

    // NOT BUILT MEANS NOT ABSORBED: something in it has not decoded yet, so the loop draws these exactly as
    // it always did and the chunk is tried again next frame.
    if (!chunk) continue
    if (chunk !== held) chunks.set(key, chunk)

    ctx.drawImage(chunk.canvas, anchor.x + chunk.relX, anchor.y + chunk.relY)
    blitted++

    for (const hit of chunk.hits) {
      absorbed.add(hit.asset)
      hits.push({ asset: hit.asset, geom: shifted(hit.geom, anchor.x, anchor.y) })
    }
  }

  return { absorbed, hits, blitted }
}

interface Group {
  anchorCol: number
  anchorRow: number
  assets: GridAsset[]
}

function byChunk(ground: readonly GridAsset[]): Map<string, Group> {
  const out = new Map<string, Group>()

  for (const asset of ground) {
    const anchorCol = Math.floor(asset.col / CHUNK) * CHUNK
    const anchorRow = Math.floor(asset.row / CHUNK) * CHUNK
    const id = `${anchorCol},${anchorRow}`
    const group = out.get(id)
    if (group) {
      group.assets.push(asset)
      continue
    }
    out.set(id, { anchorCol, anchorRow, assets: [asset] })
  }

  return out
}

/**
 * WHAT MAKES THIS CHUNK'S PICTURE. Everything a ground tile draws from, so an edit to any cell rebuilds it
 * and nothing else. Cheap on purpose: it runs per chunk per frame, and arithmetic over a few hundred cells
 * is nothing against the draws it saves.
 */
function signatureOf(assets: readonly GridAsset[]): string {
  let sum = assets.length
  let text = ''

  for (const a of assets) {
    sum = (sum * 31 + a.col * 7 + a.row * 13 + (a.heightLevel ?? 0) * 3) | 0
    text += `${a.label ?? a.tileKey ?? a.type}|${a.color ?? ''}|${a.width}|${a.height}|${a.depth}|${a.spanForward}|${a.spanAxis ?? ''};`
  }

  return `${sum}:${hash(text)}`
}

function hash(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) | 0
  return h
}

/** Builds one chunk, or null when a tile in it has not decoded and the picture would be wrong. */
function build(group: Group, anchor: Pt, signature: string, deps: SubstrateDeps): Chunk | null {
  if (!group.assets.every(deps.ready)) return null
  if (typeof document === 'undefined') return null

  // MEASURE FIRST, DRAW SECOND. The canvas has to hold every silhouette the chunk draws, and the only honest
  // way to know how far they reach is to ask the same geometry the picker uses.
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null

  const measured: Array<{ asset: GridAsset; geom: TileGeom; ax: number; ay: number }> = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const asset of group.assets) {
    const at = deps.anchorOf(asset)
    const geom = deps.drawOne(probe, at.x, at.y, asset)
    if (!geom) continue
    measured.push({ asset, geom, ax: at.x, ay: at.y })
    for (const p of points(geom)) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }

  if (measured.length === 0 || !Number.isFinite(minX)) return null

  const width = Math.ceil(maxX - minX) + 2
  const height = Math.ceil(maxY - minY) + 2
  if (width <= 0 || height <= 0 || width * height > 16_000_000) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const into = canvas.getContext('2d')
  if (!into) return null

  // The chunk is drawn in WORLD screen coordinates shifted so its own bounding box starts at the origin, so
  // every draw is the one the main loop would have made and nothing has to be re-derived.
  into.translate(-minX + 1, -minY + 1)
  const hits: BakedHit[] = []
  for (const m of measured) {
    deps.drawOne(into, m.ax, m.ay, m.asset)
    hits.push({ asset: m.asset, geom: shifted(m.geom, -anchor.x, -anchor.y) })
  }

  return { canvas, relX: minX - 1 - anchor.x, relY: minY - 1 - anchor.y, hits, signature, assets: group.assets }
}

function points(geom: TileGeom): Pt[] {
  return geom.kind === 'cube' ? [...geom.base, ...geom.top] : geom.pts
}

/** The same silhouette, moved. A geom is only points, which is what makes a chunk's geometry reusable. */
function shifted(geom: TileGeom, dx: number, dy: number): TileGeom {
  const move = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy })

  if (geom.kind === 'cube') {
    return {
      kind: 'cube',
      base: [move(geom.base[0]), move(geom.base[1]), move(geom.base[2]), move(geom.base[3])],
      top: [move(geom.top[0]), move(geom.top[1]), move(geom.top[2]), move(geom.top[3])],
    }
  }

  return { kind: 'poly', pts: geom.pts.map(move) }
}

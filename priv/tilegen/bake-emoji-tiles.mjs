/**
 * Bake every emoji tile in the DB tileset into a pre-rendered PNG, so a tile draws as an IMAGE
 * (identical on every OS) instead of a live-rasterised glyph (Segoe on Windows, Noto on Linux…).
 *
 * The pipeline is exactly the user's ask: "render whatever emoji with whatever font, screenshot it,
 * cut it". For each entry in emoji.json whose `char` is an emoji, we rasterise the glyph with the
 * installed Noto Color Emoji font in headless Chromium, trim to the inked bounding box, and fit it
 * centred into a transparent 256×256 square. 256 is the single accepted baseline — it downscales
 * crisply and the renderers already scale a tile image to whatever the view needs.
 *
 * We then point each baked entry's `image` at `/tiles/emoji/baked/<key>.png` so the renderer's
 * already-wired image path (resolveVisual → resolveDraw → drawStyledImage) takes over from fillText.
 * Keeping that path convention here (one place) is why the generator owns the emoji.json write.
 *
 * Run (node 20 + playwright):
 *   NODE_PATH=/home/visiond/projects/game-engine/game-website/node_modules \
 *     node scripts/bake-emoji-tiles.mjs
 *
 * Config via env: TILESET_JSON (source+target tileset), OUT_DIR (png output), FONT (css family),
 * WRITE_JSON=0 to bake without rewriting the tileset.
 */
import { fileURLToPath } from 'url'
import fs from 'fs'
import path from 'path'
import { bakeGlyph, isEmoji, openBakePage } from './lib/emoji-bake.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The DB tileset the nebulith backend seeds from — the source of the tiles AND the file we point
// at the baked PNGs. Overridable for a different checkout.
const TILESET_JSON =
  process.env.TILESET_JSON ||
  path.join(REPO_ROOT, 'repo/tilesets/emoji.json')
// WHERE THE ART LANDS: the BACKEND's static root, never this repo's public/.
//
// Alexander, 2026-09-12: *"all those tiles in the frontend shouldn't exist at all, all tils should come from
// backend"*. The frontend's copy is deleted, and this default is what would have quietly recreated it on the
// next bake. nebulith's own bake.mjs already writes to priv/static/tiles; this matches it now.
//
// The SERVED URL does not change: the backend serves priv/static at "/", so a tile still resolves at
// /tiles/emoji/baked/<key>.png, absolutised against the backend origin by the tileset loader.
const OUT_DIR = process.env.OUT_DIR || path.join(REPO_ROOT, 'static/tiles/emoji/baked')
// The public URL the tileset entry points at (OUT_DIR served from /public).
const PUBLIC_PREFIX = process.env.PUBLIC_PREFIX || '/tiles/emoji/baked'
// Force Noto so the bake is the SAME art on every machine (never the host's default emoji font).
const FONT = process.env.FONT || undefined // undefined → the shared lib's Noto default
const WRITE_JSON = process.env.WRITE_JSON !== '0'

async function main() {
  const tileset = JSON.parse(fs.readFileSync(TILESET_JSON, 'utf8'))
  const targets = Object.entries(tileset).filter(([, tile]) => isEmoji(tile?.char))
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const { browser, page } = await openBakePage()

  const baked = []
  const skipped = []
  for (const [key, tile] of targets) {
    const res = await bakeGlyph(page, tile.char, FONT)
    if (!res) {
      skipped.push(key)
      console.warn(`  skip  ${key} (${tile.char}) — nothing inked`)
      continue
    }
    const file = path.join(OUT_DIR, `${key}.png`)
    fs.writeFileSync(file, Buffer.from(res.url.split(',')[1], 'base64'))
    if (WRITE_JSON) tile.image = `${PUBLIC_PREFIX}/${key}.png`
    baked.push(key)
    const flat = res.colored / res.inked < 0.05 ? ' [monochrome — verify]' : ''
    console.log(`  bake  ${key.padEnd(10)} ${tile.char}  bbox ${res.bbox.join('x')}${flat}`)
  }

  await browser.close()

  const nonEmoji = Object.keys(tileset).filter((k) => !isEmoji(tileset[k]?.char))
  if (WRITE_JSON) fs.writeFileSync(TILESET_JSON, JSON.stringify(tileset))

  console.log(`\nbaked ${baked.length} tiles → ${OUT_DIR}`)
  if (skipped.length) console.log(`skipped (no ink): ${skipped.join(', ')}`)
  if (nonEmoji.length) console.log(`non-emoji entries (untouched): ${nonEmoji.join(', ') || 'none'}`)
  console.log(WRITE_JSON ? `wrote image refs → ${TILESET_JSON}` : 'WRITE_JSON=0 — tileset unchanged')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

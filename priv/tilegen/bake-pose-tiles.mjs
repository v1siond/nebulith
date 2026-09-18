// Bake the POSE glyphs used by the player animation seed (walk 🚶 / run 🏃) into PNGs, so the animation
// frames reference DB IMAGE tiles (emoji:walk / emoji:run) in the consistent Noto font instead of a raw
// OS glyph. Same rasterise-with-Noto pipeline as bake-emoji-tiles.mjs, but just these two glyphs.
//   Run: NODE_PATH=$(pwd)/node_modules node scripts/bake-pose-tiles.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { bakeGlyph, openBakePage } from './lib/emoji-bake.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// WHERE THE ART LANDS: the BACKEND's static root, never this repo's public/.
//
// Alexander, 2026-09-12: *"all those tiles in the frontend shouldn't exist at all, all tils should come from
// backend"*. The frontend's copy is deleted, and this default is what would have quietly recreated it on the
// next bake. nebulith's own bake.mjs already writes to priv/static/tiles; this matches it now.
//
// The SERVED URL does not change: the backend serves priv/static at "/", so a tile still resolves at
// /tiles/emoji/baked/<key>.png, absolutised against the backend origin by the tileset loader.
const OUT = process.env.OUT_DIR || path.join(ROOT, 'static/tiles/emoji/baked')
const POSES = [['walk', '🚶'], ['run', '🏃']]

fs.mkdirSync(OUT, { recursive: true })
const { browser, page } = await openBakePage()
for (const [slug, char] of POSES) {
  const res = await bakeGlyph(page, char)
  if (!res) { console.error('NOTHING rendered for', slug, char); continue }
  fs.writeFileSync(path.join(OUT, `${slug}.png`), Buffer.from(res.url.split(',')[1], 'base64'))
  console.log('baked', slug, char, '-> ', `${slug}.png`, '| bbox', res.bbox, '| colored', res.colored)
}
await browser.close()

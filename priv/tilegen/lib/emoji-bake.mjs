/**
 * Shared emoji→PNG rasteriser. ONE place owns "render a glyph with Noto in headless Chromium, trim to
 * its inked bbox, and fit it centred into a transparent 256×256 square" — reused by both the tileset
 * bake (bake-emoji-tiles.mjs) and the entity/variant bake (bake-entity-tiles.mjs) so the pipeline never
 * drifts between the two. Baking big (512) then trimming + downscaling to 256 keeps the tile crisp.
 */
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
// Resolve playwright from the website's node_modules regardless of cwd (a worktree runs from anywhere).
const { chromium } = require('/home/visiond/projects/game-engine/game-website/node_modules/playwright')

export const RENDER = 512 // rasterise big, then trim + downscale → a smooth 256 tile
export const OUT = 256 // the baked tile size (the accepted baseline)
export const PAD = 6 // a hair of transparent margin so a glyph never clips the tile edge
// Force Noto so the bake is the SAME art on every machine (never the host's default emoji font).
export const DEFAULT_FONT = '"Noto Color Emoji"'

/** The same classifier the renderer uses to decide "this is an emoji" (shared.ts isWeaponEmoji). */
export const isEmoji = (char) => typeof char === 'string' && /\p{Extended_Pictographic}/u.test(char)

/**
 * Rasterise one glyph, trim to its inked bbox, and fit it centred into a transparent OUT×OUT canvas.
 * Runs in the page so it can use the real canvas text + image APIs. Returns { url, bbox, inked, colored }
 * or null when nothing inked (a glyph the font can't draw) so the caller can flag it instead of a blank.
 */
export async function bakeGlyph(page, char, font = DEFAULT_FONT) {
  return page.evaluate(
    async ({ char, FONT, RENDER, OUT, PAD }) => {
      await document.fonts.ready
      const src = document.createElement('canvas')
      src.width = src.height = RENDER
      const sctx = src.getContext('2d')
      sctx.clearRect(0, 0, RENDER, RENDER)
      sctx.textAlign = 'center'
      sctx.textBaseline = 'middle'
      sctx.font = `${Math.round(RENDER * 0.8)}px ${FONT}`
      sctx.fillText(char, RENDER / 2, RENDER / 2)

      // Inked bounding box from the alpha channel — trims the em-box whitespace so the glyph is centred
      // by its own pixels (fillText centres the em box, which is not the glyph's visual centre).
      const data = sctx.getImageData(0, 0, RENDER, RENDER).data
      let minX = RENDER, minY = RENDER, maxX = -1, maxY = -1, inked = 0, colored = 0
      for (let y = 0; y < RENDER; y++) {
        for (let x = 0; x < RENDER; x++) {
          const i = (y * RENDER + x) * 4
          if (data[i + 3] <= 8) continue
          inked++
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          const r = data[i], g = data[i + 1], b = data[i + 2]
          if (Math.max(r, g, b) - Math.min(r, g, b) > 30) colored++
        }
      }
      if (maxX < 0) return null // nothing rendered

      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      const out = document.createElement('canvas')
      out.width = out.height = OUT
      const octx = out.getContext('2d')
      octx.imageSmoothingEnabled = true
      octx.imageSmoothingQuality = 'high'
      const avail = OUT - PAD * 2
      const scale = Math.min(avail / bw, avail / bh)
      const dw = bw * scale, dh = bh * scale
      octx.drawImage(src, minX, minY, bw, bh, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh)
      return { url: out.toDataURL('image/png'), bbox: [bw, bh], inked, colored }
    },
    { char, FONT: font, RENDER, OUT, PAD },
  )
}

/** Launch a headless Chromium page ready to rasterise glyphs. Caller closes the returned browser. */
export async function openBakePage() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  const page = await browser.newPage()
  return { browser, page }
}

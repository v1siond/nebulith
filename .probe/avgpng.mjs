/** Average visible colour and coverage of a baked tile, so "the tones read as mixed" can be checked against
 *  the ART rather than against a screenshot. */
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { basename } from 'path'
for (const f of process.argv.slice(2)) {
  const img = await loadImage(f)
  const c = createCanvas(img.width, img.height)
  const x = c.getContext('2d')
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, img.width, img.height).data
  let r = 0, g = 0, b = 0, n = 0, lum = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    const a = d[i + 3] / 255
    r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a
    lum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a
  }
  const px = img.width * img.height
  if (!n) { console.log(basename(f).padEnd(22), 'EMPTY'); continue }
  const hex = v => Math.round(v / n).toString(16).padStart(2, '0')
  console.log(`${basename(f).padEnd(22)} #${hex(r)}${hex(g)}${hex(b)}  lum ${(lum / n).toFixed(1).padStart(5)}  coverage ${(100 * n / px).toFixed(1)}%  ${img.width}x${img.height}`)
}

// Bakes each tile in tiles.json into a transparent 128x128 PNG.
//
// file:// fetch is CORS-blocked in headless chromium, so we read tiles.json here
// and hand it to the page's renderAtlas(tiles); then we screenshot each cell.
// Run from priv/tilegen:  node bake.mjs
import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tilesPath = join(here, "tiles.json");
const atlasUrl = "file://" + join(here, "atlas.html");
const outRoot = join(here, "..", "static", "tiles");

const tiles = JSON.parse(await readFile(tilesPath, "utf8"));

await mkdir(join(outRoot, "ascii"), { recursive: true });
await mkdir(join(outRoot, "emoji"), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(atlasUrl);
const rendered = await page.evaluate((data) => window.renderAtlas(data), tiles);
await page.evaluate(() => document.fonts.ready);

let baked = 0;
for (const tile of tiles) {
  const selector = `#tile-${tile.style}-${tile.label}`;
  const el = page.locator(selector);
  const outPath = join(outRoot, tile.style, `${tile.label}.png`);
  await el.screenshot({ omitBackground: true, path: outPath });
  baked++;
}

await browser.close();
console.log(`rendered ${rendered} cells, baked ${baked} PNGs into ${outRoot}/{ascii,emoji}`);

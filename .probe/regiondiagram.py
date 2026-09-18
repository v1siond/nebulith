"""THE REGION DIAGRAM: every biome's regions, as a picture, on one sheet.

`REGIONS.md` §6 asks for region work to be measured region by region rather than eyeballed on one screenshot,
and the working protocol says that when the tool for judging a whole FAMILY does not exist, building it is the
first task. `.probe/regionsheet.mjs` collects the numbers and writes one JSON per biome; this draws them.

    node .probe/regionsheet.mjs          # build every biome, dump regions + per-region tallies
    python3 .probe/regiondiagram.py      # draw them all onto one sheet

What to look for: the ARRANGEMENT should be the one the biome declares. Irregular blobs are a scatter,
horizontal stripes are bands, concentric circles are rings. A set that declares rings and draws blobs is the
defect this whole thing exists to catch, because no region CONTENT can produce a sense of approach on top of
a scatter.
"""
from PIL import Image, ImageDraw
import json, pathlib, sys

SRC = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/home/visiond/.claude/jobs/beedf1c6/tmp/regions')
BIOMES = ['Woodland', 'Jungle', 'Meadow', 'Swamp', 'Mountain', 'Beach', 'Ruins', 'Desert', 'Volcanic']
# One colour per ORDER POSITION, not per name, so the same ramp reads across every biome: first region dark,
# last light. That makes a gradient legible as a gradient at a glance.
RAMP = [(40, 52, 74), (52, 96, 112), (74, 140, 120), (150, 178, 104), (226, 214, 150)]
CELL, PAD, LABEL = 2, 16, 30

tiles = []
for name in BIOMES:
    f = SRC / f'{name}.json'
    if not f.exists():
        print('missing', f)
        continue
    d = json.loads(f.read_text())
    reg, order = d['regions'], list(d['per'].keys())
    idx = {k: i for i, k in enumerate(order)}
    rows, cols = len(reg), len(reg[0])
    im = Image.new('RGB', (cols * CELL, rows * CELL), (22, 25, 32))
    px = im.load()
    for r in range(rows):
        for c in range(cols):
            k = reg[r][c]
            if not k:
                continue
            col = RAMP[idx.get(k, 0) % len(RAMP)]
            for dy in range(CELL):
                for dx in range(CELL):
                    px[c * CELL + dx, r * CELL + dy] = col
    tiles.append((name, im, order, d['per']))

w = max(t[1].width for t in tiles)
h = max(t[1].height for t in tiles)
COLS = 3
rowsN = (len(tiles) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * (w + PAD) + PAD, rowsN * (h + PAD + LABEL) + PAD), (16, 18, 24))
d = ImageDraw.Draw(sheet)
for i, (name, im, order, per) in enumerate(tiles):
    x = PAD + (i % COLS) * (w + PAD)
    y = PAD + (i // COLS) * (h + PAD + LABEL)
    total = sum(v['cells'] for v in per.values()) or 1
    d.text((x, y), name, fill=(240, 244, 250))
    # the order, dark to light, with each region's share: the legend for the ramp above
    legend = '  '.join(f"{k}{round(per[k]['cells'] / total * 100)}%" for k in order)
    d.text((x, y + 13), legend[:int(w / 5.6)], fill=(150, 162, 180))
    sheet.paste(im, (x, y + LABEL))
out = SRC / 'sheet.png'
sheet.save(out)
print('wrote', out, sheet.size, 'biomes', len(tiles))

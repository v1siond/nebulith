"""HOW CLOSE IS THIS OBJECT TO ITS REFERENCE. As numbers, not as an opinion.

*"the most important part of the framnwrok is how to get designs CLOSE tot he reference"*. Judging that by
eye is how four objects were built and rejected. This reduces both pictures to their SILHOUETTE and measures
the four things that decide whether a shape reads as the thing it is named after.

Why silhouette and not colour: squint at any image and the detail disappears, leaving the big shape. If the
big shape is wrong, no texture rescues it; if it is right, the object reads before it is finished.

    python3 .probe/silhouette.py <reference.png> <ours.png> [out-dir]

Prints a row per image plus the deltas, and writes both silhouettes so they can be looked at side by side.
"""
import sys, os
from collections import Counter
from PIL import Image
import numpy as np


def mask(path):
    """Every pixel that is not background.

    Backgrounds differ (a render sits on grass, a reference on white or on its own map), so the background is
    MEASURED as the commonest colour around the image border rather than assumed.
    """
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.int16)
    h, w = a.shape[:2]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    opaque = border[border[:, 3] >= 24]
    solid = np.ones((h, w), bool) if opaque.size == 0 else None
    m = a[:, :, 3] >= 24
    if opaque.size:
        key = Counter(map(tuple, (opaque[:, :3] >> 4))).most_common(1)[0][0]
        bg = np.array(key, np.int16) * 16 + 8
        near = np.abs(a[:, :, :3] - bg).sum(axis=2) < 60
        m = m & ~near
    return m


def shape(m):
    """The four numbers. Each names a way a shape can be wrong, and each was wrong at least once."""
    ys, xs = np.nonzero(m)
    if xs.size == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    ink = xs.size
    # THE SKYLINE: how much the highest ink varies across the width. A flat roofline is architecture, a jagged
    # one is rock. This separated the cave from the temple more sharply than anything else.
    col = m[y0:y1 + 1, x0:x1 + 1]
    first = np.argmax(col, axis=0).astype(float)
    has = col.any(axis=0)
    tops = first[has]
    jag = float(tops.std() / bh) if tops.size else 0.0
    return {
        "aspect": bw / bh,                      # wide and low, or tall and narrow
        "fill": ink / (bw * bh),                # solid block, or broken mass
        "centroid": (ys.mean() - y0) / bh,      # where the weight sits: low is grounded, high is top heavy
        "jag": jag,                             # how uneven the skyline is
    }


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    ref_path, our_path = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else "/tmp/silhouette"
    os.makedirs(out, exist_ok=True)

    masks = {"REFERENCE": mask(ref_path), "OURS": mask(our_path)}
    vals = {}
    for name, m in masks.items():
        s = shape(m)
        if s is None:
            print(f"{name}: no object found, the whole image reads as background")
            sys.exit(1)
        vals[name] = s
        Image.fromarray((m * 255).astype("uint8")).save(f"{out}/silhouette-{name.lower()}.png")

    row = lambda n, s: f"{n:<11} aspect={s['aspect']:.2f}  fill={s['fill']:.2f}  centroid={s['centroid']:.2f}  jag={s['jag']:.3f}"
    print(row("REFERENCE", vals["REFERENCE"]))
    print(row("OURS", vals["OURS"]))
    d = {k: vals["OURS"][k] - vals["REFERENCE"][k] for k in vals["OURS"]}
    print(f"{'DELTA':<11} aspect={d['aspect']:+.2f}  fill={d['fill']:+.2f}  centroid={d['centroid']:+.2f}  jag={d['jag']:+.3f}")
    print(f"\nwrote {out}/silhouette-reference.png and {out}/silhouette-ours.png")


if __name__ == "__main__":
    main()

# Tile design

How a tile is drawn, where its colour comes from, and how the pieces of a family relate.

Open this before authoring, re-colouring or re-shaping any tile. The checklist at the end is the gate,
not a summary: walk it item by item and state the evidence for each.

## 1. A tile is a label, a picture per style, and a row of facts

One ENGINE, N art styles. A style is a set of baked images and nothing else, so there is no "ascii
engine" and no branch anywhere on a style id.

A LABEL owns everything but the picture: its name, its bucket, its height, its collision, its colour
role. The picture is a `tile_images` row, one per style, which is the only thing a style owns
(`docs/SPEC.md` §3.1). `TileSource.normalize_label_facts/0` and `normalize_label_colors/0` still
reconcile the facts across styles at the end of a seed, so the same `door` is the same shape and the
same colour wherever it is drawn.

**Parity is a query, not a pass.** A label with art in every style is
`count(tile_images) = count(tilesets)`, which is `Nebulith.ParityIsAQueryTest`. It used to be a
reconciliation pass over the whole catalog, and it had to be, because every fact was stored once per
style and could disagree.

That is why a tile's settings live on the TILE ROW and never in a frontend factory. A value the
frontend invents does not save, does not round-trip, and cannot be edited.

## 2. Where the picture comes from

```
priv/tilegen/tiles.json     what the tile looks like, authored
        ↓  node bake.mjs  (from priv/tilegen)
priv/static/tiles/<style>/<label>.png     a transparent 128x128 PNG
        ↓  TileSource seeds it as a tile_images row for that style
tiles (the label and its facts) + tile_images (one picture per style)
```

Four rules that come out of that pipeline:

* **`tiles.json` is the only place a glyph lives.** The character a picture is rasterised from is
  authoring input for the bake, and nothing else reads it: `tiles` has no glyph column and never will
  (`docs/SPEC.md` §9.2, *"Glyph. DELETED. A tile is an image"*). The seeder used to carry its own copy
  of the character beside each tile it wrote, 318 of them, every one silently dropped by the changeset.
  Two of those copies had already drifted from the manifest that does the baking: `wood-log` said `▬`
  while the PNG was drawn from `▭`, and `decor_ripple` said `~` while the PNG was drawn from `⌣`.
  Nobody noticed, because nothing read them. A second copy of a fact does not stay a copy.

* **Bake incrementally.** `node bake.mjs --only=meadow,water` restricts the run to the named labels.
  The glyph rasteriser depends on the fonts installed on the baking machine, so a full re-bake on a
  different machine silently re-renders all four hundred existing PNGs. Each atlas cell is
  independent, so `--only` output is byte-for-byte what a full run would produce.
* **Never `image_url: nil` with a raw character.** A tile with no picture renders as the missing
  glyph box on any machine whose fonts differ. A tile is an IMAGE.
* **A missing tile is authored, not reported.** "No art in the frontend" says WHERE art lives, it is
  not permission to leave a gap. The bake pipeline is how the gap is closed.

## 3. Colour: the art carries the TONE, the setting moves the HUE

This is the rule that decides whether a family reads as one material.

A tile's colour setting shifts its HUE. It does not and must not change its luminance. Two tiles of
one material whose art is drawn at different luminance will read as two materials however carefully
they are tinted, because the eye separates by tone first. Measured: a river's three bands carried one
colour and spanned luminance 194.7 to 91.2, and read as three different substances.

So: **draw a family's art at one luminance, and let the colour do the rest.**

### Where a tile's colour comes from

| Column | Holds |
|---|---|
| `color_role` | a dotted path into the zone palette, e.g. `canopy`, `building.roof`, `feature.peak` |
| `settings.colors[zone]` | the shades that role resolves to for that season, as an array |

`TileSource.per_zone_colors/2` walks every palette in `priv/repo/tilesets/ascii.json`, resolves the
role's path, and writes the result onto the row. The roles in use today are `canopy`, `trunk`,
`weapon`, `building.door/roof/wall/window` and `feature.mountain/peak/spill`.

An ARRAY, not one colour, because per-cell variance is what stops a stand of trees reading as one
painted mass. The placer picks an index (`variant`) and the same index means the same shade.

### The three axes a placed colour goes through

`assets/game/engine/foliageColor.ts` holds the arithmetic and the reasoning. In short:

| axis | owns | from |
|---|---|---|
| SEASON | the tone, and the per-cell variance | the served shade array, indexed by `variant` |
| BIOME | the hue and saturation identity, and how much the season moves it at all | the generator's `palette.leaf` + `leafSeasonality` |
| REGION | a small local shift, light and damp | the sub-zone's `leafHue` / `leafValue`, at most six degrees |

`leafSeasonality` is the one that makes this correct rather than merely colourful. At 1.0 (woodland,
fully deciduous) the served shade reaches the cell unchanged, so an autumn wood turns orange. At 0.05
(jungle, evergreen) every shade collapses onto the biome hue, so an autumn jungle does not.

That number also decides whether a colour on the map can be traced back to the shade it came from. At
1.0 it can, exactly. Any test that reads a placed colour and reasons about which shade produced it
must say which biome it is standing in and why the answer is unambiguous there.

## 4. A role may hold shades that only part of the family may reach

Spring's canopy is three greens and a blossom. The crown may wear the blossom. What grows underneath
it must not, because a bush does not flower because the tree above it does.

The palette states the two separately (`palettes.spring.canopy` and `palettes.spring.blossom`) and
`shades_for/3` joins them, blossom last, for role `canopy`. `settings.leafShades[zone]` then says how
many of the entries are leaf.

* A crown reads the whole array: `canopyShade(tileset, zone, variant)`.
* Anything growing under it reads the leaves alone: `leafShade(tileset, zone, variant)`.

**Where the shades stop being leaves is SERVED, never derived.** A renderer that decided which of the
database's colours are flowers by looking at them would be the frontend judging backend data, and it
would be wrong the first time a season's blossom was not pink.

Pass the variant to `leafShade` RAW. Folding it over the full shade count first wraps spring's four
into three and hands the first green twice the share of the thicket.

## 5. Autotile families

A family is a base label and nine pieces: four corners, four edges, a centre, spelled `<base>_tl`,
`<base>_t`, `<base>_c` and so on. Which piece a cell takes is decided entirely by which of its sides
face outward. `Nebulith.Catalog.Autotile.suffix/4` is the one place that decides it; `piece/5` spells
the label. It was written twice as two `cond` blocks in two modules before that, which is one rule and
two places for it to drift.

Compositions are built FROM these pieces, not from one tile bent with a scale. A fountain is
`water_c` plus its rim edges and corners plus jets. Before extruding a tile into a shape, check its
alpha: a 31% transparent margin extruded is an open crate, not a solid one.

## 6. The seeder's ordering trap

`TileSource.seed/0` is a sequence of passes, and several of them WRITE the data that later passes read.
A rule that filters on a column a later pass fills will under-apply, and it does it silently, because
an UPDATE matching fewer rows than expected is not an error.

Measured: `state_where_leaves_end/0` selects `WHERE color_role = 'canopy' AND settings ? 'colors'`. At
its first position it reached 25 of the 34 canopy rows. `normalize_label_colors/0`, further down, is
what gives the nine-slice canopy its `colors` in the first place, so those nine were skipped and kept a
blossom the undergrowth could then pick. Moved after it: 34 of 34.

**So: a pass that stamps a fact derived from a column belongs AFTER every pass that can write that
column.** When adding one, say in a comment which pass it must follow and why.

## 7. The checklist

Walk it item by item. State the evidence for each, and say plainly which ones could not be verified.

1. **Which framework is this?** Say so. Tile art is this document. Water is `WATER.md`. Objects are
   `OBJECT-CONSTRUCTION.md`. Generation is `SPEC.md` §3.3.
2. **Is the change in the backend?** Tile data is Elixir writing Postgres. A tile value set in the
   frontend is a defect regardless of how it looks.
3. **Does the label already exist?** Grep the seeders AND the tests. One label change broke six exact
   string sites last time, two of them in tests, and one NARROWED rather than failing.
4. **Is the art one luminance across the family?** Measure it, do not eyeball it. See §3.
5. **Does every member of the family carry the change?** A family is every piece, every season, every
   style. Build the sheet that renders all of them at a size you can judge, and look at it. "I fixed
   the trees" after looking at one tree is how the other fourteen get reported back.
6. **Did the seeder actually run, and does the API serve the new value?** Editing a seeder is not
   changing the database. Run it, then read the field back. `upsert_tile` replaces the WHOLE settings
   map, so seed order silently erases.
7. **If a pass derives from a column, does it run after every pass that writes that column?** §6.
8. **Is there a test that FAILS on the old code?** Both layers: a `mix test` gate on the data, and a
   `bin/e2e` scenario that drives the real page and reads what the app actually holds. A gate that
   cannot fail is decoration. `docs/TESTING.md` has the framework.
9. **Have the docs that describe this been checked against the code in the SAME turn?** They go stale.
   When they disagree, find out which is right and fix the other now.
10. **The verdict is his, at :3000.** A green suite and a headless render are not "done" for anything
    visual.

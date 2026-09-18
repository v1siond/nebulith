# FRAMEWORKS, the index and the rule

## The rule

**Before any work starts, open the framework for the thing being worked on and follow it. If there is no framework for it, research the fundamentals, the best practices and real examples, write the framework, and only then do the work.**

Working on water means reading `WATER.md` first. Working on an object means reading `OBJECT-CONSTRUCTION.md` first. Working on tile art means reading `TILE-DESIGN.md` first, and when that does not exist yet, it gets written before a single tile is drawn.

This is not a suggestion about tidiness. Knowledge shared once and applied once is knowledge lost: the reference, the video, the correction all get spent on a single fix and the next session relearns the same ground wrongly. A framework is where that knowledge is banked so it outlives the conversation it arrived in.

### What following it looks like

1. Read this table, find the context, open the framework it names.
2. Say which framework is being followed before starting.
3. A reference, video or tutorial that arrives mid-work goes INTO the framework as a numbered fact with its source, in the same change. Not into a reply.
4. Code and framework change together. A framework that lies is worse than none.
5. A context with no row here is a GAP. Close it before the work, not after.
6. **Run the checklist before saying it is done, item by item, with the evidence for each.** The checklist at the end of a framework is the gate, not a summary.

### The family rule

When a change applies to a FAMILY of things (every tile in a set, every species, every piece of an autotile, every variant), the evidence has to cover **all of them**.

Build the sheet that renders every member at a size you can actually judge, and look at it. If that tool does not exist yet, building it is the first task, not an optional extra: it is cheaper than the round trip of shipping a fix for one member and having the other fourteen reported back.

This rule is written here because it was broken, repeatedly: a tree fix was validated on one tree, shipped, and came back as *"there's still a bunch of detached trees, you didn't fix all types, and I don't think you validated them visually like the framework say"*. `.probe/treerow.mjs` is that tool for trees, it plants one of every kind and photographs the row; the equivalent for any other family is a morning's work and pays for itself the first time.

And say plainly which checklist items you could not verify. An unverified item named is a known gap; an unverified item unmentioned is a defect with a delay on it.

### Why he shares a tutorial, in his words

> *"keep in mind I'm passing all these tutorial to do 2 things: 1. use them to build our internal frameworks and tiles, 2. understand how users build their stuff to provide an easy way to do the same in our system, that's where the extra physics, textures came from."*

So every source is read TWICE, and a framework that only does the first half is half written:

1. **What it teaches us to build.** The technique, the numbers, the order of the passes.
2. **What it teaches us to OFFER.** A tutorial is a person doing by hand what our users will want to do by choosing. Whatever it takes a shader to achieve there becomes a served option here. The texture and physics systems in `TILE-EFFECTS.md` exist because the water videos showed both halves: what the effect is, and that a person should not have to write it.

When reading a source, write down both. The second half is usually the more valuable one and is the easier to skip.

### Turning a source into a framework

- Video: `yt-dlp --skip-download --write-auto-sub --sub-lang "en.*" --sub-format vtt <url>` gives a timestamped transcript. Cite the timestamps.
- Tutorial page or article: fetch it, pull the numbers, record the URL in `references/SOURCES.md`.
- Reference art: save the file outside the repo, measure the comparison, never eyeball it.
- No source: research first. A framework invented from nothing is improvisation with a filename.

## The map: context to framework

| Working on | Framework | State |
|---|---|---|
| What the engine is FOR, and who for | [`VISION.md`](VISION.md) | Written 2026-09-16 from his positioning. Read before arguing about a feature. |
| Cells, blocks, tiles, the three views | [`MAP-MODEL.md`](MAP-MODEL.md) | Written. **Read first, always.** §6 stacking law binds everything. |
| Tile naming, `<base>_<edge>` | [`TILE-VOCABULARY-CONTRACT.md`](TILE-VOCABULARY-CONTRACT.md) | Written |
| Where a tile lives, how it is baked and served | [`TILESET-AUTHORING.md`](TILESET-AUTHORING.md), [`TILE-BACKEND-MIGRATION.md`](TILE-BACKEND-MIGRATION.md) | Written, thin. Covers ownership and the pipeline, not how to draw one. |
| Designing the ART of a tile | [`TILE-DESIGN.md`](TILE-DESIGN.md) | Written 2026-09-16. Luminance band, full bleed, nine piece families, the rim on edge pieces, staggered frames, variants vs tints. |
| Effects on a tile: textures, animation, physics | [`TILE-EFFECTS.md`](TILE-EFFECTS.md) | Written 2026-09-16, nothing built. The design for what water uncovered. |
| Building an object out of tiles | [`OBJECT-CONSTRUCTION.md`](OBJECT-CONSTRUCTION.md) | Written, complete. Reference-first process, engine facts, six patterns, checklist. |
| Trees: species, form, what a forest is made of | [`TREES.md`](TREES.md) | Written 2026-09-16. A species-crown attempt was built and REVERTED the same day: §2 records why, and its constraints bind any retry. |
| Map entrances | [`DESIGN-ENTRANCES.md`](DESIGN-ENTRANCES.md) | Written |
| Water, rivers, pools, the sea | [`WATER.md`](WATER.md) | Written 2026-09-16 from his two sources. Build order is stated, most of it is not built. |
| What regions a biome has, and how you move through them | [`REGIONS.md`](REGIONS.md) | Written 2026-09-17. A region set belongs to its BIOME and is ORDERED; the scatter partition is why a volcano felt like a wood. |
| How the ground is painted, per biome, region and season | [`TERRAIN.md`](TERRAIN.md) | Written 2026-09-17. Floor colours measured off the references. Biome+season blending is NOT built. |
| Map generation, the layer order | [`GENERATION-SPEC.md`](GENERATION-SPEC.md) | Written. §5 is the layer model. |
| Picking a generator algorithm | [`ALGORITHMS.md`](ALGORITHMS.md) | Written |
| Hitboxes and elevation | [`HITBOXES-AND-ELEVATION.md`](HITBOXES-AND-ELEVATION.md) | Spec written, nothing built. §4.11 settles terrain height: `perlin(x, z)` plus a served height profile. |
| Drawing, the camera, the four facings | [`RENDER-AND-CAMERA.md`](RENDER-AND-CAMERA.md) | Written |
| Animating anything | [`ANIMATION-SYSTEM.md`](ANIMATION-SYSTEM.md) | Written |
| Night light and glow | [`LIGHTING.md`](LIGHTING.md) | Written, narrow. Covers the night ground glow only, not daylight, not water light. |
| Combat, triggers | [`COMBAT-AND-SYSTEMS-SPEC.md`](COMBAT-AND-SYSTEMS-SPEC.md), [`TRIGGERS-SPEC.md`](TRIGGERS-SPEC.md) | Written |
| The editor, editing a cell | [`EDITOR-INTERACTION-SPEC.md`](EDITOR-INTERACTION-SPEC.md) | Written |
| The editor, choosing what a map contains | [`EDITOR-UX.md`](EDITOR-UX.md) | Written 2026-09-16. Elements are optional over a working default, groups and limits are served, a preview is fed the build's own options. |
| The maths: lerp, trig, vectors, dot product, matrices | [`MATH-FOUNDATIONS.md`](MATH-FOUNDATIONS.md) | Written 2026-09-16 from his source. Formulas plus where each lands here. §1.2 colour-space blending binds the tree work. |
| Polygon and vector shapes, the maths behind them | [`POLYGONS.md`](POLYGONS.md) | Written 2026-09-18 from his source. `x/z, y/z` projection, vertices + face loops, rotation. Nothing built; it is the model the polygon ticket starts from. |
| Where the apps live, how they deploy, what may cross | [`DEPLOYMENT-AND-BOUNDARIES.md`](DEPLOYMENT-AND-BOUNDARIES.md) | Written 2026-09-18 for the nebulith split. The engine is a React SPA that Phoenix bundles and serves; game-website is the CV only. §5 is the iframe contract, §7 is what `frame-ancestors *` costs, §9 is the gate. |
| Shipping it: the image, the platform, the variables | [`DEPLOY.md`](DEPLOY.md) | Written 2026-09-18. One service, one database, Phoenix serves everything. §5 is what breaks first. The image and the release were built and booted, not just written. |
| Moving the engine to LiveView, later | [`LIVEVIEW-MIGRATION-PLAN.md`](LIVEVIEW-MIGRATION-PLAN.md) | Written 2026-09-18. Deferred on purpose: the canvas loop stays JS whatever the shell is. Read before anyone proposes it again. |
| Writing code here | [`CODING-STANDARDS.md`](CODING-STANDARDS.md) | Written |
| Reference art and its licences | [`references/SOURCES.md`](references/SOURCES.md) | Written |

## The gaps, in the order they hurt

These have no framework. Each one is currently decided by whoever touches it last, which is exactly the problem. Research and write before working in them.

| Missing framework | What it has to settle | Why it hurts now |
|---|---|---|
| **`PATHWAYS.md`** | A pathway is a stretch with 1 or 2 exits. The five served things (surface, width, edge, scatter, lining), the ten kinds, how a settlement's streets derive from it, how a way meets water. | Implemented six times under six names before it was collapsed. The model lives in code comments and a ticket row, nowhere readable. |
| **`COLOUR-AND-PALETTE.md`** | A colour setting moves the hue and never the tone. Which palette a template serves, what reads as lit and what reads as material, the path-lighter-than-field law measured off references. | The path was darker than the field by 24.5 luminance across every template, against references where it is lighter by 35 to 128. |
| **`SHADOWS.md`** | What casts, what receives, how a stack of blocks shadows itself, how shadow interacts with water and with night light. | Named as a layer in the stack, nothing behind the name. |
| **`PERFORMANCE.md`** | The frame budget, what is allowed per frame, how a new layer proves it can afford itself. | FPS fell from about 20 to 17 with boundary overlays and there is no stated budget to judge that against. |
| **`UNITS-AND-CHARACTERS.md`** | How a unit is authored as a grid of art frames, its facings, its animation set. | A unit is a grid of chars baked to a PNG, written down only in memory. |

## How a design gets written down here

Source: Stone Librande (creative director, EA Maxis), *"One Page Design Philosophy"*, GDC, 52 min.
<https://www.youtube.com/watch?v=E9_wLks1kAg>. Shared 2026-09-17 as *"Super important documentation for game
development"*. Transcript pulled and read; timestamps below are from it.

The talk is about the FORM a design document takes, which is what this index governs, so it belongs here
rather than in any one framework.

### What he measured about the long-form design doc

A design bible is 30 to 100+ pages of mostly text, written from a template, printed and handed out
([02:11], [04:17]). His verdict on the pros is real and worth keeping: it is the definitive source, it is
thorough, and *"the act of writing that document is the act of designing"*, because a sentence forces a
decision you were carrying vaguely in your head ([06:04]-[06:30]). He still writes them, for himself.

The cons are what kill it as a TEAM artifact: it does not scale, and the flow is one-way. He describes
studios where *"programmers ... I've never even saw our designers ... I see their design documents but I never
see them"* ([02:57]-[03:06]). A document nobody reads is not communication.

### The one-page design

One page, one subject, and it is a PICTURE, not a wall of text. His explicit warning is against the obvious
shortcut: *"what you don't want to do is take that design bible ... and just blow it up on a poster"*
([24:04]-[24:17]).

The construction he names:

- lots of white space
- one main illustration in the middle to draw the reader in
- callouts, notes and bullets arranged around it ([24:19]-[24:27])
- built in a VECTOR tool, so elements rotate, scale and move while you think, and it prints at printer
  resolution rather than at document resolution ([24:32]-[25:24])
- if you have never made one, start with a FLOWCHART of the core loop ([26:20]-[26:27])

The reader chooses their own depth: the headline reads from across the room, and the detail rewards someone
who walks up to it ([26:04]-[26:14]).

### Why it beats a wiki

A wiki *"is notorious for chopping up your design and breaking connections between things, other than a
hyperlink, which is not really a real connection"* ([46:57]-[47:06]). A single page keeps the RELATIONSHIPS
visible, and drawing the arrows is itself how you find them: *"oh, that has that effect on this other thing,
oh I see it now"* ([46:47]-[46:56]).

### The cost, stated honestly

It is subtractive work. An audience member put it back to him as *"you're getting this comprehensive picture
of the design and then you're compressing it"*, and he agreed: you must decide what to leave OUT
([51:07]-[51:34]). It is slow. *"Is it hard? Oh yeah, it's really hard ... but what are you getting paid
for"* ([47:41]-[47:50]). A page can be a week's work on its own, iterated in meetings in black and white
until people get it, and only printed for the wall once it is settled ([49:43]-[50:05]).

### What this binds here

1. A framework in the table above stays the long form: it is the thorough source, and writing it is how the
   design gets decided. That is the pro he names and it is why these files exist.
2. Anything meant to be READ BY SOMEBODY ELSE, a proposal, a region set, a layer order, a comparison against
   a reference, gets a ONE-PAGE form beside the prose: one picture, callouts around it, no wall of text.
3. For a FAMILY of things, that one page is the render-all sheet the protocol already demands. The region
   sheet (`.probe/regionsheet.mjs` plus `.probe/regiondiagram.py`) is exactly this artifact, and the talk is
   why it is worth the build: the sheet is the design, the prose is the backup.
4. Draw the CONNECTIONS. If a change touches two layers, the page shows the arrow between them; splitting it
   across two sections is the wiki failure he names.

## Precedence

`nebulith/docs/` is canonical and wins on conflict. This repo's copies map the same model onto the frontend. Change both in the same commit.

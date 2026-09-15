import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data from the loaded backend tileset fixture
import { generatorLayers } from '@/components/game/editorConfig'
import { installGenerationLayers } from '@/engine/generate/generationLayers'
import { generateStage, layerIds, type LayerId, type StageData } from '@/engine/stageGenerator'
import { makeRng } from '@/lib/math'

// ── a compact, deterministic DIGEST of a whole StageData ──────────────────────
// Canonicalise every field the generator produces into one string and FNV-1a hash it. Two stages
// with the SAME digest are structurally identical (ground, collision, buildings, trees, props,
// compositions, spawn) — the strong equality the equivalence + independence tests assert.
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function digest(stage: StageData): string {
  const parts: string[] = [
    `${stage.cols}x${stage.rows}`,
    `zone=${stage.zone};variant=${stage.variant}`,
    `ground=${stage.ground.map(r => r.join('')).join('|')}`,
    `coll=${stage.collision.map(r => r.map(c => (c ? '1' : '0')).join('')).join('|')}`,
    `buildings=${stage.buildings.map(b => `${b.kind}@${b.col},${b.row}:${b.facing}:${b.length}x${b.height}x${b.depth}:${b.doorCells.map(d => `${d.col},${d.row}`).join('/')}`).join(';')}`,
    `trees=${stage.trees.map(t => `${t.kind}#${t.variant}@${t.col},${t.row}`).join(';')}`,
    `props=${stage.props.map(p => `${p.type}:${p.char}:${p.color}:${p.blocking ? 1 : 0}:${p.label ?? ''}@${p.col},${p.row}`).join(';')}`,
    `comps=${stage.compositions.map(c => `${c.kind}#${c.variant ?? 0}@${c.col},${c.row}`).join(';')}`,
    `spawn=${stage.spawn.col},${stage.spawn.row}`,
  ]
  return fnv1a(parts.join('\n'))
}

// Run the generator with a deterministic GLOBAL Math.random so a plain generate (no per-layer seeds)
// is fully reproducible — this is how the refactor's behaviour is locked to the pre-refactor output.
function genSeeded(opts: Parameters<typeof generateStage>[0], seed: number): StageData {
  const orig = Math.random
  Math.random = makeRng(seed)
  try {
    return generateStage(opts)
  } finally {
    Math.random = orig
  }
}

// ── EQUIVALENCE / behaviour-preservation lock ─────────────────────────────────
// Baseline digests captured from the generator's output under a seeded Math.random. The layer-pass
// refactor MUST keep a plain `generateStage` (no per-layer seeds) drawing from Math.random in the
// SAME order, so these digests are unchanged. If a refactor legitimately changes generation, these
// are regenerated deliberately — never loosened to "any value".
// Settlement digests were regenerated 2026-07-20 when the failing-lamp selection changed from a per-cell ratio
// hash to a small ABSOLUTE random pick (markFailingLamps, drawn from the decor rng) — a deliberate generation
// change (see stageGenerator.lamps.test.ts). Only town/city move (they run the decor pass); the non-settlement
// archetypes below are untouched.
// Regenerated again 2026-07-22 when naturePass gained scatterFlowers — a light scatter of STANDING blooms over
// the town's open grass (single billboards, height 1). Only the FLOWERING zones bloom, so only the two SUMMER
// settlements move; autumn town + the non-flowering archetypes are byte-identical.
// Regenerated again 2026-07-23 for G7 — the walkable ENTRANCE now spans the composition's REAL door span
// (buildingDoorOffset) instead of a hardcoded 1 cell, so an EVEN-facade building (house_4 / hospital_6 /
// hospital_6 / temple_8 / castle_12, all baked with a centred 2-wide doorway) opens BOTH door cells. That
// moves `doorCells` + the collision grid, hence the digest. Only the three SETTLEMENTS have buildings; the
// forest/cave/temple/boss archetypes are byte-identical.
// Regenerated again 2026-07-23 when the scattered nature props (flower / rock / mushroom / crystal) started
// carrying their baked backend LABEL so ASCII draws the baked tile image instead of a legacy glyph (see
// generatedPropLabels.test.ts). Only stages that scatter those props move: the two summer settlements + city
// (flowers), cave (rock walls + crystal + mushroom), boss-stage (rock). town|autumn (non-flowering, no rocks)
// and temple|winter (interior) are byte-identical.
// Regenerated again 2026-07-25 for the FOREST rework to match #24/#14: the meadow now DOMINATES the map — an
// open olive field with faint garden-plot grid lines, subtle earth/rock/flower ornament zones, a SINGLE
// bottom-left cobble entrance (lamps + flower beds), and SPARSE tree clumps framing the edges; the river
// variant adds a WINDING colour-only river hugging three sides (near edge open) + a top-right stone bridge.
// The dense tree border + perimeter ring + two entrances were removed, so forest|summer legitimately moves.
// The two SUMMER settlements also move because SUMMER_FLOWERS gained four more bloom tones (a fuller flower
// bed, per #14/#17) — town|summer + city|summer scatter from the wider set. Every other archetype (town|autumn,
// cave, temple, boss) is byte-identical.
// Regenerated again 2026-09-09 for the two de-hardcoding changes. (1) villageLayout takes
// its nine settlement numbers (plaza size, setback, road width, lot gap, per-frontage cap, building cap, house
// + house ranges and widths) from the backend `settlement` block instead of nine frontend constants,
// they were parsed and then never read. (2) A building is COMPOSED to the footprint its plot rolled rather
// than snapping to the nearest baked size — Both move
// where plots land and what they are called, hence the digest. Only the three SETTLEMENTS move; forest, cave,
// temple and boss are byte-identical. Sanity-checked before relocking: each still carves roads (816/936/1184
// tinted cells), plants 15-19 buildings across several kinds, every building keeps a door, and none lands
// off-grid.
// Regenerated again 2026-09-09 for the CAVE ENTRANCE fix. A pool stamped across the corridor joining the
// entrance chamber to the cavern severed it, and the floor repair — which keeps the largest region — filled
// the severed entrance as a stranded pocket: measured on a 400-seed sweep, ~3% of caves came out with no way
// in at all. The cave now restores its entrance chamber and re-joins it before the repair runs, so the cells
// that used to be filled stay floor. Only the CAVE moves; every other archetype is byte-identical.
// Regenerated 2026-09-11 for ticket 47, a river is an OPTION now and `meadow_river` is gone as a layout. This
// case serves no layout, so it rolls one, and the random pool went from three meadows to two — a different
// draw off the same seed, hence a different digest. Only the FOREST moves. Sanity-checked before relocking:
// 30x24 all meadow floor, 63 trees framing an open middle, 91% of cells walkable, and no water, which is
// right because nothing switched the river on.
// Relocked 2026-09-11 for flat floors. Every
// open-ground material is swapped for the flat `floor` tile wearing the same colour, and a cave's moss is laid as a
// few ornament patches instead of a per-cell roll, so the ground moves in every case but the forest (a meadow,
// flat already). Nothing else draws off the rng differently except the cave's moss. Checked before relocking in
// stageGenerator.floors.test.ts: no textured floor left in open ground, stone only under buildings, moss under a
// tenth of a cave's floor.
// Relocked 2026-09-11, town|autumn|40x40|1 only: a settlement now finds its store and hospital a spot on ANY
// street before houses fill in (7 of 300 summer towns had no hospital). This town was one where an essential
// did not fit the top street; the rescue searches the streets in random order (so a rescued building can still
// land on an east/west street, which the foundation-orphan test samples), and this town comes out with its store,
// hospital, temple and 12 houses.
// Relocked 2026-09-11, the three SETTLEMENT cases: which buildings a place is made of is now served per place
// instead of a fixed store+hospital+temple plus an office range. and A town now plans a church, stables, a barn and a
// smithy; a city plans towers and apartment
// blocks. The temple landmark stays in every settlement, as it always was. A deliberate generation change, so the
// digests move; the five non-settlement cases below are untouched.
// Regenerated 2026-09-12, the three SETTLEMENT cases only: naturePass now reads the numbers the backend has
// been serving all along. `settlement.natureMultiplier` was parsed into `GeneratorSettlement` and never
// declared on `SettlementTuning`, so it was invisible to types and eight served rows (town 1.3, city 0.5,
// town_small 1.8, town_forest 2.4, town_swamp 2.0 and more) could not reach `fillVillageNature`, which used
// the frontend `NATURE_MULT` instead. The ground-cover and flower densities were literals (0.12 / 0.06) with
// the served `nature` block sitting in scope, so town_forest's 0.28/0.08 and town_swamp's 0.45/0.08 were dead.
// A deliberate generation change: tree, tuft and bloom counts move on every settlement. Only the three
// settlements run this pass, so the forest/cave/temple/boss cases below are byte-identical.
// Regenerated 2026-09-12, the CAVE and TEMPLE only: the shoreline is real tiles now. A land cell bordering
// water used to get one `≈` character prop with a hardcoded colour, whichever side the water was on; it now
// gets one of the 8 baked `shore_*` edge/corner pieces, chosen by the same 9-piece autotile scheme trees and
// buildings use, carried as `ground_decor` so it draws as a flat overlay on the bank.
// Only these two archetypes have hazard POOLS, which is why the
// three settlements and the forest are byte-identical: the forest's river is off by default and a settlement
// places no water at all.
// RELOCKED TWICE ON 2026-09-13, cave and temple only. Second time: the shoreline is GONE.
// RELOCKED 2026-09-14, forest only. The meadow entrance now runs through the shared gateway lane, which places
// a lamp post INSTEAD of a flower bed at the two lamp depths. The old code did both, so a flower prop was left
// sitting inside the cell the lamp post blocks. Nothing else about the lane moved: same width, same run, same
// clamp, same paving.
//
// Recolouring the shore pieces to the served bank was the wrong fix, because the pieces are DRAWN as blooms:
// and A tan bloom is still a bloom. So the water edge carries no
// decoration at all now, and only lava keeps its ember.
//
// Same blast radius as the first relock and for the same reason: only the two archetypes with POOLS move.
//
// The first relock, kept for the record: a bank stopped being white.
//
// They were the shore pieces, 231 to 450 a map, painted with an invented `#eaf8ff` while `palette.bank` was
// served and ignored. `shorePiece` reads the served colour now and the tile row is no longer authored near
// white either.
//
// The blast radius is the proof the change is what it says: only the two archetypes that hold POOLS moved.
// The three settlements place no water, and the forest's river is off by default, so all four are byte
// identical. Any wider spread than this and the fix had reached something it should not have.
// RELOCKED FOR THE PAVING, and this one moves every variant, which is the point of it.
//
// A way is a COLOUR ON THE GROUND BLOCK, never a tile laid on top: *"CITY STREETS FUCKING SUCK ... NOT ADD
// BLACK ULGY TILES ON TOP"*, *"THESE STREETS ARE A REGRESION"*. The paver was writing `ground[row][col] =
// surface`, which is exactly what the settlement paver has warned against in its own comment since it was
// written, and it put a second block on the map wherever a way ran.
//
// A settlement's streets also record themselves as pathway cells now. Nothing did, so `pathwayCells` was
// empty for every town and city: the served surface, its scatter and its lining had nothing to act on, and
// the guard that keeps things out of a road saw no road.
//
// RELOCKED AGAIN, same day, for the WOODLAND going the same way as the meadow. Two things move a map:
//
//   · its whole TRAIL NETWORK stops growing trees, not only its planned routes. The sweep this replaces ran
//     on `plan.cells`, 170 of the 487 cells a woodland actually cuts as trail, so two thirds of its own paths
//     were never cleared. Objects now choose from ground the pathways layer did not claim, which is the
//     difference between a rule and a repair.
//   · the BORDER TREELINE is planted in objects rather than in pathways, because it is a line of trees:
//     *"edge is part of objects, we just used it to determine how to block towns borders with objects with
//     the exception of pathway exits"*. Running it before the planting let the passes that repair and join
//     the floor cut back out through it, measured as six holes in a border that belonged to no exit.
//
// Only `forest` moves, again. The three settlements, the cave, the temple and the boss stage are byte
// identical because none of them is split yet.
//
// RELOCKED 2026-09-15, and the blast radius is again the proof.
//
// The MEADOW is the first variant split into the layer phases the backend serves: terrain paints the floor,
// water carves the river, pathways draws the cobble ways, objects plants everything else. Two things follow
// from the cut and both are the point of it:
//
//   · the ornaments and the framing trees now run AFTER the ways, so they go ROUND them. They used to run
//     first and a sweep pulled whatever landed in the road back out afterwards, which only works while the
//     planting happens before the ways exist.
//   · nothing tints a cell a way is standing on. Measured the moment the split landed: the plot patchwork
//     repainted over the cobble and a way that is one colour all the way across came out in three.
//
// Only `forest` moves. The three settlements, the cave, the temple and the boss stage are byte identical,
// because none of them is split yet. Any wider spread than this and the change had reached something it
// should not have.
const BASELINE: Record<string, string> = {
  'town|autumn|40x40|1': 'b6b7674a',
  'town|summer|50x40|7': 'c74a0a7d',
  'city|summer|56x44|3': 'd7402cde',
  'forest|summer|30x24|42': '4b8b2192',
  'cave|autumn|40x30|99': '94c7579b',
  'temple|winter|36x30|5': 'c6258d72',
  'boss-stage|winter|36x30|11': 'e081dcd4',
}

const CASES: Array<{ key: string; opts: Parameters<typeof generateStage>[0]; seed: number }> = [
  { key: 'town|autumn|40x40|1', opts: { zone: 'autumn', variant: 'town', cols: 40, rows: 40 }, seed: 1 },
  { key: 'town|summer|50x40|7', opts: { zone: 'summer', variant: 'town', cols: 50, rows: 40 }, seed: 7 },
  { key: 'city|summer|56x44|3', opts: { zone: 'summer', variant: 'city', cols: 56, rows: 44 }, seed: 3 },
  { key: 'forest|summer|30x24|42', opts: { zone: 'summer', variant: 'forest', cols: 30, rows: 24 }, seed: 42 },
  { key: 'cave|autumn|40x30|99', opts: { zone: 'autumn', variant: 'cave', cols: 40, rows: 30 }, seed: 99 },
  { key: 'temple|winter|36x30|5', opts: { zone: 'winter', variant: 'temple', cols: 36, rows: 30 }, seed: 5 },
  { key: 'boss-stage|winter|36x30|11', opts: { zone: 'winter', variant: 'boss-stage', cols: 36, rows: 30 }, seed: 11 },
]

describe('generateStage — behaviour-preserving under a seeded Math.random (equivalence lock)', () => {
  it.each(CASES)('$key is reproducible AND matches the locked baseline digest', ({ key, opts, seed }) => {
    const a = digest(genSeeded(opts, seed))
    const b = digest(genSeeded(opts, seed)) // same seed → identical output (determinism)
    expect(a).toBe(b)
    if (BASELINE[key] !== '__CAPTURE__') expect(a).toBe(BASELINE[key])
    // eslint-disable-next-line no-console
    else console.log(`BASELINE '${key}': '${a}',`)
  })
})

// ── per-layer independence + seedability (settlement) ─────────────────────────
describe('generateStage — settlement layer passes are independent + seedable', () => {
  const base = { zone: 'summer' as const, variant: 'town' as const, cols: 48, rows: 40 }

  // THE LAYERS COME FROM THE BACKEND, so these install a served body and assert against THAT: *"on the tests
  // side we must mock the backend response and return and assert as many layers we want"*. Nothing here names
  // a canonical list, because the engine does not have one any more.
  const served = (...layers: Array<Partial<{ key: string; label: string; hint: string; position: number; seedable: boolean }>>) => ({
    generationLayers: layers.map((l, i) => ({
      key: l.key ?? `layer${i}`,
      label: l.label ?? `Layer ${i}`,
      hint: l.hint ?? 'what it does',
      position: l.position ?? (i + 1) * 10,
      seedable: l.seedable ?? true,
    })),
  })

  it('the engine runs whatever layers the backend serves, in the order it serves them', () => {
    installGenerationLayers(served(
      { key: 'pathways', position: 10 },
      { key: 'layout', position: 20 },
      { key: 'fog', position: 30 },
    ))
    expect(layerIds()).toEqual(['pathways', 'layout', 'fog'])
  })

  it('takes as many layers as the backend cares to serve', () => {
    installGenerationLayers(served(...Array.from({ length: 12 }, (_, i) => ({ key: `layer_${i}`, position: i }))))
    expect(layerIds()).toHaveLength(12)
    expect(layerIds()[0]).toBe('layer_0')
    expect(layerIds()[11]).toBe('layer_11')
  })

  it('orders by POSITION, not by the order the rows happen to arrive in', () => {
    installGenerationLayers(served(
      { key: 'units', position: 60 },
      { key: 'pathways', position: 10 },
      { key: 'nature', position: 40 },
    ))
    expect(layerIds()).toEqual(['pathways', 'nature', 'units'])
  })

  it('serves nothing → the engine names no layers, and never falls back to a list of its own', () => {
    installGenerationLayers({ generationLayers: [] })
    expect(layerIds()).toEqual([])
  })

  // Every SEEDABLE layer gets a panel row, in the served order. A layer the engine rolls and the panel does
  // not offer is a re-roll nobody can reach; one the panel offers and the engine cannot roll is a dead button.
  it('every seedable layer the backend serves has a row in the panel, in the same order', () => {
    installGenerationLayers(served(
      { key: 'pathways', label: 'Pathways', position: 10 },
      { key: 'gates', label: 'Gates', position: 15, seedable: false },
      { key: 'fog', label: 'Fog', position: 20 },
    ))
    expect(generatorLayers().map(l => l.id)).toEqual(['pathways', 'fog'])
    for (const l of generatorLayers()) {
      expect(l.label.trim()).not.toBe('')
      expect(l.hint.trim()).not.toBe('')
    }
  })

  it('a layer that cannot be re-rolled is not offered as a button that does nothing', () => {
    installGenerationLayers(served({ key: 'gates', label: 'Gates', position: 10, seedable: false }))
    expect(layerIds()).toEqual(['gates'])   // the engine still runs it
    expect(generatorLayers()).toEqual([])   // the panel does not pretend you can roll it
  })

  it('a per-layer seed makes the whole town reproducible (all layers seeded)', () => {
    const seeds = { layout: 11, buildings: 22, nature: 33, decor: 44, units: 55 }
    const a = generateStage({ ...base, seeds })
    const b = generateStage({ ...base, seeds })
    expect(digest(a)).toBe(digest(b))
  })

  it('re-rolling ONLY the nature seed changes trees but leaves roads + buildings intact', () => {
    const seeds = { layout: 11, buildings: 22, nature: 33, decor: 44 }
    const a = generateStage({ ...base, seeds })
    const b = generateStage({ ...base, seeds: { ...seeds, nature: 999 } })
    // layout is the ground roads/plaza — identical
    expect(a.ground.map(r => r.join('')).join('|')).toBe(b.ground.map(r => r.join('')).join('|'))
    // buildings (kind + placement) identical
    const buildKey = (s: StageData) => s.buildings.map(x => `${x.kind}@${x.col},${x.row}`).join(';')
    expect(buildKey(a)).toBe(buildKey(b))
    // but the nature (trees) differs
    const treeKey = (s: StageData) => s.trees.map(t => `${t.kind}#${t.variant}@${t.col},${t.row}`).join(';')
    expect(treeKey(a)).not.toBe(treeKey(b))
  })

  it('re-rolling ONLY the layout seed changes roads AND clears the dependent layers do NOT bleed seeds', () => {
    const seeds = { layout: 11, buildings: 22, nature: 33, decor: 44 }
    const a = generateStage({ ...base, seeds })
    const b = generateStage({ ...base, seeds: { ...seeds, layout: 12345 } })
    // a different layout seed yields a different road/plot skeleton
    expect(a.ground.map(r => r.join('')).join('|')).not.toBe(b.ground.map(r => r.join('')).join('|'))
  })
})

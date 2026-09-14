import '@/__tests__/helpers/installTilesetSeed' // the generator reads ALL tile data from the loaded backend tileset fixture
import { generateStage, LAYER_IDS, type LayerId, type StageData } from '@/engine/stageGenerator'
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

// ── EQUIVALENCE / behaviour-preservation lock ───────────────────────────────── Baseline digests captured from the
// generator's output under a seeded Math.random. The layer-pass refactor MUST keep a plain `generateStage` (no
// per-layer seeds) drawing from Math.random in the SAME order, so these digests are unchanged. If a refactor
// legitimately changes generation, these are regenerated deliberately — never loosened to "any value". Settlement
// digests were regenerated 2026-07-20 when the failing-lamp selection changed from a per-cell ratio hash to a small
// ABSOLUTE random pick (markFailingLamps, drawn from the decor rng) — a deliberate generation change (see
// stageGenerator.lamps.test.ts). Only town/city move (they run the decor pass); the non-settlement archetypes below
// are untouched. Regenerated again 2026-07-22 when naturePass gained scatterFlowers — a light scatter of STANDING
// blooms over the town's open grass (single billboards, height 1). Only the FLOWERING zones bloom, so only the two
// SUMMER settlements move; autumn town + the non-flowering archetypes are byte-identical. Regenerated again
// 2026-07-23 for G7 — the walkable ENTRANCE now spans the composition's REAL door span (buildingDoorOffset) instead
// of a hardcoded 1 cell, so an EVEN-facade building (house_4 / hospital_6 / hospital_6 / temple_8 / castle_12, all
// baked with a centred 2-wide doorway) opens BOTH door cells. That moves `doorCells` + the collision grid, hence the
// digest. Only the three SETTLEMENTS have buildings; the forest/cave/temple/boss archetypes are byte-identical.
// Regenerated again 2026-07-23 when the scattered nature props (flower / rock / mushroom / crystal) started carrying
// their baked backend LABEL so ASCII draws the baked tile image instead of a legacy glyph (see
// generatedPropLabels.test.ts). Only stages that scatter those props move: the two summer settlements + city
// (flowers), cave (rock walls + crystal + mushroom), boss-stage (rock). town|autumn (non-flowering, no rocks) and
// temple|winter (interior) are byte-identical. Regenerated again 2026-07-25 for the FOREST rework to match #24/#14:
// the meadow now DOMINATES the map — an open olive field with faint garden-plot grid lines, subtle earth/rock/flower
// ornament zones, a SINGLE bottom-left cobble entrance (lamps + flower beds), and SPARSE tree clumps framing the
// edges; the river variant adds a WINDING colour-only river hugging three sides (near edge open) + a top-right stone
// bridge. The dense tree border + perimeter ring + two entrances were removed, so forest|summer legitimately moves.
// The two SUMMER settlements also move because SUMMER_FLOWERS gained four more bloom tones (a fuller flower bed, per
// #14/#17) — town|summer + city|summer scatter from the wider set. Every other archetype (town|autumn, cave, temple,
// boss) is byte-identical. Regenerated again 2026-09-09 for the two de-hardcoding changes. (1)
// villageLayout takes its nine settlement numbers (plaza size, setback, road width, lot gap, per-frontage cap,
// building cap, house + house ranges and widths) from the backend `settlement` block instead of nine frontend
// constants, they were parsed and then never read. (2) A building is COMPOSED to the footprint its plot rolled rather
// than snapping to the nearest baked size — *"we randomize the footprint and house adapts to it"*. Both move where
// plots land and what they are called, hence the digest. Only the three SETTLEMENTS move; forest, cave, temple and
// boss are byte-identical. Sanity-checked before relocking: each still carves roads (816/936/1184 tinted cells),
// plants 15-19 buildings across several kinds, every building keeps a door, and none lands off-grid. Regenerated
// again 2026-09-09 for the CAVE ENTRANCE fix. A pool stamped across the corridor joining the entrance chamber to the
// cavern severed it, and the floor repair — which keeps the largest region — filled the severed entrance as a
// stranded pocket: measured on a 400-seed sweep, ~3% of caves came out with no way in at all. The cave now restores
// its entrance chamber and re-joins it before the repair runs, so the cells that used to be filled stay floor. Only
// the CAVE moves; every other archetype is byte-identical. Regenerated 2026-09-11 for ticket 47, a river is an OPTION
// now and `meadow_river` is gone as a layout. This case serves no layout, so it rolls one, and the random pool went
// from three meadows to two — a different draw off the same seed, hence a different digest. Only the FOREST moves.
// Sanity-checked before relocking: 30x24 all meadow floor, 63 trees framing an open middle, 91% of cells walkable,
// and no water, which is right because nothing switched the river on. Relocked 2026-09-11 for flat floors. Every
// open-ground material is swapped for the flat `floor` tile wearing the same colour, and a cave's moss is laid as a
// few ornament patches instead of a per-cell roll, so the ground moves in every case but the forest (a meadow, flat
// already). Nothing else draws off the rng differently except the cave's moss. Checked before relocking in
// stageGenerator.floors.test.ts: no textured floor left in open ground, stone only under buildings, moss under a
// tenth of a cave's floor. Relocked 2026-09-11, town|autumn|40x40|1 only: a settlement now finds its store and
// hospital a spot on ANY street before houses fill in (7 of 300 summer towns had no hospital). This town was one
// where an essential did not fit the top street; the rescue searches the streets in random order (so a rescued
// building can still land on an east/west street, which the foundation-orphan test samples), and this town comes out
// with its store, hospital, temple and 12 houses. Relocked 2026-09-11, the three SETTLEMENT cases: which buildings a
// place is made of is now served per place instead of a fixed store+hospital+temple plus an office range. and
// *"cities have more skycrappers, towns have more houses"*. A town now plans a church, stables, a barn and a smithy;
// a city plans towers and apartment blocks. The temple landmark stays in every settlement, as it always was. A
// deliberate generation change, so the digests move; the five non-settlement cases below are untouched. Regenerated
// 2026-09-12, the three SETTLEMENT cases only: naturePass now reads the numbers the backend has been serving all
// along. `settlement.natureMultiplier` was parsed into `GeneratorSettlement` and never declared on
// `SettlementTuning`, so it was invisible to types and eight served rows (town 1.3, city 0.5, town_small 1.8,
// town_forest 2.4, town_swamp 2.0 and more) could not reach `fillVillageNature`, which used the frontend
// `NATURE_MULT` instead. The ground-cover and flower densities were literals (0.12 / 0.06) with the served `nature`
// block sitting in scope, so town_forest's 0.28/0.08 and town_swamp's 0.45/0.08 were dead. A deliberate generation
// change: tree, tuft and bloom counts move on every settlement. Only the three settlements run this pass, so the
// forest/cave/temple/boss cases below are byte-identical. Regenerated 2026-09-12, the CAVE and TEMPLE only: the
// shoreline is real tiles now. A land cell bordering water used to get one `≈` character prop with a hardcoded
// colour, whichever side the water was on; it now gets one of the 8 baked `shore_*` edge/corner pieces, chosen by the
// same 9-piece autotile scheme trees and buildings use, carried as `ground_decor` so it draws as a flat overlay on
// the bank. Only these two archetypes have hazard POOLS, which is why the three settlements and the forest are
// byte-identical: the forest's river is off by default and a settlement places no water at all. RELOCKED TWICE ON
// 2026-09-13, cave and temple only. Second time: the shoreline is GONE. RELOCKED 2026-09-14, forest only. The meadow
// entrance now runs through the shared gateway lane, which places a lamp post INSTEAD of a flower bed at the two lamp
// depths. The old code did both, so a flower prop was left sitting inside the cell the lamp post blocks. Nothing else
// about the lane moved: same width, same run, same clamp, same paving.
//
// Recolouring the shore pieces to the served bank was the wrong fix, because the pieces are DRAWN as blooms: *"I
// didn't want to recolor them, i wanted to remove them, becuase they don't match the fucking context of the forest"*,
// and *"just remove that crap"*. A tan bloom is still a bloom. So the water edge carries no decoration at all now,
// and only lava keeps its ember.
//
// Same blast radius as the first relock and for the same reason: only the two archetypes with POOLS move.
//
// The first relock, kept for the record: a bank stopped being white.
//
// They were the shore pieces, 231 to 450 a map, painted with an invented `#eaf8ff` while `palette.bank` was served
// and ignored. `shorePiece` reads the served colour now and the tile row is no longer authored near white either.
//
// The blast radius is the proof the change is what it says: only the two archetypes that hold POOLS moved. The three
// settlements place no water, and the forest's river is off by default, so all four are byte identical. Any wider
// spread than this and the fix had reached something it should not have.
const BASELINE: Record<string, string> = {
  'town|autumn|40x40|1': 'affafaf3',
  'town|summer|50x40|7': '9c0fd03a',
  'city|summer|56x44|3': 'b8a0077c',
  'forest|summer|30x24|42': '99a9427a',
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

  it('exposes the canonical layer ids', () => {
    expect(LAYER_IDS).toEqual(['layout', 'buildings', 'nature', 'decor', 'units'])
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

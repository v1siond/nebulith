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

// ── EQUIVALENCE / behaviour-preservation lock ─────────────────────────────────
// Baseline digests captured from the generator's output under a seeded Math.random. The layer-pass
// refactor MUST keep a plain `generateStage` (no per-layer seeds) drawing from Math.random in the
// SAME order, so these digests are unchanged. If a refactor legitimately changes generation, these
// are regenerated deliberately — never loosened to "any value".
// Settlement digests were regenerated 2026-07-20 when the failing-lamp selection changed from a per-cell ratio
// hash to a small ABSOLUTE random pick (markFailingLamps, drawn from the decor rng) — a deliberate generation
// change (see stageGenerator.lamps.test.ts). Only town/city move (they run the decor pass); the non-settlement
// archetypes below are untouched.
const BASELINE: Record<string, string> = {
  'town|autumn|40x40|1': '80de66d8',
  'town|summer|50x40|7': 'ade8f497',
  'city|summer|56x44|3': 'e548bd05',
  'forest|summer|30x24|42': 'a4369e55',
  'cave|autumn|40x30|99': '4eff2d41',
  'temple|winter|36x30|5': '7b1712d1',
  'boss-stage|winter|36x30|11': '286ee6cd',
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

/**
 * THE OPTIONS PANEL'S DATA: which group an option is browsed under, and which choices a map this size can
 * actually carry.
 *
 * Both are served (`docs/EDITOR-UX.md` §2.1 and §2.3), so these test that the frontend READS them and invents
 * nothing: a generator with no groups renders as it always did, and a generator with no `maxPer` is never
 * narrowed.
 */
import { countCeiling, countChoices, optionSections, parseGeneratorCatalog, type GeneratorDef, type GeneratorOption } from '@/lib/generatorCatalog'

const opt = (over: Partial<GeneratorOption> & Pick<GeneratorOption, 'key'>): GeneratorOption => ({
  label: over.key,
  type: 'choice',
  default: 'random',
  choices: [{ key: 'random', label: 'Random' }, { key: '1', label: '1' }, { key: '2', label: '2' }, { key: '3', label: '3' }, { key: '4', label: '4' }],
  ...over,
})

const gen = (options: readonly GeneratorOption[], optionGroups?: Record<string, string>): GeneratorDef =>
  ({ key: 'g', name: 'G', description: null, layout: null, options, config: optionGroups ? { optionGroups } : {} }) as unknown as GeneratorDef

describe('an option belongs to a group', () => {
  it('sections the options in the order their groups first appear, with the served headings', () => {
    const g = gen(
      [opt({ key: 'exits', group: 'layout' }), opt({ key: 'river', group: 'water' }), opt({ key: 'pathways', group: 'layout' })],
      { layout: 'Layout', water: 'Water' },
    )
    expect(optionSections(g).map(s => [s.label, s.options.map(o => o.key)])).toEqual([
      ['Layout', ['exits', 'pathways']],
      ['Water', ['river']],
    ])
  })

  it('a generator that serves no groups renders as ONE section, exactly what the panel drew before', () => {
    const g = gen([opt({ key: 'exits' }), opt({ key: 'river' })])
    expect(optionSections(g)).toEqual([{ key: '', label: 'Options', options: g.options }])
  })

  it('shows a group whose LABEL is missing rather than hiding its controls', () => {
    // A missing label is a data gap worth seeing. Dropping the section would drop the controls with it.
    const g = gen([opt({ key: 'river', group: 'water' })], {})
    expect(optionSections(g).map(s => s.label)).toEqual(['water'])
  })

  it('has nothing to section when the generator has no options', () => {
    expect(optionSections(gen([]))).toEqual([])
    expect(optionSections(null)).toEqual([])
  })
})

describe('the limits are BUILT from the map, not trimmed from a list', () => {
  const ways = opt({ key: 'pathways', group: 'layout', countBy: 'ways', choices: [{ key: 'random', label: 'Random' }] })
  const exits = opt({
    key: 'exits',
    group: 'layout',
    countPer: { option: 'pathways', each: 2 },
    choices: [{ key: 'random', label: 'Random' }, { key: '1', label: '1: in and out the same way' }],
  })

  it('offers as many ways across as the map measures, not a hand-written four', () => {
    // The ENGINE measures it (`pathwayCeiling`) and hands it in; the list is generated up to it. Trimming a
    // list of four could only ever take choices AWAY, so a big map and a small one both topped out at four.
    expect(countChoices(ways, { cols: 60, rows: 40, ways: 6 }).map(c => c.key))
      .toEqual(['random', '1', '2', '3', '4', '5', '6'])
    expect(countChoices(ways, { cols: 20, rows: 20, ways: 2 }).map(c => c.key)).toEqual(['random', '1', '2'])
  })

  it('and as many ways OUT as it has ways across, two per stretch', () => {
    const gAll = gen([ways, exits])
    const ctx = { cols: 60, rows: 40, ways: 6, edges: 20, gen: gAll, options: { pathways: '3' } }
    expect(countCeiling(exits, ctx)).toBe(6)
    // …and the wording a bare number cannot carry survives on the choices that authored it.
    expect(countChoices(exits, ctx).map(c => c.label))
      .toEqual(['Random', '1: in and out the same way', '2', '3', '4', '5', '6'])
  })

  it('held to what the BORDER can carry, so the panel never offers an exit that cannot be placed', () => {
    const gAll = gen([ways, exits])
    expect(countCeiling(exits, { cols: 20, rows: 20, ways: 6, edges: 4, gen: gAll, options: { pathways: '6' } })).toBe(4)
  })

  it('a followed option on "random" means the most it could be', () => {
    const gAll = gen([ways, exits])
    expect(countCeiling(exits, { cols: 60, rows: 40, ways: 5, edges: 20, gen: gAll, options: { pathways: 'random' } })).toBe(10)
  })

  it('leaves an option that is not a count completely alone', () => {
    const region = opt({ key: 'region' })
    expect(countChoices(region, { cols: 1, rows: 1 })).toEqual(region.choices)
  })

  it('and builds nothing when nobody measured the map, rather than inventing a ceiling', () => {
    expect(countChoices(ways, { cols: 60, rows: 40 })).toEqual(ways.choices)
  })
})

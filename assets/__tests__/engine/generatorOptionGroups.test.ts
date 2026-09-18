/**
 * THE OPTIONS PANEL'S DATA: which group an option is browsed under, and which choices a map this size can
 * actually carry.
 *
 * Both are served (`docs/EDITOR-UX.md` §2.1 and §2.3), so these test that the frontend READS them and invents
 * nothing: a generator with no groups renders as it always did, and a generator with no `maxPer` is never
 * narrowed.
 */
import { choicesForSize, optionSections, parseGeneratorCatalog, trimmedBySize, type GeneratorDef, type GeneratorOption } from '@/lib/generatorCatalog'

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

describe('the limits move with the size of the map', () => {
  const ways = opt({ key: 'pathways', group: 'layout', maxPer: 180 })

  it('offers every count on a map with room for them', () => {
    // 60x40 = 2400 cells, and 4 x 180 = 720, so all four fit.
    expect(choicesForSize(ways, 60, 40).map(c => c.key)).toEqual(['random', '1', '2', '3', '4'])
  })

  it('drops the counts a small map cannot carry, and keeps the ones it can', () => {
    // 20x20 = 400 cells: 1 and 2 fit at 180 each, 3 and 4 do not.
    expect(choicesForSize(ways, 20, 20).map(c => c.key)).toEqual(['random', '1', '2'])
  })

  it('never drops a NON-count choice, because a size says nothing about it', () => {
    const river = opt({ key: 'river', maxPer: 180, choices: [{ key: 'none', label: 'No river' }, { key: 'through', label: 'Through' }] })
    expect(choicesForSize(river, 1, 1).map(c => c.key)).toEqual(['none', 'through'])
  })

  it('leaves an option with no maxPer completely alone', () => {
    expect(choicesForSize(opt({ key: 'region' }), 1, 1)).toEqual(opt({ key: 'region' }).choices)
  })

  it('always leaves something to pick, however small the map', () => {
    const counts = opt({ key: 'pathways', maxPer: 180, choices: [{ key: '4', label: '4' }] })
    expect(choicesForSize(counts, 1, 1)).toHaveLength(1)
  })

  it('counts how many were trimmed, so the panel only explains itself when it is true', () => {
    const g = gen([ways, opt({ key: 'region' })])
    expect(trimmedBySize(g, { cols: 60, rows: 40 })).toBe(0)
    expect(trimmedBySize(g, { cols: 20, rows: 20 })).toBe(2)
  })
})

describe('the live catalog carries both, so this is not testing a fixture', () => {
  it('parses group and maxPer off a served generator', () => {
    const catalog = parseGeneratorCatalog({
      data: [{
        key: 'wilderness', name: 'Wilderness', description: null, position: 0,
        generators: [{
          key: 'woodland', name: 'Woodland', description: null, position: 0, layout: 'woodland',
          config: { optionGroups: { layout: 'Layout', water: 'Water' } },
          options: [
            { key: 'pathways', label: 'Pathways', type: 'choice', default: 'random', group: 'layout', maxPer: 180,
              choices: [{ key: 'random', label: 'Random' }, { key: '4', label: '4' }] },
            { key: 'river', label: 'River', type: 'choice', default: 'none', group: 'water',
              choices: [{ key: 'none', label: 'No river' }] },
          ],
        }],
      }],
    })
    const found = catalog[0].generators[0]
    expect(found.options.map(o => [o.key, o.group, o.maxPer])).toEqual([['pathways', 'layout', 180], ['river', 'water', undefined]])
    expect(found.config.optionGroups).toEqual({ layout: 'Layout', water: 'Water' })
    expect(optionSections(found).map(s => s.label)).toEqual(['Layout', 'Water'])
  })
})

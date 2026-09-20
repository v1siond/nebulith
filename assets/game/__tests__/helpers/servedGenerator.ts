/**
 * THE SERVED CONFIG, fed to the engine the way the editor feeds it.
 *
 * A generate is described by the row the backend serves: its nature densities, its colours, its formation,
 * its regions and how they are laid out, its ways, its crossings, and how much of what the map contains
 * (`terrain`). The editor hands `generateStage` all of it.
 *
 * A test that hands over three of those fields is testing a map the app never makes. That is not a
 * hypothetical: suites here built a woodland with no `formation`, so the stand grouping every real woodland
 * is drawn with was never exercised, and the day the engine stopped inventing a lattice for itself the
 * suite measured zero trees on a map the editor still draws in full.
 *
 * So there is one place that says what a build is fed, and it reads the captured `/api/generators` rather
 * than a literal, which means these suites fail if the backend stops serving what the game expects. A local
 * fixture could never tell you that.
 *
 * Usage, spread FIRST so a suite can still override any single field it is actually testing:
 *
 *     generateStage({ ...servedBy('wilderness', 'forest_woodland'), zone, variant, layout, cols, rows })
 */
import { findGenerator, parseGeneratorCatalog, type GeneratorConfig } from '@/lib/generatorCatalog'
import liveBody from '@/__tests__/fixtures/generators.json'

export const SERVED_CATALOG = parseGeneratorCatalog(liveBody)

/** The row's own config, or a throw naming it: an undefined config proves nothing, it just skips assertions. */
export function servedConfig(categoryKey: string, generatorKey: string): GeneratorConfig {
  const config = findGenerator(SERVED_CATALOG, categoryKey, generatorKey)?.config
  if (!config) throw new Error(`the catalog serves no "${generatorKey}" under "${categoryKey}"`)
  return config
}

/** Everything `generateStage` reads off a served row, ready to spread into its options. */
export function servedBy(categoryKey: string, generatorKey: string) {
  const config = servedConfig(categoryKey, generatorKey)
  return {
    nature: config.nature,
    palette: config.palette,
    formation: config.formation,
    pathway: config.pathway,
    subZones: config.subZones,
    regionLayout: config.regionLayout,
    terrain: config.terrain,
    treeMix: config.trees,
    crossings: config.crossings,
    settlement: config.settlement,
  }
}

/** The same, for a wilderness biome named by its environment (`woodland` → `forest_woodland`). */
export const servedWild = (environment: string) => servedBy('wilderness', `forest_${environment}`)

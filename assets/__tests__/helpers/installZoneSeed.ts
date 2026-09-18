// Side-effect import, installs the DB-equivalent SEASON catalog for the whole test file.
//
// Ground palettes, the curated tree/decor/flower tile, bloom variants and the temple/cave palettes moved
// out of `engine/zones.ts` into the backend on 2026-09-11, so a test that generates a stage needs them
// installed for the same reason it needs the tileset: the engine reads all of it and authors none of it.
//
// Separate from `installTilesetSeed` because these suites want the seasons WITHOUT the tileset, importing
// that one would install a whole catalog they never asked for.
import { installZoneRules, installZones } from '@/engine/zoneCatalog'
import zonesFixture from '@/__tests__/fixtures/zones.json'
import combatFixture from '@/__tests__/fixtures/combat.json'

installZones(zonesFixture)
installZoneRules((combatFixture as { data: { rules: unknown } }).data.rules)

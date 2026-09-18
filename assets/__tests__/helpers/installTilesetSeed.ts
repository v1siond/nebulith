// Side-effect import, installs the DB-equivalent tileset for the WHOLE test file. Import this FIRST
// (`import '@/__tests__/helpers/installTilesetSeed'`) in a test whose every case exercises the sidebar /
// reskin / override path. For a file that mixes those with bundled-default mechanism tests, use the scoped
// `useSeedTileset()` from ./tilesetSeed inside just the describe that needs it instead.
import { installZoneRules, installZones } from '@/engine/zoneCatalog'
import zonesFixture from '@/__tests__/fixtures/zones.json'
import combatFixture from '@/__tests__/fixtures/combat.json'

import { installSeedTileset } from './tilesetSeed'

installSeedTileset()

// THE SEASONS TOO, since 2026-09-11. Ground palettes, the curated tree/decor/flower tile, bloom variants
// and the temple/cave palettes moved out of `engine/zones.ts` into the backend, so a generator test needs
// them installed for the same reason it needs the tileset: the engine reads all of it, and authors none.
// Captured from the live `/api/zones` and `/api/combat`, so a test asserts against what ships.
installZones(zonesFixture)
installZoneRules((combatFixture as { data: { rules: unknown } }).data.rules)

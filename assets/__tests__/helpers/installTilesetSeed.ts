// Side-effect import — installs the DB-equivalent tileset for the WHOLE test file. Import this FIRST
// (`import '@/__tests__/helpers/installTilesetSeed'`) in a test whose every case exercises the sidebar /
// reskin / override path. For a file that mixes those with bundled-default mechanism tests, use the scoped
// `useSeedTileset()` from ./tilesetSeed inside just the describe that needs it instead.
import { installSeedTileset } from './tilesetSeed'

installSeedTileset()

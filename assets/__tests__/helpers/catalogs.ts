/**
 * Installs the BACKEND CATALOGS into a test, from verbatim captures of the live API.
 *
 * The item catalog and the ability registry are backend data now (§3.14b #1 and #2), and both are
 * deliberately EMPTY until something installs them — nothing invents a fallback sword or a stand-in Fire
 * Slash. That is the right runtime behaviour and it means any test touching gear or abilities has to say
 * which catalog it is testing against.
 *
 * Using the captured payloads rather than hand-written fixtures keeps these suites honest: they fail if the
 * backend stops serving what the game expects, which a local literal could never tell you.
 */
import { installItemCatalog } from '@/game/itemCatalog'
import { installAbilityRegistry } from '@/game/abilities'
import liveItems from '@/__tests__/fixtures/items.json'
import liveAbilities from '@/__tests__/fixtures/abilities.json'

/** Install both, as the editor does on boot. Call from `beforeEach`. */
export function installLiveCatalogs(): void {
  installItemCatalog(liveItems.data as never)
  installAbilityRegistry(liveAbilities.data as never)
}

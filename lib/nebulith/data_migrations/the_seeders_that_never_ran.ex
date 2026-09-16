defmodule Nebulith.DataMigration.TheSeedersThatNeverRan do
  @moduledoc """
  Three things the tile seeder was getting wrong, all of them silent.

  `seed_bridge_tiles/0` was written, documented and NEVER CALLED. `bridge_deck` and `bridge_rail` existed
  only where someone had run it by hand, and fifteen bridge compositions reference the pair, so on a fresh
  database every crossing was built out of a label nothing served.

  `seed_water_surface/0` copies each tileset's `water_still` from its own `water_shallow` row, and it sat
  ahead of the list that gives EMOJI its shallow band. The nil arm took it every time, so a puddle was seeded
  into ascii alone and an emoji player got a `?` where standing water should be. This is the same trap the
  comment two lines above it already described, for a different seeder.

  `@water_color` was defined three hundred lines BELOW the emoji list that reads it, and a module attribute
  is read where it stands, so emoji's `water_deep` and `water_shallow` were seeded with no colour at all. The
  compiler said so on every build and it read as noise.

  The fix in all three cases is in the seeder, so this pass just runs it. On a database built from the ledger
  `BuiltInCatalog` has already run the same seeder, which makes this a no-op there and the real repair on a
  database that predates the fixes.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed()

    Logger.info(
      "[data_migrate] tile seeder re-run for bridge tiles, water surface and water colour"
    )

    :ok
  end
end

defmodule Nebulith.DataMigration.SeedWaterLook do
  @moduledoc """
  Gives water its ART: frame pictures for the water surface, and the foam shoreline.

  Measured before writing it: `emoji/baked/water.png` was an 854 byte BLANK and both other bands pointed at
  `sq_blue.png`, a flat rounded square, so a river rendered as three flat tones with no texture anywhere. The
  pictures are authored as drawn art in `tiles.json` and baked per style.

  Runs the same `seed_water_look/0` the catalog seed runs (idempotent upserts and per-key settings merges),
  plus `seed_water_color/0` and `point_tiles_at_own_image/0` so the rows stop pointing at the old blanks.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_water_color()
    TileSource.seed_water_look()
    TileSource.point_tiles_at_own_image()

    Logger.info("[data_migrate] water art seeded (colour, frames, own image)")
    :ok
  end
end

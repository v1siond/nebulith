defmodule Nebulith.DataMigration.AddGrowthTiles do
  @moduledoc """
  Adds `tall_grass` (walkable) and `thicket` (blocking), in both styles.

  The generator was blocking cells that held a clover. A thicket that stops you needs to look like one, and
  long grass you walk into needs to exist at all.

  Runs the same seeder the catalog seed runs, which upserts by [tileset_id, label], so it touches these four
  rows and nothing else.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_growth()

    Logger.info("[data_migrate] growth tiles seeded (tall_grass, thicket)")
    :ok
  end
end

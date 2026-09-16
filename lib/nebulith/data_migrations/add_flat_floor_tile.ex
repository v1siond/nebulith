defmodule Nebulith.DataMigration.AddFlatFloorTile do
  @moduledoc """
  Adds the flat `floor` ground tile, in both styles.

  The meadow's floor is one flat tile tinted per cell. Every other template laid a TEXTURED tile as its whole
  floor (a cave is `cave_floor` wall to wall, a temple a checkerboard of two textured tiles). This is the flat
  tile they lay instead, wearing the material's colour, so the textured ones are left for ornaments.

  Runs the same seeder the catalog seed runs, which upserts by [tileset_id, label], so it touches the two
  rows and nothing else.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_floor()

    Logger.info("[data_migrate] flat floor tile seeded")
    :ok
  end
end

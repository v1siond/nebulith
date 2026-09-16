defmodule Nebulith.DataMigration.AsciiPathFloorHeight do
  @moduledoc """
  Puts the ascii `path` tile back ON THE FLOOR: the same minimal flat height every other floor tile carries.

  A tile's height is per-tile DATA read uniformly, and the SAME label must behave the same in EVERY art style
  (MAP-MODEL §4). `path` broke that, the emoji row is a flat slab while the ascii row was born a FULL BLOCK
  from the glyph seed's old hardcoded `height: 1`. A building's ENTRANCE places the `path` tile
  (`BuildingCompositions.entrance_cells/2`), so the doorstep stood up as a kerb instead of lying flat like the
  road it joins.

  The seed now reads the tile's OWN authored height (ascii.json `path` = flat), so a fresh DB is born right;
  this fixes the rows already in a live DB. A re-seed is not the vehicle, it would `replace_all` and clobber
  editor-tuned poses. Idempotent: a row already on the floor matches nothing.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Tile
  alias Nebulith.Catalog.Tileset
  alias Nebulith.DataMigration.FlatTilesMinimalHeight
  alias Nebulith.Repo

  @label "path"

  def run do
    flat = FlatTilesMinimalHeight.flat_height()

    {count, _} =
      from(t in Tile,
        join: ts in Tileset,
        on: ts.id == t.tileset_id,
        where: ts.key == "ascii" and t.label == @label and t.height != ^flat
      )
      |> Repo.update_all(set: [height: flat])

    Logger.info("[data_migrate] ascii #{@label} -> floor height #{flat} (#{count} updated)")
    :ok
  end
end

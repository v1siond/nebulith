defmodule Nebulith.DataMigration.FlatTilesMinimalHeight do
  @moduledoc """
  Gives every FLAT tile its real minimal height as DATA: 0.1 blocks — a thin slab, "a block with minimal
  height, enough to just see the colour" (the "min" in MAP-MODEL §4's "0/min: shows on the floor face").

  A tile's `height` is its size in BLOCKS. A flat tile (terrain, floor, road, decor, a flower — anything at
  height 0) is the same as any tile, just 0.1 tall; a standing tile keeps its whole-block height (≥ 1). The
  frontend only READS this and renders it — it invents nothing. UNITS are the one exception (drawn as a
  depth-0 billboard, not by height), so they keep their own height and are skipped.

  Idempotent: after the first run flat tiles are 0.1 (no longer 0.0), so a re-run matches nothing.
  Requires the `height` column to be a float (migration ChangeTileHeightToFloat).
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Repo
  alias Nebulith.Catalog.Tile

  def run do
    {count, _} =
      from(t in Tile,
        where: t.height == 0.0 and (is_nil(t.category) or t.category != "units")
      )
      |> Repo.update_all(set: [height: 0.1])

    Logger.info("[data_migrate] flat tiles -> height 0.1 (#{count} updated)")
    :ok
  end
end

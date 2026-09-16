defmodule Nebulith.DataMigration.FlatTilesZeroHeight do
  @moduledoc """
  Takes every FLAT tile back to height 0.

  `FlatTilesMinimalHeight` gave flat tiles a 0.1 "minimal slab". That slab is not needed and is not the
  model: FLOORS ARE TILES, AND ALL TILES STACK ON TOP OF EACH OTHER LIKE LEGOS BY DEFAULT (MAP-MODEL §4). A
  composition dropped on cells that already hold floor tiles stacks on them through the ordinary stacking every
  tile uses, there is no per-floor slab and no floor-special lift. Raise ANY tile's height (a floor included)
  and whatever sits on it rises, because that is how every tile behaves; the floor is no different.

  So a flat tile is simply 0 blocks tall.

  Idempotent: after the first run nothing sits at 0.1, so a re-run matches nothing. Registered LAST in
  `Nebulith.DataMigrations` so it also neutralises the 0.1 that `FlatTilesMinimalHeight` and
  `AsciiPathFloorHeight` would otherwise re-land on a full re-run.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Tile
  alias Nebulith.Repo

  def run do
    {count, _} =
      from(t in Tile, where: t.height == 0.1)
      |> Repo.update_all(set: [height: 0.0])

    Logger.info("[data_migrate] flat tiles -> height 0 (#{count} updated)")
    :ok
  end
end

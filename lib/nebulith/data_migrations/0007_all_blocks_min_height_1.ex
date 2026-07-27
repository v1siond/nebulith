defmodule Nebulith.DataMigration.AllBlocksMinHeight1 do
  @moduledoc """
  Every tile/block is at least ONE block tall (Alexander 2026-07-26: "remove the height 0 from any generator,
  all tiles/blocks are height 1 by default. GLOBAL").

  This REVERSES `FlatTilesZeroHeight` (0005), which took flat tiles down to 0. The model moved on: grounds are
  now RAISED height-1 blocks so that content marked `act_as_tile` stacks ON TOP of them (houses on the grass,
  not sunk inside — the visibility bug). A flat 0-height ground gave content nothing to sit on.

  Bumps ONLY tiles below 1.0 up to 1.0; explicit taller heights (a 4-block wall) are untouched. Idempotent:
  after the first run nothing sits below 1.0, so a re-run matches nothing. Registered LAST in `mix data_migrate`
  so a full re-run lands on 1.0 even after 0001/0005 touch heights.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Tile
  alias Nebulith.Repo

  def run do
    {count, _} =
      from(t in Tile, where: t.height < 1.0)
      |> Repo.update_all(set: [height: 1.0])

    Logger.info("[data_migrate] all blocks -> min height 1 (#{count} updated)")
    :ok
  end
end

defmodule Nebulith.DataMigration.AllBlocksMinHeight1 do
  @moduledoc """
  Every tile/block is at least ONE block tall.

  This REVERSES `FlatTilesZeroHeight`, which took flat tiles down to 0. The model moved on: grounds are
  now RAISED height-1 blocks so that content marked `act_as_tile` stacks ON TOP of them (houses on the grass,
  not sunk inside, the visibility bug). A flat 0-height ground gave content nothing to sit on.

  Bumps ONLY tiles below 1.0 up to 1.0; explicit taller heights (a 4-block wall) are untouched. Idempotent:
  after the first run nothing sits below 1.0, so a re-run matches nothing. It was registered LAST in the runner
  so a full re-run lands on 1.0 even after `FlatTilesMinimalHeight` and `FlatTilesZeroHeight` touch heights.

  NOT REGISTERED in `Nebulith.DataMigrations`. It is superseded by `GroundTilesAreFlat`, which takes the
  ground back down, so running this would only give that pass work to undo. The module is kept because the
  live database carries its effect and `GroundTilesAreFlat` documents itself against it.
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

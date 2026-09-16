defmodule Nebulith.DataMigration.DeleteBigHouseComposition do
  @moduledoc """
  Removes the seeded `big_house_6` composition.

  WHY A DATA PASS AND NOT A RESEED. `BuildingCompositions.seed_sample/0` upserts by name and deletes nothing,
  so dropping the type from `definitions/0` stops it being RE-created and leaves the existing row exactly
  where it was: still in the compositions list, still in the paint palette, still offered in the objects
  sidebar. It was measured in the running dev DB before this was written, under both tilesets.

  The count it used to carry did not vanish with it: `houseRange` absorbed it and the served `houseWidths`
  gained a 6, so a settlement keeps the same number of buildings and the same wide silhouettes, built as
  houses at a bigger footprint. A footprint is composed on demand, which is what made the separate type
  redundant.

  Idempotent: once the row is gone there is nothing left to match.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  @name "big_house_6"

  def run do
    ids = Repo.all(from(c in "compositions", where: c.name == @name, select: c.id))

    # Cells first: they hang off the composition, and a bare delete would trip the foreign key.
    Repo.delete_all(from(cc in "composition_cells", where: cc.composition_id in ^ids))
    {count, _} = Repo.delete_all(from(c in "compositions", where: c.id in ^ids))

    Logger.info("[data_migrate] #{@name} composition removed (#{count} rows)")
    :ok
  end
end

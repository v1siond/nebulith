defmodule Nebulith.Repo.Migrations.DeleteBigHouseComposition do
  @moduledoc """
  Removes the seeded `big_house_6` composition from a DB that already has it.

  Alexander, 2026-09-12: *"per biome, and delete big_house"*, after *"there's duplicated objects, like big house
  and house / in fact most are basically ther same, same form, same layout, same everything"*.

  WHY A MIGRATION AND NOT A RESEED. `BuildingCompositions.seed_sample/0` upserts by name and deletes nothing, so
  dropping the type from `definitions/0` stops it being RE-created and leaves the existing row exactly where it
  was: still in the compositions list, still in the paint palette, still offered in the objects sidebar. It was
  measured in the running dev DB before this was written, under both tilesets.

  The count it used to carry did not vanish with it: `houseRange` absorbed it and the served `houseWidths` gained
  a 6, so a settlement keeps the same number of buildings and the same wide silhouettes, built as houses at a
  bigger footprint. A footprint is composed on demand, which is what made the separate type redundant.

  Guarded on compositions existing at all, so a fresh or test DB that has none is left alone rather than being
  handed rows it never asked for (the mistake the flat-floor migration made first time round).
  """
  use Ecto.Migration

  import Ecto.Query

  @name "big_house_6"

  def up do
    if compositions_present?() do
      ids = repo().all(from(c in "compositions", where: c.name == @name, select: c.id))
      # Cells first: they hang off the composition, and a bare delete would trip the foreign key.
      repo().delete_all(from(cc in "composition_cells", where: cc.composition_id in ^ids))
      repo().delete_all(from(c in "compositions", where: c.name == @name))
    end
  end

  def down do
    # IRREVERSIBLE on purpose. The composition is gone from `definitions/0`, so there is nothing left to compose
    # it from; re-creating it here would mean pasting a copy of deleted source into a migration and calling that
    # a rollback. A house at a 6x4 footprint is the replacement, and it is composed on demand.
    :ok
  end

  defp compositions_present? do
    repo().aggregate(from(c in "compositions"), :count) > 0
  end
end

defmodule Nebulith.DataMigration.ABuildingIsNotATile do
  @moduledoc """
  DELETES EVERY TILE WHOSE NAME IS A BUILDING.

  `docs/SPEC.md` §8 phase 2, DELETE: *"Every tile whose name is a building, because a building is a
  construction of tiles."* `docs/OBJECT-CONSTRUCTION.md` §1 states the same rule from the other side:
  *"A billboard tile is not an object. A single-cell tile wearing a picture of a cactus is a picture of a
  cactus. It cannot be walked around, lit, resized per part, or edited part by part."*

  A house is a footprint of wall, roof, door and window tiles, and `Nebulith.Catalog.BuildingCompositions`
  already builds one from those pieces at eleven sizes. The 19 labels here were the other thing: a single
  cell wearing a picture of a whole building, seeded from the emoji catalog. They came in as a shortcut
  and every one of them is a dead end, because nothing you can do to a picture of a house makes it a
  house you can walk into.

  Nothing places them. Measured before deleting: `house`, `castle`, `church`, `hospital`, `tower` and
  `bank` appear elsewhere in the code as building TYPES, which is `BuildingCompositions.compose_building/3`
  producing `house_3`, `house_4` and friends, not this label. The other thirteen appear nowhere but the
  seeder.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  # The nineteen, listed once. `Nebulith.ABuildingIsNotATileTest` reads this list rather than repeating it,
  # so the fact has one owner.
  @billboards ~w(
    bank castle church classical-building convenience-store department-store derelict-house factory
    hospital hotel house house-garden houses japanese-castle mosque office-building school stadium tower
  )

  def billboards, do: @billboards

  def run do
    {count, _} =
      Repo.delete_all(
        from(t in Nebulith.Catalog.Tile, where: t.label in ^@billboards),
        log: false
      )

    Logger.info("[data_migrate] a building is not a tile (#{count} billboard tiles deleted)")
    :ok
  end
end

defmodule Nebulith.Repo.Migrations.SeedEntrances do
  @moduledoc """
  The four entrances: forest, cave, town and park.

  *"we need a better visual indicator that 'going through this pathway goes to somewhere else' … a forest
  entrance, a cave entrance, a town/city entrance, a park entrance"*, modelled against the reference picture he
  gave. Each is three cells wide, which is the gate width, with two uprights, a span over the middle and a dark
  mouth under it.

  Each carries a category so it lands in the objects palette: *"these exits would be new objects we can just
  put in a map whenever we want"*.

  Composition-only, so tile rows and the poses tuned by hand in the editor are untouched. Guarded on
  compositions existing, so a fresh or test database is left alone.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up, do: if(compositions_present?(), do: TileSource.seed_entrances())

  def down do
    # Reversible, and worth reversing: they are four named rows.
    ids =
      repo().all(
        from(c in "compositions",
          where: c.name in ["forest_entrance", "cave_entrance", "town_entrance", "park_entrance"],
          select: c.id
        )
      )

    repo().delete_all(from(cc in "composition_cells", where: cc.composition_id in ^ids))
    repo().delete_all(from(c in "compositions", where: c.id in ^ids))
  end

  defp compositions_present?, do: repo().aggregate(from(c in "compositions"), :count) > 0
end

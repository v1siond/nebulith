defmodule Nebulith.Repo.Migrations.AddFlatFloorTile do
  @moduledoc """
  Adds the flat `floor` ground tile, in both styles, to a DB that already exists.

  Alexander, 2026-09-11: *"look how we handle the floor in meadow, just using different colors and only using
  the floor tiles as ornaments, that's how we wanna do it on all other templates too"*.

  The meadow's floor is one flat tile tinted per cell. Every other template laid a TEXTURED tile as its whole
  floor (a cave is `cave_floor` wall to wall, a temple a checkerboard of two textured tiles). This is the flat
  tile they lay instead, wearing the material's colour, so the textured ones are left for ornaments.

  Runs the same seeder `seed/0` runs, which upserts by [tileset_id, label], so it touches the two new rows
  and nothing else. Only on a DB that already HAS both tilesets: a fresh one gets the floor from `seed/0` with
  everything else. It used to create the tilesets itself when they were missing, and a test DB then started
  every test with two tilesets it never asked for. `down` removes the rows.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if tilesets_present?(), do: TileSource.seed_floor()
  end

  def down do
    repo().delete_all(from(t in "tiles", where: t.label == "floor"))
  end

  defp tilesets_present? do
    repo().aggregate(from(t in "tilesets", where: t.key in ["ascii", "emoji"]), :count) == 2
  end
end

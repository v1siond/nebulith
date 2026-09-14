defmodule Nebulith.Repo.Migrations.AddGrowthTiles do
  @moduledoc """
  Adds `tall_grass` (walkable) and `thicket` (blocking) to a DB that already exists.

  and The generator was blocking cells that held a clover; a thicket that stops you needs to look like
  one, and long grass you walk into needs to exist at all.

  Runs the same seeder `seed/0` runs, which upserts by [tileset_id, label], so it touches these four rows and
  nothing else. Guarded: only on a DB that already HAS both tilesets, so a test DB never gets tilesets it did
  not ask for (the mistake the flat-floor migration made first time round).
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if tilesets_present?(), do: TileSource.seed_growth()
  end

  def down do
    repo().delete_all(from(t in "tiles", where: t.label in ["tall_grass", "thicket"]))
  end

  defp tilesets_present? do
    repo().aggregate(from(t in "tilesets", where: t.key in ["ascii", "emoji"]), :count) == 2
  end
end

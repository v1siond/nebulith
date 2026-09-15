defmodule Nebulith.Repo.Migrations.TheSeedersThatNeverRan do
  @moduledoc """
  Three things the tile seeder was getting wrong, all of them silent.

  `seed_bridge_tiles/0` was written, documented and NEVER CALLED. `bridge_deck` and `bridge_rail` existed
  only where someone had run it by hand, and fifteen bridge compositions reference the pair, so on a fresh
  database every crossing was built out of a label nothing served.

  `seed_water_surface/0` copies each tileset's `water_still` from its own `water_shallow` row, and it sat
  ahead of the list that gives EMOJI its shallow band. The `nil -> :ok` arm took it every time, so a puddle
  was seeded into ascii alone and an emoji player got a `?` where standing water should be. This is the same
  trap the comment two lines above it already described, for a different seeder.

  `@water_color` was defined three hundred lines BELOW the emoji list that reads it, and a module attribute
  is read where it stands, so emoji's `water_deep` and `water_shallow` were seeded with no colour at all.
  The compiler said so on every build and it read as noise.

  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up, do: if(tilesets_present?(), do: TileSource.seed())

  def down, do: :ok

  defp tilesets_present?, do: repo().aggregate(from(t in "tilesets"), :count) > 0
end

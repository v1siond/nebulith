defmodule Nebulith.DataMigration.GroundTilesAreFlat do
  @moduledoc """
  The ground you WALK ON is flat: every `terrain`, `floors` and `roads` tile goes to height 0.

  ## Why this is data and not code

  The frontend had stopped reading a tile's height at all (`resolveTileHeight` did `void tile`). It did that
  because THIS TABLE was inconsistent, `grass` and `road` said 0 while `meadow`, `water`, `path_stone` and
  `bridge` said 1, so a road sank below the grass beside it and cut a trench across the map. Ignoring the
  column hid the symptom and cost the setting entirely: a floor could never be laid flat, and no height a
  designer chose could ever be saved. The column is now correct, so the frontend reads it again.

  ## What this supersedes

  `AllBlocksMinHeight1` raised EVERY tile below 1.0 up to 1.0 ("all tiles/blocks are height 1 by
  default. GLOBAL"). That rule still holds for everything that STANDS, walls, roofs, doors, windows, props,
  nature. It is wrong only for the ground, because a 1-block floor is a cube with side faces: it can occlude,
  so it needs its own turn in the back-to-front sort, and a floor merged into a z-width run spans many depths
  with only one turn to give. That is what made roads disappear behind grass and what blocked merging ground
  into runs at all.

  A flat floor has no side faces, occludes nothing, and needs no turn. The map's THICKNESS comes from the
  grid's own slab instead, one skirt around the edge, not a cube per cell.

  Registered LAST in `Nebulith.DataMigrations`, after every pass that lands a height. `AllBlocksMinHeight1`,
  which raises everything to 1 and would otherwise undo this, is not registered at all: the live database
  carries its effect but a fresh run does not reproduce it.

  Idempotent: matches only ground tiles that are not already 0.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Tile
  alias Nebulith.Repo

  # The categories that ARE the ground, the surface a unit stands on, as opposed to anything standing on it.
  @ground_categories ~w(terrain floors roads)

  def run do
    {count, _} =
      from(t in Tile, where: t.category in ^@ground_categories and t.height != 0.0)
      |> Repo.update_all(set: [height: 0.0])

    Logger.info("[data_migrate] ground tiles (#{Enum.join(@ground_categories, "/")}) -> flat (#{count} updated)")
    :ok
  end
end

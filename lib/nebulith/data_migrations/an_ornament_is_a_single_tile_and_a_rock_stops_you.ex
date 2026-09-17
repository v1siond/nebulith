defmodule Nebulith.DataMigration.AnOrnamentIsASingleTileAndARockStopsYou do
  @moduledoc """
  Every ornament draws as a single tile, and the ones big enough to stop you do.

  ## 1. The rest of the ornaments

  *"please make sure ornaments are always rendered single"*, on a shot of a rock and a bush both drawn as
  solid cubes. `bush`, `shrub` and the rest below were never in the first pass's list, so they kept drawing
  as boxes of foliage.

  The reason the ones that WERE in that list still looked like cubes is not here, it is in the engine: all
  three renderers read `display` off the asset's own per-instance settings and never off the tile the backend
  serves, so a generated prop (which pins no per-instance settings) could not see it. Fixed alongside this.

  ## 2. A rock stops you, a mushroom does not

  *"make sure their collissions are logical, for example that rock doesn't have collisions, but it should
  considering it's size"*. Every ornament in the catalog carries `blocking: false` and an empty collision
  box, so a boulder was scenery you walked through.

  Split by what the thing IS, which is what he asked for:

    * **Blocks**: `rock`, `boulder`, `wood-log`. Knee-high or better, you go round them.
    * **Walk over**: mushrooms, shells, pebbles, shamrock, flowers, bush, shrub. You step on them.

  A blocker gets `blocking: true` and the full-cell box every blocking tile in the catalog already carries,
  `[{x: 0, y: 0, w: 1, h: 1}]`, so it matches the fountain and the wall rather than inventing a shape. When
  the hitbox system lands (ticket 62) these become real boxes; until then this is the mechanism that works.

  Idempotent: targeted setting writes.
  """
  require Logger

  alias Nebulith.Catalog

  # Everything that lies on the ground and is read as one object. Both lists draw as a single tile; they
  # differ only in whether you can walk through them.
  @blocking ~w(rock boulder wood-log)
  @walkable ~w(mushroom red-mushroom seashell decor_shell decor_pebbles shamrock bush shrub)

  # The full-cell box every blocking tile in the catalog already uses.
  @whole_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

  def run do
    singles =
      for label <- @blocking ++ @walkable, ts <- Catalog.list_tilesets(), reduce: 0 do
        acc ->
          {hit, _} = Catalog.put_tile_setting(ts.id, label, "display", "single")
          Catalog.put_tile_setting(ts.id, label, "transparent", true)
          acc + hit
      end

    blocks =
      for label <- @blocking, ts <- Catalog.list_tilesets(), reduce: 0 do
        acc ->
          {hit, _} = Catalog.put_tile_setting(ts.id, label, "collision", @whole_cell)
          Catalog.set_tile_blocking(ts.id, label, true)
          acc + hit
      end

    Logger.info("[data_migrate] #{singles} ornament rows draw single, #{blocks} of them now stop you")
    :ok
  end
end

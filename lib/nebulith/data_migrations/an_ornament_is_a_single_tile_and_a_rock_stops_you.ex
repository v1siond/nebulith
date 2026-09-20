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
  considering it's size"*. Every ornament in the catalog carries `occupies: false` and an empty collision
  box, so a boulder was scenery you walked through.

  Split by what the thing IS, which is what he asked for:

    * **Blocks**: `rock`, `boulder`, `wood-log`. Knee-high or better, you go round them.
    * **Walk over**: mushrooms, shells, pebbles, shamrock, flowers, bush, shrub. You step on them.

  A blocker gets `occupies: true` and the full-cell box every blocking tile in the catalog already carries,
  `[{x: 0, y: 0, w: 1, h: 1}]`, so it matches the fountain and the wall rather than inventing a shape. When
  the hitbox system lands (ticket 62) these become real boxes; until then this is the mechanism that works.

  ## This used to PATCH the seeder's output, and that was the bug

  It wrote both facts onto rows `TileSource.seed/0` had already written. `upsert_tile` REPLACES the whole
  settings map, so one fact had two owners and every reseed put the crates back and let you walk through the
  boulders again, with nothing in the code having changed.

  They live in `TileSource.ensure_ornaments/0` now, beside the other tile-fact rules, so the seeder's output
  IS the approved state, and this calls that one rule to bring an existing database up to it.

  It calls the two RULES and not `seed/0`, deliberately. A tile row carries poses and sizes tuned in the editor
  and `seed/0` rewrites every settings map, so a full reseed would fix the rocks by flattening someone's
  work. The rule writes the two keys it owns and nothing else.
  `an_ornament_is_one_object_test.exs` is the gate that keeps the facts in the seeder.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.ensure_ornaments()
    TileSource.ensure_collisions()
    Logger.info("[data_migrate] every ornament draws as one object, and a rock stops you")
    :ok
  end
end

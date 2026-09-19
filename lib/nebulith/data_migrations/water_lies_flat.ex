defmodule Nebulith.DataMigration.WaterLiesFlat do
  @moduledoc """
  Every terrain water tile lies FLAT, at height 0, like the grass beside it.

  *"the issue was that the town had water over the floor level at height .5"*, and *"just make the water
  height 0 for now"*.

  `height` is a top-level COLUMN on a tile, not a key in `settings`, which is why it reads as absent when you
  only look at the settings map. Measured on the live catalog, in both styles:

      water          0.5     <- the town's water, the half block standing proud of the floor
      water_f1/2/3   0.5     <- its animation frames, so the whole cycle stood proud
      water_shallow  1.0
      water_deep     1.0
      water_still    0.05    <- the ford and puddle FILM, left alone, it is already flush
      grass, meadow  0.0     <- what a floor looks like

  The autotile river pieces (`water_smooth_*`, `water_lined_*`) were already 0.0, which is why a forest river
  looked flush while a town's did not. An earlier pass set `water` to 0.5 on purpose, so a river surface would
  sit under its bank rim. That was the channel model and the channel is gone.

  NOT TOUCHED: `water_c` and `water_jet` at 1.0. Those are the FOUNTAIN's basin and jets, pieces of a built
  object rather than terrain, and a fountain was not what was asked about here. They are why a town square's
  fountain draws as a tall blue box, and they want their own decision.
  """
  require Logger

  alias Nebulith.Repo

  @flat ~w(water water_f1 water_f2 water_f3 water_shallow water_deep)

  def run do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!("UPDATE tiles SET height = 0.0 WHERE label = ANY($1) AND height <> 0.0", [@flat])

    Logger.info("[data_migrate] water lies flat: #{rows} tile row(s) at height 0")
    :ok
  end
end

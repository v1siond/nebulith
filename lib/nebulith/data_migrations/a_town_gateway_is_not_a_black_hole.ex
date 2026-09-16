defmodule Nebulith.DataMigration.ATownGatewayIsNotABlackHole do
  @moduledoc """
  The dark mouth under an entrance arch becomes opt-in, and a town's gateway no longer has one.

  It was a `path_stone` cell coloured #0d0d12 at `scaleY: 0.06`, a near-black stain on the paving under every
  arch, and it read as a black diamond lying on the town square. A CAVE mouth is dark because a cave is dark.
  A built town gateway is not, and painting one black is a hole in the square.

  The `light` that rode with it is dropped too. `drawNightLighting` is the only thing that draws a light
  setting, so on a day map all it ever contributed was the black.

  The cave keeps its mouth, by asking for it.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_entrances()
    TileSource.seed_approved_entrances()

    Logger.info("[data_migrate] the dark mouth under an arch is opt-in")
    :ok
  end
end

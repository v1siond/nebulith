defmodule Nebulith.DataMigration.TheWayWearsItsOwnColour do
  @moduledoc """
  THE COLOUR A WAY WEARS BELONGS TO THE PATHWAY, NOT TO THE TEMPLATE'S PALETTE.

  It was in both, and the palette won. So a mountain forest that asks for `rocky_track` had its gravel
  painted the woodland's dirt, a swamp that asks for `boardwalk` had its planks painted the jungle's dirt,
  and a meadow, whose palette states no trail at all, had its park path fall through to the raw tile and come
  out 45 points DARKER than the lawn it crosses. Every one of those is a template stating what its way is
  made of and being overruled by something it inherited.

  Every kind in `@pathways` now carries a `tone`, measured off that kind's own stored reference, and the
  three palettes that carried a `trail` no longer do. The city street also carries its `marking`, which is
  the white centre line drawn on the asphalt as an ornament.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] each way carries its own tone")
    :ok
  end
end

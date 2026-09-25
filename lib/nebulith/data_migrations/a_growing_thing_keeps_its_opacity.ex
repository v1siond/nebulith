defmodule Nebulith.DataMigration.AGrowingThingKeepsItsOpacity do
  @moduledoc """
  A tree stays readable when the hero walks up to it. A wall still does not.

  Both fade: `FadeTreesAndExteriorNearHero` gave every standing exterior tile `fadeNear`, and the reveal
  then treated a forest exactly like a facade, which is the report *"I'd like to make the tree more
  opaque"*. The difference is what you are meant to see THROUGH the thing. A wall hides a room. A tree
  hides nothing worth a ghost.

  Runs `TileSource.ensure_min_alpha/0`, which writes only the `minAlpha` key, so poses tuned in the editor
  survive.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.ensure_min_alpha()

    Logger.info("[data_migrate] growing things keep #{TileSource.leafy_min_alpha()} of their opacity")
    :ok
  end
end

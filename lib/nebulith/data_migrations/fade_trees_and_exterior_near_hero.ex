defmodule Nebulith.DataMigration.FadeTreesAndExteriorNearHero do
  @moduledoc """
  Trees and the other standing exterior tiles ease see-through as the hero comes close.

  The renderer already fades any tile carrying `fadeNear`. A building's walls, windows and doors did, the
  trees and everything else outside did not.

  Runs `TileSource.ensure_fade_near/0`, which writes only the `fadeNear` key, so editor-tuned poses survive.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.ensure_fade_near()

    Logger.info("[data_migrate] fadeNear applied to trees and exterior tiles")
    :ok
  end
end

defmodule Nebulith.DataMigration.TheLayersPanelIsTheFilter do
  @moduledoc """
  The separate stop-at-a-layer dropdown is removed. It was a second control for something the panel already
  had, under a worse name.

  The layers panel is served from `generation_layers` and already names every layer in run order. Stopping
  the system at one of them is a thing to do WITH that list, not a second dropdown listing the same layers.
  The engine keeps `upTo`, because the filter itself is right; what was wrong was adding a duplicate way to
  say it.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] the duplicate layer dropdown is gone")
    :ok
  end
end

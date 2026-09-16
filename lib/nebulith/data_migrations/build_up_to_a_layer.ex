defmodule Nebulith.DataMigration.BuildUpToALayer do
  @moduledoc """
  Every template that has pathways offers a stop at a layer: an empty map with all pathways, an empty map
  with a river, the full map. It is a filter, one more parameter for the generator, and it is what makes a
  preview of the exits and the pathways possible.

  The choice keys ARE the layer keys, so the option cannot drift from the layers it names. Nothing is drawn
  differently for a stop: the engine runs the same stack and stops early, so a preview is the real ground and
  the real tiles rather than a sketch of them.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] generators offer a stop at a layer")
    :ok
  end
end

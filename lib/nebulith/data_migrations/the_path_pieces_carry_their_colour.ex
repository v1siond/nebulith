defmodule Nebulith.DataMigration.ThePathPiecesCarryTheirColour do
  @moduledoc """
  The path pieces seeded with a null colour.

  A module attribute is read at COMPILE time, and this one stood BELOW the function that read it, so every
  piece was written with `%{"color" => nil}` and the family had no tone of its own to fall back on. The same
  mistake is recorded a few hundred lines up for the water colour.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_path_pieces()

    Logger.info("[data_migrate] the path pieces carry their colour")
    :ok
  end
end

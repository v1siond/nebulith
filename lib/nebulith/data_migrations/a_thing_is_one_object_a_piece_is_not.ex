defmodule Nebulith.DataMigration.AThingIsOneObjectAPieceIsNot do
  @moduledoc """
  Every loose thing draws as one object, and the rule stopped being a list of names.

  `AnOrnamentIsASingleTileAndARockStopsYou` ran the same pass when it decided by eleven label names. The
  ruins map strews `pillar`, which was not one of them, so a column came out as a cube with a column printed
  on each of its four faces. Counting the catalog: 36 of the 64 nature and decor tiles drew on every face.

  `TileSource.ensure_ornaments/0` asks the data now: a label that is a cell of some composition is a PIECE of
  something built and keeps its faces, and anything else in nature or decor is one object. Re-running it is
  how an existing database picks the wider rule up, since the earlier pass is recorded as done.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.ensure_ornaments()

    Logger.info("[data_migrate] a loose thing draws as one object, by composition rather than by name")
    :ok
  end
end

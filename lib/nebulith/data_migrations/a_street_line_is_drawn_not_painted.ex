defmodule Nebulith.DataMigration.AStreetLineIsDrawnNotPainted do
  @moduledoc """
  The road marking becomes ART.

  > *"look at the street, isn ugly, the 'lines' are big squares instead of actual street lines"*

  It was a COLOUR. `TheWhiteLinesInTheMiddle` settled on #eae7db and the generator wrote it onto the middle
  cell of each carriageway cross-section, dashed. A colour fills the cell it is written into, so the marking
  could only ever be a square, and at this zoom a square of cream on grey is what he is looking at.

  `TILE-DESIGN.md` §2.3 already recorded the same lesson from the dirt path: it was attempted three times as
  a colour change alone and always drew a staircase, because the shape only exists INSIDE the art.

  So the dash is a tile now, one per axis, flat decor lying on the road at `stackAt: 0` exactly like the
  puddle's film. The colour survives untouched and tints the tile's white body, which is §1: one served
  colour, a body that carries it.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_road_markings()
    Logger.info("[data_migrate] the street line is drawn, not painted")
    :ok
  end
end

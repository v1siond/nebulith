defmodule Nebulith.DataMigration.ATrunkIsThinByThickness do
  @moduledoc """
  A TREE TRUNK IS THIN BECAUSE OF ITS THICKNESS, not because its width was shrunk.

      trees are also wrong, the trunk is created by modifying width, instead of thickness … do not
      modify their width, modify their thickness and height

  Width is how many cells across a tile is. Thickness is how much of its own cell the block fills. A
  trunk is one cell across and mostly air, so it is the second one, and the shape it was drawing (0.2
  wide, 0.6 deep) said the first.

  Two things were doing the thinning at once. The cell carried a Zoom, which the placement folds into
  BOTH ground axes, and on top of that the derivation divided by that same Zoom to cancel it back out. A
  term that only exists to be undone two layers later in another language is not a measurement, and the
  moment thickness arrived the two halves stopped matching. The cell now states the width it draws at,
  the height it draws at, and the reaches that pull its faces in.

  The compositions are authored in code and no endpoint writes them, so this re-seeds them from that
  source rather than patching rows and hoping the two spellings in the wild (some databases hold the old
  `scaleX`, some the half-converted reaches) are the only two.

  The cave mound grows its own trees and they were thinned the same wrong way. It is seeded by its own
  entry point, so re-seeding the compositions alone leaves them behind.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_compositions()
    TileSource.seed_approved_entrances()

    Logger.info("trunks are thin by thickness, and no composition cell carries a zoom for it")
    :ok
  end
end

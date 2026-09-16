defmodule Nebulith.DataMigration.BridgeDeckAndPostsByZWidth do
  @moduledoc """
  Rebuilds the 15 bridge compositions.

  Two changes, both about the same thing: the structure of a bridge is stated with Z-WIDTH and with
  world-axis THICKNESS, never with screen-axis scale.

    * the WALKWAY was `span` separate planks per row, 2 times span tiles for a surface that is one flat run.
      It is now one z-width tile per row, so a span-7 bridge is 10 tiles instead of 18 and the deck draws as
      one solid top with no column seams down the middle of it.
    * the POSTS were thinned with `scaleX`/`scaleZ`, which squash the drawn diamond on the SCREEN axes. A post
      held its shape only at the default camera corner and sheared at the other three. They now state the four
      REACHES that centre a thin block on both GROUND axes, which is what a door states, so a post is a post
      at every facing.

  Runs the composition-only `seed_compositions/0`, the path that exists precisely so a composition change does
  not rewrite tile rows and clobber the poses tuned by hand in the editor.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_compositions()

    Logger.info("[data_migrate] bridge compositions rebuilt by z-width")
    :ok
  end
end

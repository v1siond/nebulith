defmodule Nebulith.DataMigration.ADoorIsTwoBlocksTall do
  @moduledoc """
  A DOOR IS TWO BLOCKS TALL, and it is the door that knows it.

      this is the correct value for doors, 2 height, and see how the thickness is applied

  The height was stated in one place only: the `scaleY` on the composition cell that stamps a door into a
  building. So a door was two blocks tall when it arrived as part of a house, and one block tall by every
  other route into a map: painted by hand, swapped onto an existing tile, or read back off a save.

  How tall a door is has nothing to do with the house it is in. It is a fact about the label, so it
  belongs on the tile, where every path already looks. The building cell still says 2 and now agrees with
  it rather than contradicting it.

  `reconcile_tile_heights/0` takes its numbers from `emoji.json`, which is the height authority for both
  art styles, and that is where the 2 is written. `normalize_tile_heights/0` is the second half and is
  not optional: the authority is emoji, so without it the ascii door keeps the old number and the same
  door is two blocks tall in one art style and one block in the other. A label owns everything but the
  picture.

  Runs after the trunk pass and last among the height passes, for the reason the registry gives: a pass
  whose job is to settle what the seeders land has to come after the ones that re-run a seeder.

  Not fixed here, and reported at the same time: a door showing a thickness on all four sides rather than
  one. Every tile in the catalogue that carries a bare thickness amount also names a direction (four
  rows, all doors, all `left-down`), and the panel shows 1 for a reach nobody set, so there is no path in
  the current data that produces four. Left alone rather than guessed at.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.reconcile_tile_heights()
    TileSource.normalize_tile_heights()

    Logger.info("a door is two blocks tall, in both art styles")
    :ok
  end
end

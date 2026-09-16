defmodule Nebulith.DataMigration.AsciiUnitArtFigures do
  @moduledoc """
  Gives every ascii UNIT its composed FIGURE instead of one character.

  A unit is not a single character. A dog is a set of characters combined to form a dog, which is then baked
  to a PNG like every other tile. The cause of the single character was treating a unit like a terrain slab:
  `ensure_distinct_glyphs/0` makes every tile's picture distinct by giving it its own CHARACTER, which is
  right for a wall piece and wrong for a living thing, so `man` became a mars sign, `woman` a venus sign,
  `dog` a `d` and `bear` a `B`. The figures themselves had never been backend data at all, they lived in the
  frontend (`engine/entityArt.ts`) and were drawn live, so when units moved onto baked tiles there was
  nothing to bake and the single character was all that was left.

  This runs the seeder that reads `priv/repo/tilesets/ascii_unit_art.json` (67 figures times 2 frames, the 11
  enemy figures recovered verbatim from the frontend). It writes only three settings keys per unit,
  `artFrames`, `frames` and `frameMs`, so editor-tuned poses, colours and per-view sizes survive.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.apply_unit_art()

    Logger.info("[data_migrate] ascii unit art figures applied")
    :ok
  end
end

defmodule Nebulith.DataMigration.OnlyACanopyBlossoms do
  @moduledoc """
  A CANOPY MAY BLOSSOM. THE THINGS UNDER IT DO NOT.

  Spring's canopy was three greens and a blossom pink in one array, and that array is what a per-cell
  variant picks from. It is picked from twice: once for a tree's crown, where a blossom belongs, and
  once for the UNDERGROWTH beneath it, where it does not.

  Measured on a generated woodland: 48 shrubs and 11 tall grass wearing the blossom, alongside 25 leaf
  pieces that were entitled to it.

  The leaf tiles now carry `leafShades`, the count of shades that are leaf, the rest being blossom.
  The renderer reads it rather than judging which of the database's colours are flowers by looking at
  them.

  ## It does not touch the colours

  The shade arrays already in the database are the seed's `canopy ++ blossom` under an older spelling,
  where the palette held all four under `canopy`. The array is the same list in the same order either
  way, so nothing here rewrites a colour. What was missing was only the count beside it.

  ## The count comes from the palette, not from here

  `TileSource.state_where_leaves_end/0` derives it from `priv/repo/tilesets/ascii.json`, the file that
  states each zone's leaves and its blossom separately. Repeating the numbers in this module would put
  a second authority on them, and the day a season gains a fourth green the two would disagree with no
  way to tell which was right.
  """
  alias Nebulith.Catalog.TileSource

  def run, do: TileSource.state_where_leaves_end()
end

defmodule Nebulith.DataMigration.TheFieldComesOverTheWay do
  @moduledoc """
  The path_dirt pieces are replaced by path_edge: the tongue of FIELD reaching into the way, not the dirt.

  Measured on a built woodland: laying the dirt as art over a field-coloured floor left 334 way cells wearing
  six colours, only 144 of them the way's own tone, because every boundary cell kept the grass underneath.
  More than half of a path was painted the colour of the grass, which is the patchwork it read as. Inverted,
  the way wears one tone across every cell and the field comes over the top, so the boundary still lives
  inside the art where the reference puts it.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_path_pieces()

    Logger.info("[data_migrate] the field comes over the way")
    :ok
  end
end

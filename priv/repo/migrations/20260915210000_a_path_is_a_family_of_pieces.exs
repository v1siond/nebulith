defmodule Nebulith.Repo.Migrations.APathIsAFamilyOfPieces do
  @moduledoc """
  The `path_dirt` autotile family: a centre, four edges, four corners, three cuts of each.

  A way has been a flat fill tile wearing a colour, and a flat fill on a grid can only draw a polygon with
  staircase edges. Measured on the forest reference, the boundary between dirt and grass wanders about 0.17
  of a cell, so it belongs inside the art. This is the art, authored through the same pipeline the canopy
  nine went through: SVG in priv/tilegen/tiles.json, near-white so the tile's colour tints it, baked with
  --only so the other 573 PNGs are untouched.
  """
  use Ecto.Migration

  alias Nebulith.Catalog.TileSource

  def up, do: TileSource.seed_path_pieces()

  def down, do: :ok
end

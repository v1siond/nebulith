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

  def up, do: if(tilesets_present?(), do: TileSource.seed_path_pieces())

  def down, do: :ok

  # ONLY A DB THAT ALREADY HAS TILES. Every data migration in this repo carries this guard and this one did
  # not, so it seeded the ascii and emoji tilesets into the FRESH TEST database, where three suites create
  # their own "ascii" tileset in setup and hit the unique index on the key. A data migration describes a
  # change to data that exists; on an empty database there is nothing to change.
  defp tilesets_present? do
    %{rows: [[count]]} = repo().query!("SELECT count(*) FROM tilesets")
    count > 0
  end
end

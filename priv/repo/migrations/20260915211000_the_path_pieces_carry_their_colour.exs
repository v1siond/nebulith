defmodule Nebulith.Repo.Migrations.ThePathPiecesCarryTheirColour do
  @moduledoc """
  The path pieces seeded with a null colour.

  A module attribute is read at COMPILE time, and this one stood BELOW the function that read it, so every
  piece was written with `%{"color" => nil}` and the family had no tone of its own to fall back on. The same
  mistake is recorded a few hundred lines up for the water colour.
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

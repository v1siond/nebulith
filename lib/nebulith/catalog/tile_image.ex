defmodule Nebulith.Catalog.TileImage do
  @moduledoc """
  ONE LABEL'S PICTURE IN ONE ART STYLE, which is the only thing an art style owns.

  `docs/SPEC.md` §3.1: *"a LABEL owns every fact; a TILESET owns only the picture. A new art style is one
  `tilesets` row plus N `tile_images` rows, and no fact is copied."*

  While the picture lived on `tiles`, a label needed one row per style, so every fact on that row existed
  twice and the two copies could drift. They did, and each time the answer was another pass over the
  catalog reconciling them. With the picture here, there is nothing to reconcile: parity is
  `count(tile_images) = count(tilesets)`, which is a query rather than a pass.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "tile_images" do
    field :image_path, :string
    belongs_to :tileset, Nebulith.Catalog.Tileset, type: :id
    belongs_to :tile, Nebulith.Catalog.Tile, type: :id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(image, attrs) do
    image
    |> cast(attrs, [:tileset_id, :tile_id, :image_path])
    |> validate_required([:tileset_id, :tile_id, :image_path])
    |> validate_change(:image_path, fn :image_path, path ->
      if String.trim(path) == "", do: [image_path: "is empty, which is not a picture"], else: []
    end)
    |> unique_constraint([:tileset_id, :tile_id], name: :tile_images_tileset_id_tile_id_index)
  end
end

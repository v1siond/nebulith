defmodule Nebulith.Catalog.Tile do
  use Ecto.Schema
  import Ecto.Changeset

  schema "tiles" do
    field :label, :string
    field :glyph, :string
    field :emoji, :string
    field :color_role, :string
    field :blocking, :boolean, default: false
    field :height, :float, default: 0.0
    field :category, :string
    field :title, :string
    field :image_url, :string
    field :settings, :map, default: %{}
    belongs_to :tileset, Nebulith.Catalog.Tileset

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(tile, attrs) do
    tile
    |> cast(attrs, [
      :tileset_id,
      :label,
      :glyph,
      :emoji,
      :color_role,
      :blocking,
      :height,
      :category,
      :title,
      :image_url,
      :settings
    ])
    |> validate_required([:tileset_id, :label])
    |> unique_constraint([:tileset_id, :label], name: :tiles_tileset_id_label_index)
  end
end

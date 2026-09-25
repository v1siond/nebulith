defmodule Nebulith.Catalog.Tile do
  use Ecto.Schema
  import Ecto.Changeset

  schema "tiles" do
    field :label, :string
    field :color_role, :string
    field :height, :float, default: 0.0
    field :category, :string
    field :title, :string

    # The picture is a `tile_images` row, one per art style (`docs/SPEC.md` §3.1). This stays as the word
    # every reader already uses for it: `Catalog.list_tiles_for/1` fills it from the join, and a writer
    # still names it, which is how the picture reaches the table that owns it.
    field :image_url, :string, virtual: true
    field :settings, :map, default: %{}

    # Which piece of an autotiled run this picture is, and the run it belongs to. `docs/SPEC.md` §3.1:
    # it describes the PICTURE, not a placement, so it lives with the label. NULL slot means the tile is
    # not autotiled at all.
    field :autotile_slot, :string
    field :family, :string

    belongs_to :tileset, Nebulith.Catalog.Tileset

    belongs_to :category_row, Nebulith.Catalog.TileCategory,
      foreign_key: :category_id,
      type: :binary_id

    belongs_to :owner, Nebulith.Accounts.User, type: :binary_id
    has_many :images, Nebulith.Catalog.TileImage

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(tile, attrs) do
    tile
    |> cast(attrs, [
      :tileset_id,
      :label,
      :color_role,
      :height,
      :category,
      :title,
      :image_url,
      :settings,
      :autotile_slot,
      :family,
      :category_id,
      :owner_id
    ])
    |> validate_required([:tileset_id, :label])
    |> unique_constraint([:tileset_id, :label], name: :tiles_tileset_id_label_index)
  end
end

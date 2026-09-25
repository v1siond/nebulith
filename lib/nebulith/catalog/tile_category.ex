defmodule Nebulith.Catalog.TileCategory do
  @moduledoc """
  The bucket a tile browses under, as a row.

  It was a string repeated on every tile, which meant the sidebar's ORDER had nowhere to live and got
  decided by whichever list the frontend happened to hold. `docs/SPEC.md` §3.1 gives it `position`, so the
  order is a fact about the category and the panel reads it.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "tile_categories" do
    field :key, :string
    field :name, :string
    field :position, :integer, default: 0

    has_many :tiles, Nebulith.Catalog.Tile, foreign_key: :category_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(category, attrs) do
    category
    |> cast(attrs, [:key, :name, :position])
    |> validate_required([:key, :name])
    |> unique_constraint(:key, name: :tile_categories_key_index)
  end
end

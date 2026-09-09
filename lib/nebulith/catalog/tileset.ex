defmodule Nebulith.Catalog.Tileset do
  use Ecto.Schema
  import Ecto.Changeset

  schema "tilesets" do
    field :key, :string
    field :name, :string
    # A tileset row IS an art style, so it carries what the style picker needs to show one: the affordance
    # icon and the order it appears in. Without these the frontend has to declare the style list itself,
    # which is what §3.14a's BUILT_IN_STYLES was.
    field :icon, :string
    field :position, :integer, default: 0
    field :data, :map

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(tileset, attrs) do
    tileset
    |> cast(attrs, [:key, :name, :icon, :position, :data])
    |> validate_required([:key, :name])
    |> unique_constraint(:key)
  end
end

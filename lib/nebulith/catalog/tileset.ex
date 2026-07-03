defmodule Nebulith.Catalog.Tileset do
  use Ecto.Schema
  import Ecto.Changeset

  schema "tilesets" do
    field :key, :string
    field :name, :string
    field :data, :map

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(tileset, attrs) do
    tileset
    |> cast(attrs, [:key, :name, :data])
    |> validate_required([:key, :name])
    |> unique_constraint(:key)
  end
end

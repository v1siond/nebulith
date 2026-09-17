defmodule Nebulith.Catalog.GeneratorCategory do
  @moduledoc """
  A MAP TYPE the editor can generate, `forest`, `town`, `city`, `cave`, `temple`. The `key` is the
  engine's own variant id, so the generate call needs no translation layer.

  A category is a bucket, not a runnable thing: what runs is a `Nebulith.Catalog.Generator` inside
  it. One category can hold several (a forest's "Meadow" and "Meadow + River"), which is the point, authoring a new generator becomes a row, not a code change.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "generator_categories" do
    field :key, :string
    field :name, :string
    field :description, :string
    field :position, :integer, default: 0
    has_many :generators, Nebulith.Catalog.Generator, foreign_key: :category_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(category, attrs) do
    category
    |> cast(attrs, [:key, :name, :description, :position])
    |> validate_required([:key, :name])
    |> unique_constraint(:key)
  end
end

defmodule Nebulith.Catalog.Composition do
  use Ecto.Schema
  import Ecto.Changeset

  schema "compositions" do
    field :name, :string
    field :footprint_w, :integer
    field :footprint_h, :integer
    # Human NAME of the building, rendered as apex signage (a store's "Store" badge). Optional:
    # houses/trees have none, so they show no badge.
    field :title, :string
    # Sidebar BUCKET, the SAME category vocabulary a tile carries (MAP-MODEL §8): `buildings`/`nature`/
    # `props`/`terrain`. Marks the composition browseable in the paint palette and GROUPS it there, exactly
    # like a tile's `category`, so the editor never derives the group from names or door-detection.
    field :category, :string
    has_many :cells, Nebulith.Catalog.CompositionCell

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(composition, attrs) do
    composition
    |> cast(attrs, [:name, :footprint_w, :footprint_h, :title, :category])
    |> validate_required([:name, :footprint_w, :footprint_h])
    |> unique_constraint(:name)
  end
end

defmodule Nebulith.Catalog.Composition do
  use Ecto.Schema
  import Ecto.Changeset

  schema "compositions" do
    field :name, :string
    field :footprint_w, :integer
    field :footprint_h, :integer
    # Human NAME of the building — rendered as apex signage (a store's "Store" badge). Optional:
    # houses/trees have none, so they show no badge.
    field :title, :string
    has_many :cells, Nebulith.Catalog.CompositionCell

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(composition, attrs) do
    composition
    |> cast(attrs, [:name, :footprint_w, :footprint_h, :title])
    |> validate_required([:name, :footprint_w, :footprint_h])
    |> unique_constraint(:name)
  end
end

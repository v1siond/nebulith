defmodule Nebulith.Catalog.CompositionCell do
  use Ecto.Schema
  import Ecto.Changeset

  schema "composition_cells" do
    field :dx, :integer
    field :dy, :integer
    field :level, :integer
    field :label, :string
    field :walkable, :boolean, default: false
    # Uniform draw ZOOM for this cell's tile — the render multiplies every axis by it (iso.ts `zoom =
    # asset.scale`), so a cell can hold a tile bigger than one block. The tree's canopy is ONE leaf cell
    # at scale 2 (a 2×2 crown) instead of a 9-slice ring. Default 1.0 → every other cell renders unchanged.
    field :scale, :float, default: 1.0
    belongs_to :composition, Nebulith.Catalog.Composition

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(cell, attrs) do
    cell
    |> cast(attrs, [:composition_id, :dx, :dy, :level, :label, :walkable, :scale])
    |> validate_required([:composition_id, :dx, :dy, :level, :label])
  end
end

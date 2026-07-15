defmodule Nebulith.Catalog.CompositionCell do
  use Ecto.Schema
  import Ecto.Changeset

  schema "composition_cells" do
    field :dx, :integer
    field :dy, :integer
    field :level, :integer
    field :label, :string
    field :walkable, :boolean, default: false
    belongs_to :composition, Nebulith.Catalog.Composition

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(cell, attrs) do
    cell
    |> cast(attrs, [:composition_id, :dx, :dy, :level, :label, :walkable])
    |> validate_required([:composition_id, :dx, :dy, :level, :label])
  end
end

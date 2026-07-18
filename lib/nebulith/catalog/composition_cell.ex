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
    # Draw-priority (CSS z-index style): a higher value renders LATER (on top / in front), overriding the
    # positional depth sort in every view (iso `isoDepthCompare`, 2D, top). The fountain's water cells carry a
    # high value so the water reads IN FRONT of a wall behind it. Default 0 → the sort falls through to the
    # positional key, so every other cell orders EXACTLY as before.
    field :z_index, :integer, default: 0
    # DEFAULT tile ANIMATIONS for this cell — a LIST of `Animation` envelopes (id/kind/durationMs/tracks/…,
    # the exact shape the frontend engine reads), stored as jsonb. The fountain's WATER cells (water_c +
    # water_jet) carry the two chained rise/fade animations, copied onto the placed asset at stamp time so a
    # generated town's fountain animates BY DEFAULT. Nil on every other cell → the API omits the key, so a
    # non-animated cell serves EXACTLY as before.
    field :animations, {:array, :map}
    belongs_to :composition, Nebulith.Catalog.Composition

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(cell, attrs) do
    cell
    |> cast(attrs, [:composition_id, :dx, :dy, :level, :label, :walkable, :scale, :z_index, :animations])
    |> validate_required([:composition_id, :dx, :dy, :level, :label])
  end
end

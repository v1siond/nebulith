defmodule Nebulith.World.Cell do
  @moduledoc """
  ONE SQUARE OF THE GRID, and the three things a square owns.

  Its ground height, in blocks and signed so a pit is negative. Its surface, because a ramp is something
  the GROUND does and not a tile standing on it. And its own texture, which had nowhere to live at all.

  A cell holds tiles; it is not one. The vocabulary does not bend: CELL is the 2D square, BLOCK is the
  3D unit, TILE is what goes in.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @surfaces ~w(flat ramp_n ramp_e ramp_s ramp_w)

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "cells" do
    belongs_to :grid, Nebulith.World.Grid

    field :col, :integer
    field :row, :integer
    field :ground_height, :integer, default: 0
    field :surface, :string, default: "flat"
    field :submerge, :decimal, default: Decimal.new("0.0")
    field :texture_tile_id, :integer
    field :region_id, :binary_id

    has_many :cell_tiles, Nebulith.World.CellTile, foreign_key: :cell_id

    timestamps(type: :utc_datetime)
  end

  @castable ~w(grid_id col row ground_height surface submerge texture_tile_id region_id)a

  @doc "Every surface a cell can have. A ramp is one of them."
  def surfaces, do: @surfaces

  @doc false
  def changeset(cell, attrs) do
    cell
    |> cast(attrs, @castable)
    |> validate_required([:grid_id, :col, :row])
    |> validate_inclusion(:surface, @surfaces)
    |> unique_constraint([:grid_id, :col, :row])
  end
end

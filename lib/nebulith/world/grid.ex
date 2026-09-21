defmodule Nebulith.World.Grid do
  @moduledoc """
  THE SHAPE OF A MAP: how many cells, how big they draw, and how thick the body under them is.

  `cell_size`, `iso_scale` and `slab_blocks` are written on every save today and never read back, so a
  map that was authored at one cell size opens at whatever the editor happens to default to.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "grids" do
    belongs_to :map, Nebulith.World.Map

    field :cols, :integer, default: 50
    field :rows, :integer, default: 50
    field :cell_size, :integer, default: 16
    field :iso_scale, :decimal, default: Decimal.new("2.5")
    # The map BODY's thickness, under the ground. Not any tile's thickness.
    field :slab_blocks, :integer, default: 1
    field :generator_id, :binary_id
    field :seed, :integer
    field :spawn_col, :integer, default: 25
    field :spawn_row, :integer, default: 25

    has_many :cells, Nebulith.World.Cell, foreign_key: :grid_id

    timestamps(type: :utc_datetime)
  end

  @castable ~w(map_id cols rows cell_size iso_scale slab_blocks generator_id seed spawn_col spawn_row)a

  @doc false
  def changeset(grid, attrs) do
    grid
    |> cast(attrs, @castable)
    |> validate_required([:map_id, :cols, :rows])
    |> validate_number(:cols, greater_than: 0)
    |> validate_number(:rows, greater_than: 0)
    |> validate_number(:cell_size, greater_than: 0)
    |> unique_constraint(:map_id)
  end
end

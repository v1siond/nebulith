defmodule Nebulith.Catalog.Generator do
  @moduledoc """
  One runnable MAP GENERATOR, a named configuration inside a `GeneratorCategory`.

  Everything the run is steered by lives in `config`, a jsonb blob, because the knobs differ per
  category and adding one must not need a migration (the same reason a tile's `settings` is jsonb).
  The frontend reads it as one typed object; nothing is re-derived and nothing is defaulted in the
  frontend, a missing key means the generator does not do that thing.

  ## `config` shape

      %{
        "grid" => %{                       # T-120: a map is generated FROM the grid settings
          "cols" => %{"min" => 30, "max" => 45},
          "rows" => %{"min" => 24, "max" => 35},
          "cellSize" => 16,
          "isoScale" => 2.5
        },
        "settlement" => %{                 # only the settlement categories carry this
          "plazaSize" => 5,                # the road-free block reserved dead-centre
          "setback" => 1,                  # front-yard cells between a building and its street
          "roadWidth" => 4,
          "lotGap" => [1, 2],              # side-yard cells between neighbours (min/max)
          "maxPerFrontage" => 6,
          "buildingCap" => 18,
          "houseRange" => [4, 6],          # read by buildingMix only; the mix is what demands houses
          "houseWidths" => [3, 3, 4, 4, 4, 5, 6],  # WEIGHTED roll; the sizes themselves are composition data
          "natureMultiplier" => 1.15       # a town is leafy, a city is paved
        },
        "nature" => %{"groundCover" => 0.12, "flowers" => 0.06},
        "units" => %{                      # who the editor scatters after the stage is built
          "townsfolk" => 8,
          "enemies" => 0,
          "enemyTypes" => []
        },
        "buildings" => %{                  # the per-building material/colour roll
          "materials" => ["wall_brick", "wall_wood", "wall_stone"],
          "roofColors" => [...], "wallColors" => [...],
          "storeRoof" => "#235a96", "hospitalRoof" => "#2f7e50", "fixedWall" => "#f0f0ea"
        }
      }

  Building SIZES are deliberately absent: those are composition data already
  (`compositions.footprint_w/h`), read through `buildingCatalog`'s resolvers.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "generators" do
    field :key, :string
    field :name, :string
    field :description, :string
    field :layout, :string
    field :zones, {:array, :string}, default: []
    field :config, Nebulith.EctoJSON, default: %{}
    # What a person may switch ON for this generator: `[{key, label, type, default, requires}]`. A
    # variation is an option, not a new row. Declared, not inferred, so the panel renders whatever the backend says
    # exists.
    field :options, Nebulith.EctoJSON, default: []
    # WHICH ARCHETYPE this row runs ("town", "city", "forest", "cave", "temple"). The category key used to be
    # read as the variant, which cannot survive two kinds sharing one category. Nil on a subtype: it inherits its
    # parent's.
    field :variant, :string
    field :position, :integer, default: 0
    belongs_to :category, Nebulith.Catalog.GeneratorCategory
    # A SUBTYPE of another generator, Nil for
    # a top-level type. `children` is filled when the catalog is read as a tree, never persisted.
    belongs_to :parent, Nebulith.Catalog.Generator
    field :children, :any, virtual: true, default: []

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(generator, attrs) do
    generator
    |> cast(attrs, [:key, :name, :description, :layout, :variant, :zones, :config, :options, :position, :category_id, :parent_id])
    |> validate_required([:key, :name, :category_id])
    |> unique_constraint(:key)
    |> assoc_constraint(:category)
  end
end

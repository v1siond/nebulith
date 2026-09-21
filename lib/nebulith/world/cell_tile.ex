defmodule Nebulith.World.CellTile do
  @moduledoc """
  A TILE, PLACED. The one table that carries the setting vocabulary.

  53 columns, every one of them a control a person actually uses in the Size and position, Appearance
  or Behaviour modal. They are COLUMNS WITH DEFAULTS, and that is the entire point of this phase.

  ## Why a default belongs here and not in the renderer

  Measured on the live catalogue: `display` is stated on 26 of 636 tiles and `shape` on 0, against 116
  places in the engine where a renderer reads a served value through `?? <some literal>`. So the
  renderers hold 116 opinions about what a tile looks like when nobody said, and the database holds
  none. A default that lives in a renderer is a default that differs between renderers.

  > The default shouldn't happen at the engine level, it should happen at the setting level.

  ## The vocabulary, which does not bend

  **DEPTH is a size in every view.** It is how far the tile reaches into the screen. Today it stretches
  the sprite from above and thins the block from the side, which is one control answering two different
  questions depending on the camera.

  **THICKNESS is not width.** Pulling a face in leaves the block its own size and makes it thin. That is
  what a trunk is: a full cell of tree with a narrow stem in it.

  **SPAN counts whole cells.** Depth is a fraction of ONE cell, span is a count of cells. Both were
  called depth somewhere, and the type definition flagged the clash in its own comment.

  **There is no zoom.** Zoom is the three axes set to the same number, so it multiplies them instead of
  replacing them: Width 2 with Zoom 2 draws at 4 and nothing in the panel says so (D20).

  **`stack_at` defaults to 1.** A generator sets 0 for grass and water because that suits their context.

  **`rotation` is in DEGREES**, which is what the control shows. Radians in the column meant every read
  and every write converted, and a value copied between two places that disagreed was 57x wrong.

  **No walkable, no blocking, no blocked, no blocks_movement, no is_solid.** A cell is blocked where a
  collision box says so.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @displays ~w(all_faces single)
  @shapes ~w(square circle cone)
  @surfaces ~w(plain tiled ornament)
  @headings ~w(n e s w)
  # The four iso diagonals, the same four the engine's DepthDir names.
  @axes ~w(right-up left-up left-down right-down)

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "cell_tiles" do
    ## IDENTITY AND PLACEMENT (9)
    belongs_to :cell, Nebulith.World.Cell
    field :composition_id, :integer
    field :tile_id, :integer
    field :dx, :integer, default: 0
    field :dy, :integer, default: 0
    field :level, :integer, default: 0
    field :stack_index, :integer, default: 0
    field :composition_instance_id, :binary_id

    ## SIZE (3)
    field :width, :decimal, default: Decimal.new("1.0")
    field :height, :decimal, default: Decimal.new("1.0")
    field :depth, :decimal, default: Decimal.new("1.0")

    ## THICKNESS (5)
    field :thickness_lu, :decimal, default: Decimal.new("1.0")
    field :thickness_ru, :decimal, default: Decimal.new("1.0")
    field :thickness_ld, :decimal, default: Decimal.new("1.0")
    field :thickness_rd, :decimal, default: Decimal.new("1.0")
    field :thickness_axis, :string

    ## SPAN (5)
    field :span_forward, :integer, default: 1
    field :span_back, :integer, default: 1
    field :span_perp, :integer, default: 1
    field :span_perp_back, :integer, default: 1
    field :span_axis, :string

    ## POSE (6)
    field :nudge_x, :decimal, default: Decimal.new("0.0")
    field :nudge_y, :decimal, default: Decimal.new("0.0")
    field :rotation, :decimal, default: Decimal.new("0.0")
    field :mirror, :boolean, default: false
    field :art_scale, :decimal, default: Decimal.new("1.0")
    field :muzzle, :decimal

    ## ORDER AND SLIDE (4)
    field :slide_amount, :decimal, default: Decimal.new("0.0")
    field :slide_direction, :string
    field :draw_order, :integer, default: 0
    field :stack_level, :integer, default: 0

    ## STACKING (2)
    field :stack_at, :integer, default: 1
    field :act_as_tile, :boolean, default: false

    ## APPEARANCE (19)
    field :display, :string, default: "all_faces"
    field :transparent, :boolean, default: false
    field :shape, :string, default: "square"
    field :color, :string
    field :color_role, :string
    field :opacity, :decimal, default: Decimal.new("1.0")
    field :brightness, :decimal, default: Decimal.new("1.0")
    field :bg_color, :string
    field :side_color, :string
    field :leaf_color, :string
    field :fade_near, :boolean, default: false
    field :cutaway_near, :boolean, default: false
    field :min_alpha, :decimal
    field :sign_text, :string
    field :sign_color, :string
    field :foliage, :boolean, default: false
    field :water_heading, :string
    field :surface, :string, default: "plain"
    field :pinned, :boolean, default: false

    ## MOTION (2)
    #
    # The one place a placement is allowed a shapeless payload, and it earns it under law 8: an animation
    # is a list of keyframes, each a partial transform with its own easing and trigger, and nothing
    # selects a map by what its tiles animate.
    #
    # It cannot be re-derived from the label the way height and display are. A fountain has nine
    # `water_c` cells and three of them rise and fade, so animating is a fact about this PLACEMENT and
    # not about the tile. Leaving it off the table is why a fountain stopped moving after a reload.
    field :animations, {:array, :map}
    # The clock origin the loop is measured from. A composition's defaults anchor at 0 so every fountain
    # on a map stays in step.
    #
    # THE DEFAULT HAS TO BE HERE, not only on the column. A whole map is written with `insert_all`, which
    # names every column, and a column DEFAULT only applies to a column that was left OUT: naming it with
    # a nil sends NULL and the not-null constraint rejects the row. That is why every other decimal in
    # this schema carries one, and leaving it off made every save of every map fail at once.
    field :placed_at, :decimal, default: Decimal.new("0")

    has_many :views, Nebulith.World.CellTileView, foreign_key: :cell_tile_id

    timestamps(type: :utc_datetime)
  end

  # What the schema itself owns and a caller never sets.
  @not_settable [:id, :inserted_at, :updated_at]

  @doc """
  Every authorable column on a placed tile, READ OFF THE SCHEMA rather than typed out again.

  This is the fix for the defect the plan names: the frontend's placement copy is a hand-written list
  that silently drops 21 of a placement's 41 fields, so a caller sets a value, nothing complains, and
  the value is simply gone. A list that is derived cannot fall behind the thing it lists.

  Derived at call time because `__schema__/1` does not exist until the module finishes compiling, which
  is exactly the constraint that makes people write the list out by hand instead.

  It is what the API serves as its field list and what the round-trip gate compares, so adding a column
  adds it in all three places at once.
  """
  def settable_fields, do: __MODULE__.__schema__(:fields) -- @not_settable

  @doc "Every enum column and the values it admits, so one statement of them reaches the API and the UI."
  def vocabularies do
    %{
      display: @displays,
      shape: @shapes,
      surface: @surfaces,
      water_heading: @headings,
      thickness_axis: @axes,
      span_axis: @axes,
      slide_direction: @axes
    }
  end

  @doc false
  def changeset(cell_tile, attrs) do
    cell_tile
    |> cast(attrs, settable_fields())
    |> validate_placed_or_preset()
    |> validate_inclusion(:display, @displays)
    |> validate_inclusion(:shape, @shapes)
    |> validate_inclusion(:surface, @surfaces)
    |> validate_inclusion(:water_heading, @headings)
    |> validate_inclusion(:thickness_axis, @axes)
    |> validate_inclusion(:span_axis, @axes)
    |> validate_inclusion(:slide_direction, @axes)
    |> check_constraint(:cell_id, name: :cell_tiles_placed_or_preset)
  end

  # A tile is either PLACED on a map or part of a PRESET, never both and never neither (D14).
  defp validate_placed_or_preset(changeset) do
    cell_id = get_field(changeset, :cell_id)
    composition_id = get_field(changeset, :composition_id)

    placed_or_preset(changeset, cell_id, composition_id)
  end

  defp placed_or_preset(changeset, nil, nil) do
    add_error(changeset, :cell_id, "a tile is placed on a cell or belongs to a composition")
  end

  defp placed_or_preset(changeset, cell_id, composition_id)
       when not is_nil(cell_id) and not is_nil(composition_id) do
    add_error(
      changeset,
      :cell_id,
      "a tile cannot be both placed on a cell and part of a composition"
    )
  end

  defp placed_or_preset(changeset, _cell_id, _composition_id), do: changeset
end

defmodule Nebulith.Catalog.TileSettings do
  @moduledoc """
  THE SETTINGS A TILE HAS. One list, in Elixir, served to the frontend.

  `tiles.settings` and `composition_cells.settings` are both untyped `:map` columns, so nothing anywhere
  said which keys exist. That is how `scaleY` got written onto all 22 trees: it is read by the renderer as a
  Height multiplier and NO control in the editor writes it, so a tree was built in a field a person cannot
  reach, and the panel's own Height edits a different number (`height`, the tile's block height). A hand
  tuned value and a seeded value could never correspond.

  *"ENSURE ALL COMPOSITION SECTIONS/TILES HAVE EXACTLY THE SAME SETTINGS WE HAVE ON THE SCHEMA … WE CAN HAVE
  DEFAULT VALUES FOR EACH, BUT ANY COMPOSITION SHOULD SET ALL SETTINGS ON THEIR TILES … I'D GO AS FAR AS TO
  PASS THE SCHEMA FROM ELIXIR ECTO ALL THE WAY DOWN TO THE JS SIDE"*.

  So this is the vocabulary, and it is the EDITOR'S vocabulary, because the panel is what a person sets:

  | panel control | field here | was stored as |
  |---|---|---|
  | Width | `width` | `scaleX` |
  | Height | `height` | `scaleY` |
  | Depth | `depth` | `scaleZ` |
  | Zoom | `zoom` | `scale` |
  | How much of its own cell it fills | `thickness` | `thickness` |
  | How many cells it spans | `footprint` | `footprint` |
  | Left ↔ Right / Up ↕ Down / Rotate / Face the other way | `pose` | `pose` |
  | Draw order | `draw_order` | `zIndex` |

  Everything below `pose` is appearance and behaviour, which the other panel sections set.

  ## The rule this exists to enforce

  A composition cell states EVERY field. Not the two somebody remembered: all of them, at their default
  where it has no opinion. A half-stated cell is how a tree ends up thin in a field the editor cannot edit
  while its Width sits at a value nobody chose.
  """

  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  embedded_schema do
    # ── SIZE, the "Size & position" panel ────────────────────────────────────
    # Multipliers over the tile's own art, 1 = native. Width and Depth stretch the block on the ground
    # plane; Height grows it UP. Zoom scales all three together.
    field :width, :float, default: 1.0
    field :height, :float, default: 1.0
    field :depth, :float, default: 1.0
    field :zoom, :float, default: 1.0

    # HOW MUCH OF ITS OWN CELL IT FILLS, per iso direction, 1 = the whole cell. This is THICKNESS, and it is
    # not width: pulling a face in leaves the block its own size and makes it thin, which is what a trunk is.
    field :thickness, :map, default: %{}

    # HOW MANY CELLS IT SPANS, per iso direction, 1 = its own cell only.
    field :footprint, :map, default: %{}

    # WHERE IT SITS inside the cell: `dx` left/right, `dy` up/down, `rot` radians, `flip` faces it the other
    # way. A canopy sits ON its trunk by stating `dy`, which is the only thing that links the two.
    field :pose, :map, default: %{}

    # DRAW ORDER, higher draws in front, whatever the depth sort says.
    field :draw_order, :integer, default: 0

    # ── APPEARANCE ───────────────────────────────────────────────────────────
    # `single` draws ONE face, a picture standing in the cell; `all-faces` wraps the block. A plant, a flower
    # and an ornament are single; a wall is all-faces.
    field :display, :string, default: "all-faces"
    field :transparent, :boolean, default: false
    field :shape, :string, default: "square"
    field :color, :string
    field :colors, :map, default: %{}
    field :fade_near, :boolean, default: false
    field :foliage, :boolean, default: false

    # ── BEHAVIOUR ────────────────────────────────────────────────────────────
    # The boxes that stop you. Empty means you walk through it.
    field :collision, {:array, :map}, default: []
    # Which level of its own cell it stacks at. 0 = at your feet, so the next tile lands on the ground.
    field :stack_at, :integer, default: 0
    # The cell behaves as though a tile is already in it, so the next one stacks ON TOP (a road, a deck).
    field :act_as_tile, :boolean, default: false
  end

  @fields ~w(width height depth zoom thickness footprint pose draw_order display transparent shape
             color colors fade_near foliage collision stack_at act_as_tile)a

  @doc "Every field name, in order. The frontend reads this so both sides share one list."
  def fields, do: @fields

  @doc """
  The complete settings map, every field at its default, as the JSON keys the wire uses.

  A composition cell starts from this and overrides what it means to say, so no cell is ever half stated.
  """
  def defaults, do: to_wire(%__MODULE__{})

  @doc "Validates a settings map against the schema. An unknown key is an error, not a shrug."
  def changeset(settings \\ %__MODULE__{}, attrs) do
    cast(settings, attrs, @fields)
  end

  @doc """
  The wire shape: camelCase keys, which is what the frontend reads, with nothing dropped.

  `draw_order` → `drawOrder`, `fade_near` → `fadeNear`, `stack_at` → `stackAt`, `act_as_tile` → `actAsTile`.
  """
  def to_wire(%__MODULE__{} = s) do
    %{
      "width" => s.width,
      "height" => s.height,
      "depth" => s.depth,
      "zoom" => s.zoom,
      "thickness" => s.thickness,
      "footprint" => s.footprint,
      "pose" => s.pose,
      "drawOrder" => s.draw_order,
      "display" => s.display,
      "transparent" => s.transparent,
      "shape" => s.shape,
      "color" => s.color,
      "colors" => s.colors,
      "fadeNear" => s.fade_near,
      "foliage" => s.foliage,
      "collision" => s.collision,
      "stackAt" => s.stack_at,
      "actAsTile" => s.act_as_tile
    }
  end

  @doc """
  The schema ITSELF, served so the frontend has the same list rather than a second copy of it.

  Each entry says the field's wire name, its type and its default, which is everything a caller needs to
  build a complete settings map or to check one.
  """
  def describe do
    defaults = to_wire(%__MODULE__{})

    for {wire, type} <- [
          {"width", "float"},
          {"height", "float"},
          {"depth", "float"},
          {"zoom", "float"},
          {"thickness", "map"},
          {"footprint", "map"},
          {"pose", "map"},
          {"drawOrder", "integer"},
          {"display", "string"},
          {"transparent", "boolean"},
          {"shape", "string"},
          {"color", "string"},
          {"colors", "map"},
          {"fadeNear", "boolean"},
          {"foliage", "boolean"},
          {"collision", "list"},
          {"stackAt", "integer"},
          {"actAsTile", "boolean"}
        ] do
      %{"key" => wire, "type" => type, "default" => Map.get(defaults, wire)}
    end
  end
end

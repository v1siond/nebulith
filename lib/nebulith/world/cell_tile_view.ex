defmodule Nebulith.World.CellTileView do
  @moduledoc """
  WHERE A TILE HAS TO DIFFER BETWEEN CAMERAS, and only there.

  Three numbers are typed into the renderers today: iso `2.2`, 2D `1.5`, top `1.0`. They move every
  tile at once, so a tile that reads correctly in iso can be unreadable from above and there is no way
  to say so.

  SPARSE on purpose. A row exists only where a tile genuinely needs to differ, and no row means the
  base columns on `cell_tiles` apply. This is the one part of the schema with a known history of being
  designed and not built: per-view overrides were approved on 2026-07-05 and zero of 366 tiles ever
  carried one.

  iso and top only (D16). 2D stays behind its flag and gets no authoring surface until it comes back.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @views ~w(iso top)

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "cell_tile_views" do
    belongs_to :cell_tile, Nebulith.World.CellTile

    field :view, :string
    field :width, :decimal
    field :height, :decimal
    field :depth, :decimal
    field :nudge_x, :decimal
    field :nudge_y, :decimal
    field :anchor_lift, :decimal

    timestamps(type: :utc_datetime)
  end

  @castable ~w(cell_tile_id view width height depth nudge_x nudge_y anchor_lift)a

  @doc "The cameras that get authored rows."
  def views, do: @views

  @doc false
  def changeset(view, attrs) do
    view
    |> cast(attrs, @castable)
    |> validate_required([:cell_tile_id, :view])
    |> validate_inclusion(:view, @views)
    |> unique_constraint([:cell_tile_id, :view])
  end
end

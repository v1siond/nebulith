defmodule Nebulith.World.Map do
  @moduledoc """
  A MAP. What a place IS, separate from the shape of its grid.

  Note for anyone aliasing this: `alias Nebulith.World.Map` shadows Elixir's own `Map` for the whole
  file. Use the full name, or `alias Nebulith.World.Map, as: WorldMap`.

  A dungeon is a ZONE, not a different kind of thing, so there is no dungeon table and never will be.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "maps" do
    field :name, :string
    field :description, :string
    field :level_id, :binary_id
    field :tileset_id, :integer
    field :zone_id, :binary_id

    # Optimistic locking. Two editors on one map used to mean the last save won silently.
    field :lock_version, :integer, default: 1

    # THE MIGRATION BRIDGE. Which `Template` row this map came from, for as long as both exist.
    # `Template` is not in the target schema; this column dies with it.
    field :template_id, :string

    has_one :grid, Nebulith.World.Grid, foreign_key: :map_id

    timestamps(type: :utc_datetime)
  end

  @castable ~w(name description level_id tileset_id zone_id template_id)a

  @doc false
  def changeset(map, attrs) do
    map
    |> cast(attrs, @castable)
    |> validate_required([:name])
    |> optimistic_lock(:lock_version)
  end
end

defmodule Nebulith.Catalog.Zone do
  @moduledoc """
  One SEASON and everything it looks like: its ground palette, the tile it wears for trees, decor and
  flowers, the blooms it scatters, and its temple and cave palettes.

  Each group is jsonb because the generator reads each one whole and they differ in shape. Seasons that do
  not flower carry `flowers: nil` rather than an empty list — "this season has no blooms" and "this season
  blooms with nothing" are different statements, and the generator treats them differently.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "zones" do
    field :key, :string
    field :name, :string
    field :position, :integer, default: 0
    field :palette, Nebulith.EctoJSON, default: %{}
    field :tiles, Nebulith.EctoJSON, default: %{}
    field :flowers, Nebulith.EctoJSON
    field :temple, Nebulith.EctoJSON, default: %{}
    field :cave, Nebulith.EctoJSON, default: %{}

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(zone, attrs) do
    zone
    |> cast(attrs, [:key, :name, :position, :palette, :tiles, :flowers, :temple, :cave])
    |> validate_required([:key, :name])
    |> unique_constraint(:key)
  end
end

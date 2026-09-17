defmodule Nebulith.Catalog.Item do
  @moduledoc """
  One item in the catalog, a weapon, a piece of armour, or a consumable.

  The stat block lives in `stats` because a weapon's and an armour piece's are genuinely different shapes;
  the columns carry only what the catalog is queried by.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @slots ~w(weapon armor consumable)

  schema "items" do
    field :slug, :string
    field :name, :string
    field :slot, :string
    field :kind, :string
    field :stats, :map, default: %{}
    field :starter_kits, {:array, :string}, default: []
    field :position, :integer, default: 0

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(item, attrs) do
    item
    |> cast(attrs, [:slug, :name, :slot, :kind, :stats, :starter_kits, :position])
    |> validate_required([:slug, :name, :slot])
    |> validate_inclusion(:slot, @slots)
    |> unique_constraint(:slug)
  end
end

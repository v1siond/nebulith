defmodule Nebulith.Catalog.Ability do
  @moduledoc """
  One ability in the registry. `animation` names the FX tile it plays, the tile carries the tint, so an
  ability never declares a colour of its own.
  """
  use Ecto.Schema
  import Ecto.Changeset

  schema "abilities" do
    field :slug, :string
    field :name, :string
    field :description, :string
    field :category, :string
    field :animation, :string
    field :cooldown_ms, :integer, default: 0
    field :effect, :map, default: %{}
    field :position, :integer, default: 0

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(ability, attrs) do
    ability
    |> cast(attrs, [:slug, :name, :description, :category, :animation, :cooldown_ms, :effect, :position])
    |> validate_required([:slug, :name, :category])
    |> unique_constraint(:slug)
  end
end

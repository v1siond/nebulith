defmodule Nebulith.Catalog.GameRule do
  @moduledoc """
  One named bundle of tunable RULES, as `key → value`.

  `combat` holds the coefficients the damage maths multiplies by; `stats` holds the default stat lines
  a player, an enemy and an npc start from. The FORMULAS are not here: `(weapon.baseDamage + strength)
  * multiplier` is the shape of the algorithm, and the rule is that the frontend So the shape stays in
  code and every number it uses comes from here.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "game_rules" do
    field :key, :string
    field :value, Nebulith.EctoJSON, default: %{}

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(rule, attrs) do
    rule
    |> cast(attrs, [:key, :value])
    |> validate_required([:key])
    |> unique_constraint(:key)
  end
end

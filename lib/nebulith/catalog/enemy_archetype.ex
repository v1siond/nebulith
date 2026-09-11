defmodule Nebulith.Catalog.EnemyArchetype do
  @moduledoc """
  One authored CREATURE — the stat block, pace, reach and attack pattern an enemy of this kind fights
  with. Alexander, 2026-09-06: *"enemies are a separate configurable entity each one with their own
  patterns and attacks"*.

  `stats` and `attack` are jsonb because each is ONE thing the frontend reads whole: a stat line, and
  an attack pattern the combat tick already knows how to walk. Splitting either into columns would buy
  nothing and cost a migration every time a creature gains a knob.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "enemy_archetypes" do
    field :key, :string
    field :name, :string
    field :stats, Nebulith.EctoJSON, default: %{}
    field :move_delay_ms, :integer
    field :reach_cells, :integer
    field :attack, Nebulith.EctoJSON, default: %{}
    field :position, :integer, default: 0

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(archetype, attrs) do
    archetype
    |> cast(attrs, [:key, :name, :stats, :move_delay_ms, :reach_cells, :attack, :position])
    |> validate_required([:key, :name, :move_delay_ms, :reach_cells])
    |> unique_constraint(:key)
  end
end

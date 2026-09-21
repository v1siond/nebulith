defmodule Nebulith.Repo.Migrations.CreateCombatCatalog do
  use Ecto.Migration

  @moduledoc """
  CREATURES AND COMBAT AS DATA.

  and on 2026-09-06 about enemies specifically:

  Two tables, because they are two different things:

  * `enemy_archetypes` — one authored creature: its stat block, how fast it moves, how far it reaches,
    and the attack pattern it fires. Nine of them were a frontend `Record` (`game/archetypes.ts`).
  * `game_rules` — the tunable COEFFICIENTS the combat maths runs on, as `key → jsonb`. A key/value
    table rather than a column per knob for the same reason a generator's `config` is jsonb: the knobs
    are heterogeneous and adding one must not need a migration. The FORMULAS stay in the frontend,
    because the shape of an algorithm is not data — only its numbers are.
  """

  def change do
    create table(:enemy_archetypes, primary_key: false) do
      add :id, :binary_id, primary_key: true

      # The engine's own archetype id (grunt / brute / archer …), so nothing has to translate names.
      add :key, :string, null: false
      add :name, :string, null: false

      # strength / intelligence / defense / maxHp / dodge — one blob, because a stat line is one thing.
      add :stats, :map, null: false, default: %{}
      add :move_delay_ms, :integer, null: false
      add :reach_cells, :integer, null: false

      # `{mode, attacks: [{mode, damage, cooldownMs, animation, reachCells, name}]}` — the pattern the
      # combat tick already speaks, stored verbatim so nothing reshapes it on the way in or out.
      add :attack, :map, null: false, default: %{}
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:enemy_archetypes, [:key])

    create table(:game_rules, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :value, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:game_rules, [:key])
  end
end

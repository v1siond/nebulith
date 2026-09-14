defmodule Nebulith.Repo.Migrations.DropEnemyArchetypes do
  use Ecto.Migration

  @moduledoc """
  Drop `enemy_archetypes`, a few hours old and wrong.

  The reasoning did not survive being written down. The table held nine archetypes for eight creatures, one
  each, and a frontend `Record` translated creature → archetype. Reuse was the only argument for a separate
  table and there was none: a second vocabulary whose whole job is to be translated back is not a concept.

  A creature's numbers now live on the creature's own tile row, next to the role, height and collision it
  already carries (`TileSource.seed_unit_combat/0`). `game_rules` stays — the damage coefficients and the
  default stat lines belong to the fight, not to any one creature.
  """

  def up do
    drop table("enemy_archetypes")
  end

  def down do
    create table(:enemy_archetypes, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :name, :string, null: false
      add :stats, :map, null: false, default: %{}
      add :move_delay_ms, :integer, null: false
      add :reach_cells, :integer, null: false
      add :attack, :map, null: false, default: %{}
      add :position, :integer, null: false, default: 0
      timestamps(type: :utc_datetime)
    end

    create unique_index(:enemy_archetypes, [:key])
  end
end

defmodule Nebulith.Repo.Migrations.CreateLevels do
  @moduledoc """
  THE LEVEL LAYER. and on why it is a real layer and not a label:

  Until now a game held templates directly (`game_templates`), flat, so there was nowhere to say "these four
  maps are one level". That is also why "Manage levels" showed a list of GAMES: there were no levels to
  show, so the screen showed the only thing that existed.

  `game_templates` is left in place and untouched. It still carries the game's own ordering and the flow the
  editor reads, and dropping it in the same change that introduces levels would make one migration responsible
  for two different things. Levels are additive here; moving the flow onto them is its own step.

  SCHEMA ONLY. Giving every existing game its "Level 1" is DATA and lives in
  `Nebulith.DataMigration.BackfillLevelsFromGameTemplates`, run by `mix nebulith.data_migrate`.
  """
  use Ecto.Migration

  def up do
    create table(:levels, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :game_id, references(:games, type: :binary_id, on_delete: :delete_all), null: false
      add :name, :string, null: false
      add :description, :string
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:levels, [:game_id])
    # Two levels in one game cannot share a slot; different games are free to both have a "1-1".
    create unique_index(:levels, [:game_id, :position])

    create table(:level_templates, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :level_id, references(:levels, type: :binary_id, on_delete: :delete_all), null: false

      # The Template table is Prisma-owned, so no cross-owner FK, the same rule game_templates follows.
      add :template_id, :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:level_templates, [:level_id])
    create index(:level_templates, [:template_id])
    create unique_index(:level_templates, [:level_id, :template_id])
  end

  def down do
    drop table(:level_templates)
    drop table(:levels)
  end
end

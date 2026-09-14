defmodule Nebulith.Repo.Migrations.CreateLevels do
  @moduledoc """
  THE LEVEL LAYER. and on why it is a real layer and not a label:

  Until now a game held templates directly (`game_templates`), flat, so there was nowhere to say "these four
  maps are one level". That is also why "Manage levels" showed him a list of GAMES: there were no levels to
  show, so the screen showed the only thing that existed.

  `game_templates` is left in place and untouched. It still carries the game's own ordering and the flow the
  editor reads, and dropping it in the same change that introduces levels would make one migration responsible
  for two different things. Levels are additive here; moving the flow onto them is its own step.
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
      # The Template table is Prisma-owned, so no cross-owner FK — the same rule game_templates follows.
      add :template_id, :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:level_templates, [:level_id])
    create index(:level_templates, [:template_id])
    create unique_index(:level_templates, [:level_id, :template_id])

    # BACKFILL. Every existing game gets one level holding everything it already had, so nobody opens their
    # game tomorrow and finds it empty. Named "Level 1" rather than after the game: it is the first level OF
    # that game, and the game's own name is already on the game.
    execute("""
    INSERT INTO levels (id, game_id, name, description, position, inserted_at, updated_at)
    SELECT gen_random_uuid(), g.id, 'Level 1', NULL, 0, NOW(), NOW()
    FROM games g
    """)

    execute("""
    INSERT INTO level_templates (id, level_id, template_id, position, inserted_at, updated_at)
    SELECT gen_random_uuid(), l.id, gt.template_id, gt.position, NOW(), NOW()
    FROM game_templates gt
    JOIN levels l ON l.game_id = gt.game_id AND l.position = 0
    """)
  end

  def down do
    drop table(:level_templates)
    drop table(:levels)
  end
end

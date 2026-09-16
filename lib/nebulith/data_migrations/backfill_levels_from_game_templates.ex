defmodule Nebulith.DataMigration.BackfillLevelsFromGameTemplates do
  @moduledoc """
  Every existing game gets one level holding everything it already had, so nobody opens their game tomorrow
  and finds it empty.

  The level is named "Level 1" rather than after the game: it is the first level OF that game, and the game's
  own name is already on the game. Its templates come across from `game_templates` in the position they were
  already in.

  The TABLES are schema and stay in the migration that creates them. The backfill is data and lives here,
  which also means it runs against the finished schema instead of a half-built one.

  Idempotent: a game that already has a level is skipped, and a template already on a level is not added
  twice.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: levels} =
      Repo.query!("""
      INSERT INTO levels (id, game_id, name, description, position, inserted_at, updated_at)
      SELECT gen_random_uuid(), g.id, 'Level 1', NULL, 0, NOW(), NOW()
        FROM games g
       WHERE NOT EXISTS (SELECT 1 FROM levels l WHERE l.game_id = g.id)
      """)

    %{num_rows: placements} =
      Repo.query!("""
      INSERT INTO level_templates (id, level_id, template_id, position, inserted_at, updated_at)
      SELECT gen_random_uuid(), l.id, gt.template_id, gt.position, NOW(), NOW()
        FROM game_templates gt
        JOIN levels l ON l.game_id = gt.game_id AND l.position = 0
       WHERE NOT EXISTS (
             SELECT 1 FROM level_templates lt
              WHERE lt.level_id = l.id AND lt.template_id = gt.template_id
       )
      """)

    Logger.info(
      "[data_migrate] levels backfilled (#{levels} levels, #{placements} templates placed)"
    )

    :ok
  end
end

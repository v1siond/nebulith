defmodule Nebulith.DataMigration.EveryGameHasAnOwnerAndAStyle do
  @moduledoc """
  A GAME THAT BELONGS TO NOBODY CANNOT BE EDITED BY ANYBODY.

  Phase 1 gave `games` an owner, a default art style and a visibility. The rows that already existed have
  none of the three, and under the new rules an ownerless game is a game no one may touch.

  So: every ownerless game goes to an admin, and every game without a default art style gets the first
  tileset by position, which is what the frontend assumed when it hardcoded `ascii`. The difference is that
  the assumption is now a row a person can change.

  Idempotent. It only ever fills a NULL, so re-running it cannot take a game off the person it belongs to
  or change a style somebody chose.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: owned} =
      Repo.query!("""
      UPDATE games
         SET owner_id = (SELECT id FROM users WHERE is_admin ORDER BY inserted_at LIMIT 1),
             updated_at = NOW()
       WHERE owner_id IS NULL
         AND EXISTS (SELECT 1 FROM users WHERE is_admin)
      """)

    %{num_rows: styled} =
      Repo.query!("""
      UPDATE games
         SET default_tileset_id = (SELECT id FROM tilesets ORDER BY position, id LIMIT 1),
             updated_at = NOW()
       WHERE default_tileset_id IS NULL
         AND EXISTS (SELECT 1 FROM tilesets)
      """)

    # A game reads its settings without having to handle a missing row, so every game has one.
    %{num_rows: settled} =
      Repo.query!("""
      INSERT INTO game_settings (id, game_id, inserted_at, updated_at)
      SELECT gen_random_uuid(), g.id, NOW(), NOW()
        FROM games g
       WHERE NOT EXISTS (SELECT 1 FROM game_settings s WHERE s.game_id = g.id)
      """)

    Logger.info("[data_migrate] #{owned} game(s) given an owner, #{styled} a default style, #{settled} their settings")
    :ok
  end
end

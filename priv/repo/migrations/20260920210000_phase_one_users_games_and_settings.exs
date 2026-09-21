defmodule Nebulith.Repo.Migrations.PhaseOneUsersGamesAndSettings do
  @moduledoc """
  PHASE 1 OF THE REBUILD: the spine. Everything in the app belongs to a game, and a game belongs to a user.

  From the plan in `docs/SPEC.md` §8, phase 1. Three changes:

    * `users`, which did not exist. `admin_users` did, holding the one backend account, and it moves here so
      there is ONE table that answers "who is this person". Two user tables is the one-fact-two-owners
      problem this rebuild exists to end, so the old one is dropped in the same migration rather than left
      to drift.

    * `games` gains its owner, its default art style and its visibility. The art style is the correction he
      asked for directly: *"I like the versatility of having one art style per map, but I do want to be able
      to set the default at the game table level instead of hardcoding ascii."* Today the style is a marker
      asset hidden at cell (-1, -1) with ascii assumed when the marker is absent.

    * `game_settings`, which did not exist. It takes `MAP_SIZE_MAX`, a frontend constant whose own comment
      says "100, for now", and the discovery switches, so changing either stops needing a deploy.

  `levels` already has what it needs (game_id, name, position) and is untouched.

  Email is matched case-insensitively through a unique index on `lower(email)` rather than a citext column,
  because this database has only plpgsql loaded and requiring an extension would make the migration need a
  privilege it does not otherwise need.
  """
  use Ecto.Migration

  def up do
    create table(:users, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :email, :string, null: false
      add :hashed_password, :string, null: false
      add :display_name, :string
      # Gates generator authoring, with two factor on top of it later: "Since it's admin only
      # functionality, it should be fine on security side, we'll have two factor or something".
      add :is_admin, :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:users, ["lower(email)"], name: :users_email_lower_index)

    # The existing backend accounts become users, keeping their hashes so nobody has to reset a password.
    execute """
    INSERT INTO users (id, email, hashed_password, display_name, is_admin, inserted_at, updated_at)
    SELECT gen_random_uuid(),
           a.email,
           a.hashed_password,
           split_part(a.email, '@', 1),
           TRUE,
           NOW(),
           NOW()
      FROM admin_users a
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(a.email))
    """

    drop table(:admin_users)

    alter table(:games) do
      add :owner_id, references(:users, type: :uuid, on_delete: :delete_all)

      # A bigint because `tilesets` is a bigserial table. Nilify rather than cascade: deleting an art style
      # must not delete somebody's game.
      add :default_tileset_id, references(:tilesets, type: :bigint, on_delete: :nilify_all)

      # Private by default. "a platform and a community where people can play with their ideas openly"
      # is what unlisted and public are for, and neither is the default.
      add :visibility, :string, null: false, default: "private"
      add :plays, :integer, null: false, default: 0
    end

    create index(:games, [:owner_id])
    create index(:games, [:visibility])

    create constraint(:games, :games_visibility_known,
             check: "visibility IN ('private', 'unlisted', 'public')"
           )

    create table(:game_settings, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :game_id, references(:games, type: :uuid, on_delete: :delete_all), null: false

      # Was MAP_SIZE_MAX in the frontend. A number in a row, so "100, for now" can stop being for now.
      add :map_size_max, :integer, null: false, default: 100
      add :discovery_on, :boolean, null: false, default: false
      add :discovery_radius, :integer, null: false, default: 6
      add :discovery_remembers, :boolean, null: false, default: true
      add :default_view, :string, null: false, default: "iso"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:game_settings, [:game_id])

    create constraint(:game_settings, :game_settings_view_known,
             check: "default_view IN ('iso', 'top', '2d')"
           )

    # Every game that already exists gets its settings row, so reading them never has to handle a missing one.
    execute """
    INSERT INTO game_settings (id, game_id, inserted_at, updated_at)
    SELECT gen_random_uuid(), g.id, NOW(), NOW()
      FROM games g
     WHERE NOT EXISTS (SELECT 1 FROM game_settings s WHERE s.game_id = g.id)
    """
  end

  def down do
    drop table(:game_settings)

    drop constraint(:games, :games_visibility_known)

    alter table(:games) do
      remove :plays
      remove :visibility
      remove :default_tileset_id
      remove :owner_id
    end

    create table(:admin_users) do
      add :email, :string, null: false
      add :hashed_password, :string, null: false
      add :role, :string, null: false, default: "admin"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:admin_users, [:email])

    execute """
    INSERT INTO admin_users (email, hashed_password, role, inserted_at, updated_at)
    SELECT u.email, u.hashed_password, 'admin', NOW(), NOW() FROM users u WHERE u.is_admin
    """

    drop table(:users)
  end
end

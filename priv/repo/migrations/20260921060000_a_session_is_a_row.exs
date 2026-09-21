defmodule Nebulith.Repo.Migrations.ASessionIsARow do
  @moduledoc """
  A LOGGED-IN SESSION BECOMES A ROW.

  The engine pages are behind a login now, and the cookie that proves it carries a random token rather
  than a user id. The difference is revocation: with a row, changing a password can end the sessions
  opened under the old one and a person can be signed out. With an id in a signed cookie there is
  nothing on the server to delete, so a stolen cookie is valid until the whole app's secret rotates.

  See docs/AUTH.md.
  """
  use Ecto.Migration

  def change do
    create table(:users_tokens, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :user_id, references(:users, type: :binary_id, on_delete: :delete_all), null: false

      # 32 raw bytes from :crypto.strong_rand_bytes/1. Not hashed: unlike a password this is already
      # high-entropy and used nowhere else. Not base64: encoding is a transport concern.
      add :token, :binary, null: false

      # What the token is FOR. Only "session" exists today; password reset and email confirmation are
      # the same table in the pattern this follows, which is why the column is here rather than implied.
      add :context, :string, null: false

      timestamps(type: :utc_datetime, updated_at: false)
    end

    # Deleting every session a person has is one query, which is what "sign out everywhere" is.
    create index(:users_tokens, [:user_id])

    # The lookup on every single authenticated request. Unique because a token IS the identifier.
    create unique_index(:users_tokens, [:context, :token])
  end
end

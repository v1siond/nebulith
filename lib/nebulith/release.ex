defmodule Nebulith.Release do
  @moduledoc """
  Used for executing DB release tasks when run in production without Mix
  installed.
  """
  @app :nebulith

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  @doc """
  Builds the CATALOG on a database that has none: tilesets, tiles, compositions, generators, the admin
  account, and every registered data migration. The same thing `mix run priv/repo/seeds.exs` does in
  development, from a release where Mix does not exist.

      bin/nebulith eval "Nebulith.Release.seed"

  Idempotent, and still **not** something to put in a pre-deploy command. The seeders write whole columns
  from their own literals, so running this over a database somebody has edited discards those edits. Ten
  data migrations' worth of region work was erased that way, repeatedly, before anyone noticed.
  """
  def seed do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, fn _repo -> run_seeds() end)
    end
  end

  @doc """
  Mints an API token for an existing account and prints it.

      bin/nebulith eval 'Nebulith.Release.api_token("admin@nebulith.local")'
      mix run -e 'Nebulith.Release.api_token("admin@nebulith.local")'

  Printed once and never again: only the raw bytes are stored, so a lost token is replaced, not
  recovered. Revoke with `Nebulith.Accounts.delete_user_api_token/1`.
  """
  def api_token(email) when is_binary(email) do
    load_app()

    [repo | _] = repos()

    {:ok, result, _} =
      Ecto.Migrator.with_repo(repo, fn _repo ->
        case Nebulith.Accounts.get_user_by_email(email) do
          nil -> {:error, :no_such_user}
          user -> {:ok, Nebulith.Accounts.create_user_api_token(user)}
        end
      end)

    print_token(email, result)
  end

  defp print_token(email, {:error, :no_such_user}) do
    IO.puts("no account with email #{email}")
    :error
  end

  defp print_token(email, {:ok, token}) do
    IO.puts("API token for #{email}:\n\n  #{token}\n\nSend it as: Authorization: Bearer #{token}")
    :ok
  end

  defp run_seeds do
    path = Application.app_dir(@app, "priv/repo/seeds.exs")

    if File.exists?(path) do
      Code.eval_file(path)
      :ok
    else
      raise "no seeds at #{path}. priv/ has to be in the release for this to work."
    end
  end

  defp repos do
    Application.fetch_env!(@app, :ecto_repos)
  end

  defp load_app do
    # Many platforms require SSL when connecting to the database
    Application.ensure_all_started(:ssl)
    Application.ensure_loaded(@app)
  end
end

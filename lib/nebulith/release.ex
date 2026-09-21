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

defmodule Mix.Tasks.Nebulith.DataMigrate do
  @moduledoc """
  Runs nebulith DATA migrations, by hand, after the server is up.

      mix nebulith.data_migrate                      # every pass that has not run yet
      mix nebulith.data_migrate --list               # what is registered, what is pending
      mix nebulith.data_migrate --only SeedEntrances # one pass by name, run or not
      mix nebulith.data_migrate --baseline           # record pending as run WITHOUT running it
      mix nebulith.data_migrate --redo               # EVERY pass again, which is what a re-seed needs

  Migrations are for schema. Data is these modules, in `lib/nebulith/data_migrations/`, and they are run
  explicitly here so a pass over eight hundred tiles can never slow down a boot or time out a deploy.

  The task starts the REPO ONLY, never the endpoint, so it is safe to run while the dev server is serving on
  its port. What has run is recorded in the `data_migrations` table, so a second run does nothing.

  `--baseline` is for a database that already carries the effects, from back when these passes lived in
  `priv/repo/migrations`. It writes the ledger without touching a row, which is what keeps a seeder from
  overwriting settings tuned by hand in the editor.
  """
  use Mix.Task

  alias Nebulith.DataMigrations

  @shortdoc "Run pending nebulith data migrations"

  @requirements ["app.config"]

  @switches [list: :boolean, only: :string, baseline: :boolean, redo: :boolean]

  # Flag to mode, in precedence order. A dispatch table beats a chain of ifs, and it keeps the modes visible.
  @modes [list: :list, baseline: :baseline, only: :only, redo: :redo]

  @impl Mix.Task
  def run(args) do
    {opts, _rest} = OptionParser.parse!(args, strict: @switches)
    start_repo()
    execute(mode(opts), opts)
  end

  # The repo and nothing else. `app.start` would bring up the whole supervision tree, and in dev that is a
  # second copy of everything the running server already holds.
  defp start_repo do
    {:ok, _} = Application.ensure_all_started(:postgrex)
    {:ok, _} = Application.ensure_all_started(:ecto_sql)
    {:ok, _} = Nebulith.Repo.start_link(pool_size: 2)
  end

  defp mode(opts),
    do: Enum.find_value(@modes, :pending, fn {flag, mode} -> opts[flag] && mode end)

  defp execute(:list, _opts) do
    pending = MapSet.new(DataMigrations.pending(), &DataMigrations.name/1)

    Mix.shell().info("registered data migrations, in run order:")

    for module <- DataMigrations.all() do
      name = DataMigrations.name(module)
      Mix.shell().info("  #{status(MapSet.member?(pending, name))} #{name}")
    end

    Mix.shell().info("#{MapSet.size(pending)} pending of #{length(DataMigrations.all())}")
  end

  defp execute(:baseline, _opts),
    do: report("recorded as already applied", DataMigrations.baseline())

  defp execute(:only, opts), do: report("ran", [DataMigrations.run_one(opts[:only])])

  # EVERY pass again, which is the other half of a re-seed. A seeder re-run lands what its source says
  # today and knows nothing about the passes that edited those rows afterwards, and the ledger then stops
  # those passes ever running again. Seed, then `--redo`, or the seeder silently undoes them.
  defp execute(:redo, _opts), do: report("ran", DataMigrations.run_all())

  defp execute(:pending, _opts), do: report("ran", DataMigrations.run_pending())

  defp report(_verb, []), do: Mix.shell().info("nothing to do, no data migration is pending")

  defp report(verb, names) do
    Mix.shell().info("#{verb} #{length(names)}:")
    for name <- names, do: Mix.shell().info("  #{name}")
  end

  defp status(true), do: "pending"
  defp status(false), do: "     up"
end

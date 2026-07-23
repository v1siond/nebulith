defmodule Mix.Tasks.DataMigrate do
  @moduledoc """
  Runs nebulith DATA migrations. Usage: `mix data_migrate`.

  Data migrations handle DATA (not schema) and are run EXPLICITLY here — NEVER at startup — so a heavy data
  pass can't time out the boot/deploy. Each module's `run/0` is idempotent (safe to re-run). New data
  migrations: add a numbered module under `lib/nebulith/data_migrations/` and append its `run/0` call below.
  """
  use Mix.Task

  alias Nebulith.DataMigration.FlatTilesMinimalHeight

  @shortdoc "Run nebulith data migrations"
  @impl Mix.Task
  def run(_) do
    Mix.Task.run("app.start")

    FlatTilesMinimalHeight.run()
  end
end

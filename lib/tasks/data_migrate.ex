defmodule Mix.Tasks.DataMigrate do
  @moduledoc """
  Runs nebulith DATA migrations. Usage: `mix data_migrate`.

  Data migrations handle DATA (not schema) and are run EXPLICITLY here — NEVER at startup — so a heavy data
  pass can't time out the boot/deploy. Each module's `run/0` is idempotent (safe to re-run). New data
  migrations: add a numbered module under `lib/nebulith/data_migrations/` and append its `run/0` call below.
  """
  use Mix.Task

  alias Nebulith.DataMigration.AsciiEmojiBehaviorParity
  alias Nebulith.DataMigration.AsciiEmojiVocabularyParity
  alias Nebulith.DataMigration.AsciiPathFloorHeight
  alias Nebulith.DataMigration.BackfillCompositionCategories
  alias Nebulith.DataMigration.FlatTilesMinimalHeight
  alias Nebulith.DataMigration.FlatTilesZeroHeight

  @shortdoc "Run nebulith data migrations"
  @impl Mix.Task
  def run(_) do
    Mix.Task.run("app.start")

    FlatTilesMinimalHeight.run()
    AsciiPathFloorHeight.run()
    AsciiEmojiBehaviorParity.run()
    AsciiEmojiVocabularyParity.run()
    BackfillCompositionCategories.run()
    # LAST: floors are tiles and all tiles stack, so a flat tile needs no 0.1 slab — this undoes the 0.1 that
    # 0001/0002 land, and keeps doing so on any full re-run.
    FlatTilesZeroHeight.run()
  end
end

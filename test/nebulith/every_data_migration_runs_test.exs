defmodule Nebulith.EveryDataMigrationRunsTest do
  @moduledoc """
  EVERY REGISTERED DATA MIGRATION RUNS ON THE SCHEMA WE ACTUALLY HAVE.

  A data migration is raw SQL against column names typed by hand, so nothing checks it until it runs, and
  it only ever runs once per database. That combination lets one rot in silence: the column it names is
  dropped by a later structural migration, every existing database has already recorded it as done, and
  nothing goes wrong until somebody builds from empty.

  Measured when this was written: one migration named `occupies`, a column dropped with the old blocking
  flag, so a fresh database could not be built at all and nothing anywhere said so.

  This runs every registered migration against the live schema and names the ones that raise. It is cheap
  because they are idempotent by construction: each skips the rows it has already written.
  """
  use Nebulith.DataCase, async: false

  # It runs EVERY registered pass over the whole catalog, which is minutes of real work, not ExUnit's
  # default minute. The number is a ceiling on the wait, not a budget being asserted: what this checks is
  # that each pass runs at all.
  @moduletag timeout: 900_000

  alias Nebulith.DataMigrations

  test "every registered data migration executes without raising" do
    migrations = DataMigrations.all()
    assert migrations != [], "no data migrations are registered, so this test proves nothing"

    broken =
      for module <- migrations, reduce: [] do
        acc ->
          try do
            module.run()
            acc
          rescue
            error -> [{module, Exception.message(error)} | acc]
          end
      end

    assert broken == [],
           "these raise on the current schema:\n" <>
             Enum.map_join(broken, "\n", fn {mod, msg} ->
               "  #{inspect(mod)}\n    #{String.slice(msg, 0, 300)}"
             end)
  end

  test "every registered migration exports run/0, so the runner cannot hit an undefined function" do
    # `function_exported?/3` answers false for a module that is merely compiled and not yet LOADED, which
    # is every one of these on a cold test run. Without the ensure_loaded it reports all 102 as missing,
    # which is a test that fails for a reason that has nothing to do with the code.
    missing =
      Enum.reject(DataMigrations.all(), fn module ->
        Code.ensure_loaded?(module) and function_exported?(module, :run, 0)
      end)

    assert missing == [], "registered but export no run/0: #{inspect(missing)}"
  end
end

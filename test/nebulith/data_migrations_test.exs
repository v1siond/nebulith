defmodule Nebulith.DataMigrationsTest do
  @moduledoc """
  The runner is the thing that decides whether a database gets its rows, so its LEDGER behaviour is what
  these tests pin: what counts as pending, what recording does, and the difference between running a pass
  and merely recording it.

  The heavy catalog passes are not re-run here on purpose. They are covered by their own suites, and a
  runner test that seeds eight hundred tiles would be testing the seeder, not the runner.
  """
  use Nebulith.DataCase

  import Ecto.Query

  alias Nebulith.Catalog.Tile
  alias Nebulith.DataMigrations
  alias Nebulith.Repo

  # A registered pass that is cheap and touches a table no other test populates, so running it for real
  # proves the run-and-record path without dragging the catalog in.
  @cheap "DropBagAndJournalButtons"

  describe "the registry" do
    test "every registered module exposes run/0" do
      for module <- DataMigrations.all() do
        Code.ensure_loaded!(module)

        assert function_exported?(module, :run, 0),
               "#{inspect(module)} is registered but has no run/0, so the runner cannot run it"
      end
    end

    test "a module is recorded under its short name" do
      assert DataMigrations.name(Nebulith.DataMigration.SeedEntrances) == "SeedEntrances"
    end

    test "the list has no duplicates, so nothing runs twice in one pass" do
      names = Enum.map(DataMigrations.all(), &DataMigrations.name/1)

      assert Enum.uniq(names) == names
    end

    test "the catalog seed runs first, because every later pass edits what it wrote" do
      assert DataMigrations.all() |> List.first() |> DataMigrations.name() == "BuiltInCatalog"
    end
  end

  describe "pending" do
    test "an empty ledger leaves every registered pass pending, in run order" do
      assert DataMigrations.ran() == []
      assert DataMigrations.pending() == DataMigrations.all()
    end

    test "a recorded pass drops out of pending and keeps the rest in order" do
      DataMigrations.run_one(@cheap)

      assert @cheap in DataMigrations.ran()
      refute @cheap in Enum.map(DataMigrations.pending(), &DataMigrations.name/1)
      assert length(DataMigrations.pending()) == length(DataMigrations.all()) - 1
    end
  end

  describe "run_one" do
    test "runs the pass and records it" do
      assert DataMigrations.run_one(@cheap) == @cheap
      assert DataMigrations.ran() == [@cheap]
    end

    test "re-running a recorded pass is allowed and does not duplicate the ledger row" do
      DataMigrations.run_one(@cheap)
      DataMigrations.run_one(@cheap)

      assert DataMigrations.ran() == [@cheap]
    end

    test "an unknown name raises and names what IS registered" do
      error = assert_raise ArgumentError, fn -> DataMigrations.run_one("NotAPass") end

      assert error.message =~ "no data migration named \"NotAPass\""
      assert error.message =~ "BuiltInCatalog"
    end
  end

  describe "baseline" do
    test "records every pending pass WITHOUT running it" do
      recorded = DataMigrations.baseline()

      assert length(recorded) == length(DataMigrations.all())
      assert DataMigrations.pending() == []

      # The proof that nothing RAN: BuiltInCatalog is in that list and would have seeded the whole catalog.
      assert Repo.aggregate(from(t in Tile), :count) == 0
    end

    test "a baselined ledger leaves run_pending with nothing to do" do
      DataMigrations.baseline()

      assert DataMigrations.run_pending() == []
    end

    test "baselining twice records nothing the second time" do
      DataMigrations.baseline()

      assert DataMigrations.baseline() == []
    end
  end
end

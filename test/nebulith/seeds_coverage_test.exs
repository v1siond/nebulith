defmodule Nebulith.SeedsCoverageTest do
  @moduledoc """
  EVERY SOURCE THAT EXPOSES `seed/0` MUST BE REACHED BY THE FRESH-DATABASE PATH.

  What had happened: `zone_source.ex` and `ui_source.ex` each had a table, a migration and a `seed/0`, and
  `seeds.exs` called neither. The dev database answered `/api/zones` and `/api/ui` only because a past session
  ran those seeders by hand, which left no trace in the repo at all. A clean clone would have served empty, and
  nothing anywhere would have said why.

  The path is now two links long, and both of them can break:

    1. `priv/repo/seeds.exs` runs `Nebulith.DataMigrations.run_pending/0`.
    2. the runner runs the modules REGISTERED in `Nebulith.DataMigrations`, in order.

  So a seeder is reachable when `seeds.exs` calls it directly or when a REGISTERED data migration does. A
  module sitting in `lib/nebulith/data_migrations/` that nobody registered never runs at all, which is the new
  version of the same silent gap, so that is checked too.

  Deliberately STATIC: it reads the source files as text and touches no database, so it runs anywhere and
  fails the moment somebody adds a source or a module without wiring it up. An invariant that depends on being
  remembered is not an invariant.

  A source with NO `seed/0` is correctly absent: `EntitySource` is an authored module served straight from
  memory with no table, and this check ignores it for that reason.
  """
  use ExUnit.Case, async: true

  @sources "lib/nebulith/catalog/*_source.ex"
  @seeds "priv/repo/seeds.exs"
  @registry "lib/nebulith/data_migrations.ex"
  @modules "lib/nebulith/data_migrations/*.ex"

  # Modules kept for their history but deliberately left out of the runner. `GroundTilesAreFlat` documents
  # itself against this one, and registering it would raise heights that pass then has to lower again.
  @withdrawn ~w(AllBlocksMinHeight1)

  test "every source exposing seed/0 is reached by the fresh-database path" do
    seeders = Enum.map(seeder_paths(), &module_name/1)

    assert seeders != [],
           "no seeders found at all, so the glob #{@sources} is wrong, not the seeds file"

    path = fresh_database_path()
    missing = Enum.reject(seeders, &String.contains?(path, &1))

    assert missing == [],
           """
           These sources expose seed/0 but nothing on the fresh-database path calls them, so a fresh database
           comes up without their data and the editor serves empty for it:

               #{Enum.join(missing, ", ")}

           Call them from a data migration registered in #{@registry} (they are all idempotent upserts), or
           delete the seed/0 if the source is genuinely served from memory like EntitySource.
           """
  end

  test "seeds.exs delegates to the runner rather than seeding a second way" do
    seeds = File.read!(@seeds)

    assert String.contains?(seeds, "Nebulith.DataMigrations.run_pending"),
           "#{@seeds} must run the data-migration runner, so there is ONE path to the data"
  end

  test "every data migration module is registered in the runner" do
    registered = registered_modules()

    unregistered = Enum.reject(module_names(), &(&1 in registered))

    assert unregistered == @withdrawn,
           """
           A data migration module that is not in the @migrations list in #{@registry} never runs, so its
           change reaches no database at all. Unregistered right now:

               #{Enum.join(unregistered, ", ")}

           Register it, or add it to @withdrawn in this test with the reason it stays out.
           """
  end

  test "the runner registers nothing that does not exist" do
    names = module_names()

    ghosts = Enum.reject(registered_modules(), &(&1 in names))

    assert ghosts == [],
           "#{@registry} registers modules with no file in #{@modules}: #{Enum.join(ghosts, ", ")}"
  end

  test "the sources this check finds are the ones we expect, so a broken glob cannot pass silently" do
    names = Enum.map(seeder_paths(), &module_name/1)

    for expected <-
          ~w(TileSource ItemSource AbilitySource GeneratorSource ZoneSource UiSource CombatSource) do
      assert expected in names, "#{expected} exposes seed/0 but this check did not find it"
    end

    refute "EntitySource" in names,
           "EntitySource has no seed/0 (served from memory), so it must not be required"
  end

  # Everything a fresh database actually runs: the seeds script, plus the source of every REGISTERED data
  # migration. An unregistered module's text is deliberately left out, because it never runs.
  defp fresh_database_path do
    registered = registered_modules()

    @modules
    |> Path.wildcard()
    |> Enum.filter(&(module_defined_in(&1) in registered))
    |> Enum.map_join("\n", &File.read!/1)
    |> Kernel.<>(File.read!(@seeds))
  end

  # The short names in the @migrations list, in order, read as text so the check needs no compiled module.
  defp registered_modules do
    @registry
    |> File.read!()
    |> String.split("@migrations [", parts: 2)
    |> List.last()
    |> String.split("\n  ]", parts: 2)
    |> List.first()
    |> then(&Regex.scan(~r/Nebulith\.DataMigration\.(\w+)/, &1))
    |> Enum.map(&List.last/1)
  end

  defp module_names, do: @modules |> Path.wildcard() |> Enum.map(&module_defined_in/1)

  # "lib/nebulith/data_migrations/built_in_catalog.ex" becomes "BuiltInCatalog", read from the file's own
  # defmodule rather than guessed from the filename, so a number in a name cannot break the mapping.
  defp module_defined_in(path) do
    [[_, name]] = Regex.scan(~r/defmodule Nebulith\.DataMigration\.(\w+) do/, File.read!(path))
    name
  end

  defp seeder_paths do
    @sources
    |> Path.wildcard()
    |> Enum.filter(&(&1 |> File.read!() |> String.contains?("def seed do")))
  end

  # "lib/nebulith/catalog/zone_source.ex" becomes "ZoneSource"
  defp module_name(path) do
    path
    |> Path.basename(".ex")
    |> String.split("_")
    |> Enum.map_join(&String.capitalize/1)
  end
end

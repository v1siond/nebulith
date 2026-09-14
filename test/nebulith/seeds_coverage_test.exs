defmodule Nebulith.SeedsCoverageTest do
  @moduledoc """
  EVERY SOURCE THAT EXPOSES `seed/0` MUST BE CALLED BY `priv/repo/seeds.exs`.

  and then

  What had happened: `zone_source.ex` and `ui_source.ex` each had a table, a migration and a `seed/0`, and
  `seeds.exs` called neither. The dev database answered `/api/zones` and `/api/ui` only because a past session
  ran those seeders by hand, which left no trace in the repo at all. A clean clone would have served empty, and
  nothing anywhere would have said why.

  So this is the guard, and it is deliberately STATIC: it reads the source files and `seeds.exs` as text and
  touches no database, so it runs anywhere and fails the moment somebody adds a source without wiring it up.
  `TileSource.seed/0`'s own comment already says the principle: an invariant that depends on being remembered
  is not an invariant.

  A source with NO `seed/0` is correctly absent from `seeds.exs`: `EntitySource` is an authored module served
  straight from memory with no table, and this check ignores it for that reason.
  """
  use ExUnit.Case, async: true

  @sources "lib/nebulith/catalog/*_source.ex"
  @seeds "priv/repo/seeds.exs"

  test "every source exposing seed/0 is called by seeds.exs" do
    seeds = File.read!(@seeds)
    seeders = Enum.map(seeder_paths(), &module_name/1)

    assert seeders != [], "no seeders found at all, so the glob #{@sources} is wrong, not the seeds file"

    missing = Enum.reject(seeders, &String.contains?(seeds, &1))

    assert missing == [],
           """
           These sources expose seed/0 but nothing in #{@seeds} calls them, so a fresh database comes up
           without their data and the editor serves empty for it:

               #{Enum.join(missing, ", ")}

           Add the call to #{@seeds} (they are all idempotent upserts), or delete the seed/0 if the source is
           genuinely served from memory like EntitySource.
           """
  end

  test "the sources this check finds are the ones we expect, so a broken glob cannot pass silently" do
    names = Enum.map(seeder_paths(), &module_name/1)

    for expected <- ~w(TileSource ItemSource AbilitySource GeneratorSource ZoneSource UiSource CombatSource) do
      assert expected in names, "#{expected} exposes seed/0 but this check did not find it"
    end

    refute "EntitySource" in names, "EntitySource has no seed/0 (served from memory), so it must not be required"
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

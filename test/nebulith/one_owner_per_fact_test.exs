defmodule Nebulith.OneOwnerPerFactTest do
  @moduledoc """
  A DATA MIGRATION MAY NOT OWN A FACT THE SEEDER ALSO WRITES.

  `docs/CODING-STANDARDS.md` §4. `GeneratorSource.seed/0` writes `generators.config` WHOLE, so a data
  migration that `jsonb_set`s into the same column is a SECOND owner, and the next seed silently discards
  its work. That is not a style preference: it is the single mechanism behind every biome regression
  reported so far. A migration writes the volcanic tree mix, the seeder runs, the mix is gone, and the
  symptom reads as "we no longer have zones with burned trees".

  ## How this is checked

  Not by grepping the migrations for `jsonb_set`, which only says a migration COULD be a second owner.
  This runs them: seed, snapshot every generator's config, run all of them, snapshot again. Anything that
  moved is a fact with two owners, named by generator and by key, which is the list to fold into
  `GeneratorSource` and then retire.

  The grep version of this check answered "23 violations" while the measurement answers differently,
  because most of those migrations write a fact the seeder has SINCE been taught. A check that cannot
  tell a live second owner from a retired one sends the work to the wrong place.

  ## Why it is excluded from the normal run

  It runs 100+ passes, several of which re-run a full seeder. Tagged `:slow` and run deliberately:

      mix test test/nebulith/one_owner_per_fact_test.exs --include slow
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigrations
  alias Nebulith.Repo

  @moduletag :slow
  @moduletag timeout: 900_000

  @tag :slow
  test "no data migration changes a generator config the seeder has already written" do
    TileSource.seed()
    GeneratorSource.seed()

    before = configs()

    # Every registered pass, not just the pending ones: the ledger in a test database is empty, but the
    # question here is what the passes DO, not what this database has recorded.
    for module <- DataMigrations.all(), do: module.run()

    # Read ONCE, not once per generator: `configs()` is a query, and calling it inside the comprehension
    # ran it 45 times to answer one question.
    after_migrations = configs()

    second_owners =
      for {key, was} <- before,
          now = after_migrations[key],
          now != was,
          {field, before_value, after_value} <- changed_keys(was, now),
          do: {key, field, before_value, after_value}

    assert second_owners == [], report(second_owners)
  end

  defp configs do
    %{rows: rows} = Repo.query!("SELECT key, config FROM generators")
    Map.new(rows, fn [key, config] -> {key, config || %{}} end)
  end

  # THE KEYS THAT MOVED, so the failure names the fact rather than dumping two configs a reader cannot
  # diff by eye.
  defp changed_keys(was, now) do
    keys = Enum.uniq(Map.keys(was) ++ Map.keys(now))

    for key <- keys, was[key] != now[key], do: changed_key(key, was[key], now[key])
  end

  # A SUB-ZONE LIST IS DIFFED BY REGION AND BY KEY. "list of 6 against list of 6" is true and useless: it
  # says a region changed without saying which region or which fact, which is the whole thing this gate
  # exists to name. Regions are matched by their `key`, not by position, because a reordering is not a
  # content change and must not read as one.
  defp changed_key("subZones", was, now) when is_list(was) and is_list(now) do
    a = Map.new(was, &{&1["key"], &1})
    b = Map.new(now, &{&1["key"], &1})

    gained = Map.keys(b) -- Map.keys(a)
    lost = Map.keys(a) -- Map.keys(b)

    per_region =
      for {region, before_zone} <- a,
          after_zone = b[region],
          after_zone != before_zone,
          field <- Enum.uniq(Map.keys(before_zone) ++ Map.keys(after_zone)),
          before_zone[field] != after_zone[field],
          do:
            "#{region}.#{field} #{summarise(before_zone[field])} -> #{summarise(after_zone[field])}"

    detail =
      [
        if(gained != [], do: "regions gained: #{Enum.join(gained, ", ")}"),
        if(lost != [], do: "regions lost: #{Enum.join(lost, ", ")}")
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.concat(per_region)
      |> Enum.join("; ")

    {"subZones", "", detail}
  end

  defp changed_key(key, was, now), do: {key, summarise(was), summarise(now)}

  defp summarise(nil), do: "(absent)"
  defp summarise(value) when is_list(value), do: "list of #{length(value)}"
  defp summarise(value) when is_map(value), do: inspect(value, limit: 6, printable_limit: 200)
  defp summarise(value), do: inspect(value)

  defp report([]), do: ""

  defp report(second_owners) do
    lines =
      second_owners
      |> Enum.sort()
      |> Enum.map_join("\n  ", fn
        {key, "subZones", "", detail} ->
          "#{key}.subZones: #{detail}"

        {key, field, was, now} ->
          "#{key}.#{field}: seeder wrote #{was}, a migration then wrote #{now}"
      end)

    """
    #{length(second_owners)} facts have two owners. The seeder writes the config WHOLE, so every one of
    these is discarded the next time `GeneratorSource.seed/0` runs, and the content disappears with no
    error anywhere. Fold each into `GeneratorSource` and retire the migration that writes it.

      #{lines}
    """
  end
end

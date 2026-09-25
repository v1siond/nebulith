defmodule Nebulith.WhatTheMigrationsStillOwnTest do
  @moduledoc """
  A TOOL, NOT A GATE. Writes out the region state the data migrations produce, so it can be folded into
  `GeneratorSource` by transcription rather than by retyping what a migration was read to mean.

  `Nebulith.OneOwnerPerFactTest` is the gate: it says 36 generators carry a region fact the seeder does
  not own, and names the fields. This writes the ANSWER: the full post-migration `subZones` for every
  generator, as JSON, so folding is copying a measured value rather than reconstructing one.

  Reading 100 migrations and retyping what they appear to do is how content gets lost. Several of them
  correct each other (a desert pass that overreached is itself corrected by a later one), so only the
  FINAL state after all of them is the state that was approved.

  ## Run it

      mix test test/nebulith/what_the_migrations_still_own_test.exs --include dump

  Writes `docs/generated/region-state.json`. The database work happens inside the Ecto sandbox and is
  rolled back; only the file survives.

  The file is NOT kept in the tree. Once the fold is done it is a second copy of what `GeneratorSource`
  states, which is the exact thing this whole exercise was undoing. Run the tool when you need it again.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigrations
  alias Nebulith.Repo

  @moduletag :dump
  @moduletag timeout: 900_000

  @out "docs/generated/region-state.json"

  @tag :dump
  test "writes the region state the migrations produce" do
    TileSource.seed()
    GeneratorSource.seed()
    for module <- DataMigrations.all(), do: module.run()

    %{rows: rows} = Repo.query!("SELECT key, config FROM generators ORDER BY key")

    state =
      Map.new(rows, fn [key, config] ->
        config = config || %{}

        {key,
         %{
           "subZones" => config["subZones"],
           "regionLayout" => config["regionLayout"],
           "trees" => config["trees"],
           # The one settlement fact the gate also flagged: a per-biome street material against the
           # seeder's single `path_stone`.
           "streets" => get_in(config, ["settlement", "streets"])
         }}
      end)

    File.mkdir_p!(Path.dirname(@out))
    File.write!(@out, Jason.encode!(state, pretty: true))

    counts =
      for {key, value} <- state, is_list(value["subZones"]), do: {key, length(value["subZones"])}

    IO.puts("""

    #{@out}: #{map_size(state)} generators, #{length(counts)} with regions.
    Fold these into GeneratorSource, then retire the migrations that write generators.config.
    """)

    assert map_size(state) > 0
  end
end

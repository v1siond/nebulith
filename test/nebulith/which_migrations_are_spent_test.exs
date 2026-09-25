defmodule Nebulith.WhichMigrationsAreSpentTest do
  @moduledoc """
  A TOOL, NOT A GATE. Names the data migrations that change NOTHING on a freshly seeded database, which
  is the only safe evidence for retiring one.

  A migration's job is to move an EXISTING database to the state the seeder already describes
  (`docs/OBJECT-CONSTRUCTION.md` §7). Once the seeder describes it, the migration is spent: it is dead
  weight that still has to be read, ordered and reasoned about, and several of them are actively
  confusing because they describe an intent the seeder now contradicts.

  Retiring one on the grounds that it LOOKS redundant is how content disappears. This measures it: seed,
  digest the catalog, run one pass, digest again. A pass that moved nothing cannot be the only owner of
  anything.

  ## Why a digest of everything, not just generators

  `Nebulith.OneOwnerPerFactTest` covers `generators.config`. A migration can be a no-op there and still
  be the only owner of a tile setting or a composition cell, so retiring on that evidence alone would
  delete real content. This digests tiles, compositions and their cells too.

  ## Run it

      mix test test/nebulith/which_migrations_are_spent_test.exs --include dump
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigrations
  alias Nebulith.Repo

  @moduletag :dump
  @moduletag timeout: 1_800_000

  @tag :dump
  test "names the passes that change nothing after a seed" do
    TileSource.seed()
    GeneratorSource.seed()

    {spent, live} =
      Enum.reduce(DataMigrations.all(), {[], []}, fn module, {spent, live} ->
        was = digest()
        module.run()

        case digest() do
          ^was -> {[DataMigrations.name(module) | spent], live}
          _ -> {spent, [DataMigrations.name(module) | live]}
        end
      end)

    IO.puts("""

    SPENT, so safe to retire (#{length(spent)}):
      #{spent |> Enum.reverse() |> Enum.join("\n  ")}

    STILL CHANGES SOMETHING (#{length(live)}):
      #{live |> Enum.reverse() |> Enum.join("\n  ")}

    A pass in the second list either owns a fact the seeder does not, or corrects a pass that ran before
    it. Read it before retiring it: the order above is the run order, so a pass that only undoes an
    earlier one retires WITH that one, never alone.
    """)

    assert spent != []
  end

  # ONE NUMBER FOR THE WHOLE CATALOG. Comparing full row sets 214 times is the same answer at many times
  # the cost, and the question here is only "did anything move".
  defp digest do
    Map.new(
      [
        {:tiles,
         "SELECT t.id, t.label, i.image_path, t.height, t.category, t.settings FROM tiles t LEFT JOIN tile_images i ON i.tile_id = t.id AND i.tileset_id = t.tileset_id ORDER BY t.id"},
        {:generators, "SELECT key, config, options, zones FROM generators ORDER BY key"},
        {:compositions,
         "SELECT id, name, category, footprint_w, footprint_h FROM compositions ORDER BY id"},
        {:cells,
         "SELECT composition_id, dx, dy, level, label, scale, settings FROM composition_cells ORDER BY composition_id, dx, dy, level, label"}
      ],
      fn {name, sql} ->
        %{rows: rows} = Repo.query!(sql)
        {name, :erlang.md5(:erlang.term_to_binary(rows))}
      end
    )
  end
end

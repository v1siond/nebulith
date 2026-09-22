defmodule Nebulith.E2E.World do
  @moduledoc """
  The data a scenario needs, written through the app's own schema.

  ## Why a fixture goes through the changeset

  A scenario is only honest if the backend it talks to is the real one. The strongest way to guarantee
  a fixture "follows the exact schema" is not to check it against the schema, it is to write it THROUGH
  the schema: `Catalog.create_template/1` runs the changeset, the column defaults fire, and the real
  controller serialises the real struct on the way out. A row built with raw INSERT skips all three,
  and then the scenario is asserting against a shape the app would never have produced.

  Both of the first two browser tests inserted their map with hand-written SQL naming fifteen quoted
  columns. That is a second spelling of the schema, kept by hand, in a test.

  ## Why the catalog is seeded

  The editor holds its canvas behind a tileset gate, so with no tiles there is no map and nothing to
  assert on. The seeds run inside the sandbox transaction, so they cost one run and vanish with it.
  """

  alias Nebulith.Catalog

  @doc """
  The catalog, built the way the app builds it.

  There is exactly one way to seed this app, and `priv/repo/seeds.exs` is it: `run_pending/0`, whose
  first ledger entry IS the catalog seed. Calling the individual seeders instead is a second spelling
  of that, kept by hand, and it is already wrong. `seed_road_markings/0` is reached only through a data
  migration, so a scenario that called the seeders directly built a world with no street markings in
  the catalog, watched the generator place them by label anyway, and then found them coming back as
  plain decoration after a reload. That looks exactly like a round-trip defect and is not one.

  A scenario has to be handed the catalog the app ships, or what it proves is about a different app.

  Slow, and unavoidable: an empty catalog means an empty editor. It runs inside the sandbox
  transaction, so it costs one scenario and vanishes with it.
  """
  def seed_catalog do
    Nebulith.DataMigrations.run_pending()
    :ok
  end

  @doc """
  An empty map to open, flat grass, sized `cols` by `rows`.

  The editor restores the last saved template and bounces to the gallery when there is none, so an
  empty database never renders the editor at all and a scenario waits for a canvas that was never
  coming.
  """
  def scratch_map(attrs \\ %{}) do
    cols = Map.get(attrs, :cols, 40)
    rows = Map.get(attrs, :rows, 40)

    {:ok, template} =
      Catalog.create_template(%{
        "name" => Map.get(attrs, :name, "e2e scratch #{System.unique_integer([:positive])}"),
        "cols" => cols,
        "rows" => rows,
        "cellSize" => Map.get(attrs, :cell_size, 16),
        "isoScale" => Map.get(attrs, :iso_scale, 2.5),
        "slabBlocks" => 1,
        "groundData" => filled(cols, rows, Map.get(attrs, :ground, "grass")),
        "heightData" => filled(cols, rows, 0),
        "assetsData" => [],
        "connectors" => [],
        "entities" => [],
        "quests" => []
      })

    template
  end

  defp filled(cols, rows, value), do: List.duplicate(List.duplicate(value, cols), rows)
end

defmodule Nebulith.DataMigration.SeedEntrances do
  @moduledoc """
  The four entrances: forest, cave, town and park.

  A pathway that leads somewhere else needs to say so, so each one is modelled against the reference
  picture: three cells wide, which is the gate width, with two uprights, a span over the middle and a dark
  mouth under it.

  Each carries a category so it lands in the objects palette and can be dropped on a map like any other
  object, rather than only being stamped by a generator.

  Composition-only, so tile rows and the poses tuned by hand in the editor are untouched.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_entrances()

    Logger.info("[data_migrate] entrances seeded (forest, cave, town, park)")
    :ok
  end
end

defmodule Nebulith.DataMigration.AnElementShowsWhatItDoes do
  @moduledoc """
  The options whose choices are worth SEEING say so, and the panel draws a picture of each one.

  An element is a thing the map gets made OF: the water (river, lake, beach) and the ways over it (stone, dirt
  and wood bridges), plus the region the map sits in.

  So `river`, `bridge` and `region` carry `preview: true`. Their choices are visibly different places, and a
  picture says what a word cannot: "Divides the map in two" and "Around the edge" are two different maps, and
  so are a marsh and a thicket. `exits` and `pathways` do not: they are counts, and a thumbnail of three
  beside four is two nearly identical pictures that cost a whole map generation each.

  ## This used to PATCH the seeder's output, and that was the bug

  It ran an UPDATE that set `preview` on rows the seeder had just written without it. So one fact had two
  owners, and `seed/0` REPLACES the whole options array, which means running the base seeder stripped the flag
  and every preview card fell back to a plain dropdown, leaving the panel looking like a much older version of
  itself.

  The flag lives in `GeneratorSource` now, beside the option it describes, so the seeder's output IS the
  approved state and re-running it cannot regress the panel. This re-seeds, which is all it ever needed to do,
  and is the same shape as `TheWhiteLinesInTheMiddle`. `the_panel_draws_the_options_test.exs` is the gate.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()
    Logger.info("[data_migrate] the options worth seeing carry their own preview flag")
    :ok
  end
end

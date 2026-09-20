defmodule Nebulith.DataMigration.AnOptionBelongsToAGroup do
  @moduledoc """
  An option says which heading it lives under, and how much map one of its choices wants.

  ## 1. The heading

  A flat list of seven made `depth`, `bridge` and the water look read as peers of the river they are settings
  OF, which is what he called unclear. `group` puts each option under its own heading and the generator
  carries the labels for them, so the panel renders what the catalog says and infers nothing,
  `docs/EDITOR-UX.md` §2.1.

  ## 2. The limit that moves with the map

  A limit on how many pathways fit has to move with the grid, not sit at a fixed number. `maxPer` says how
  many cells one of these wants: a choice of N is offered only while `cols * rows >= N * maxPer`. 180 comes
  from the smallest grid a generator serves (30x24 = 720) still offering four, so it states today's rate
  rather than tightening it. A bigger map offers the same or more, never fewer.

  ## This used to PATCH the seeder's output, and that was the bug

  It ran UPDATEs that set `group`, `maxPer` and the group labels onto rows `seed/0` had just written without
  them. One fact, two owners, and `seed/0` REPLACES what it writes, so running the base seeder stripped all
  three and the grouped preview panel fell back to a flat list of dropdowns.

  All three live in `GeneratorSource` now, beside the options they describe, so the seeder's output IS the
  approved state. This re-seeds, which is all it ever needed to do, and is the same shape as
  `TheWhiteLinesInTheMiddle`. `the_panel_draws_the_options_test.exs` is the gate that keeps them there.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()
    Logger.info("[data_migrate] every option carries its own group, label and size limit")
    :ok
  end
end

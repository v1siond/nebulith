defmodule Nebulith.DataMigration.ATrunkIsAQuarterOfItsCrown do
  @moduledoc """
  Re-seed every tree so its trunk is a share of its own crown rather than whatever it was hand-given.

  *"we have a bunch of trees with trunks that are almost as thick as the leaf section, which is bad, trunks
  should not be like that, reduce thicknes and improve proportions of ALL trees that have trunk"*.

  Measured on the live catalog before this, as trunk drawn-width over crown drawn-width:

      tree_cypress   0.80     tree_stub    0.53     tree_small   0.53
      tree_mangrove  0.49     tree         0.44     tree_round   0.44
      tree_conifer   0.40     tree_giant   0.39     tree_tall    0.38   ... and nine more above 0.30

  against the ones nobody ever complained about, which is where the number comes from rather than from taste:

      tree_coconut   0.19     tree_willow  0.23     tree_palm    0.24     tree_cherry  0.25

  `tree_comp/1` derives the trunk from the crown at `@trunk_to_crown` now, so this just runs the seeder again
  and every tree comes out on the rule. `assert_tree_dimensions!/3` enforces the SHARE as well, where it used
  to ask only that the trunk be thinner than the crown, which a trunk at 80% of it passes.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_compositions()
    Logger.info("[data_migrate] every trunk is a share of its own crown")
    :ok
  end
end

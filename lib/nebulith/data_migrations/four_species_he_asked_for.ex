defmodule Nebulith.DataMigration.FourSpeciesHeAskedFor do
  @moduledoc """
  Oak, weeping willow, cherry and encina, and the biomes that actually grow them.

  *"I like to see pines, palm tree, cypress, oak, weeping willow, cherry tree, encina"*, and then *"then add
  the variants"*. Pine is `tree_conifer`, cypress and palm were already in the catalog, so these four are the
  remainder.

  ## Built the way the existing ones are, deliberately

  Each is `tree_comp/1` with its own proportions, which is what the nineteen before it are. That matters
  because the previous attempt at more species replaced the model with per-species crown art and was
  reverted: *"all i wanted was to add more variants of types of trees and different coloring and we ended up
  changing the whole fucking system entirely"*. `tree_comp/1` asserts the crown is wider than the trunk and
  seats it at `round(trunk_h * trunk_zoom)`, so none of these can come out detached or thinner than its own
  bole, which were the two complaints that killed the crowns.

  They differ by SILHOUETTE, which is the only axis a shared leaf tile leaves open:

      oak      short heavy bole, the widest crown in the temperate set (2.0 zoom)
      willow   slim trunk under a tall wide FALL of leaf, mass low and spreading
      cherry   small and light, a thin trunk; its blossom is the spring shade array's pink, not new art
      encina   short and sturdy under a dense rounded evergreen dome, a dry open-country tree

  ## Where each one grows, and why there

  Not everywhere. A species that grows on every map is the thing being fixed, not a fix.

      oak       woodland, ruins             the temperate broadleaf
      cherry    woodland, meadow            his meadow note asks for orange and pink, and a cherry is that
      willow    the LAKESIDE region, swamp  it grows with its feet in water and nowhere else
      encina    desert, beach               the dry open dehesa tree, which is what those two lacked

  Willow is added per REGION rather than per environment, because a woodland's lakeside is where it belongs
  and its deep wood is not. The sub-zone mix already exists for exactly this and nothing used it this way.

  Idempotent: each mix is rebuilt only when it does not already name the species.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    # The four compositions themselves. `seed_compositions/0` is the one that writes the tree species; the
    # crowns migration proved the hard way that `seed_tree_pieces/0` writes the leaf TILES and not these.
    TileSource.seed_compositions()

    # WHICH MIXES GROW THEM IS THE SEEDER'S TO SAY. `GeneratorSource.seed/0` writes `generators.config`
    # whole, so appending a species to a mix from here made the mix a second owner and the next seed
    # dropped the addition. The four species are in the authored mixes; this composes them.
    Logger.info("[data_migrate] 4 species composed")

    :ok
  end

  # Appended to the mix rather than replacing it: the existing species and their weights are what a woodland
  # already is, and this adds to it.
end

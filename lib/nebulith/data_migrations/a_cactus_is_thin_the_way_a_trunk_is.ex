defmodule Nebulith.DataMigration.ACactusIsThinTheWayATrunkIs do
  @moduledoc """
  A CACTUS IS THINNED BY A DIRECTED REACH, NOT BY A BARE `scaleZ`.

      cactus look horrible, we used width instead of thickness to make it, and looks too skynny,
      before it looked way better

  The same correction a tree trunk already got, in almost the same words (*"I REQUESTED TO EDIT THE THICKNES
  AND YOU CHANGED THE WITH"*), and the first pass at it only got half way.

  ## What the first pass missed

  It read `scaleZ` as the panel's Thickness and widened `scaleX` beside it. `scaleZ` is the thickness
  SHORTHAND, and `tileThicknessReach` spells out what a bare one means: thin toward EVERY face. At 0.3 each
  ground axis then asks `reachGroundQuad` for `hi = 0.3` against `lo = 1 - 0.3 = 0.7`, the two sides cross,
  and the guard that keeps a block from vanishing mid-drag leaves a `MIN_SPAN` sliver where they met: 0.05 of
  the cell, on BOTH ground axes. That draws as a 2px line 85px tall, so the widened width could never have
  reached the screen and the picture stayed the stick that was reported.

  Measured on `docs/renders/family-cactus_saguaro.png`: every saguaro bar 2px across and 85px tall, beside
  `family-cactus_barrel.png` at 40px across, whose cells carry `scaleX 0.72` and no `scaleZ` at all. The
  presence of `scaleZ` is the whole difference between the two pictures.

  ## What the bars hold now

  Full width across (the axis you look at), and a `thickness` reach naming the +row pair, which is the axis
  going into the screen. The arms are the reference plate's proportions rather than picked ones
  (`docs/references/SOURCES.md`, Cactus): 0.44 of the trunk, standing 0.72 of a cell off it.

  The compositions are authored in code and no endpoint writes them, so this re-seeds them from that source
  rather than patching rows and guessing which of the two spellings a given database holds.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_compositions()

    Logger.info("cactus bars are full width and thin by a directed reach, no bar carries a bare scaleZ")
    :ok
  end
end

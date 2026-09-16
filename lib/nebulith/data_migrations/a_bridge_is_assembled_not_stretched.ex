defmodule Nebulith.DataMigration.ABridgeIsAssembledNotStretched do
  @moduledoc """
  The bridges are rebuilt out of pieces that each do one job, instead of one picture stretched and tinted.

  ## What was measured, against the references

  Both crossings were put beside the reference they are named after and reduced to their silhouettes
  (`.probe/silhouette.py`). The two numbers that matter:

      stone  reference (red humped arch)  aspect 1.28  fill 0.40  jag 0.193
             ours                         aspect 1.56  fill 0.73  jag 0.076
      wood   reference (arched footbridge) aspect 1.34  fill 0.38  jag 0.142
             ours                         aspect 1.56  fill 0.71  jag 0.079

  `fill` is ink over bounding box. A bridge measures 0.39 because it is mostly HOLE: the arch opening and the
  gaps between the uprights are most of the shape. Ours measured 0.72, a solid brick. `jag` is how broken the
  skyline is, and ours was half the reference because the only uprights were four posts at the corners.

  ## The five faults in the data, all of them fixed here

  1. **Length by stretching.** The substructure was ONE cell carrying `depth: span`, which extrudes an
     unbroken box bank to bank, so the underside was solid on every bridge ever generated. It is authored per
     column now and the middle columns are simply absent. That absence is the arch.
  2. **Material by recolour.** All fifteen compositions were the same ten cells and differed by a `color` on
     three of them. `bridge_plank_*` was byte-identical to `bridge_wood_*`. Each material now names its own
     pieces and no cell states a colour.
  3. **One tile playing three roles.** `bridge_rail` was the under-bearer at level -1, the near parapet and
     the far parapet, one picture squashed three ways. Eight new tiles, one role each.
  4. **The parapets did not touch the deck.** `thicknessDir` names the face a thinned block hugs. The side at
     dy 0 must reach +row (`left-down`) and the one at dy 3 must reach -row (`right-up`). Both were authored
     the other way round, so each was pulled to the outer face of its own row with a gap of air between it and
     the deck it edges.
  5. **Incoherent material.** The deck cell carried no colour, so the "stone" bridge drew `bridge_deck`'s own
     #a8794a, which is wood brown.

  ## What it is made of now

      level -1  abutments at both ends, spandrels hung under the deck, OPEN between them
      level  0  deck, two rows, one z-width run each
      level  0  a solid parapet (stone) or the uprights of a post-and-rail (timber)
      level  1  bollards on the parapet, or the handrail on the posts

  Uprights stand at both ends and every other column between, because the rhythm is what reads as length.

  Colours are measured off the references rather than chosen: #893640 red sandstone, #b2855c warm oak.

  Idempotent: `seed_bridge_tiles/0` and `seed_compositions/0` both upsert.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_bridge_tiles()
    TileSource.seed_compositions()

    Logger.info("[data_migrate] bridges rebuilt from piece families, arch opening and all")
    :ok
  end
end

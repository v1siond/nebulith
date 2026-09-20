defmodule Nebulith.DataMigration.EveryBiomeItsOwnRegions do
  @moduledoc """
  Every biome states its own regions, and the ordered ones are laid out in order.

  *"none of the regions from volcanic type are different and they don't look like volcanic regions at all.
  there's no sense of getting close to the volcano for example, because all of them are the same as the other
  forests, even when the context is different"*, and the general form of it:

  > *"most regions should be edited per type per biom, the zones of a meadow aren'tn the sme of a swamp ... so
  > we need to have logical sectons per BIOM, not generic ones repeated across all of them. and each region
  > should create a distinct template, different layout, different everything to represent the actual region"*

  The framework is `REGIONS.md`, written for this. Two things were wrong and only one of them was the data.

  ## 1. The set was shared

  One list of five, `edge / deep / glade / thicket / lakeside`, reused by all nine wild environments with only
  the floor tones swapped. Those are woodland words: a desert has no deep wood, a volcano has no glade, and a
  beach's lakeside is the sea. Measured: `forest_volcanic` carried the MOUNTAIN's five byte for byte, same
  keys, same names, same conifer and stub lists.

  ## 2. The set had no ORDER, which is the half that mattered

  `partitionSubZones` is a nearest-seed Voronoi, so every kind lands in blobs all over the map. That is why
  the volcanic bands built earlier the same day still read as "the same as the other forests" even though
  their species and floors were right: you met them in a random order, so there was nothing to approach.

  Every example he gave is a gradient or a position, never a scatter: closer to the volcano, *"gradually gets
  more wet and with deeper rivers"*, *"gradually increase until you reach the actual ruins"*, *"the bottom of
  the mountain, the middle and the top"*, *"the end or start of it"*. So a set now states its arrangement and
  the engine honours it:

      rings   region 0 at the middle, the last at the rim. Volcanic, ruins: things you APPROACH.
      bands   region 0 at the SOUTH edge. Mountain, beach, swamp, desert: gradients you cross.
      scatter what it always did. The meadow keeps it, because a meadow genuinely has no gradient:
              *"a meadow is not that wet, and rivers aren't gonna be as prominent as in a swamp"*.

  South first is not arbitrary: a map's entrance is always south, so band 0 is the one you walk into, which
  puts the foot of the mountain and the shore of the beach where you arrive.

  ## What each set is, in his words

      mountain   foot -> slope -> treeline -> crag -> summit      "the higher you get the less vegetation"
      beach      shore -> dunes -> palms -> backshore -> inland   "the actual beach" outside, jungle within
      swamp      margin -> mire -> bog -> sink -> open_water       pools climb from 0.02 to 0.78
      ruins      heart -> courts -> terraces -> overgrown -> forest   stone climbs toward the middle
      desert     erg -> hardpan -> wadi -> oasis                   the only gradient a desert has is water
      meadow     pasture / hedgerow / orchard / bank / common      its own words, still a scatter
      volcanic   crater -> burnt -> ashfall -> sheltered -> lavaside   already right, now laid as rings

  Woodland and jungle keep `edge / deep / glade / thicket / lakeside`, because those ARE woodland words and a
  glade really is anywhere.

  ## What this does NOT do

  A region still cannot state its own crossings, so *"dirt paths and bridges constantly or jump on platforms"*
  has nowhere to live, and it cannot state a STRUCTURE, so the ruins `heart` and the swamp's temple are
  density and colour rather than a place with something in it. Both are written up in `REGIONS.md` §5.

  Idempotent: writes stated lists by generator key.

  ## This used to PATCH the seeder's output, and that was the bug

  It ran `UPDATE generators SET config = jsonb_set(config, '{subZones}', ...)` on rows `GeneratorSource.seed/0`
  had just written. The seeder writes that whole `config` column from its own literal, so one fact had two
  owners and every re-seed put the generic wood's five regions back on all nine biomes. Ten migrations' worth
  of region work went that way, more than once, and nothing in the code had changed each time.

  The sets live in `GeneratorSource` now (`@biome_regions`), beside the generators they describe, so the
  seeder's output IS the approved state and this re-seeds.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()
    Logger.info("[data_migrate] every biome lays out its own regions")
    :ok
  end
end

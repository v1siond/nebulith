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
  """
  require Logger

  alias Nebulith.Repo

  # EVERY region states `leafHue` and `leafValue`, and that is not decoration.
  #
  # The first run of this dropped them, because the new sets were written from scratch and the old ones carried
  # them. Measured immediately after on a family sweep: leaf tones fell from 20 to FOUR on meadow, mountain,
  # beach, ruins and desert, which undid the meadow fix made the same morning. A season serves four shades and
  # the REGION is what multiplies them into a stand that varies, so a set without these is a flat wall of one
  # colour however good its species list is.
  #
  # The numbers are the same exposure gradient the floors use: more light, lighter and slightly warmer.

  @sets %{
    "forest_mountain" => {"bands", [
      %{"key" => "foot", "name" => "Mountain foot", "weight" => 4, "canopy" => 1.10, "undergrowth" => 1.00, "leafHue" => -3, "leafValue" => -0.06, "level" => 0,
        "formation" => %{"lattice" => 11, "spacing" => 1, "understory" => 1.00, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_conifer", "weight" => 55}, %{"kind" => "tree_broadleaf", "weight" => 25}, %{"kind" => "tree_stub", "weight" => 20}]},
      %{"key" => "slope", "name" => "Wooded slope", "weight" => 3, "canopy" => 0.85, "undergrowth" => 0.70, "leafHue" => -1, "leafValue" => -0.02, "level" => 1,
        "formation" => %{"lattice" => 9, "spacing" => 2, "understory" => 0.70, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_conifer", "weight" => 70}, %{"kind" => "tree_tall", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 10}]},
      %{"key" => "treeline", "name" => "Treeline", "weight" => 3, "canopy" => 0.45, "undergrowth" => 0.35, "leafHue" => 1, "leafValue" => 0.04, "level" => 2,
        "formation" => %{"lattice" => 7, "spacing" => 3, "understory" => 0.35, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_conifer", "weight" => 55}, %{"kind" => "tree_stub", "weight" => 45}]},
      %{"key" => "crag", "name" => "Crag", "weight" => 2, "canopy" => 0.12, "undergrowth" => 0.10, "leafHue" => 3, "leafValue" => 0.08, "level" => 3,
        "formation" => %{"lattice" => 4, "spacing" => 5, "understory" => 0.12, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_stub", "weight" => 60}, %{"kind" => "tree_sapling", "weight" => 40}]},
      %{"key" => "summit", "name" => "Summit", "weight" => 1, "canopy" => 0.02, "undergrowth" => 0.04, "leafHue" => 5, "leafValue" => 0.10, "level" => 4,
        "formation" => %{"lattice" => 3, "spacing" => 6, "understory" => 0.05, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_sapling", "weight" => 100}]}
    ]},
    "forest_beach" => {"bands", [
      %{"key" => "shore", "name" => "Shore", "weight" => 3, "canopy" => 0.05, "undergrowth" => 0.50, "leafHue" => 6, "leafValue" => 0.10,
        "formation" => %{"lattice" => 4, "spacing" => 5, "understory" => 0.50, "understoryTile" => "dune_grass_young"},
        "trees" => [%{"kind" => "bush_round", "weight" => 100}]},
      %{"key" => "dunes", "name" => "Dunes", "weight" => 3, "canopy" => 0.18, "undergrowth" => 0.90, "leafHue" => 4, "leafValue" => 0.08,
        "formation" => %{"lattice" => 6, "spacing" => 4, "understory" => 0.90, "understoryTile" => "dune_grass"},
        "trees" => [%{"kind" => "tree_palm", "weight" => 40}, %{"kind" => "tree_coconut", "weight" => 30}, %{"kind" => "bush_round", "weight" => 30}]},
      %{"key" => "palms", "name" => "Palm line", "weight" => 3, "canopy" => 0.60, "undergrowth" => 0.70, "leafHue" => 1, "leafValue" => 0.03,
        "formation" => %{"lattice" => 9, "spacing" => 2, "understory" => 0.70, "understoryTile" => "dune_grass_seed"},
        "trees" => [%{"kind" => "tree_coconut", "weight" => 40}, %{"kind" => "tree_palm", "weight" => 35}, %{"kind" => "tree_banana", "weight" => 25}]},
      %{"key" => "backshore", "name" => "Backshore", "weight" => 3, "canopy" => 0.95, "undergrowth" => 1.00, "leafHue" => -2, "leafValue" => -0.04,
        "formation" => %{"lattice" => 12, "spacing" => 1, "understory" => 1.00, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_banana", "weight" => 35}, %{"kind" => "tree_mangrove", "weight" => 30}, %{"kind" => "tree_coconut", "weight" => 20}, %{"kind" => "tree_encina", "weight" => 15}]},
      %{"key" => "inland", "name" => "Inland jungle", "weight" => 2, "canopy" => 1.20, "undergrowth" => 1.20, "leafHue" => -4, "leafValue" => -0.08,
        "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.20, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_encina", "weight" => 35}, %{"kind" => "tree_banana", "weight" => 30}, %{"kind" => "tree_mangrove", "weight" => 20}, %{"kind" => "bush", "weight" => 15}]}
    ]},
    "forest_swamp" => {"bands", [
      %{"key" => "margin", "name" => "Drying margin", "weight" => 3, "canopy" => 0.90, "undergrowth" => 0.90, "leafHue" => 2, "leafValue" => 0.04, "pools" => 0.02,
        "formation" => %{"lattice" => 10, "spacing" => 2, "understory" => 0.90, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_willow", "weight" => 40}, %{"kind" => "tree_broadleaf", "weight" => 30}, %{"kind" => "tree_stub", "weight" => 30}]},
      %{"key" => "mire", "name" => "Mire", "weight" => 3, "canopy" => 0.85, "undergrowth" => 1.10, "leafHue" => -1, "leafValue" => -0.01, "pools" => 0.14,
        "formation" => %{"lattice" => 11, "spacing" => 1, "understory" => 1.10, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_willow", "weight" => 45}, %{"kind" => "tree_cypress", "weight" => 30}, %{"kind" => "bush", "weight" => 25}]},
      %{"key" => "bog", "name" => "Bog", "weight" => 3, "canopy" => 0.70, "undergrowth" => 1.20, "leafHue" => -4, "leafValue" => -0.06, "pools" => 0.30,
        "formation" => %{"lattice" => 12, "spacing" => 1, "understory" => 1.20, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_cypress", "weight" => 50}, %{"kind" => "tree_willow", "weight" => 30}, %{"kind" => "tree_mangrove", "weight" => 20}]},
      %{"key" => "sink", "name" => "Sink", "weight" => 2, "canopy" => 0.50, "undergrowth" => 0.80, "leafHue" => -6, "leafValue" => -0.09, "pools" => 0.50,
        "formation" => %{"lattice" => 9, "spacing" => 3, "understory" => 0.80, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_cypress", "weight" => 45}, %{"kind" => "tree_mangrove", "weight" => 45}, %{"kind" => "tree_sapling", "weight" => 10}]},
      %{"key" => "open_water", "name" => "Open water", "weight" => 1, "canopy" => 0.15, "undergrowth" => 0.25, "leafHue" => -8, "leafValue" => -0.10, "pools" => 0.78,
        "formation" => %{"lattice" => 5, "spacing" => 5, "understory" => 0.25, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_mangrove", "weight" => 70}, %{"kind" => "tree_cypress", "weight" => 30}]}
    ]},
    "forest_ruins" => {"rings", [
      %{"key" => "heart", "name" => "The ruin itself", "weight" => 1, "canopy" => 0.08, "undergrowth" => 0.15, "leafHue" => 3, "leafValue" => 0.09, "stone" => 0.60,
        "formation" => %{"lattice" => 3, "spacing" => 6, "understory" => 0.15, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_sapling", "weight" => 100}]},
      %{"key" => "courts", "name" => "Fallen courts", "weight" => 2, "canopy" => 0.25, "undergrowth" => 0.35, "leafHue" => 2, "leafValue" => 0.06, "stone" => 0.42,
        "formation" => %{"lattice" => 5, "spacing" => 4, "understory" => 0.35, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_stub", "weight" => 50}, %{"kind" => "tree_sapling", "weight" => 30}, %{"kind" => "bush", "weight" => 20}]},
      %{"key" => "terraces", "name" => "Terraces", "weight" => 3, "canopy" => 0.55, "undergrowth" => 0.60, "leafHue" => 0, "leafValue" => 0.01, "stone" => 0.24,
        "formation" => %{"lattice" => 8, "spacing" => 2, "understory" => 0.60, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_oak", "weight" => 35}, %{"kind" => "tree_stub", "weight" => 30}, %{"kind" => "tree_broadleaf", "weight" => 20}, %{"kind" => "bush", "weight" => 15}]},
      %{"key" => "overgrown", "name" => "Overgrown walls", "weight" => 3, "canopy" => 0.95, "undergrowth" => 1.15, "leafHue" => -3, "leafValue" => -0.05, "stone" => 0.10,
        "formation" => %{"lattice" => 11, "spacing" => 1, "understory" => 1.15, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_oak", "weight" => 30}, %{"kind" => "tree_broadleaf", "weight" => 25}, %{"kind" => "tree_gnarled", "weight" => 20}, %{"kind" => "bush", "weight" => 25}]},
      %{"key" => "forest", "name" => "Forest around it", "weight" => 3, "canopy" => 1.15, "undergrowth" => 1.00, "leafHue" => -4, "leafValue" => -0.08,
        "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.00, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_oak", "weight" => 30}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree_broadleaf", "weight" => 25}, %{"kind" => "tree_column", "weight" => 20}]}
    ]},
    "forest_desert" => {"bands", [
      %{"key" => "erg", "name" => "Dune sea", "weight" => 4, "canopy" => 0.02, "undergrowth" => 0.06, "leafHue" => 4, "leafValue" => 0.10,
        "formation" => %{"lattice" => 3, "spacing" => 7, "understory" => 0.06, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "cactus_barrel", "weight" => 50}, %{"kind" => "cactus_saguaro_young", "weight" => 50}]},
      %{"key" => "hardpan", "name" => "Hardpan", "weight" => 3, "canopy" => 0.06, "undergrowth" => 0.12, "leafHue" => 2, "leafValue" => 0.07,
        "formation" => %{"lattice" => 5, "spacing" => 5, "understory" => 0.12, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "cactus_saguaro_young", "weight" => 30}, %{"kind" => "cactus_prickly", "weight" => 30}, %{"kind" => "tree_gnarled", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 20}]},
      %{"key" => "wadi", "name" => "Wadi", "weight" => 2, "canopy" => 0.20, "undergrowth" => 0.40, "leafHue" => -1, "leafValue" => 0.00,
        "formation" => %{"lattice" => 7, "spacing" => 3, "understory" => 0.40, "understoryTile" => "shrub"},
        "trees" => [%{"kind" => "tree_gnarled", "weight" => 35}, %{"kind" => "tree_encina", "weight" => 25}, %{"kind" => "cactus_saguaro", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 20}]},
      %{"key" => "oasis", "name" => "Oasis", "weight" => 1, "canopy" => 0.75, "undergrowth" => 0.80, "leafHue" => -5, "leafValue" => -0.05, "pools" => 0.18,
        "formation" => %{"lattice" => 10, "spacing" => 1, "understory" => 0.80, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_palm", "weight" => 60}, %{"kind" => "tree_encina", "weight" => 25}, %{"kind" => "bush", "weight" => 15}]}
    ]},
    "forest_meadow" => {"scatter", [
      %{"key" => "pasture", "name" => "Pasture", "weight" => 4, "canopy" => 0.12, "undergrowth" => 0.30, "leafHue" => 2, "leafValue" => 0.05,
        "formation" => %{"lattice" => 4, "spacing" => 5, "understory" => 0.30, "understoryTile" => "tall_grass"},
        "trees" => [%{"kind" => "tree_round", "weight" => 40}, %{"kind" => "tree_big", "weight" => 30}, %{"kind" => "bush_round", "weight" => 30}]},
      %{"key" => "hedgerow", "name" => "Hedgerow", "weight" => 3, "canopy" => 0.70, "undergrowth" => 1.20, "leafHue" => -3, "leafValue" => -0.05,
        "formation" => %{"lattice" => 9, "spacing" => 1, "understory" => 1.20, "understoryTile" => "thicket"},
        "trees" => [%{"kind" => "tree_gnarled", "weight" => 40}, %{"kind" => "bush_round", "weight" => 35}, %{"kind" => "bush", "weight" => 25}]},
      %{"key" => "orchard", "name" => "Orchard", "weight" => 2, "canopy" => 0.85, "undergrowth" => 0.40, "leafHue" => 1, "leafValue" => 0.02,
        "formation" => %{"lattice" => 7, "spacing" => 3, "understory" => 0.40, "understoryTile" => "clover"},
        "trees" => [%{"kind" => "tree_cherry", "weight" => 45}, %{"kind" => "tree_round", "weight" => 35}, %{"kind" => "tree_big", "weight" => 20}]},
      %{"key" => "bank", "name" => "River bank", "weight" => 2, "canopy" => 0.50, "undergrowth" => 0.90, "leafHue" => -5, "leafValue" => -0.02, "pools" => 0.12,
        "formation" => %{"lattice" => 8, "spacing" => 2, "understory" => 0.90, "understoryTile" => "tall_grass"},
        "trees" => [%{"kind" => "tree_willow", "weight" => 55}, %{"kind" => "tree_broadleaf", "weight" => 30}, %{"kind" => "bush", "weight" => 15}]},
      %{"key" => "common", "name" => "Open common", "weight" => 3, "canopy" => 0.05, "undergrowth" => 0.20, "leafHue" => 3, "leafValue" => 0.08,
        "formation" => %{"lattice" => 3, "spacing" => 6, "understory" => 0.20, "understoryTile" => "clover"},
        "trees" => [%{"kind" => "bush_round", "weight" => 60}, %{"kind" => "tree_sapling", "weight" => 40}]}
    ]}
  }


  def run do
    rows =
      for {key, {layout, regions}} <- @sets, reduce: 0 do
        acc -> acc + write(key, layout, regions)
      end

    # The volcanic set is already right; what it never had was an arrangement, so it was met at random.
    volcanic = layout_only("forest_volcanic", "rings")

    Logger.info("[data_migrate] #{rows} biomes carry their own regions, #{volcanic} more get an arrangement")

    :ok
  end

  defp write(key, layout, regions) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(jsonb_set(config, '{subZones}', $2::text::jsonb), '{regionLayout}', $3::text::jsonb)
        WHERE key = $1
        """,
        [key, Jason.encode!(regions), Jason.encode!(layout)]
      )

    rows
  end

  defp layout_only(key, layout) do
    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{regionLayout}', $2::text::jsonb) WHERE key = $1",
        [key, Jason.encode!(layout)]
      )

    rows
  end
end

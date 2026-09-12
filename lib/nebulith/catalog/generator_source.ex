defmodule Nebulith.Catalog.GeneratorSource do
  @moduledoc """
  The SEED for the map-generator catalog — the categories the editor offers and the generators in
  them, ported verbatim from the constants that used to be scattered across the frontend.

  Alexander (2026-09-06): *"in fact, I want to get to the point where all generators are just backend
  records organized per categories, we can seed categories and existing generators from what we
  have"* and *"we should generate the maps based of the specified grid settings, IE: cell size, rows
  x col"*.

  Every number here is the value the shipped generator uses TODAY, so seeding changes no behaviour —
  it only moves where the number lives. Provenance, so the port can be re-checked:

    * grid ranges — `templates.tsx` `generateStageInEditor` (city 52-71 x 42-57, else 30-45 x 24-35)
    * cellSize / isoScale — `levels/village.ts` `VILLAGE_CONFIG`
    * settlement tuning — `engine/villageLayout.ts` (`PLAZA_SIZE`, `SETBACK`, `ROAD_W`, `LOT_GAP_BY`,
      `MAX_PER_FRONTAGE`, `BUILDING_CAP`, `HOUSE_RANGE`, `BIG_RANGE`, `HOUSE_WIDTHS`)
    * natureMultiplier — `engine/stageGenerator.ts` `NATURE_MULT`
    * nature densities — `engine/stageGenerator.ts` nature pass (`scatterGroundCover` 0.12,
      `scatterFlowers` 0.06)
    * townsfolk / enemies — `templates.tsx` (`townCount` 14/8/5, `seedStageEnemies` count 10) and
      `game/spawner.ts` (`CAVE_ENEMY_TYPES`, `TEMPLE_ENEMY_TYPES`)
    * building materials + colours — `templates.tsx` `applyStageToGrid`

  Idempotent: `seed/0` upserts by `key`, so re-running never duplicates and never clobbers a row's
  id (the same contract `TileSource.seed/0` has).
  """
  import Ecto.Query, warn: false

  alias Nebulith.Repo
  alias Nebulith.Catalog.{Generator, GeneratorCategory}

  # Every season the editor's zone selector offers (`editorConfig.ts` STAGE_ZONES). Every category
  # runs in all of them, so the menu is zone x category with no gaps.
  @zones ~w(spring summer autumn winter desert)

  # THE OPTIONS an outdoor generator offers. Alexander, 2026-09-10: *"we should just have extra options for
  # each template"*, after listing exactly how the row count explodes otherwise (woodland, woodland + river,
  # woodland + river + bridge…).
  #
  # `requires` is what keeps the panel honest: a crossing is meaningless without a river, so it says so
  # rather than the frontend knowing it. That was his next ticket too — *"rivers need crossings connected to
  # the paths"* — and as an option it is one more row here, never another template.
  #
  # THE RIVER IS A CHOICE OF COURSE, not an on/off. Alexander, 2026-09-11: *"the rivers aren't consistently
  # generated, It'd like to have variants of river usage, maybe it's traversable, maybe it's dividing the map
  # in two half, maybe it's around the map, etc right now is super random, and while I want and think the
  # randomness is good, we need to parametize it a bit more"*. So each course he named is a choice, and the
  # randomness he wants to keep is one of them rather than the only behaviour.
  @water_options [
    %{
      "key" => "river",
      "label" => "River",
      "type" => "choice",
      "default" => "none",
      "choices" => [
        %{"key" => "none", "label" => "No river"},
        %{"key" => "random", "label" => "Random"},
        %{"key" => "through", "label" => "Winds through (easy to cross)"},
        %{"key" => "divides", "label" => "Divides the map in two"},
        %{"key" => "around", "label" => "Around the edge"}
      ]
    },
    %{
      "key" => "crossing",
      "label" => "A crossing joined to the paths",
      "type" => "toggle",
      "default" => false,
      "requires" => "river"
    },
    # WHAT the river is crossed on. Alexander, 2026-09-11: *"on the "bridges" that we use on rivers, we must have
    # multiple variations too / it can be a simple dirt path, it can be an actual bridge, which again, are
    # multiple variations"*. Each key is a row of @crossings, which says the tile it lays.
    %{
      "key" => "bridge",
      "label" => "Kind of crossing",
      "type" => "choice",
      "default" => "random",
      "requires" => "river",
      "choices" => [
        %{"key" => "random", "label" => "Random"},
        %{"key" => "dirt", "label" => "Dirt path"},
        %{"key" => "wood", "label" => "Wooden bridge"},
        %{"key" => "planks", "label" => "Plank walkway"},
        %{"key" => "stone", "label" => "Stone bridge"}
      ]
    }
  ]

  # The tile each kind of crossing lays over the water. A dirt path is the flat floor wearing the dirt path's
  # colour (the floor rule: colour on the flat tile, textured tiles for the things that stand out). The bridges
  # are the textured tiles, in the colour they come in, so each reads as its own material.
  @crossings %{
    "dirt" => %{"tile" => "floor", "colorOf" => "path_dirt"},
    "wood" => %{"tile" => "bridge"},
    "planks" => %{"tile" => "wooden_planks"},
    "stone" => %{"tile" => "cobblestone"}
  }

  # ── THE WAYS THROUGH A MAP ────────────────────────────────────────────────
  # Alexander, 2026-09-11: *"I expect maps to have an entrance and exit, sometimes it'll be the same place to enter
  # and leave, others we must have multiple pathways with different exists ... we should always have paths firsts,
  # and ensure the rest is build around it"*, and for caves and temples too: *"I can generate a cave with 1 exit and
  # 3 pathways to simulate entrance, then I continue doing the same until I reach a part where is just 1 exit no
  # pathway, which is the end of the cave"*.
  #
  # So a map carries TWO numbers, not one. EXITS are the ways out to another map (the connectors). PATHWAYS are the
  # paths inside it: the ones that are not an exit end somewhere in the map, which is where a closed or gated
  # section belongs. One exit and no extra pathway is the end of a chain; one exit and three pathways is a junction.
  @way_options [
    %{
      "key" => "exits",
      "label" => "Exits",
      "type" => "choice",
      "default" => "random",
      "choices" => [
        %{"key" => "random", "label" => "Random"},
        %{"key" => "1", "label" => "1: in and out the same way"},
        %{"key" => "2", "label" => "2: in one side, out the other"},
        %{"key" => "3", "label" => "3"},
        %{"key" => "4", "label" => "4"}
      ]
    },
    %{
      "key" => "pathways",
      "label" => "Pathways",
      "type" => "choice",
      "default" => "random",
      "choices" => [
        %{"key" => "random", "label" => "Random"},
        %{"key" => "1", "label" => "1"},
        %{"key" => "2", "label" => "2"},
        %{"key" => "3", "label" => "3"},
        %{"key" => "4", "label" => "4"}
      ]
    }
  ]

  # The default grid a non-city map rolls, and the cell geometry every map starts from.
  @small_grid %{
    "cols" => %{"min" => 30, "max" => 45},
    "rows" => %{"min" => 24, "max" => 35},
    "cellSize" => 16,
    "isoScale" => 2.5
  }

  # A city reads BIGGER on screen: ~1.7x the town's linear size, on top of its denser street grid.
  @city_grid %{
    "cols" => %{"min" => 52, "max" => 71},
    "rows" => %{"min" => 42, "max" => 57},
    "cellSize" => 16,
    "isoScale" => 2.5
  }

  # The per-building material + colour roll. Residential buildings pick a material and a roof/wall
  # tone by a position hash; a store and a hospital are FIXED so they read as civic at a glance.
  # A LOOK IS A MATERIAL AND A ROOF, not a hex nudge. Alexander, 2026-09-11: *"I picked a tropical city and had
  # nothing different than a regular one ... the material of houses should be different, walls different, roof
  # different"*, and *"each settlement variation should have their own flavor and clear differences"*.
  #
  # He was right and the reason was in here: every look carried colours only, and the ROOF TILE is baked into
  # the composition (`house_5` is slate, `house_4` and `big_house_6` are gables, `store_5` is a flat deck), so
  # no palette could change a roof's shape. `roof` names the body tile a residential building lays, and the
  # stamper swaps its cap with it. Four wall families exist (brick, plaster, stone, wood), so each look below
  # owns a DIFFERENT one, and the colours are pulled far apart rather than sitting a few percent from each other.
  @building_palette %{
    "roof" => "roof",
    "materials" => ["wall_brick", "wall_wood", "wall_stone"],
    "roofColors" => ["#b5533a", "#5a636b", "#5c4433", "#4a6a7a"],
    "wallColors" => ["#9e4b3b", "#c9a66b", "#e8dcc0", "#8a8580", "#a89f7a"],
    "storeRoof" => "#235a96",
    "hospitalRoof" => "#2f7e50",
    "fixedWall" => "#f0f0ea"
  }

  # The light dressing every outdoor map gets: flat ground tufts + a few standing blooms.
  # `tallGrass` is the share of open floor standing in LONG GRASS, walkable, the kind Pokemon hides its
  # encounters in (Alexander, 2026-09-11: *"we do need some type of walkable long grass too ... that long grass
  # is walkable, we need variance like that too"*). A field is where you expect it most.
  @outdoor_nature %{"groundCover" => 0.12, "flowers" => 0.06, "tallGrass" => 0.18}

  # A WOODLAND's densities. `canopy` is the share of cells carrying a tree, and it is the number that
  # makes a forest read as a forest. Alexander, 2026-09-09: *"the meadow is not a forest, it doesn't look
  # like one"* — measured, the meadow presets produced ~10% tree cover scattered over an open field. At
  # 0.62 the canopy dominates the forest floor and the carved clearings read as clearings rather than as
  # the default state. Note the share is of the PLANTABLE floor, not the whole grid — the clearings and
  # paths are excluded, so this number is not diluted by how many clearings a map happens to roll.
  # Ground cover is richer than the meadow's because a forest floor is not lawn.
  # Alexander, 2026-09-09: *"we need less trees on woodland, reduce it about 30%."* 0.62 → 0.434. The trees
  # were reading as a wall rather than as a wood — thinning them lets the clearings and trails breathe and
  # lets you see through the trunks. The density lives HERE, not in the generator, so tuning it is a data
  # change and not a code change.
  @woodland_nature %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.434, "tallGrass" => 0.12}

  # A JUNGLE is a woodland grown over: the canopy Alexander already accepted as forest-dense (the 0.62 the
  # woodland used to carry), plus the thing that actually distinguishes a jungle from a wood — UNDERGROWTH.
  # Ground cover more than doubles and the blooms go with it, so the floor is choked rather than walkable
  # lawn between trunks. Same STRUCTURE as the woodland (clearings, trails); only these numbers differ, which
  # is why it needs no generator of its own. Starting values — tune them here by eye.
  @jungle_nature %{"groundCover" => 0.5, "flowers" => 0.1, "canopy" => 0.62}

  # THE FOREST PALETTES. Alexander, 2026-09-10: *"right now a jungle is basically the same as woodland in the
  # app, there's not a single difference between them, but they should be, colors should be different"* and
  # *"like there's a huge difference between amazonas and a pines forest"*.
  #
  # He is right, and the reason was structural: every colour in a forest came from the SEASON (spring, autumn)
  # and nothing came from the KIND of forest, so a spring jungle and a spring woodland were painted from the
  # same numbers. A palette per GENERATOR is what makes them different places, and it lives here because it is
  # data about a template.
  #
  # The generator paints these onto cells as floor STATE. That is the sanctioned path: a generator PICKS and
  # WRITES colour, the renderer only reads. Nothing here is a render-time fallback.

  # A TEMPERATE WOOD. Muted, grey-green, a lot of brown showing through — a pine or oak floor is needles and
  # leaf litter with light reaching it, so it reads dry and open even under the canopy.
  @woodland_palette %{
    "floor" => "#6f7f4a",
    "floorAlt" => "#7d8a55",
    "litter" => "#7a6a44",
    "canopy" => "#5d7340",
    "canopyAlt" => "#6b8049",
    "undergrowth" => "#6d7f45",
    "water" => "#4f93b3",
    # Water by DEPTH, then swamp. Alexander, 2026-09-11: *"I only want light blue for walkable water, different
    # layers of darkblue for the deeper waters and we can have some share of blue-green for swamp"*.
    "waterShallow" => "#8ccbe8",
    "waterDeep" => "#2a5f8a",
    "swamp" => "#3f8a84",
    "bank" => "#c1a877",
    "trail" => "#9a8a62"
  }

  # AN AMAZONAS. Deep, wet, saturated, and DARK: a closed canopy puts the floor in permanent shade, so the
  # ground is near-black green rather than the woodland's lit olive. The canopy above it is the brightest
  # thing on the map because it is the layer actually getting the sun, which is the inversion that makes a
  # jungle read as a jungle. Water is silt-brown, not blue — a jungle river carries the forest in it.
  @jungle_palette %{
    "floor" => "#2f4a2a",
    "floorAlt" => "#38552f",
    "litter" => "#46442a",
    "canopy" => "#2e6b32",
    "canopyAlt" => "#3f8a3c",
    "undergrowth" => "#25532a",
    # Was olive silt (#5e6b3a), my choice in ticket 48, and exactly what he saw: *"right now the green used
    # makes it look like a floor instead of water and it's confusing"*. Water is blue; only swamp leans green.
    "water" => "#3f86b0",
    "waterShallow" => "#86c5e2",
    "waterDeep" => "#23547e",
    "swamp" => "#3a8278",
    "bank" => "#6b5f3c",
    "trail" => "#57502f"
  }

  # WHICH TREES GROW HERE. Alexander, 2026-09-11: *"we need to have more variance of trees, like we're using
  # the same for all forest variations, but that's not good"*. Every forest rolled from one global weighted
  # table, so a jungle and a meadow grew the same species. Each template states its own mix now; a template
  # that states none falls back to that global table.
  @woodland_trees [
    %{"kind" => "tree_column", "weight" => 30},
    %{"kind" => "tree", "weight" => 22},
    %{"kind" => "tree_tall", "weight" => 18},
    %{"kind" => "tree_round", "weight" => 12},
    %{"kind" => "tree_conifer", "weight" => 10},
    %{"kind" => "tree_stub", "weight" => 8},
    %{"kind" => "bush", "weight" => 6},
    %{"kind" => "tree_sapling", "weight" => 4}
  ]

  @meadow_trees [
    %{"kind" => "tree_gnarled", "weight" => 38},
    %{"kind" => "tree_broadleaf", "weight" => 22},
    %{"kind" => "tree_round", "weight" => 20},
    %{"kind" => "tree_big", "weight" => 10},
    %{"kind" => "bush_round", "weight" => 10}
  ]

  @jungle_trees [
    %{"kind" => "tree_round", "weight" => 22},
    %{"kind" => "tree_big", "weight" => 20},
    %{"kind" => "bush_round", "weight" => 16},
    %{"kind" => "tree_giant", "weight" => 14},
    %{"kind" => "tree_palm", "weight" => 14},
    %{"kind" => "bush", "weight" => 14}
  ]

  # The meadow's WATER, by depth. It has no floor palette of its own (its gradient is seasonal), but its river
  # is still water and owes the same reading as every other: light blue where you can wade, darker as it deepens.
  @meadow_palette %{
    "water" => "#4a8fbf",
    "waterShallow" => "#91cdea",
    "waterDeep" => "#275b88",
    "swamp" => "#3f8a84"
  }

  # HOW THE TREES ARE DISTRIBUTED. Alexander, 2026-09-11: *"we need more variants of trees distribution too,
  # or formations, like right now all forest variations kind of follow the same type oof tree grouping, but
  # just there's different forests types, there's different ways in which trees and nature is distributed
  # across these zones"*, with six reference photographs.
  #
  # Two numbers do most of the work:
  #
  #   * `lattice` — the scale of the noise the canopy is scored against, in cells. SMALL means the score
  #     changes every few cells, so trees land as fine scatter. LARGE means neighbouring cells score alike,
  #     so they land as big continuous masses. This is the "grouping" he is describing.
  #   * `spacing` — the minimum gap between two trunks. 0 lets them touch and read as a wall; 3 forces the
  #     open, individually-readable spacing of a wood pasture. NEVER 1: claiming only the four orthogonal
  #     neighbours leaves a CHECKERBOARD, which is passable diagonally (the iso view's movement) but not
  #     orthogonally (the top view's), so the floor measures as hundreds of regions and the repair has to cut
  #     through the whole wood to fix it. Measured at 308 regions on one seed. 0 or 2+, never 1.
  #
  # `understory` multiplies the served ground cover, because how choked the floor is between the trunks is
  # the other half of what tells two forests apart.
  #
  # Each of these is one of his photographs:
  @formations %{
    # Image #10 — a wood pasture. Big gnarled trees standing alone on open grass, wide apart, nothing
    # between them. The trees are individuals, not a canopy.
    "scattered" => %{"lattice" => 3, "spacing" => 4, "understory" => 0.35},
    # Image #11 — an even-aged beech stand. Straight trunks at regular spacing, a clear walkable floor, and
    # a broad track through it. Ordered rather than clumped.
    "stand" => %{"lattice" => 5, "spacing" => 2, "understory" => 0.45},
    # Image #12 — conifers scattered in patches over an open hillside. Clear ground between the groups, so
    # a large lattice (real clumps) but a low overall density.
    "clumped" => %{"lattice" => 10, "spacing" => 0, "understory" => 0.6},
    # Image #14 — a closed canopy seen from across the valley. Wall to wall, no floor visible anywhere.
    "closed" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.25},
    # Image #15 — tall dense trunks over deep green undergrowth, with a narrow trail winding through. The
    # canopy is not the hard part here, the floor is.
    "understory" => %{"lattice" => 7, "spacing" => 0, "understory" => 1.9},
    # Image #13 — cypress standing IN the water, well apart, buttressed bases. Spaced like a pasture but wet.
    "flooded" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.7}
  }

  # THE JUNGLE'S SUB-ZONES. Alexander, 2026-09-10: *"the generator shoudl be smart enough to identify
  # different patterns of jungles for example, open zones, dense zones, zones with swamp, zone with river,
  # zone with cave, zone with ruins"*, and 2026-09-11 on the shape: REGIONS INSIDE ONE MAP, not more rows in
  # the template list. You walk out of the open canopy into dense growth, through a swamp, up to the ruins,
  # without loading anything.
  #
  # `canopy` and `undergrowth` are MULTIPLIERS on the generator's served base densities, not absolutes. That
  # keeps one knob in charge: tune `@jungle_nature` and the whole map moves together, tune a multiplier here
  # and only that kind of ground changes. `weight` is how much of the map a kind tends to claim.
  #
  # The river is not in this list because it is not a region — it is the watercourse that runs THROUGH them,
  # and every jungle has one.
  # WOODLAND REGIONS. Alexander, 2026-09-11: *"woodland with meadow is the same as mountain forest..."*.
  #
  # Measured, he was right: glades ran `canopy 0.35` and mountain forest `0.28`, both under the SAME `clumped`
  # formation with the same ground cover, on ground that is flat everywhere. One thin uniform scatter, twice.
  #
  # "Stands of trees broken by open meadow" is its own description and it is TWO REGIONS, not one average. A
  # region's `canopy` is a MULTIPLIER of the template's, so a stand closes over and a meadow is grass with the
  # odd tree standing alone in it. The jungle has had this machinery since its open/dense split; no woodland
  # ever used it.
  @woodland_sub_zones [
    %{
      "key" => "stand",
      "name" => "Tree stand",
      "weight" => 3,
      "canopy" => 1.7,
      "undergrowth" => 0.9,
      "floor" => "#5c6e3d",
      # close together, floor barely visible inside a stand
      "formation" => %{"lattice" => 7, "spacing" => 1, "understory" => 0.8},
      "trees" => [%{"kind" => "tree_column", "weight" => 30}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree", "weight" => 25}, %{"kind" => "tree_sapling", "weight" => 20}]
    },
    %{
      "key" => "meadow",
      "name" => "Open meadow",
      "weight" => 2,
      # almost nothing: a meadow is the ABSENCE of canopy, which is what makes the stands read as stands
      "canopy" => 0.06,
      "undergrowth" => 0.4,
      "floor" => "#8b9a5a",
      "formation" => %{"lattice" => 3, "spacing" => 5, "understory" => 0.3},
      "trees" => [%{"kind" => "tree_gnarled", "weight" => 60}, %{"kind" => "tree_round", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}]
    }
  ]

  @jungle_sub_zones [
    %{
      "key" => "open",
      "name" => "Open canopy",
      "weight" => 3,
      "canopy" => 0.45,
      "undergrowth" => 0.5,
      "floor" => "#3f5f33",
      # an open region reads as individual trees on visible ground — his image #12
      "formation" => %{"lattice" => 9, "spacing" => 3, "understory" => 0.5},
      "trees" => [%{"kind" => "tree_palm", "weight" => 30}, %{"kind" => "tree_round", "weight" => 30}, %{"kind" => "tree_big", "weight" => 20}, %{"kind" => "bush_round", "weight" => 20}]
    },
    %{
      "key" => "dense",
      "weight" => 4,
      "name" => "Dense growth",
      "canopy" => 1.3,
      "undergrowth" => 1.45,
      "floor" => "#24381f",
      # wall to wall, nothing between — his image #14
      "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.3},
      "trees" => [%{"kind" => "tree_giant", "weight" => 25}, %{"kind" => "tree_big", "weight" => 25}, %{"kind" => "bush", "weight" => 25}, %{"kind" => "tree_round", "weight" => 25}]
    },
    %{
      "key" => "swamp",
      "name" => "Swamp",
      "weight" => 2,
      "canopy" => 0.85,
      "undergrowth" => 1.1,
      "floor" => "#3b4a2e",
      # the share of the zone that stands under water — pools, not a channel
      "pools" => 0.22,
      # cypress standing IN the water, well apart — his image #13
      "formation" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.7},
      # the cypress IS the swamp — image #13
      "trees" => [%{"kind" => "tree_cypress", "weight" => 60}, %{"kind" => "bush_round", "weight" => 25}, %{"kind" => "tree_round", "weight" => 15}]
    },
    %{
      "key" => "ruins",
      "name" => "Ruins",
      "weight" => 2,
      "canopy" => 0.55,
      "undergrowth" => 0.65,
      "floor" => "#4a4a3c",
      # the trees have taken the ruins back, but unevenly — clumps with open stone between
      "stone" => 0.16,
      "formation" => %{"lattice" => 8, "spacing" => 2, "understory" => 0.6},
      "trees" => [%{"kind" => "tree_round", "weight" => 30}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_stub", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 20}]
    }
  ]

  # How many ancestors a seed row has — parents seed first.
  defp depth(%{parent: parent}, by_key) when is_binary(parent), do: 1 + depth(Map.fetch!(by_key, parent), by_key)
  defp depth(_row, _by_key), do: 0

  @doc false
  # THE REGION PICKER. Alexander, 2026-09-11: *"on jungle we have "regions" in it, but it's badly implemented,
  # we should just have variations, similar to "which jungle" "which region""*.
  #
  # Tick boxes are gone. You pick a region to LEAD and the map leans that way, which is the same idiom as
  # picking a preset or a subtype. Built from the KEYS a row actually carries, so a subtype that holds two
  # regions offers two, and the names come from one place.
  defp region_options(keys), do: region_options(@jungle_sub_zones, keys)

  defp region_options(list, keys) do
    named = Map.new(list, &{&1["key"], &1["name"]})

    [
      %{
        "key" => "region",
        "label" => "Region",
        "type" => "choice",
        "default" => "random",
        "choices" => [
          %{"key" => "random", "label" => "Random"}
          | for(k <- keys, do: %{"key" => k, "label" => Map.fetch!(named, k)})
        ]
      }
    ]
  end

  # The jungle's regions at different weights — a swamp jungle is the same regions, mostly swamp. A weight of
  # zero leaves that region out.
  defp sub_zones(list, weights) do
    for z <- list, w = Map.get(weights, z["key"], 0), w > 0, do: Map.put(z, "weight", w)
  end

  defp sub_zones(weights), do: sub_zones(@jungle_sub_zones, weights)

  # The water options with a different starting river — an island starts ringed by water.
  defp water_options(river_default) do
    [river | rest] = @water_options
    [Map.put(river, "default", river_default) | rest]
  end

  @doc "The categories to seed, in menu order (`editorConfig.ts` STAGE_VARIANTS)."
  def categories do
    [
      %{key: "forest", name: "Forest", position: 0, description: "Woodland and open meadows, with no settlement in them."},
      # Alexander, 2026-09-11: *"City and town options are the same, it'd put them in a single category"*. So a
      # town and a city are two PRESETS of one kind of place, the way a woodland and a meadow are two presets
      # of forest. The row says which archetype it runs, so the engine still builds a town for Town.
      %{key: "settlement", name: "Settlement", position: 1, description: "Towns and cities: the same streets and squares at different densities."},
      %{key: "cave", name: "Cave", position: 2, description: "A seasonal cavern with enemies instead of townsfolk."},
      %{key: "temple", name: "Temple", position: 3, description: "A seasonal temple dungeon."}
    ]
  end

  @doc "The generators to seed, keyed to their category."
  def generators do
    [
      %{
        category: "forest", key: "forest_woodland", name: "Woodland", layout: "woodland", variant: "forest", position: 0,
        description: "Dense trees with clearings cut into them, joined by paths.",
        config: %{"grid" => @small_grid, "nature" => @woodland_nature, "units" => townsfolk(3), "palette" => @woodland_palette, "formation" => @formations["stand"], "trees" => @woodland_trees, "crossings" => @crossings},
        options: @way_options ++ @water_options
      },
      %{
        category: "forest", key: "forest_jungle", name: "Jungle", layout: "jungle", variant: "forest", position: 1,
        description: "A closed canopy over choked undergrowth, with clearings cut into it.",
        config: %{"grid" => @small_grid, "nature" => @jungle_nature, "units" => townsfolk(2), "palette" => @jungle_palette, "subZones" => @jungle_sub_zones, "formation" => @formations["closed"], "trees" => @jungle_trees, "crossings" => @crossings},
        options: @way_options ++ region_options(~w(open dense swamp ruins)) ++ @water_options
      },
      %{
        category: "forest", key: "forest_meadow", name: "Meadow", layout: "meadow", variant: "forest", position: 2,
        description: "An open clearing framed by trees, with two ways in.",
        config: %{"grid" => @small_grid, "nature" => @outdoor_nature, "units" => townsfolk(5), "formation" => @formations["scattered"], "trees" => @meadow_trees, "palette" => @meadow_palette, "crossings" => @crossings},
        options: @way_options ++ @water_options
      },
      # ── SUBTYPES ────────────────────────────────────────────────────────────────────────────────────
      # Alexander, 2026-09-11: *"we should also have extra options to select different types of the selected
      # zone, or just randomize, and we can go various levels deeper / forest > type of forest > sub type of
      # type of forest > etc / like maybe it's an island jungle, maybe it's a mountain forest"*. Each one
      # states ONLY what makes it different; the catalog merges its parent's config under it. The woodland and
      # meadow sets are his six reference photographs, named by image.

      # image #11 — straight trunks at even spacing, a clear floor
      %{
        category: "forest", parent: "forest_woodland", key: "forest_woodland_beech", name: "Beech stand",
        layout: "woodland", position: 0,
        description: "Tall straight trunks at even spacing over a clear floor.",
        config: %{"formation" => @formations["stand"], "nature" => %{"canopy" => 0.45},
                  "trees" => [%{"kind" => "tree_column", "weight" => 55}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree", "weight" => 20}]}
      },
      # image #15 — the floor is the hard part: deep undergrowth, a trail through it
      %{
        category: "forest", parent: "forest_woodland", key: "forest_woodland_dense", name: "Dense woodland",
        layout: "woodland", position: 1,
        description: "Tall trunks over deep undergrowth, with a trail cut through it.",
        # A BUSH IS NOT A TREE. Alexander, 2026-09-11: *"'dense woodland' is not dense at all, standard
        # woodland is denser lol"*. He was right and it was arithmetic: `canopy` is the share of plantable
        # floor that gets an entry from the TREE table, and 30% of this one's table was `bush`. So its real
        # tree cover was 0.55 x 0.70 = 0.39, against plain woodland's 0.434 x 0.95 = 0.41. It was thinner.
        #
        # Undergrowth has its OWN channel (`groundCover`), so the bushes move there where they belong and the
        # table is trees only. Real cover is 0.60 now, half again as much as plain woodland, and still under
        # the jungle's 0.62 so a dense wood does not out-thicket a rainforest.
        config: %{"formation" => @formations["understory"], "nature" => %{"canopy" => 0.6, "groundCover" => 0.5},
                  "trees" => [%{"kind" => "tree_column", "weight" => 35}, %{"kind" => "tree_tall", "weight" => 28}, %{"kind" => "tree", "weight" => 20}, %{"kind" => "tree_big", "weight" => 10}, %{"kind" => "tree_sapling", "weight" => 7}]}
      },
      # image #12 — conifers in patches over an open hillside
      %{
        category: "forest", parent: "forest_woodland", key: "forest_woodland_mountain", name: "Mountain forest",
        layout: "woodland", position: 2,
        description: "Conifers in patches over open hillside.",
        config: %{"formation" => @formations["clumped"], "nature" => %{"canopy" => 0.28},
                  "trees" => [%{"kind" => "tree_conifer", "weight" => 70}, %{"kind" => "tree_tall", "weight" => 15}, %{"kind" => "tree_stub", "weight" => 15}]}
      },
      # image #12 again — woodland broken by open meadow sections
      %{
        category: "forest", parent: "forest_woodland", key: "forest_woodland_glades", name: "Woodland with meadows",
        layout: "woodland", position: 3,
        description: "Closed stands of trees with open meadow between them.",
        config: %{"formation" => @formations["clumped"], "nature" => %{"canopy" => 0.4},
                  "subZones" => sub_zones(@woodland_sub_zones, %{"stand" => 3, "meadow" => 2}),
                  "trees" => [%{"kind" => "tree", "weight" => 30}, %{"kind" => "tree_round", "weight" => 25}, %{"kind" => "tree_broadleaf", "weight" => 25}, %{"kind" => "tree_gnarled", "weight" => 20}]},
        options: @way_options ++ region_options(@woodland_sub_zones, ~w(stand meadow)) ++ @water_options
      },
      # image #14 — wall to wall, no floor visible
      %{
        category: "forest", parent: "forest_jungle", key: "forest_jungle_dense", name: "Super dense jungle",
        layout: "jungle", position: 0,
        description: "A closed canopy wall to wall, almost no open ground.",
        config: %{"nature" => %{"canopy" => 0.72}, "subZones" => sub_zones(%{"dense" => 5, "open" => 1})},
        options: @way_options ++ region_options(~w(open dense)) ++ @water_options
      },
      # image #13 — cypress standing in the water
      %{
        category: "forest", parent: "forest_jungle", key: "forest_jungle_swamp", name: "Swamp jungle",
        layout: "jungle", position: 1,
        description: "Mostly swamp, cypress standing in the water.",
        config: %{"subZones" => sub_zones(%{"swamp" => 6, "dense" => 2, "open" => 1})},
        options: @way_options ++ region_options(~w(open dense swamp)) ++ @water_options
      },
      # his words — an island: water around it, palms
      %{
        category: "forest", parent: "forest_jungle", key: "forest_jungle_island", name: "Island jungle",
        layout: "jungle", position: 2,
        description: "Palms over pale sand, ringed by shallow turquoise water.",
        # AN ISLAND IS NOT THE AMAZON. Alexander, 2026-09-11: *"Island jungle is not different whatsoever from
        # regular swamp, vegetation and colors should differt, the nature from islands is not the same as in
        # amazonas for example"*.
        #
        # Measured: it inherited the jungle palette WHOLE, so its colours were the same numbers as the swamp
        # jungle's, down to the hex. Only the tree weights differed and you cannot see a weight. An island is
        # brighter and paler than rainforest: sand where a jungle has peat, turquoise where a jungle has
        # blue-brown, and a canopy that is yellow-green rather than near-black.
        config: %{"subZones" => sub_zones(%{"open" => 3, "dense" => 2}),
                  "palette" => Map.merge(@jungle_palette, %{
                    "floor" => "#7c8a4e",
                    "floorAlt" => "#8c9a5b",
                    "litter" => "#9a8d5a",
                    "canopy" => "#4f9147",
                    "canopyAlt" => "#68ab56",
                    "undergrowth" => "#618c48",
                    "water" => "#2aa8c0",
                    "waterShallow" => "#86e0ea",
                    "waterDeep" => "#1a7891",
                    "bank" => "#e8d6a6",
                    "trail" => "#cdb684"
                  }),
                  "trees" => [%{"kind" => "tree_palm", "weight" => 55}, %{"kind" => "tree_round", "weight" => 20}, %{"kind" => "bush_round", "weight" => 15}, %{"kind" => "tree_stub", "weight" => 10}]},
        options: @way_options ++ region_options(~w(open dense)) ++ water_options("around")
      },
      %{
        category: "forest", parent: "forest_jungle", key: "forest_jungle_ruins", name: "Jungle ruins",
        layout: "jungle", position: 3,
        description: "Ruins the jungle has taken back.",
        config: %{"subZones" => sub_zones(%{"ruins" => 5, "dense" => 2, "open" => 2})},
        options: @way_options ++ region_options(~w(open dense ruins)) ++ @water_options
      },
      # image #10 — big lone trees wide apart on open grass
      %{
        category: "forest", parent: "forest_meadow", key: "forest_meadow_pasture", name: "Wood pasture",
        layout: "meadow", position: 0,
        description: "Big lone trees standing wide apart on open grass.",
        config: %{"formation" => @formations["scattered"],
                  "trees" => [%{"kind" => "tree_gnarled", "weight" => 60}, %{"kind" => "tree_broadleaf", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}]}
      },
      %{
        category: "forest", parent: "forest_meadow", key: "forest_meadow_open", name: "Open meadow",
        layout: "meadow", position: 1,
        description: "The open clearing, as it is.",
        config: %{}
      },
      # ── SETTLEMENTS, BUILT LIKE FORESTS ─────────────────────────────────────────────────────────────
      # Alexander, 2026-09-11: *"all settlements are still the same fucking thing, only city and town are
      # different, the rest are the same"*, *"we even have THE FUCKING FOREST as baseline, just like a swamp
      # jungle is not the same as regular jungle"*, and *"i think we should threat setlement the same way we do
      # with forest"*.
      #
      # So the shape is the forest's. What you pick is the KIND, and a town and a city really are the two
      # different things: a town is low and green with stone pathways through it, a city is dense and paved. A
      # VARIATION hangs under its kind and states ONLY what makes it itself, because `generator_tree` inherits
      # the archetype and the options and deep-merges the config (a list, like the building mix, REPLACES its
      # parent's rather than adding to it, which is the point of stating one).
      #
      # Four of the old rows are gone at his word: *"remove "andean town", "remove mediterranean city", remove
      # "tropical city""* and *"snowy town shouldn't exist a snowing town is just a regular town withn winter
      # season and rain active"*.
      #
      # NOT here yet, deliberately: his *"A swamp city should be a city in a fucking swamp"* and the city with a
      # lake (image #34). A settlement generator places no WATER at all today, so both would be a normal place
      # with browner walls, which is the exact paint he rejected. They wait on the water work.
      %{
        category: "settlement", key: "town", name: "Town", layout: "town", variant: "town", position: 0,
        description: "Houses along stone pathways, a square in the middle, trees between the lots.",
        config: %{
          "grid" => @small_grid,
          "settlement" => settlement(plaza: 5, lot_gap: [1, 2], max_per_frontage: 6, cap: 18,
                                     houses: [4, 6], big: [1, 3], nature_mult: 1.3,
                                     mix: [{"temple", 1, 1}, {"church", 1, 1}, {"stable", 1, 2}, {"barn", 1, 2}, {"smithy", 1, 1}],
                                     streets: "path_stone"),
          "nature" => @outdoor_nature,
          "units" => townsfolk(8),
          "buildings" => Map.merge(@building_palette, %{
            "roof" => "roof",
            "materials" => ["wall_brick", "wall_wood"],
            "roofColors" => ["#8a4b2f", "#7a4326", "#6b4a2b"],
            "wallColors" => ["#c9a66b", "#b08d5b", "#d8c79a"]
          })
        }
      },
      %{
        category: "settlement", key: "city", name: "City", layout: "city", variant: "city", position: 1,
        description: "Blocks and towers on paved streets, wide junctions, little green.",
        config: %{
          "grid" => @city_grid,
          "settlement" => settlement(plaza: 7, lot_gap: [1, 1], max_per_frontage: 99, cap: 72,
                                     houses: [7, 11], big: [3, 5], nature_mult: 0.5,
                                     mix: [{"temple", 1, 1}, {"tower", 3, 5}, {"apartment", 4, 7}, {"office", 2, 4}],
                                     streets: "road"),
          "nature" => @outdoor_nature,
          "units" => townsfolk(14),
          "buildings" => Map.merge(@building_palette, %{
            "roof" => "flat_roof",
            "materials" => ["wall_plaster"],
            "roofColors" => ["#4a4f55", "#3f464c", "#5a636b"],
            "wallColors" => ["#e8ecef", "#d3d8dc", "#bcc3c9"]
          })
        }
      },
      # ── VARIATIONS OF A TOWN ────────────────────────────────────────────────────────────────────────
      # image #31 - a small town: a handful of houses and a lot of green between them
      %{
        category: "settlement", parent: "town", key: "town_small", name: "Small town",
        layout: "town", position: 0,
        description: "A handful of timber houses and green between every one of them.",
        config: %{
          "settlement" => %{
            "buildingCap" => 12, "houseRange" => [3, 5], "bigHouseRange" => [0, 1], "natureMultiplier" => 1.8,
            "mix" => mix([{"church", 1, 1}, {"stable", 1, 1}, {"barn", 1, 1}])
          },
          "units" => townsfolk(5),
          "buildings" => %{"materials" => ["wall_wood"], "wallColors" => ["#b08d5b", "#c9a66b", "#9c7c4e"]}
        }
      },
      # image #29 - a forest village: the roads are made of stone and the trees come right up to the houses
      %{
        category: "settlement", parent: "town", key: "town_forest", name: "Forest village",
        layout: "town", position: 1,
        description: "Timber houses under the trees, joined by paths of stone.",
        config: %{
          "settlement" => %{
            "buildingCap" => 14, "houseRange" => [4, 6], "bigHouseRange" => [0, 1], "natureMultiplier" => 2.4,
            "streets" => "path_stone",
            "mix" => mix([{"stable", 1, 1}, {"barn", 1, 2}, {"smithy", 1, 1}])
          },
          "nature" => %{"groundCover" => 0.28, "flowers" => 0.08, "tallGrass" => 0.22},
          "units" => townsfolk(6),
          "buildings" => %{"materials" => ["wall_wood"], "wallColors" => ["#8f7450", "#a98b5f", "#7d6544"]}
        }
      },
      # "Like mountain town" - stone walls under slate, cobbled streets
      %{
        category: "settlement", parent: "town", key: "town_mountain", name: "Mountain town",
        layout: "town", position: 2,
        description: "Stone walls under slate, cobbled streets, conifers around the edge.",
        config: %{
          "settlement" => %{
            "buildingCap" => 16, "natureMultiplier" => 1.5, "streets" => "cobblestone",
            "mix" => mix([{"church", 1, 1}, {"manor", 1, 1}, {"stable", 1, 1}, {"smithy", 1, 1}])
          },
          "units" => townsfolk(7),
          "buildings" => %{
            "roof" => "roof_slate",
            "materials" => ["wall_stone"],
            "roofColors" => ["#3f464c", "#4a4f55", "#2f3439"],
            "wallColors" => ["#8a8580", "#9c9792", "#767168"]
          }
        }
      },
      # "beach town" - timber on sand, dirt tracks instead of paving, barely any tree cover
      %{
        category: "settlement", parent: "town", key: "town_beach", name: "Beach town",
        layout: "town", position: 3,
        description: "Bleached timber along sandy tracks, hardly a tree in sight.",
        config: %{
          "settlement" => %{
            "buildingCap" => 14, "natureMultiplier" => 0.6, "streets" => "path_dirt",
            "mix" => mix([{"store", 1, 2}, {"barn", 1, 1}])
          },
          "nature" => %{"groundCover" => 0.06, "flowers" => 0.03, "tallGrass" => 0.08},
          "units" => townsfolk(7),
          "buildings" => %{
            "materials" => ["wall_wood", "wall_plaster"],
            "roofColors" => ["#9c8f6f", "#b5a888", "#87795c"],
            "wallColors" => ["#e8dcc0", "#d8c79a", "#f0e7d0"]
          }
        }
      },
      # image #22 - a swamp village: wooden huts, and the water still to come (see the note above)
      %{
        category: "settlement", parent: "town", key: "town_swamp", name: "Swamp village",
        layout: "town", position: 4, zones: ~w(spring summer),
        description: "Wooden huts on boardwalks over a green flat.",
        config: %{
          "settlement" => %{
            "plazaSize" => 3, "maxPerFrontage" => 4, "buildingCap" => 12, "bigHouseRange" => [0, 1],
            "natureMultiplier" => 2.0, "streets" => "wooden_planks",
            # No barn and no stable: there is no pasture in a swamp and nothing to keep in one. Huts, and a
            # forge for the boats. Leaving the farm buildings in made this the forest village in other colours.
            "mix" => mix([{"smithy", 1, 1}])
          },
          # CHOKED, not lawn. Alexander, 2026-09-11: *"a swamp town should have rivers, be more jungle like,
          # have houses made of wood"*. The wood it already had. This is the jungle half: undergrowth to the
          # doorstep and trees pressing in, the same numbers that separate a jungle from a woodland.
          # The RIVERS it wants are the one part that cannot be served yet, because a settlement generator
          # places no water at all. That is the same blocker as the swamp city and the lake city.
          "nature" => %{"groundCover" => 0.45, "flowers" => 0.08, "tallGrass" => 0.3},
          "units" => townsfolk(6),
          "buildings" => %{
            "materials" => ["wall_wood"],
            "roofColors" => ["#6b5a34", "#5c4f2c", "#7a6a3e"],
            "wallColors" => ["#a98b5f", "#8f7450", "#c0a375"]
          }
        }
      },
      # ── VARIATIONS OF A CITY ────────────────────────────────────────────────────────────────────────
      # images #27 and #33 - the modern city: towers and blocks of flats, flat grey decks, wide roads
      %{
        category: "settlement", parent: "city", key: "city_modern", name: "Modern city",
        layout: "city", position: 0,
        description: "Towers and blocks of flats under flat grey decks.",
        config: %{
          "settlement" => %{
            "mix" => mix([{"tower", 4, 6}, {"apartment", 5, 8}, {"office", 2, 4}])
          },
          "units" => townsfolk(16)
        }
      },
      # image #30 - a medieval city: stone under slate on cobbles, a cathedral and a castle, and no towers
      %{
        category: "settlement", parent: "city", key: "city_medieval", name: "Medieval city",
        layout: "city", position: 1,
        description: "Stone under slate on cobbled streets, a cathedral and a castle, nothing tall.",
        config: %{
          "settlement" => %{
            "buildingCap" => 54, "lotGap" => [1, 1], "natureMultiplier" => 0.8, "streets" => "cobblestone",
            "mix" => mix([{"cathedral", 1, 1}, {"castle", 1, 1}, {"manor", 2, 4}, {"smithy", 1, 2}, {"church", 1, 2}])
          },
          "units" => townsfolk(14),
          "buildings" => %{
            "roof" => "roof_slate",
            "materials" => ["wall_stone", "wall_brick"],
            "roofColors" => ["#3f464c", "#4a4f55", "#5c4433"],
            "wallColors" => ["#8a8580", "#a89f7a", "#9e4b3b"]
          }
        }
      },
      %{
        category: "cave", key: "cave_default", name: "Cave", variant: "cave", position: 0,
        description: "A cavern floor: bats, spiders and skeletons instead of townsfolk.",
        config: %{"grid" => @small_grid, "units" => enemies(~w(bat spider skeleton))},
        options: @way_options
      },
      %{
        category: "temple", key: "temple_default", name: "Temple", variant: "temple", position: 0,
        description: "A temple dungeon: skeletons, guardians and wraiths.",
        config: %{"grid" => @small_grid, "units" => enemies(~w(skeleton guardian wraith))},
        options: @way_options
      }
    ]
  end

  @doc """
  Upsert every category + generator. Idempotent by `key`, so a re-run refreshes the seeded values
  without touching ids or duplicating rows.
  """
  def seed do
    ids =
      Map.new(categories(), fn attrs ->
        {:ok, row} =
          (Repo.get_by(GeneratorCategory, key: attrs.key) || %GeneratorCategory{})
          |> GeneratorCategory.changeset(attrs)
          |> Repo.insert_or_update()

        {attrs.key, row.id}
      end)

    # Parents before their subtypes, at any depth, so every `parent` key resolves to a row that exists.
    rows = generators()
    by_key = Map.new(rows, &{&1.key, &1})

    for attrs <- Enum.sort_by(rows, &depth(&1, by_key)) do
      parent_id =
        case Map.get(attrs, :parent) do
          nil -> nil
          parent_key -> Repo.get_by!(Generator, key: parent_key).id
        end

      params =
        attrs
        |> Map.drop([:category, :parent])
        |> Map.put(:category_id, Map.fetch!(ids, attrs.category))
        # A ROW MAY IMPLY ITS SEASON. Alexander, 2026-09-11: *"if the season is implied, it shoudl be
        # preselected, or we don't mention the clima at all, like, snowy town implies winter season for
        # example"*. A row that states its own seasons keeps them; everything else runs in all of them.
        |> Map.put(:zones, Map.get(attrs, :zones, @zones))
        |> Map.put(:parent_id, parent_id)

      {:ok, _} =
        (Repo.get_by(Generator, key: attrs.key) || %Generator{})
        |> Generator.changeset(params)
        |> Repo.insert_or_update()
    end

    # A category the list no longer names is DELETED. `seed/0` upserts by key and never removed anything, so
    # merging town and city into one category would have left both behind as empty rows in the menu. Their
    # generators have already moved to their new category above, so this deletes nothing but the husk.
    for stale <- Repo.all(GeneratorCategory), stale.key not in Enum.map(categories(), & &1.key) do
      Repo.delete(stale)
    end

    # A GENERATOR the list no longer names goes the same way, and this one bit harder: the settlement LOOKS
    # replaced `town_default` and `city_default`, and without this the old rows sat in the menu as ghosts. His
    # *"we still have "city" and "town" but they're exactly the same"* would have been true all over again,
    # from the database rather than from the source. Deleting a parent takes its subtypes with it.
    keys = Enum.map(rows, & &1.key)

    for stale <- Repo.all(Generator), stale.key not in keys do
      Repo.delete(stale)
    end

    {map_size(ids), length(generators())}
  end

  # ── config builders (so the two settlements differ by their NUMBERS, not by shape) ──
  defp settlement(opts) do
    %{
      "plazaSize" => Keyword.fetch!(opts, :plaza),
      "setback" => 1,
      "roadWidth" => 4,
      "lotGap" => Keyword.fetch!(opts, :lot_gap),
      "maxPerFrontage" => Keyword.fetch!(opts, :max_per_frontage),
      "buildingCap" => Keyword.fetch!(opts, :cap),
      "houseRange" => Keyword.fetch!(opts, :houses),
      "bigHouseRange" => Keyword.fetch!(opts, :big),
      "houseWidths" => [3, 3, 4, 4, 4, 5],
      "natureMultiplier" => Keyword.fetch!(opts, :nature_mult),
      "mix" => mix(Keyword.fetch!(opts, :mix)),
      # WHAT THIS PLACE PAVES ITS STREETS WITH. Alexander, 2026-09-11: *"a town doesn't have roads, it has
      # pathways of stone, cities do have pathways a skycraoppers"*.
      #
      # Measured before writing this: the settlement pass painted every street `road` for a town and a city
      # alike, so a village had asphalt through it. A street is a COLOUR on the ground block, not a tile
      # (tickets #34/#48), so this names the ground whose colour a street takes. Every label here is one both
      # tilesets already carry, so no place is asking for art that does not exist.
      "streets" => Keyword.fetch!(opts, :streets)
    }
  end

  # WHICH BUILDINGS A PLACE IS MADE OF. Alexander, 2026-09-11: *"there's not a single difference between any of
  # the settlements ... all you did was change colors, when everything should've changed like having different
  # types of settlements implies having different objects"*, and *"cities have more skycrappers, towns have more
  # houses"*.
  #
  # A look was a palette, so every place built the same store, hospital, temple and offices in different colours.
  # This is the other half: the LIST of buildings a place demands, as data, per place. A traditional town asks for
  # a church, stables, a barn and a smithy; a modern city asks for towers and apartment blocks.
  #
  # Store and hospital are not in the lists because every settlement has them: that pair is the guaranteed civic
  # minimum and it was already true before this. Houses and big-houses are not here either, they are counted by
  # `houseRange` / `bigHouseRange` above. What a row names is what makes it ITSELF.
  defp mix(entries) do
    # ONE ENTRY PER TYPE. A row that names a type the essentials already carry (a beach town wanting more than
    # one store) used to emit it twice, which reads as a mistake in the served data and makes the count hard to
    # see. The counts ADD instead, so the list says what it means: a seafront asks for two or three stores.
    [{"store", 1, 1}, {"hospital", 1, 1} | entries]
    |> Enum.reduce([], fn {type, lo, hi}, acc ->
      case Enum.find_index(acc, fn {t, _, _} -> t == type end) do
        nil -> acc ++ [{type, lo, hi}]
        at -> List.update_at(acc, at, fn {t, l, h} -> {t, l + lo, h + hi} end)
      end
    end)
    |> Enum.map(fn {type, lo, hi} -> %{"type" => type, "count" => [lo, hi]} end)
  end

  defp townsfolk(count), do: %{"townsfolk" => count, "enemies" => 0, "enemyTypes" => []}
  defp enemies(types), do: %{"townsfolk" => 0, "enemies" => 10, "enemyTypes" => types}
end

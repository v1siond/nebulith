defmodule Nebulith.Catalog.GeneratorSource do
  @moduledoc """
  The SEED for the map-generator catalog — the categories the editor offers and the generators in
  them, ported verbatim from the constants that used to be scattered across the frontend.

  and

  Every number here is the value the shipped generator uses TODAY, so seeding changes no behaviour —
  it only moves where the number lives. Provenance, so the port can be re-checked:

    * grid ranges — `templates.tsx` `generateStageInEditor` (city 52-71 x 42-57, else 30-45 x 24-35)
    * cellSize / isoScale — `levels/village.ts` `VILLAGE_CONFIG`
    * settlement tuning — `engine/villageLayout.ts` (`PLAZA_SIZE`, `SETBACK`, `ROAD_W`, `LOT_GAP_BY`,
      `MAX_PER_FRONTAGE`, `BUILDING_CAP`, `HOUSE_RANGE`, `HOUSE_WIDTHS`)
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

  # THE OPTIONS an outdoor generator offers. after listing exactly how the row count explodes otherwise (woodland,
  # woodland + river,
  # woodland + river + bridge…).
  #
  # `requires` is what keeps the panel honest: a crossing is meaningless without a river, so it says so
  # rather than the frontend knowing it. That was the next ticket too — — and as an option it is one more row here,
  # never another template.
  #
  # THE RIVER IS A CHOICE OF COURSE, not an on/off. So each course it named is a choice, and the
  # randomness it wants to keep is one of them rather than the only behaviour.
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
    # HOW DEEP the channel is cut. and
    #
    # So the depth is a served number, not a constant the generator picks. `flat` keeps the old behaviour
    # exactly, which is a river painted on the walking plane, so nothing changes for a map that does not ask.
    %{
      "key" => "depth",
      "label" => "How deep the channel is cut",
      "type" => "choice",
      "default" => "1",
      "requires" => "river",
      # No "flat" key: a gated choice already takes "none" when its dependency is off, and that IS not cut.
      "choices" => [
        %{"key" => "1", "label" => "One block down"},
        %{"key" => "2", "label" => "Two blocks down"}
      ]
    },
    # WHAT the river is crossed on. bridges" that we use on rivers, we must have multiple variations too / it can be a
    # simple dirt path, it can be an actual bridge, which again, are multiple variations"*. Each key is a row of
    # @crossings, which says the tile it lays.
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
  # A BRIDGE KIND ALSO NAMES ITS COMPOSITION. The `tile` stays, because it is what a crossing
  # falls back to when no composition of the needed span is loaded, and it is all a DIRT PATH ever wants: he
  # called that one (#62), not a bridge, so it names no composition on purpose.
  #
  # The BACKEND names it rather than the frontend deriving `bridge_#{kind}` from the option key, because a
  # composition's name is data about what exists in the catalog. The generator appends the span it needs
  # (`bridge_wood_5`), which is the same shape as `house_3`/`house_4`/`house_5`.
  @crossings %{
    "dirt" => %{"tile" => "floor", "colorOf" => "path_dirt"},
    "wood" => %{"tile" => "bridge", "composition" => "bridge_wood"},
    "planks" => %{"tile" => "wooden_planks", "composition" => "bridge_plank"},
    "stone" => %{"tile" => "cobblestone", "composition" => "bridge_stone"}
  }

  # ── THE WAYS THROUGH A MAP ────────────────────────────────────────────────
  # and for caves and temples too:
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

  # A SETTLEMENT'S WAYS. The same exits as everywhere else, *"exits are maintained as they're now"*, and more
  # pathways to choose from: *"pathways in towns has higher ceiling (not limited to 4, we should determine the
  # limit from the grid size"*. A town is a street grid and a street grid carries as many streets as it has
  # room for, so the list goes to 8 and the engine holds it to what the map measures.
  @settlement_way_options [
    List.first(@way_options),
    %{
      "key" => "pathways",
      "label" => "Streets",
      "type" => "choice",
      "default" => "random",
      "choices" =>
        [%{"key" => "random", "label" => "Random"}] ++
          Enum.map(1..8, &%{"key" => to_string(&1), "label" => to_string(&1)})
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
  # A LOOK IS A MATERIAL AND A ROOF, not a hex nudge. and
  #
  # It was right and the reason was in here: every look carried colours only, and the ROOF TILE is baked into
  # the composition (`house_5` is slate, `house_4` is a gable, `store_5` is a flat deck), so
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
  # encounters in. A field is where you expect it most.
  @outdoor_nature %{"groundCover" => 0.12, "flowers" => 0.06, "tallGrass" => 0.18}

  # A WOODLAND's densities. `canopy` is the share of cells carrying a tree, and it is the number that
  # makes a forest read as a forest. — measured, the meadow presets produced ~10% tree cover scattered over an open
  # field. At
  # 0.62 the canopy dominates the forest floor and the carved clearings read as clearings rather than as
  # the default state. Note the share is of the PLANTABLE floor, not the whole grid — the clearings and
  # paths are excluded, so this number is not diluted by how many clearings a map happens to roll.
  # Ground cover is richer than the meadow's because a forest floor is not lawn.
  # 0.62 → 0.434. The trees
  # were reading as a wall rather than as a wood — thinning them lets the clearings and trails breathe and
  # lets you see through the trunks. The density lives HERE, not in the generator, so tuning it is a data
  # change and not a code change.
  @woodland_nature %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.434, "tallGrass" => 0.12}

  # A JUNGLE is a woodland grown over: the canopy already accepted as forest-dense (the 0.62 the
  # woodland used to carry), plus the thing that actually distinguishes a jungle from a wood — UNDERGROWTH.
  # Ground cover more than doubles and the blooms go with it, so the floor is choked rather than walkable
  # lawn between trunks. Same STRUCTURE as the woodland (clearings, trails); only these numbers differ, which
  # is why it needs no generator of its own. Starting values — tune them here by eye.
  @jungle_nature %{"groundCover" => 0.5, "flowers" => 0.1, "canopy" => 0.62}

  # THE FOREST PALETTES. and
  # It is right, and the reason was structural: every colour in a forest came from the SEASON (spring, autumn)
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
    # Water by DEPTH, then swamp.
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
    # Was olive silt (#5e6b3a), my choice in ticket 48, and exactly what was reported: Water is blue; only swamp leans
    # green.
    "water" => "#3f86b0",
    "waterShallow" => "#86c5e2",
    "waterDeep" => "#23547e",
    "swamp" => "#3a8278",
    "bank" => "#6b5f3c",
    "trail" => "#57502f"
  }

  # WHICH TREES GROW HERE. Every forest rolled from one global weighted
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
    # A BANK, because the meadow serves water and served none, so its shores fell back to the tile's own
    # colour. Same sandy tan the woodland uses: a meadow's water edge is the same trodden earth.
    "bank" => "#c1a877",
    "water" => "#4a8fbf",
    "waterShallow" => "#91cdea",
    "waterDeep" => "#275b88",
    "swamp" => "#3f8a84"
  }

  # HOW THE TREES ARE DISTRIBUTED. with six reference photographs.
  #
  # Two numbers do most of the work:
  #
  #   * `lattice` — the scale of the noise the canopy is scored against, in cells. SMALL means the score
  #     changes every few cells, so trees land as fine scatter. LARGE means neighbouring cells score alike,
  #     so they land as big continuous masses. This is the "grouping" it is describing.
  #   * `spacing` — the minimum gap between two trunks. 0 lets them touch and read as a wall; 3 forces the
  #     open, individually-readable spacing of a wood pasture. NEVER 1: claiming only the four orthogonal
  #     neighbours leaves a CHECKERBOARD, which is passable diagonally (the iso view's movement) but not
  #     orthogonally (the top view's), so the floor measures as hundreds of regions and the repair has to cut
  #     through the whole wood to fix it. Measured at 308 regions on one seed. 0 or 2+, never 1.
  #
  # `understory` multiplies the served ground cover, because how choked the floor is between the trunks is
  # the other half of what tells two forests apart.
  #
  # Each of these is one of the photographs:
  # WHICH PLANT GROWS AS THE UNDERSTORY, per formation, and it is the whole of ticket 2.
  #
  # Measured: of the 40 nature tiles the catalog serves, `thicket` is the ONLY one that blocks, and the
  # undergrowth pass could plant nothing else. So every template from the meadow up grew waist-high walls
  # wearing a plant picture, including three formations whose own notes below promise the opposite:
  # "nothing between them", "a clear walkable floor", "clear ground between the groups".
  #
  # Only #14 and #15 describe a floor you cannot cross, so only those two grow the thicket. The rest grow
  # `tall_grass`, which the catalog already authors walkable and FLAT (height 0) in both styles, and which a
  # woodland already scatters elsewhere for exactly this purpose.
  @formations %{
    # Image #10 — a wood pasture. Big gnarled trees standing alone on open grass, wide apart, nothing
    # between them. The trees are individuals, not a canopy.
    "scattered" => %{"lattice" => 3, "spacing" => 4, "understory" => 0.35, "understoryTile" => "tall_grass"},
    # Image #11 — an even-aged beech stand. Straight trunks at regular spacing, a clear walkable floor, and
    # a broad track through it. Ordered rather than clumped.
    "stand" => %{"lattice" => 5, "spacing" => 2, "understory" => 0.45, "understoryTile" => "tall_grass"},
    # Image #12 — conifers scattered in patches over an open hillside. Clear ground between the groups, so
    # a large lattice (real clumps) but a low overall density.
    "clumped" => %{"lattice" => 10, "spacing" => 0, "understory" => 0.6, "understoryTile" => "tall_grass"},
    # Image #14 — a closed canopy seen from across the valley. Wall to wall, no floor visible anywhere.
    "closed" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.25, "understoryTile" => "thicket"},
    # Image #15 — tall dense trunks over deep green undergrowth, with a narrow trail winding through. The
    # canopy is not the hard part here, the floor is.
    "understory" => %{"lattice" => 7, "spacing" => 0, "understory" => 1.9, "understoryTile" => "thicket"},
    # Image #13 — cypress standing IN the water, well apart, buttressed bases. Spaced like a pasture but wet.
    "flooded" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.7}
  }

  # THE JUNGLE'S SUB-ZONES. and 2026-09-11 on the shape: REGIONS INSIDE ONE MAP, not more rows in
  # the template list. You walk out of the open canopy into dense growth, through a swamp, up to the ruins,
  # without loading anything.
  #
  # `canopy` and `undergrowth` are MULTIPLIERS on the generator's served base densities, not absolutes. That
  # keeps one knob in charge: tune `@jungle_nature` and the whole map moves together, tune a multiplier here
  # and only that kind of ground changes. `weight` is how much of the map a kind tends to claim.
  #
  # The river is not in this list because it is not a region — it is the watercourse that runs THROUGH them,
  # and every jungle has one.
  # WOODLAND REGIONS.
  #
  # Measured, it was right: glades ran `canopy 0.35` and mountain forest `0.28`, both under the SAME `clumped`
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

  # THE MOUNTAIN'S SUB-ZONES, and the first regions that stand at DIFFERENT HEIGHTS.
  # and 2026-09-12:
  #
  # `level` is what makes this a mountain instead of a colour change: the cells of a region stand at that level
  # and the step down to the next region is drawn as a cliff face. A ridge at 3 over a slope at 1 is a two-level
  # wall, the slope down to the vale is one. Nothing else in the catalog states a level, so nothing else moves.
  #
  # NO "stone" here on purpose: in this pipeline stone means RUINS (a platform with columns on it), which is a
  # jungle thing. A bare ridge is bare.
  @mountain_sub_zones [
    %{
      "key" => "ridge",
      "name" => "Exposed ridge",
      "weight" => 2,
      "level" => 3,
      # the treeline: almost nothing grows up here, which is why the rock reads as rock
      "canopy" => 0.14,
      "undergrowth" => 0.25,
      "floor" => "#8a8d76",
      "formation" => %{"lattice" => 3, "spacing" => 4, "understory" => 0.2},
      "trees" => [%{"kind" => "tree_stub", "weight" => 55}, %{"kind" => "tree_conifer", "weight" => 45}]
    },
    %{
      "key" => "slope",
      "name" => "Wooded slope",
      "weight" => 3,
      "level" => 1,
      "canopy" => 0.32,
      "undergrowth" => 0.5,
      "floor" => "#5f7047",
      "formation" => %{"lattice" => 10, "spacing" => 0, "understory" => 0.6},
      "trees" => [%{"kind" => "tree_conifer", "weight" => 65}, %{"kind" => "tree_tall", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 15}]
    },
    %{
      "key" => "vale",
      "name" => "Sheltered vale",
      "weight" => 2,
      "level" => 0,
      # the bottom is where the water and the soil end up, so it is the thickest part of the map
      "canopy" => 0.45,
      "undergrowth" => 0.8,
      "floor" => "#47603a",
      "formation" => %{"lattice" => 7, "spacing" => 0, "understory" => 1.1},
      "trees" => [%{"kind" => "tree_conifer", "weight" => 45}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree_broadleaf", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 10}]
    }
  ]

  # A JUNGLE'S OWN BLOOMS. Measured 2026-09-13: the shared `open`, `dense` and `ruins` regions stated none, so
  # every jungle variant that did not override them fell through to the SEASON's set, and summer's carries
  # `✽ #f4f4ec`, the near-white rejected twice. A rainforest floor is not a daisy meadow.
  #
  # Like the swamp's and the island's, these colours are a PROPOSAL rather than a derivation: heliconia red,
  # orchid violet and a waxy cream-yellow, to accept or replace in review.
  @jungle_blooms [
    %{"char" => "✿", "color" => "#c2513f"},
    %{"char" => "✾", "color" => "#8d5fa8"},
    %{"char" => "❋", "color" => "#c9b063"}
  ]

  # The swamp's blooms, named once because the swamp VARIANT gives them to its other regions too (ticket 27).
  # These colours are a PROPOSAL, not a derivation: the instruction was negative (no white), so the set is
  # muted swamp growth (iris violet, dull marsh gold, a blue green sedge) to accept or replace in review.
  @swamp_blooms [
    %{"char" => "✾", "color" => "#7b5fa8"},
    %{"char" => "❋", "color" => "#4f8f7a"},
    %{"char" => "✿", "color" => "#b89a3c"}
  ]

  @jungle_sub_zones [
    %{
      "key" => "open",
      "name" => "Open canopy",
      "weight" => 3,
      "canopy" => 0.45,
      "undergrowth" => 0.5,
      "floor" => "#3f5f33",
      # an open region reads as individual trees on visible ground — reference image #12
      "formation" => %{"lattice" => 9, "spacing" => 3, "understory" => 0.5},
      "trees" => [%{"kind" => "tree_palm", "weight" => 30}, %{"kind" => "tree_round", "weight" => 30}, %{"kind" => "tree_big", "weight" => 20}, %{"kind" => "bush_round", "weight" => 20}],
      "flowers" => @jungle_blooms
    },
    %{
      "key" => "dense",
      "weight" => 4,
      "name" => "Dense growth",
      "canopy" => 1.3,
      "undergrowth" => 1.45,
      "floor" => "#24381f",
      # wall to wall, nothing between — reference image #14
      "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.3},
      "trees" => [%{"kind" => "tree_giant", "weight" => 25}, %{"kind" => "tree_big", "weight" => 25}, %{"kind" => "bush", "weight" => 25}, %{"kind" => "tree_round", "weight" => 25}],
      "flowers" => @jungle_blooms
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
      # cypress standing IN the water, well apart — reference image #13
      "formation" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.7},
      # the cypress IS the swamp — image #13
      "trees" => [%{"kind" => "tree_cypress", "weight" => 60}, %{"kind" => "bush_round", "weight" => 25}, %{"kind" => "tree_round", "weight" => 15}],
      # WHAT BLOOMS HERE. A region could already state its SPECIES (`trees` above) and had no way
      # to state its BLOOMS, so a swamp planted the season's set, and summer's carries `✽ #f4f4ec`, a near
      # white. Measured in a swamp jungle before this: whites among the blooms, exactly as was seen.
      #
      # These colours are a PROPOSAL, not a derivation: the instruction was negative (no white), so the set is
      # muted swamp growth (iris violet, dull marsh gold, a blue green sedge) to accept or replace in review.
      "flowers" => @swamp_blooms
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
      "trees" => [%{"kind" => "tree_round", "weight" => 30}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_stub", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 20}],
      "flowers" => @jungle_blooms
    }
  ]

  # How many ancestors a seed row has — parents seed first.
  defp depth(%{parent: parent}, by_key) when is_binary(parent), do: 1 + depth(Map.fetch!(by_key, parent), by_key)
  defp depth(_row, _by_key), do: 0

  @doc false
  # THE REGION PICKER. regions" in it, but it's badly implemented, we should just have variations, similar to "which
  # jungle" "which region""*.
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

  @doc false
  # THE SAME REGION, IN A DIFFERENT PLACE. `open` and `dense` are shared by every jungle variant, which is
  # why a SWAMP's open patch grew rainforest palms under summer's near-white daisies: it was, literally, the
  # rainforest's open patch.
  #
  # A variant overrides the regions it borrows. Anything it does not name is inherited unchanged, so a plain
  # jungle is untouched.
  defp sub_zones_in(weights, overrides) do
    for z <- sub_zones(weights), do: Map.merge(z, Map.get(overrides, z["key"], %{}))
  end

  # A SWAMP'S own growth, reusing the bloom set the `swamp` region already authors rather than inventing a
  # second palette for the same place. The species lean cypress, because that is what stands in this water.
  @swamp_regions %{
    "open" => %{
      "trees" => [%{"kind" => "tree_cypress", "weight" => 40}, %{"kind" => "tree_mangrove", "weight" => 30}, %{"kind" => "bush_round", "weight" => 30}],
      "flowers" => @swamp_blooms
    },
    "dense" => %{
      "trees" => [%{"kind" => "tree_cypress", "weight" => 35}, %{"kind" => "tree_giant", "weight" => 25}, %{"kind" => "bush", "weight" => 25}, %{"kind" => "tree_round", "weight" => 15}],
      "flowers" => @swamp_blooms
    }
  }

  # AN ISLAND IS A COAST, not the Amazon. Its palette was already
  # its own; its regions were still the rainforest's, so palms grew under inland blooms.
  #
  # Like the swamp set, these colours are a PROPOSAL rather than a derivation: shore growth, hibiscus pink,
  # sea-holly blue and a bleached sand yellow, to accept or replace in review.
  @island_blooms [
    %{"char" => "✿", "color" => "#e2739b"},
    %{"char" => "❋", "color" => "#6aa9c4"},
    %{"char" => "✾", "color" => "#e0c877"}
  ]

  @island_regions %{
    # THE TROPICS, not a temperate wood with palms in it. `tree_coconut`, `tree_banana` and `tree_mangrove` are
    # authored in `tile_source.ex` the same way
    # every other species is, as proportions on the shared two-tile tree.
    "open" => %{
      "trees" => [%{"kind" => "tree_coconut", "weight" => 35}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "tree_banana", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}],
      "flowers" => @island_blooms
    },
    "dense" => %{
      "trees" => [%{"kind" => "tree_banana", "weight" => 30}, %{"kind" => "tree_coconut", "weight" => 25}, %{"kind" => "tree_mangrove", "weight" => 25}, %{"kind" => "bush", "weight" => 20}],
      "flowers" => @island_blooms
    }
  }

  # The water options with a different starting river — an island starts ringed by water.
  defp water_options(river_default) do
    [river | rest] = @water_options
    [Map.put(river, "default", river_default) | rest]
  end

  @doc "The categories to seed, in menu order (`editorConfig.ts` STAGE_VARIANTS)."
  def categories do
    [
      %{key: "forest", name: "Forest", position: 0, description: "Woodland and open meadows, with no settlement in them."},
      # So a
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
        config: %{"grid" => @small_grid, "nature" => @woodland_nature, "units" => townsfolk(3), "palette" => @woodland_palette, "formation" => @formations["stand"], "trees" => @woodland_trees, "crossings" => @crossings, "entrance" => "forest_entrance"},
        options: @way_options ++ @water_options
      },
      %{
        category: "forest", key: "forest_jungle", name: "Jungle", layout: "jungle", variant: "forest", position: 1,
        description: "A closed canopy over choked undergrowth, with clearings cut into it.",
        config: %{"grid" => @small_grid, "nature" => @jungle_nature, "units" => townsfolk(2), "palette" => @jungle_palette, "subZones" => @jungle_sub_zones, "formation" => @formations["closed"], "trees" => @jungle_trees, "crossings" => @crossings, "entrance" => "forest_entrance"},
        options: @way_options ++ region_options(~w(open dense swamp ruins)) ++ @water_options
      },
      %{
        category: "forest", key: "forest_meadow", name: "Meadow", layout: "meadow", variant: "forest", position: 2,
        description: "An open clearing framed by trees, with two ways in.",
        config: %{"grid" => @small_grid, "nature" => @outdoor_nature, "units" => townsfolk(5), "formation" => @formations["scattered"], "trees" => @meadow_trees, "palette" => @meadow_palette, "crossings" => @crossings, "entrance" => "forest_entrance"},
        options: @way_options ++ @water_options
      },
      # ── SUBTYPES ────────────────────────────────────────────────────────────────────────────────────
      # Each one
      # states ONLY what makes it different; the catalog merges its parent's config under it. The woodland and
      # meadow sets are the six reference photographs, named by image.

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
        # A BUSH IS NOT A TREE. It was right and it was arithmetic: `canopy` is the share of plantable
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
        description: "Conifers over a hillside that actually climbs: ridges, slopes and sheltered vales.",
        config: %{"formation" => @formations["clumped"], "nature" => %{"canopy" => 0.28},
                  "subZones" => sub_zones(@mountain_sub_zones, %{"ridge" => 2, "slope" => 3, "vale" => 2}),
                  "trees" => [%{"kind" => "tree_conifer", "weight" => 70}, %{"kind" => "tree_tall", "weight" => 15}, %{"kind" => "tree_stub", "weight" => 15}]},
        options: @way_options ++ region_options(@mountain_sub_zones, ~w(ridge slope vale)) ++ @water_options
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
        config: %{"subZones" => sub_zones_in(%{"swamp" => 6, "dense" => 2, "open" => 1}, @swamp_regions)},
        options: @way_options ++ region_options(~w(open dense swamp)) ++ @water_options
      },
      # an island: water around it, palms
      %{
        category: "forest", parent: "forest_jungle", key: "forest_jungle_island", name: "Island jungle",
        layout: "jungle", position: 2,
        description: "Palms over pale sand, ringed by shallow turquoise water.",
        # AN ISLAND IS NOT THE AMAZON.
        #
        # Measured: it inherited the jungle palette WHOLE, so its colours were the same numbers as the swamp
        # jungle's, down to the hex. Only the tree weights differed and you cannot see a weight. An island is
        # brighter and paler than rainforest: sand where a jungle has peat, turquoise where a jungle has
        # blue-brown, and a canopy that is yellow-green rather than near-black.
        config: %{"subZones" => sub_zones_in(%{"open" => 3, "dense" => 2}, @island_regions),
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
                  # THE WHOLE ISLAND, not just its two regions. It is right and this line was why:
                  # a cell inside `open` or `dense` takes that region's mix, and everything OUTSIDE them falls back
                  # to THIS list, which was the generic palm-and-round set. On a map where the regions cover part of
                  # the ground, most trees came from here.
                  "trees" => [%{"kind" => "tree_coconut", "weight" => 30}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "tree_banana", "weight" => 20}, %{"kind" => "tree_mangrove", "weight" => 15}, %{"kind" => "bush_round", "weight" => 10}]},
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
      # and
      #
      # So the shape is the forest's. What you pick is the KIND, and a town and a city really are the two
      # different things: a town is low and green with stone pathways through it, a city is dense and paved. A
      # VARIATION hangs under its kind and states ONLY what makes it itself, because `generator_tree` inherits
      # the archetype and the options and deep-merges the config (a list, like the building mix, REPLACES its
      # parent's rather than adding to it, which is the point of stating one).
      #
      # Four of the old rows are gone: andean town, mediterranean city and tropical city, and
      #
      # NOT here yet, deliberately: the city with a
      # lake (image #34). A settlement generator places no WATER at all today, so both would be a normal place
      # with browner walls, which is the exact paint it rejected. They wait on the water work.
      %{
        category: "settlement", key: "town", name: "Town", layout: "town", variant: "town", position: 0,
        description: "Houses along stone pathways, a square in the middle, trees between the lots.",
        config: %{
          "grid" => @small_grid,
          "settlement" => settlement(plaza: 5, lot_gap: [1, 2], max_per_frontage: 6, cap: 18,
                                     houses: [4, 6], nature_mult: 1.3,
                                     mix: [{"temple", 1, 1}, {"church", 1, 1}, {"stable", 1, 2}, {"barn", 1, 2}, {"smithy", 1, 1}],
                                     streets: "path_stone"),
          "nature" => @outdoor_nature,
          "entrance" => "town_entrance",
          "units" => townsfolk(8),
          "buildings" => Map.merge(@building_palette, %{
            "roof" => "roof",
            "materials" => ["wall_brick", "wall_wood"],
            "roofColors" => ["#8a4b2f", "#7a4326", "#6b4a2b"],
            "wallColors" => ["#c9a66b", "#b08d5b", "#d8c79a"]
          })
        },
        options: @settlement_way_options
      },
      %{
        category: "settlement", key: "city", name: "City", layout: "city", variant: "city", position: 1,
        description: "Blocks and towers on paved streets, wide junctions, little green.",
        config: %{
          "grid" => @city_grid,
          "settlement" => settlement(plaza: 7, lot_gap: [1, 1], max_per_frontage: 99, cap: 72,
                                     houses: [7, 11], demanded_houses: {3, 5}, nature_mult: 0.5,
                                     mix: [{"temple", 1, 1}, {"tower", 3, 5}, {"apartment", 4, 7}, {"office", 2, 4}],
                                     streets: "road"),
          "nature" => @outdoor_nature,
          "entrance" => "town_entrance",
          "units" => townsfolk(14),
          "buildings" => Map.merge(@building_palette, %{
            "roof" => "flat_roof",
            "materials" => ["wall_plaster"],
            "roofColors" => ["#4a4f55", "#3f464c", "#5a636b"],
            "wallColors" => ["#e8ecef", "#d3d8dc", "#bcc3c9"]
          })
        },
        options: @settlement_way_options
      },
      # ── VARIATIONS OF A TOWN ────────────────────────────────────────────────────────────────────────
      # image #31 - a small town: a handful of houses and a lot of green between them
      %{
        category: "settlement", parent: "town", key: "town_small", name: "Small town",
        layout: "town", position: 0,
        description: "A handful of timber houses and green between every one of them.",
        config: %{
          "settlement" => %{
            "buildingCap" => 12, "houseRange" => [3, 5], "natureMultiplier" => 1.8,
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
            "buildingCap" => 14, "houseRange" => [4, 6], "natureMultiplier" => 2.4,
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
            "plazaSize" => 3, "maxPerFrontage" => 4, "buildingCap" => 12,
            "natureMultiplier" => 2.0, "streets" => "wooden_planks",
            # No barn and no stable: there is no pasture in a swamp and nothing to keep in one. Huts, and a
            # forge for the boats. Leaving the farm buildings in made this the forest village in other colours.
            "mix" => mix([{"smithy", 1, 1}])
          },
          # CHOKED, not lawn. The wood it already had. This is the jungle half: undergrowth to the
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
        config: %{"grid" => @small_grid, "units" => enemies(~w(bat spider skeleton)), "entrance" => "cave_entrance"},
        options: @way_options
      },
      %{
        category: "temple", key: "temple_default", name: "Temple", variant: "temple", position: 0,
        description: "A temple dungeon: skeletons, guardians and wraiths.",
        config: %{"grid" => @small_grid, "units" => enemies(~w(skeleton guardian wraith)), "entrance" => "cave_entrance"},
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
        # A ROW MAY IMPLY ITS SEASON. A row that states its own seasons keeps them; everything else runs in all of
        # them.
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
    # A city and a town that are exactly the same would have been true all over again,
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
      # A 6 IS IN HERE ON PURPOSE. It carries what `big_house` used to: its footprint was 6x4, and with the type
      # deleted the wide silhouette would have quietly left every settlement. A weighted roll, so one frontage in
      # seven is a wide house.
      "houseWidths" => [3, 3, 4, 4, 4, 5, 6],
      "natureMultiplier" => Keyword.fetch!(opts, :nature_mult),
      "mix" => mix(Keyword.fetch!(opts, :mix), Keyword.get(opts, :demanded_houses, {1, 3})),
      # WHAT THIS PLACE PAVES ITS STREETS WITH.
      #
      # Measured before writing this: the settlement pass painted every street `road` for a town and a city
      # alike, so a village had asphalt through it. A street is a COLOUR on the ground block, not a tile
      # (tickets #34/#48), so this names the ground whose colour a street takes. Every label here is one both
      # tilesets already carry, so no place is asking for art that does not exist.
      "streets" => Keyword.fetch!(opts, :streets)
    }
  end

  # WHICH BUILDINGS A PLACE IS MADE OF. and
  #
  # A look was a palette, so every place built the same store, hospital, temple and offices in different colours.
  # This is the other half: the LIST of buildings a place demands, as data, per place. A traditional town asks for
  # a church, stables, a barn and a smithy; a modern city asks for towers and apartment blocks.
  #
  # Store and hospital are not in the lists because every settlement has them: that pair is the guaranteed civic
  # minimum and it was already true before this. Houses are not here either, they are counted by `houseRange`
  # above, and a wide house is now just a house with a bigger footprint. What a row names makes it ITSELF.
  defp mix(entries, demanded_houses \\ {1, 3}) do
    # ONE ENTRY PER TYPE. A row that names a type the essentials already carry (a beach town wanting more than
    # one store) used to emit it twice, which reads as a mistake in the served data and makes the count hard to
    # see. The counts ADD instead, so the list says what it means: a seafront asks for two or three stores.
    # A HOUSE IS DEMANDED, not just filler. Measured when `big_house` was deleted: dropping its mix entry took
    # 1-3 buildings out of every town and the frontages thinned to one plot per block, which the neighbourhood
    # row test caught. `houseRange` looked like the place to put that count back and it was not: only
    # `buildingMix` reads it and nothing calls `buildingMix`. The mix is what `placePlots` demands from, so the
    # count lives here, beside the other two things every settlement has.
    #
    # LAST, exactly where the `big-house` entry used to sit. Each entry costs one rng draw, so any other
    # position shifts every later draw and moves generated maps for no reason: measured, house-third moved one
    # of the three locked settlement digests, house-last leaves all seven byte-identical.
    {house_lo, house_hi} = demanded_houses

    ([{"store", 1, 1}, {"hospital", 1, 1} | entries] ++ [{"house", house_lo, house_hi}])
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
  @doc """
  The GENERATION LAYERS: the stack map generation runs, in order.

  Six today. `ways` leads because the exits and paths are planned before anything is built around them, and
  `units` trails because the editor scatters those, not the generator.

  `seedable: false` is the honest half. `edge`, `gates`, `floors` and `transitions` are decided entirely by the
  ways above them, so re-rolling one changes nothing, and the editor reads this flag rather than offering a
  button that does nothing.

  More are coming and each is a row: *"we can apply shadow and lightning as extra layers, we'll also add fog
  layer, then we probably will add some reprocess layer too, we'll add water reflection layer"*.
  """
  def seed_generation_layers do
    layers = [
      %{key: "ways", label: "Ways", position: 10, seedable: true,
        hint: "the exits and the paths between them. re-roll to move where you come in and go out"},
      %{key: "layout", label: "Layout", position: 20, seedable: true,
        hint: "the bare shape: streets, plots and clearings, with structures and nature stripped"},
      %{key: "buildings", label: "Buildings", position: 30, seedable: true,
        hint: "the structures, re-rolled in place"},
      %{key: "nature", label: "Nature", position: 40, seedable: true,
        hint: "the trees, plants and greenery"},
      %{key: "decor", label: "Decor", position: 50, seedable: true,
        hint: "the dressing: plazas, lamps and fountains"},
      %{key: "units", label: "Units", position: 60, seedable: true,
        hint: "the creatures and townsfolk"}
    ]

    for attrs <- layers, do: {:ok, _} = Nebulith.Catalog.upsert_generation_layer(attrs)
    :ok
  end

end

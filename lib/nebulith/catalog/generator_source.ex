defmodule Nebulith.Catalog.GeneratorSource do
  @moduledoc """
  The SEED for the map-generator catalog: the categories the editor offers and the generators in
  them, ported verbatim from the constants that used to be scattered across the frontend.

  and

  Every number here is the value the shipped generator uses TODAY, so seeding changes no behaviour.
  It only moves where the number lives. Provenance, so the port can be re-checked:

    * grid ranges, `templates.tsx` `generateStageInEditor` (city 52-71 x 42-57, else 30-45 x 24-35)
    * cellSize / isoScale, `levels/village.ts` `VILLAGE_CONFIG`
    * settlement tuning, `engine/villageLayout.ts` (`PLAZA_SIZE`, `SETBACK`, `ROAD_W`, `LOT_GAP_BY`,
      `MAX_PER_FRONTAGE`, `BUILDING_CAP`, `HOUSE_RANGE`, `HOUSE_WIDTHS`)
    * natureMultiplier, `engine/stageGenerator.ts` `NATURE_MULT`
    * nature densities, `engine/stageGenerator.ts` nature pass (`scatterGroundCover` 0.12,
      `scatterFlowers` 0.06)
    * townsfolk / enemies, `templates.tsx` (`townCount` 14/8/5, `seedStageEnemies` count 10) and
      `game/spawner.ts` (`CAVE_ENEMY_TYPES`, `TEMPLE_ENEMY_TYPES`)
    * building materials + colours, `templates.tsx` `applyStageToGrid`

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
  # rather than the frontend knowing it. That was the next ticket too, and as an option it is one more row here,
  # never another template.
  #
  # THE RIVER IS A CHOICE OF COURSE, not an on/off. So each course it named is a choice, and the
  # randomness it wants to keep is one of them rather than the only behaviour.
  @water_options [
    %{
      # THERE IS NO "crossing" TOGGLE. It read "A crossing joined to the paths", which said nothing about
      # what it did. It meant: off, the river got fallen logs at random spots and a path
      # walked into the water and stopped; on, a real crossing went where the path meets the river. There is
      # no map that wants the first, so a river crossing a path is ALWAYS crossed now.
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

  # A SETTLEMENT'S WAYS. The same exits as everywhere else, and more pathways to choose from. A town is a
  # street grid and a street grid carries as many streets as it has room for, so the list goes to 8 and the
  # engine holds it to what the map measures rather than to a forest's four.
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
  # makes a forest read as a forest. Measured, the meadow presets produced ~10% tree cover scattered over an open
  # field. At
  # 0.62 the canopy dominates the forest floor and the carved clearings read as clearings rather than as
  # the default state. Note the share is of the PLANTABLE floor, not the whole grid. The clearings and
  # paths are excluded, so this number is not diluted by how many clearings a map happens to roll.
  # Ground cover is richer than the meadow's because a forest floor is not lawn.
  # 0.62 → 0.434. The trees
  # were reading as a wall rather than as a wood. Thinning them lets the clearings and trails breathe and
  # lets you see through the trunks. The density lives HERE, not in the generator, so tuning it is a data
  # change and not a code change.
  @woodland_nature %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.434, "tallGrass" => 0.12}

  # A JUNGLE is a woodland grown over: the canopy already accepted as forest-dense (the 0.62 the
  # woodland used to carry), plus the thing that actually distinguishes a jungle from a wood, UNDERGROWTH.
  # Ground cover more than doubles and the blooms go with it, so the floor is choked rather than walkable
  # lawn between trunks. Same STRUCTURE as the woodland (clearings, trails); only these numbers differ, which
  # is why it needs no generator of its own. Starting values, tune them here by eye.
  # THIRTY PER CENT FEWER TREES, 2026-09-15: 0.62 -> 0.434. Every environment built on these numbers thins
  # with it.
  # FEWER TREES, AND FEWER OF EVERYTHING THAT BLOCKS: the tree density was conflicting with the map being
  # usable, there was nowhere to move and nowhere to stand a treasure or a unit, so another 10 to 15% came
  # off on top.
  #
  # THE UNDERGROWTH GROWS BACK WHATEVER THE CANOPY GIVES UP, which is why the first cut did nothing. A
  # jungle's thicket density is `groundCover * jungleFloorReach`, and that reach is the walkable floor over
  # what is left to plant on. Thin the trees and the floor gets bigger, so the same served number plants MORE
  # thicket. Measured across four seeds on a 40x40, holding groundCover at 0.3:
  #
  #     canopy 0.369 -> 168 trees, 159 thicket, 71% walkable
  #     canopy 0.240 -> 116 trees, 183 thicket, 73% walkable   (trees down 31%, thicket UP, floor unchanged)
  #
  # So the canopy alone cannot open a jungle up, and the 0.62 -> 0.434 -> 0.369 cuts each read as no change
  # for exactly that reason. BOTH numbers have to come down together. At canopy 0.31 with groundCover 0.20:
  # 143 trees (the 15% asked for), 119 thicket, 76% walkable and 42% of the interior with room on all four
  # sides to stand a unit or a chest. A woodland is 90%/47% and a meadow 93%/68%, so the jungle is still far
  # and away the densest forest, it is simply one you can now cross and place things in.
  #
  # Every variant inherits this: dense, swamp, island and ruins all thin with it.
  @jungle_nature %{"groundCover" => 0.2, "flowers" => 0.1, "canopy" => 0.31}

  # THE FOREST PALETTES. and
  # It is right, and the reason was structural: every colour in a forest came from the SEASON (spring, autumn)
  # and nothing came from the KIND of forest, so a spring jungle and a spring woodland were painted from the
  # same numbers. A palette per GENERATOR is what makes them different places, and it lives here because it is
  # data about a template.
  #
  # The generator paints these onto cells as floor STATE. That is the sanctioned path: a generator PICKS and
  # WRITES colour, the renderer only reads. Nothing here is a render-time fallback.

  # A TEMPERATE WOOD. Muted, grey-green, a lot of brown showing through. A pine or oak floor is needles and
  # leaf litter with light reaching it, so it reads dry and open even under the canopy.
  # A PALETTE IS THE GROUND, THE WATER AND THE SHORE. What the WAY across it wears is the pathway kind's, in
  # `@pathways`, see the note there for why it cannot be in both.
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
    "bank" => "#c1a877"
  }

  # AN AMAZONAS. Deep, wet, saturated, and DARK: a closed canopy puts the floor in permanent shade, so the
  # ground is near-black green rather than the woodland's lit olive. The canopy above it is the brightest
  # thing on the map because it is the layer actually getting the sun, which is the inversion that makes a
  # jungle read as a jungle. Water is silt-brown, not blue, a jungle river carries the forest in it.
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
    "bank" => "#6b5f3c"
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
  #   * `lattice`, the scale of the noise the canopy is scored against, in cells. SMALL means the score
  #     changes every few cells, so trees land as fine scatter. LARGE means neighbouring cells score alike,
  #     so they land as big continuous masses. This is the "grouping" it is describing.
  #   * `spacing`, the minimum gap between two trunks. 0 lets them touch and read as a wall; 3 forces the
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
    # Image #10, a wood pasture. Big gnarled trees standing alone on open grass, wide apart, nothing
    # between them. The trees are individuals, not a canopy.
    "scattered" => %{"lattice" => 3, "spacing" => 4, "understory" => 0.35, "understoryTile" => "tall_grass"},
    # Image #11, an even-aged beech stand. Straight trunks at regular spacing, a clear walkable floor, and
    # a broad track through it. Ordered rather than clumped.
    "stand" => %{"lattice" => 5, "spacing" => 2, "understory" => 0.45, "understoryTile" => "tall_grass"},
    # Image #12, conifers scattered in patches over an open hillside. Clear ground between the groups, so
    # a large lattice (real clumps) but a low overall density.
    "clumped" => %{"lattice" => 10, "spacing" => 0, "understory" => 0.6, "understoryTile" => "tall_grass"},
    # Image #14, a closed canopy seen from across the valley. Wall to wall, no floor visible anywhere.
    "closed" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.25, "understoryTile" => "thicket"},
    # Image #15, tall dense trunks over deep green undergrowth, with a narrow trail winding through. The
    # canopy is not the hard part here, the floor is.
    # 1.9 MADE THE DENSE WOODLAND THE WORST MAP IN THE GAME: 46% of its interior walkable, against a super
    # dense JUNGLE's 64%. Only `forest_woodland_dense` uses this, so the number is tuned there and nowhere
    # else suffers for it. Same rule as everywhere: the floor may be hard work, it may not be a wall.
    "understory" => %{"lattice" => 7, "spacing" => 0, "understory" => 1.1, "understoryTile" => "thicket"},
    # Image #13, cypress standing IN the water, well apart, buttressed bases. Spaced like a pasture but wet.
    "flooded" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.7}
  }

  # WHAT A PATHWAY IS MADE OF, per template.
  #
  # Nine isometric references, and the same variance asked for in towns: rustic ways, street ways, each one
  # chosen from what the place itself is (2026-09-15).
  #
  # WHAT WE HAD. Measured on a 40x40 before any of this: a woodland trail swapped the ground to the flat
  # floor tile and tinted it, and a meadow and a jungle did not even do that. Their pathways were the SAME
  # `meadow` ground as the field beside them, wearing a different colour. Every template was 3 cells across
  # because `WOODLAND.pathWidth` was a constant in the engine, so a beach lane, a rainforest machete trail
  # and a city street were one rectangle in three colours. Nothing lined any of them and nothing lay on them.
  #
  # WHAT THE REFERENCES SHOW, read off the nine he gave:
  #
  #   · a pathway is a MATERIAL, not a tint. Pale sand in the wood, warm dirt on the headland, grey asphalt
  #     with markings in the beach town, planks over the swamp, flagstone where the built thing starts.
  #   · WIDTH is the character. The park path and the forest crossroads are broad enough for three abreast.
  #     The clifftop path above the beach is a single winding line. The seafront street is four lanes.
  #   · the EDGE is ragged everywhere it is not built. Grass comes back into the dirt in tongues; only the
  #     town kerb and the boardwalk are straight.
  #   · things LIE ON IT: pebbles and leaf litter, scattered thinly, walkable. Both the wood and the park
  #     show this and it is what stops a path reading as a painted stripe.
  #   · things STAND BESIDE IT: boulders and ferns in the wood, tufts and a bench in the park, a regular row
  #     of palms and lamp posts along the seafront. The lining is what tells you which place you are in
  #     before you have looked at anything else.
  #
  # `surface` is a label the tilesets already serve, so a pathway is built from the catalogue like everything
  # else. `edge` is the share of the border cells the field takes back, so 0 is a kerb and 0.5 is a track
  # people wore. `scatter` lies ON the surface and never blocks. `lining` stands on the field cells that
  # touch the path, and it blocks, which is what makes a lined path read as a corridor you follow.
  #
  # `tone` IS THE COLOUR THE WAY WEARS, and it lives here rather than in a template's palette. It used to live
  # in both, and the palette won: a mountain forest asked for `rocky_track` and inherited the woodland's dirt
  # tone, so its gravel was painted brown, and a swamp asked for `boardwalk` and inherited the jungle's, so
  # its planks were painted dirt. The template's own statement lost to the one it inherited. A pathway kind is
  # the LOOK of the way, so the look belongs to the kind, once.
  #
  # Every tone here is MEASURED off the stored reference for that kind, not chosen: the reference's own path
  # colour, scaled to sit over OUR ground at the same distance it sits over the ground in the picture. The
  # numbers are in the comment on each one.
  @pathways %{
    # The crossroads under the conifers: a broad pale track, pebbles across it, boulders and low scrub set
    # back off the edge, and the grass coming back into it everywhere.
    # `alongside_river`: its tracks are #a78463, 137.1, over a forest floor around 67. Our woodland floor is
    # 119.6, so the same distance puts the track at 170.
    "forest_track" => %{
      "surface" => "path_dirt", "tone" => "#cfa37b", "width" => 3, "edge" => 0.35,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.1}],
      "lining" => [%{"tile" => "rock", "rate" => 0.08}, %{"tile" => "shrub", "rate" => 0.1}]
    },
    # Rocky ground: the same track laid on stone rather than soil, so it is gravel, and the boulders are the
    # thing you see. Fewer plants, because they are not what grows here.
    # `woodland_mountain`: a pale grey-beige gravel track, #ded6c1 at 214.2 over grass at 145, so +69. Our
    # mountain floor is 103.1, which puts it at 171. This is the one the woodland's dirt tone was overriding.
    "rocky_track" => %{
      "surface" => "gravel", "tone" => "#b1ab9a", "width" => 3, "edge" => 0.4,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.16}],
      "lining" => [%{"tile" => "rock", "rate" => 0.16}, %{"tile" => "shrub", "rate" => 0.05}]
    },
    # The park path: as broad as the forest track and far tidier, with the tufts and blooms a kept place has
    # along it rather than boulders.
    # `meadow_park`: sand at #cbaa7a, 173.6, over grass at 141, so +22. A park path is the gentlest step of
    # the set, because a kept lawn is already bright. Our meadow floor is 166.9, so 189. The meadow served NO
    # trail at all before this, which is why its way came out 45 points DARKER than the grass beside it.
    "park_path" => %{
      "surface" => "path_dirt", "tone" => "#ddb985", "width" => 3, "edge" => 0.28,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.12}],
      "lining" => [%{"tile" => "flower", "rate" => 0.1}, %{"tile" => "rock", "rate" => 0.04}]
    },
    # A trail cut through undergrowth, not a track laid down. Narrow, and the thing lining it is the
    # undergrowth it was cut through, which is why it reads as a corridor.
    # The jungle's own tone, moved here from `@jungle_palette` where it was tuned: 118.8, clear of every region
    # the jungle has (dense 49.9, base 65.9, swamp 68.8, ruins 73.0, open 85.0). `swamp_straightforward` is the
    # reference and agrees: a trail cut through wet shaded ground is the smallest step of all, +15.
    "cut_trail" => %{
      "surface" => "path_dirt", "tone" => "#8a7550", "width" => 2, "edge" => 0.5,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.05}],
      # LINED WITH THE GRASS, NOT THE THICKET, and this is measured rather than chosen. Of every tile a
      # pathway can be dressed with, `thicket` is the only one that BLOCKS, and lining a cut trail with it at
      # 0.14 cost the plain jungle 8 points of placeable room on a map that had just been thinned to get that
      # room back. It was redundant besides: thicket already grows over the whole jungle floor, so a hedge of
      # it at the verge adds no information. Long grass crowding the trail is what makes the edge legible,
      # and you walk through it.
      "lining" => [%{"tile" => "tall_grass", "rate" => 0.22}, %{"tile" => "thicket", "rate" => 0.03}]
    },
    # The clifftop path above the beach: one winding line of warm dirt, scrub and the odd rock along it,
    # nothing laid and nothing kept.
    # The island's own tone, moved here from its palette override: 183.3 on a bright sand floor. Its reference
    # `beach_hill_path` puts the clifftop path at #e9cc98, 206.4, over scrub at 129.
    "coast_path" => %{
      "surface" => "path_dirt", "tone" => "#cdb684", "width" => 2, "edge" => 0.45,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.08}],
      "lining" => [%{"tile" => "shrub", "rate" => 0.12}, %{"tile" => "rock", "rate" => 0.06}]
    },
    # A boardwalk. It is BUILT, so its edge is straight and nothing lies on it; reeds stand off the side of
    # it in the water it crosses.
    # The PLANKS' own colour, said out loud. A boardwalk is built of a material the tileset already describes,
    # so its tone is that material's; what it must never be is the dirt tone of the swamp it was built over,
    # which is what it inherited.
    "boardwalk" => %{
      "surface" => "wooden_planks", "tone" => "#aa8250", "width" => 2, "edge" => 0.0,
      "scatter" => [],
      "lining" => [%{"tile" => "bush", "rate" => 0.1}]
    },
    # A village lane: stone underfoot, a near straight edge because somebody laid it, lamps along it and
    # flowers at the foot of them.
    # The stone's own colour. The settlement streets were already right, so a settlement's tone is the
    # material it is laid in and nothing is moved.
    "village_lane" => %{
      "surface" => "path_stone", "tone" => "#ccbbaa", "width" => 3, "edge" => 0.15,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.05}],
      "lining" => [%{"tile" => "lamp", "rate" => 0.1}, %{"tile" => "flower", "rate" => 0.07}]
    },
    # Cobbles between the houses of an older town, worn at the sides, lamps along them.
    "cobbled_lane" => %{
      "surface" => "cobblestone", "tone" => "#b9b2a3", "width" => 3, "edge" => 0.12,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.06}],
      "lining" => [%{"tile" => "lamp", "rate" => 0.12}]
    },
    # A CITY STREET, which is what the beach town reference actually shows: four lanes of asphalt with a kerb
    # you could rule, a lamp post rhythm down both sides, and nothing lying on it because a road is swept.
    # Asphalt, and DARKER than the grass on purpose: `beach_city_street` is the reference and its streets are
    # near-black against pale sand. A way is not always the lighter thing, it is always the OTHER material.
    #
    # `marking` is the centre line: a dash every `every` cells down the middle of the carriageway, painted
    # as a COLOUR like the way under it, never a tile laid on top. #eae7db is the reference's own marking, median-sampled off the
    # pixels lying on its asphalt; that asphalt measures #3e403f against our `road` at #3d3d44, so the pair is
    # the picture's pair.
    "city_street" => %{
      "surface" => "road", "tone" => "#3d3d44", "width" => 4, "edge" => 0.0,
      "marking" => %{"color" => "#eae7db", "every" => 3},
      "scatter" => [],
      "lining" => [%{"tile" => "lamp", "rate" => 0.14}, %{"tile" => "shrub", "rate" => 0.06}]
    },
    # Sandy tracks through a beach town: the same dirt as the clifftop path, widened because carts use it,
    # still nobody laying anything.
    # `beach_hill_path` again, held back off its 206.4 because a cart track through a town is trodden rather
    # than bleached.
    "sand_track" => %{
      "surface" => "path_dirt", "tone" => "#dcc190", "width" => 3, "edge" => 0.3,
      "scatter" => [%{"tile" => "decor_pebbles", "rate" => 0.1}],
      "lining" => [%{"tile" => "shrub", "rate" => 0.1}]
    }
  }

  # A SETTLEMENT'S STREETS ARE ITS PATHWAY, and they are read off the same block rather than repeated beside
  # it. A street is a form of pathway, so the pathway's size is the street distribution's size, and the two
  # were redundant. As two literals they had already drifted: a modern city's ways said asphalt
  # while its streets said cobbles, a forest town's ways said dirt while its streets said stone, and a
  # mountain town's said gravel against cobbles. One literal, so there is nothing left to disagree with.

  # A SETTLEMENT'S STREETS ARE ITS OWN PATHWAY, derived rather than written twice.
  #
  # They are the same fact: a street is just a form of pathway, so its size is the pathway's size. As two
  # literals they drifted, and INHERITANCE is what made
  # it invisible. A modern city overrides its pathway to asphalt and says nothing about streets, so it went on
  # inheriting its parent's cobbles and nobody had written a contradiction anywhere. Measured across the nine
  # settlements when this was added: three disagreed with themselves.
  #
  # Deriving it here makes the contradiction unrepresentable instead of merely absent, and a row that states
  # no pathway keeps whatever streets it has, so nothing that predates the pathway block moves.
  defp streets_follow_the_pathway(%{config: %{"pathway" => %{"surface" => surface}, "settlement" => settlement} = config} = attrs)
       when is_binary(surface) and is_map(settlement) do
    %{attrs | config: %{config | "settlement" => Map.put(settlement, "streets", surface)}}
  end

  defp streets_follow_the_pathway(attrs), do: attrs

  # One pathway definition, by key. A template names the kind of way it has and the block comes from the one
  # table, so two templates that share a kind cannot drift apart on what it is.
  defp pathway(key), do: Map.fetch!(@pathways, key)

  # ── WHAT BLOOMS IN A PLACE ──────────────────────────────────────────────────────────────────────
  #
  # A region could state its SPECIES and had no way to state its BLOOMS, so every wet and tropical map
  # fell through to the SEASON's set, and summer's carries `✽ #f4f4ec`, a near white. A rainforest floor
  # is not a daisy meadow and neither is a swamp.
  #
  # These colours are a PROPOSAL rather than a derivation: the instruction was negative (no white), so
  # each set is the growth that place actually has, to accept or replace in review. A temperate wood, a
  # meadow and a mountain state none, because the season's set is right for them.

  # Heliconia red, orchid violet and a waxy cream yellow.
  @jungle_blooms [
    %{"char" => "✿", "color" => "#c2513f"},
    %{"char" => "✾", "color" => "#8d5fa8"},
    %{"char" => "❋", "color" => "#c9b063"}
  ]

  # Iris violet, dull marsh gold and a blue green sedge.
  @swamp_blooms [
    %{"char" => "✾", "color" => "#7b5fa8"},
    %{"char" => "❋", "color" => "#4f8f7a"},
    %{"char" => "✿", "color" => "#b89a3c"}
  ]

  # Shore growth: hibiscus pink, sea holly blue and a bleached sand yellow.
  @island_blooms [
    %{"char" => "✿", "color" => "#e2739b"},
    %{"char" => "❋", "color" => "#6aa9c4"},
    %{"char" => "✾", "color" => "#e0c877"}
  ]

  # ── THE REGIONS OF A WILD PLACE ─────────────────────────────────────────────────────────────────
  #
  # ONE region set, shared by EVERY wild environment. A region is a part of the same map you walk into,
  # never another row in the menu: the margin of a wood, its middle, an opening in it, a tangle of low
  # growth, and the wet ground down at the water. A forest in the middle is not the same as its edge, and
  # some of it stands in water.
  #
  # `canopy` and `undergrowth` are MULTIPLIERS on the row's served densities, so tuning an environment
  # moves all five regions together and tuning one here moves only that kind of ground. `weight` is how
  # much of a map that kind tends to claim.
  #
  # `species` is an AUTHORING key and is never served: it names WHICH of the environment's four species
  # tables the region draws from, which is what lets one region set grow palms on a beach and conifers on
  # a mountain without either being written out twice. `wild_regions/1` takes it back out.
  #
  # Swamp and ruins used to live here as regions of the jungle. They are ENVIRONMENTS now, because a swamp
  # is a place you generate, not a corner of a rainforest, and the same goes for a ruin.
  #
  # `spacing` is never 1: claiming only the four orthogonal neighbours leaves a checkerboard, passable
  # diagonally and not orthogonally, which measures as hundreds of floor regions.
  @wild_regions [
    %{
      "key" => "edge",
      "name" => "Edge of the wood",
      "weight" => 3,
      "canopy" => 0.75,
      "undergrowth" => 0.7,
      "species" => "open",
      "formation" => %{"lattice" => 9, "spacing" => 3, "understory" => 0.5}
    },
    %{
      "key" => "deep",
      "name" => "Deep wood",
      "weight" => 3,
      "canopy" => 1.15,
      "undergrowth" => 1.2,
      "species" => "canopy",
      "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.1}
    },
    %{
      "key" => "glade",
      "name" => "Glade",
      "weight" => 2,
      # almost nothing: a glade is the ABSENCE of canopy, which is what makes the wood around it read as wood
      "canopy" => 0.12,
      "undergrowth" => 0.4,
      "species" => "open",
      "formation" => %{"lattice" => 3, "spacing" => 5, "understory" => 0.3}
    },
    %{
      "key" => "thicket",
      "name" => "Thicket",
      "weight" => 2,
      # the floor is the hard part here, not the canopy: low growth you push through under short trees
      "canopy" => 0.5,
      "undergrowth" => 1.45,
      "species" => "scrub",
      "formation" => %{"lattice" => 7, "spacing" => 2, "understory" => 1.35}
    },
    %{
      "key" => "lakeside",
      "name" => "Lakeside",
      "weight" => 2,
      "canopy" => 0.85,
      "undergrowth" => 1.1,
      # the share of the region standing under water: pools, not a channel
      "pools" => 0.22,
      "species" => "wet",
      # trees standing IN the water, well apart, buttressed bases
      "formation" => @formations["flooded"]
    }
  ]

  # THE NEIGHBOURHOODS OF A CITY, and they are the same three in every city: upper, middle and lower
  # class. The difference you can SEE is the architecture money buys, so each one owns its wall material,
  # its roof tile and its colours rather than being the same houses in another tint. Upper class is stone
  # under slate in pale renders, middle class is brick and plaster under tile, lower class is timber and
  # brick under a flat deck in drab tones.
  @city_class_zones [
    %{
      "key" => "upper",
      "name" => "Upper class neighbourhood",
      "weight" => 1,
      "buildings" => %{
        "roof" => "roof_slate",
        "materials" => ["wall_stone"],
        "roofColors" => ["#3f464c", "#2f3439", "#4a4f55"],
        "wallColors" => ["#f0e7d0", "#e8dcc0", "#ded3b4"]
      }
    },
    %{
      "key" => "middle",
      "name" => "Middle class neighbourhood",
      "weight" => 3,
      "buildings" => %{
        "roof" => "roof",
        "materials" => ["wall_brick", "wall_plaster"],
        "roofColors" => ["#b5533a", "#8a4b2f", "#5a636b"],
        "wallColors" => ["#d3d8dc", "#c9a66b", "#bcc3c9"]
      }
    },
    %{
      "key" => "lower",
      "name" => "Lower class neighbourhood",
      "weight" => 2,
      "buildings" => %{
        "roof" => "flat_roof",
        "materials" => ["wall_wood", "wall_brick"],
        "roofColors" => ["#5c4433", "#4a4239", "#6b5540"],
        "wallColors" => ["#a89f7a", "#8a8580", "#9e4b3b"]
      }
    }
  ]

  # A BEACH IS A COAST, not the Amazon: sand where a jungle has peat, turquoise where it has blue-brown,
  # and a canopy that is yellow-green rather than near-black. Everything it does not restate is the
  # rainforest's, because the water depths and the swamp tone read the same in both.
  @beach_palette Map.merge(@jungle_palette, %{
                   "floor" => "#7c8a4e",
                   "floorAlt" => "#8c9a5b",
                   "litter" => "#9a8d5a",
                   "canopy" => "#4f9147",
                   "canopyAlt" => "#68ab56",
                   "undergrowth" => "#618c48",
                   "water" => "#2aa8c0",
                   "waterShallow" => "#86e0ea",
                   "waterDeep" => "#1a7891",
                   "bank" => "#e8d6a6"
                 })

  # ── THE ENVIRONMENTS ────────────────────────────────────────────────────────────────────────────
  #
  # THE TYPE IS THE ENVIRONMENT, and it is the same list for wild country, villages, towns and cities, so
  # a swamp forest, a swamp village, a swamp town and a swamp city all exist and all mean the same thing
  # about the place: what the climate is, what grows there, what the ground is made of and what people
  # build out of. Size is NOT a type, because the number of columns and rows is what decides size.
  #
  # One entry per environment, four rows out of it, so there is nothing to keep in step by hand. What a
  # kind of settlement is (a village against a city) lives in `@settlement_kinds`; what a PLACE is lives
  # here.
  #
  # `wild` says whether the environment also stands on its own with nobody living in it. `kinds` says
  # which settlements it builds, which is how a standalone type like a futuristic or a medieval city says
  # it is a city and nothing else.
  #
  # Every key not stated falls back to `@environment_defaults`.
  @environment_defaults %{
    wild: true,
    kinds: ~w(village town city),
    blooms: nil,
    levels: %{},
    region_extra: %{},
    river: "none",
    seasons: @zones,
    folk: 3,
    settlement_folk: nil,
    settlement_nature: @outdoor_nature,
    nature_scale: 1.0,
    buildings: %{},
    mix_adds: [],
    mix_drops: [],
    mix_replace: nil,
    settlement_overrides: %{}
  }

  @environments [
    %{
      key: "woodland",
      name: "Woodland",
      wild_blurb: "A temperate wood: grey-green, a lot of brown showing through, light reaching the floor.",
      place_blurb: "under temperate trees.",
      layout: "woodland",
      palette: @woodland_palette,
      nature: @woodland_nature,
      formation: @formations["stand"],
      trees: @woodland_trees,
      ways: %{"wild" => "forest_track", "village" => "forest_track", "town" => "village_lane", "city" => "city_street"},
      floors: %{"edge" => "#7d8a55", "deep" => "#5c6e3d", "glade" => "#8b9a5a", "thicket" => "#66753f", "lakeside" => "#5a6b48"},
      species: %{
        "canopy" => [%{"kind" => "tree_column", "weight" => 30}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree", "weight" => 25}, %{"kind" => "tree_sapling", "weight" => 20}],
        "open" => [%{"kind" => "tree_gnarled", "weight" => 60}, %{"kind" => "tree_round", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}],
        "scrub" => [%{"kind" => "bush", "weight" => 45}, %{"kind" => "bush_round", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 25}],
        "wet" => [%{"kind" => "tree_broadleaf", "weight" => 40}, %{"kind" => "tree_round", "weight" => 35}, %{"kind" => "bush_round", "weight" => 25}]
      }
    },
    %{
      key: "jungle",
      name: "Jungle",
      wild_blurb: "A closed canopy over choked undergrowth, the floor in permanent shade.",
      place_blurb: "cut into the rainforest.",
      layout: "jungle",
      palette: @jungle_palette,
      nature: @jungle_nature,
      formation: @formations["closed"],
      trees: @jungle_trees,
      folk: 2,
      blooms: @jungle_blooms,
      ways: %{"wild" => "cut_trail", "village" => "cut_trail", "town" => "village_lane", "city" => "city_street"},
      floors: %{"edge" => "#3f5f33", "deep" => "#24381f", "glade" => "#4c6b38", "thicket" => "#2c4526", "lakeside" => "#3b4a2e"},
      species: %{
        "canopy" => [%{"kind" => "tree_giant", "weight" => 25}, %{"kind" => "tree_big", "weight" => 25}, %{"kind" => "bush", "weight" => 25}, %{"kind" => "tree_round", "weight" => 25}],
        "open" => [%{"kind" => "tree_palm", "weight" => 30}, %{"kind" => "tree_round", "weight" => 30}, %{"kind" => "tree_big", "weight" => 20}, %{"kind" => "bush_round", "weight" => 20}],
        "scrub" => [%{"kind" => "bush", "weight" => 45}, %{"kind" => "bush_round", "weight" => 35}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_cypress", "weight" => 60}, %{"kind" => "bush_round", "weight" => 25}, %{"kind" => "tree_round", "weight" => 15}]
      },
      settlement_nature: %{"groundCover" => 0.35, "flowers" => 0.1, "tallGrass" => 0.25},
      nature_scale: 1.4,
      buildings: %{
        "materials" => ["wall_wood"],
        "roofColors" => ["#5a6b3a", "#6b7a45", "#4c5c31"],
        "wallColors" => ["#a98b5f", "#8f7450", "#c0a375"]
      }
    },
    %{
      key: "meadow",
      name: "Meadow",
      wild_blurb: "Open grass with the odd tree standing alone in it, and the sky on it all day.",
      place_blurb: "out on open grass.",
      layout: "meadow",
      palette: @meadow_palette,
      nature: @outdoor_nature,
      formation: @formations["scattered"],
      trees: @meadow_trees,
      folk: 5,
      ways: %{"wild" => "park_path", "village" => "park_path", "town" => "village_lane", "city" => "city_street"},
      floors: %{"edge" => "#7f9050", "deep" => "#6b7d45", "glade" => "#93a463", "thicket" => "#77894c", "lakeside" => "#6f8352"},
      species: %{
        "canopy" => [%{"kind" => "tree_broadleaf", "weight" => 40}, %{"kind" => "tree_round", "weight" => 30}, %{"kind" => "tree_big", "weight" => 30}],
        "open" => [%{"kind" => "tree_gnarled", "weight" => 60}, %{"kind" => "tree_round", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}],
        "scrub" => [%{"kind" => "bush_round", "weight" => 50}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_broadleaf", "weight" => 40}, %{"kind" => "tree_round", "weight" => 35}, %{"kind" => "bush_round", "weight" => 25}]
      },
      nature_scale: 1.1,
      buildings: %{
        "roofColors" => ["#b5533a", "#a34a33", "#8a4b2f"],
        "wallColors" => ["#e8dcc0", "#d8c79a", "#c9a66b"]
      }
    },
    %{
      key: "swamp",
      name: "Swamp",
      wild_blurb: "Cypress standing in the water, boardwalks over it, nothing dry underfoot.",
      place_blurb: "on boardwalks over the water.",
      layout: "jungle",
      palette: @jungle_palette,
      nature: @jungle_nature,
      formation: @formations["closed"],
      trees: [%{"kind" => "tree_cypress", "weight" => 45}, %{"kind" => "tree_mangrove", "weight" => 25}, %{"kind" => "bush_round", "weight" => 18}, %{"kind" => "tree_round", "weight" => 12}],
      folk: 2,
      blooms: @swamp_blooms,
      # a swamp does not freeze over and it is not a desert either
      seasons: ~w(spring summer),
      ways: %{"wild" => "boardwalk", "village" => "boardwalk", "town" => "boardwalk", "city" => "boardwalk"},
      floors: %{"edge" => "#3d5233", "deep" => "#2a3a24", "glade" => "#4a5c37", "thicket" => "#33472b", "lakeside" => "#35462c"},
      species: %{
        "canopy" => [%{"kind" => "tree_cypress", "weight" => 35}, %{"kind" => "tree_giant", "weight" => 25}, %{"kind" => "bush", "weight" => 25}, %{"kind" => "tree_round", "weight" => 15}],
        "open" => [%{"kind" => "tree_cypress", "weight" => 40}, %{"kind" => "tree_mangrove", "weight" => 30}, %{"kind" => "bush_round", "weight" => 30}],
        "scrub" => [%{"kind" => "bush", "weight" => 45}, %{"kind" => "bush_round", "weight" => 35}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_cypress", "weight" => 60}, %{"kind" => "tree_mangrove", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}]
      },
      settlement_nature: %{"groundCover" => 0.45, "flowers" => 0.08, "tallGrass" => 0.3},
      nature_scale: 1.5,
      buildings: %{
        "materials" => ["wall_wood"],
        "roofColors" => ["#6b5a34", "#5c4f2c", "#7a6a3e"],
        "wallColors" => ["#a98b5f", "#8f7450", "#c0a375"]
      },
      # no pasture in a swamp and nothing to keep in one. Huts, and a forge for the boats.
      mix_adds: [{"smithy", 1, 1}],
      mix_drops: ~w(barn stable)
    },
    %{
      key: "mountain",
      name: "Mountain",
      wild_blurb: "Conifers over ground that actually climbs: a bare ridge, wooded slopes, a sheltered vale.",
      place_blurb: "on the rock, in among the conifers.",
      layout: "woodland",
      palette: @woodland_palette,
      nature: %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.28, "tallGrass" => 0.12},
      formation: @formations["clumped"],
      trees: [%{"kind" => "tree_conifer", "weight" => 70}, %{"kind" => "tree_tall", "weight" => 15}, %{"kind" => "tree_stub", "weight" => 15}],
      ways: %{"wild" => "rocky_track", "village" => "rocky_track", "town" => "cobbled_lane", "city" => "cobbled_lane"},
      floors: %{"edge" => "#6b7a4e", "deep" => "#47603a", "glade" => "#8a8d76", "thicket" => "#5f7047", "lakeside" => "#52664a"},
      # WHAT MAKES IT A MOUNTAIN rather than a colour change: the cells of a region stand at that level and
      # the step down to the next is drawn as a cliff. The glade is the exposed ridge at the top, where
      # almost nothing grows, and the deep wood is the vale at the bottom, where the water and the soil end
      # up. Nothing else in the catalog states a level except its volcanic placeholder.
      levels: %{"glade" => 3, "edge" => 2, "thicket" => 2, "deep" => 0, "lakeside" => 0},
      species: %{
        "canopy" => [%{"kind" => "tree_conifer", "weight" => 65}, %{"kind" => "tree_tall", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 15}],
        "open" => [%{"kind" => "tree_stub", "weight" => 55}, %{"kind" => "tree_conifer", "weight" => 45}],
        "scrub" => [%{"kind" => "tree_stub", "weight" => 50}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_conifer", "weight" => 45}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree_broadleaf", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 10}]
      },
      nature_scale: 0.9,
      buildings: %{
        "roof" => "roof_slate",
        "materials" => ["wall_stone"],
        "roofColors" => ["#3f464c", "#4a4f55", "#2f3439"],
        "wallColors" => ["#8a8580", "#9c9792", "#767168"]
      },
      mix_adds: [{"manor", 1, 1}, {"smithy", 1, 1}]
    },
    %{
      key: "beach",
      name: "Beach",
      wild_blurb: "Palms over pale sand, ringed by shallow turquoise water.",
      place_blurb: "on the sand by the sea.",
      layout: "jungle",
      palette: @beach_palette,
      nature: @jungle_nature,
      formation: @formations["closed"],
      trees: [%{"kind" => "tree_coconut", "weight" => 30}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "tree_banana", "weight" => 20}, %{"kind" => "tree_mangrove", "weight" => 15}, %{"kind" => "bush_round", "weight" => 10}],
      blooms: @island_blooms,
      # a coast starts ringed by water
      river: "around",
      ways: %{"wild" => "coast_path", "village" => "coast_path", "town" => "sand_track", "city" => "city_street"},
      floors: %{"edge" => "#8c9a5b", "deep" => "#6b7a45", "glade" => "#9aa768", "thicket" => "#7c8a4e", "lakeside" => "#b8a978"},
      species: %{
        "canopy" => [%{"kind" => "tree_banana", "weight" => 30}, %{"kind" => "tree_coconut", "weight" => 25}, %{"kind" => "tree_mangrove", "weight" => 25}, %{"kind" => "bush", "weight" => 20}],
        "open" => [%{"kind" => "tree_coconut", "weight" => 35}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "tree_banana", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}],
        "scrub" => [%{"kind" => "bush_round", "weight" => 50}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_mangrove", "weight" => 60}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}]
      },
      settlement_nature: %{"groundCover" => 0.06, "flowers" => 0.03, "tallGrass" => 0.08},
      nature_scale: 0.45,
      buildings: %{
        "materials" => ["wall_wood", "wall_plaster"],
        "roofColors" => ["#9c8f6f", "#b5a888", "#87795c"],
        "wallColors" => ["#e8dcc0", "#d8c79a", "#f0e7d0"]
      },
      mix_adds: [{"store", 1, 2}]
    },
    %{
      key: "ruins",
      name: "Ruins",
      wild_blurb: "Old stone the wood has taken back, unevenly: clumps of trees with open masonry between.",
      place_blurb: "built over old stone.",
      layout: "jungle",
      palette: @jungle_palette,
      nature: @jungle_nature,
      formation: @formations["closed"],
      trees: [%{"kind" => "tree_round", "weight" => 30}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_stub", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 20}],
      folk: 2,
      blooms: @jungle_blooms,
      ways: %{"wild" => "forest_track", "village" => "forest_track", "town" => "cobbled_lane", "city" => "cobbled_lane"},
      floors: %{"edge" => "#4a4a3c", "deep" => "#3a3c30", "glade" => "#5d5c4a", "thicket" => "#414433", "lakeside" => "#46503a"},
      # fallen masonry everywhere, which is the whole point of the place: it rides on every region rather
      # than on one, because the ruin is the environment now and not a corner of a rainforest
      region_extra: %{"stone" => 0.16},
      species: %{
        "canopy" => [%{"kind" => "tree_round", "weight" => 30}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_stub", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 20}],
        "open" => [%{"kind" => "tree_stub", "weight" => 40}, %{"kind" => "tree_round", "weight" => 30}, %{"kind" => "bush_round", "weight" => 30}],
        "scrub" => [%{"kind" => "bush", "weight" => 45}, %{"kind" => "tree_sapling", "weight" => 30}, %{"kind" => "bush_round", "weight" => 25}],
        "wet" => [%{"kind" => "tree_round", "weight" => 40}, %{"kind" => "bush", "weight" => 35}, %{"kind" => "tree_sapling", "weight" => 25}]
      },
      settlement_nature: %{"groundCover" => 0.22, "flowers" => 0.05, "tallGrass" => 0.16},
      nature_scale: 0.9,
      buildings: %{
        "materials" => ["wall_stone"],
        "roofColors" => ["#5c4433", "#4a3d2e", "#6b5540"],
        "wallColors" => ["#a89f7a", "#8a8580", "#9c9080"]
      },
      mix_adds: [{"church", 1, 1}]
    },
    # PLACEHOLDER, awaiting its own flavour. A desert has no data anywhere in this file yet, so it runs on
    # the BEACH's numbers, which are the closest thing we have: pale open ground, sparse growth, sand
    # underfoot and almost no green in the settlements. Everything below is the beach's until a desert
    # palette, a desert species list and desert floors are authored. The seasons are the honest half: the
    # editor already offers a desert season and that is the one this belongs in.
    %{
      key: "desert",
      name: "Desert",
      wild_blurb: "Open sand and sparse growth. Running on the beach's numbers until it gets its own.",
      place_blurb: "out on the open sand.",
      layout: "jungle",
      palette: @beach_palette,
      nature: @jungle_nature,
      formation: @formations["closed"],
      trees: [%{"kind" => "tree_palm", "weight" => 40}, %{"kind" => "tree_coconut", "weight" => 25}, %{"kind" => "tree_stub", "weight" => 20}, %{"kind" => "bush_round", "weight" => 15}],
      folk: 2,
      blooms: @island_blooms,
      seasons: ~w(summer desert),
      ways: %{"wild" => "coast_path", "village" => "sand_track", "town" => "sand_track", "city" => "sand_track"},
      floors: %{"edge" => "#8c9a5b", "deep" => "#6b7a45", "glade" => "#9aa768", "thicket" => "#7c8a4e", "lakeside" => "#b8a978"},
      species: %{
        "canopy" => [%{"kind" => "tree_banana", "weight" => 30}, %{"kind" => "tree_coconut", "weight" => 25}, %{"kind" => "tree_mangrove", "weight" => 25}, %{"kind" => "bush", "weight" => 20}],
        "open" => [%{"kind" => "tree_coconut", "weight" => 35}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "tree_banana", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}],
        "scrub" => [%{"kind" => "bush_round", "weight" => 50}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_mangrove", "weight" => 60}, %{"kind" => "tree_palm", "weight" => 25}, %{"kind" => "bush_round", "weight" => 15}]
      },
      settlement_nature: %{"groundCover" => 0.06, "flowers" => 0.03, "tallGrass" => 0.08},
      nature_scale: 0.45,
      buildings: %{
        "materials" => ["wall_plaster", "wall_stone"],
        "roofColors" => ["#9c8f6f", "#b5a888", "#87795c"],
        "wallColors" => ["#e8dcc0", "#d8c79a", "#f0e7d0"]
      },
      mix_adds: [{"store", 1, 2}]
    },
    # PLACEHOLDER, awaiting its own flavour. Nothing volcanic exists in this file, so it runs on the
    # MOUNTAIN's numbers: the same relief, the same conifers, the same stone under slate. What it is
    # missing is exactly what would make it volcanic, ash floors, black rock, lava water and a canopy that
    # gives up near the vents. Author those here and nothing else has to move.
    %{
      key: "volcanic",
      name: "Volcanic",
      wild_blurb: "Rock that climbs in steps. Running on the mountain's numbers until it gets its own.",
      place_blurb: "on the black rock under the mountain.",
      layout: "woodland",
      palette: @woodland_palette,
      nature: %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.28, "tallGrass" => 0.12},
      formation: @formations["clumped"],
      trees: [%{"kind" => "tree_conifer", "weight" => 70}, %{"kind" => "tree_tall", "weight" => 15}, %{"kind" => "tree_stub", "weight" => 15}],
      folk: 2,
      ways: %{"wild" => "rocky_track", "village" => "rocky_track", "town" => "rocky_track", "city" => "cobbled_lane"},
      floors: %{"edge" => "#6b7a4e", "deep" => "#47603a", "glade" => "#8a8d76", "thicket" => "#5f7047", "lakeside" => "#52664a"},
      levels: %{"glade" => 3, "edge" => 2, "thicket" => 2, "deep" => 0, "lakeside" => 0},
      species: %{
        "canopy" => [%{"kind" => "tree_conifer", "weight" => 65}, %{"kind" => "tree_tall", "weight" => 20}, %{"kind" => "tree_stub", "weight" => 15}],
        "open" => [%{"kind" => "tree_stub", "weight" => 55}, %{"kind" => "tree_conifer", "weight" => 45}],
        "scrub" => [%{"kind" => "tree_stub", "weight" => 50}, %{"kind" => "bush", "weight" => 30}, %{"kind" => "tree_sapling", "weight" => 20}],
        "wet" => [%{"kind" => "tree_conifer", "weight" => 45}, %{"kind" => "tree_tall", "weight" => 25}, %{"kind" => "tree_broadleaf", "weight" => 20}, %{"kind" => "tree_sapling", "weight" => 10}]
      },
      nature_scale: 0.9,
      buildings: %{
        "roof" => "roof_slate",
        "materials" => ["wall_stone"],
        "roofColors" => ["#3f464c", "#4a4f55", "#2f3439"],
        "wallColors" => ["#8a8580", "#9c9792", "#767168"]
      },
      mix_adds: [{"manor", 1, 1}, {"smithy", 1, 1}]
    },
    # ── THE STANDALONE TYPES ──────────────────────────────────────────────────────────────────────
    # Not every type is an environment. A futuristic city and a medieval city are a KIND of place in their
    # own right, so they say they are cities and nothing else, and no wild country or village is generated
    # for them. They are entries in the same table because they are the same shape of fact, and that is
    # what stops them drifting away from the rest.

    # The old Modern city, under the name it should have had. It keeps everything that made it itself: the
    # asphalt with the white lines down the middle, the towers and blocks of flats, and the lamp rhythm the
    # street lining gives it. Nothing else is built from it.
    %{
      key: "futuristic",
      name: "Futuristic",
      place_blurb: "towers and blocks of flats under flat grey decks.",
      wild: false,
      kinds: ["city"],
      ways: %{"city" => "city_street"},
      settlement_folk: 16,
      mix_replace: [{"tower", 4, 6}, {"apartment", 5, 8}, {"office", 2, 4}]
    },
    # Stone under slate on cobbled streets, a cathedral and a castle, and nothing tall anywhere in it.
    %{
      key: "medieval",
      name: "Medieval",
      place_blurb: "stone under slate on cobbles, a cathedral and a castle, nothing tall.",
      wild: false,
      kinds: ["city"],
      ways: %{"city" => "cobbled_lane"},
      nature_scale: 1.6,
      settlement_overrides: %{"buildingCap" => 54},
      buildings: %{
        "roof" => "roof_slate",
        "materials" => ["wall_stone", "wall_brick"],
        "roofColors" => ["#3f464c", "#4a4f55", "#5c4433"],
        "wallColors" => ["#8a8580", "#a89f7a", "#9e4b3b"]
      },
      mix_replace: [{"cathedral", 1, 1}, {"castle", 1, 1}, {"manor", 2, 4}, {"smithy", 1, 2}, {"church", 1, 2}]
    }
  ]

  # ── THE KINDS OF SETTLEMENT ─────────────────────────────────────────────────────────────────────
  #
  # A village, a town and a city are fundamentally different places and the difference is ARCHITECTURE,
  # not size, because size is the number of columns and rows the grid rolls. So there is no small town and
  # no big city here, there is what each one is made of:
  #
  #   * a village is rural. Small timber houses, nothing in concrete, no landmark, and green everywhere
  #     between them.
  #   * a town is a decent size place with defined areas and better architecture, brick and timber, a
  #     square, a church and a smithy, and nothing tall.
  #   * a city is large and modern, many zones, plaster and flat decks, towers and blocks of flats, and
  #     hardly any green left.
  #
  # Each one is crossed with every environment, so what is written here is said once and lands in nine
  # rows. `sub_zones` is what a kind divides ITSELF into, which is where a city's three neighbourhoods by
  # money live.
  @settlement_kinds [
    %{
      key: "village",
      noun: "village",
      layout: "town",
      variant: "town",
      blurb: "Small houses, no concrete and green between every one of them,",
      grid: @small_grid,
      plaza: 3,
      road_width: 3,
      lot_gap: [2, 3],
      max_per_frontage: 4,
      cap: 12,
      houses: [3, 5],
      demanded_houses: {1, 3},
      nature_mult: 2.2,
      folk: 6,
      mix: [{"barn", 1, 2}, {"stable", 1, 2}],
      buildings: %{
        "roof" => "roof",
        "materials" => ["wall_wood"],
        "roofColors" => ["#6b5a34", "#7a6a3e", "#5c4f2c"],
        "wallColors" => ["#b08d5b", "#c9a66b", "#9c7c4e"]
      },
      sub_zones: []
    },
    %{
      key: "town",
      noun: "town",
      layout: "town",
      variant: "town",
      blurb: "Defined areas and better architecture, nothing tall,",
      grid: @small_grid,
      plaza: 5,
      road_width: 4,
      lot_gap: [1, 2],
      max_per_frontage: 6,
      cap: 18,
      houses: [4, 6],
      demanded_houses: {1, 3},
      nature_mult: 1.3,
      folk: 8,
      mix: [{"temple", 1, 1}, {"church", 1, 1}, {"stable", 1, 2}, {"barn", 1, 2}, {"smithy", 1, 1}],
      buildings: %{
        "roof" => "roof",
        "materials" => ["wall_brick", "wall_wood"],
        "roofColors" => ["#8a4b2f", "#7a4326", "#6b4a2b"],
        "wallColors" => ["#c9a66b", "#b08d5b", "#d8c79a"]
      },
      sub_zones: []
    },
    %{
      key: "city",
      noun: "city",
      layout: "city",
      variant: "city",
      blurb: "Many zones, modern architecture and towers,",
      grid: @city_grid,
      plaza: 7,
      road_width: 4,
      lot_gap: [1, 1],
      max_per_frontage: 99,
      cap: 72,
      houses: [7, 11],
      demanded_houses: {3, 5},
      nature_mult: 0.5,
      folk: 14,
      mix: [{"temple", 1, 1}, {"tower", 3, 5}, {"apartment", 4, 7}, {"office", 2, 4}],
      buildings: %{
        "roof" => "flat_roof",
        "materials" => ["wall_plaster"],
        "roofColors" => ["#4a4f55", "#3f464c", "#5a636b"],
        "wallColors" => ["#e8ecef", "#d3d8dc", "#bcc3c9"]
      },
      sub_zones: @city_class_zones
    }
  ]

  # THE KEYS THAT PREDATE THE CROSS PRODUCT. A generated key is `<kind>_<environment>`, and five rows
  # already existed under another name before the environments were a table. They are the same place, so
  # they keep the key and nothing that points at one breaks.
  @kept_keys %{
    {"town", "woodland"} => "town",
    {"city", "woodland"} => "city",
    {"town", "mountain"} => "town_mountain",
    {"town", "swamp"} => "town_swamp"
  }

  # How many ancestors a seed row has. Parents seed first.
  defp depth(%{parent: parent}, by_key) when is_binary(parent), do: 1 + depth(Map.fetch!(by_key, parent), by_key)
  defp depth(_row, _by_key), do: 0

  # THE REGION PICKER. You pick a region to LEAD and the map leans that way, which is the same idiom as
  # picking a type. Built from the regions a row actually carries, so the names come from one place.
  defp region_options([]), do: []

  defp region_options(regions) do
    [
      %{
        "key" => "region",
        "label" => "Region",
        "type" => "choice",
        "default" => "random",
        "choices" => [
          %{"key" => "random", "label" => "Random"}
          | for(z <- regions, do: %{"key" => z["key"], "label" => z["name"]})
        ]
      }
    ]
  end

  # The water options with a different starting river: a coast starts ringed by water.
  defp water_options(river_default) do
    [river | rest] = @water_options
    [Map.put(river, "default", river_default) | rest]
  end

  # THE SAME FIVE REGIONS, IN THIS PLACE'S COLOURS. The shapes come from `@wild_regions` and the floor
  # tones, the species and the blooms come from the environment, which is the whole of reusing one set of
  # sub zones across every type instead of authoring five regions nine times.
  defp wild_regions(env) do
    for region <- @wild_regions do
      region
      |> Map.merge(%{"floor" => Map.fetch!(env.floors, region["key"]), "trees" => Map.fetch!(env.species, region["species"])})
      |> Map.merge(env.region_extra)
      |> with_blooms(env.blooms)
      |> with_level(Map.get(env.levels, region["key"]))
      |> Map.delete("species")
    end
  end

  # Absent means the season decides, which is right for a temperate wood and wrong for a rainforest.
  defp with_blooms(region, nil), do: region
  defp with_blooms(region, blooms), do: Map.put(region, "flowers", blooms)

  # Only a place with relief states a level. Everywhere else every cell stands on the walking floor.
  defp with_level(region, nil), do: region
  defp with_level(region, level), do: Map.put(region, "level", level)

  defp environments, do: Enum.map(@environments, &Map.merge(@environment_defaults, &1))

  defp settlement_key(kind, env), do: Map.get(@kept_keys, {kind.key, env.key}, "#{kind.key}_#{env.key}")

  # A standalone type may say how many people live in it; everything else takes the kind's count.
  defp settlement_folk(%{settlement_folk: count}, _kind) when is_integer(count), do: count
  defp settlement_folk(_env, kind), do: kind.folk

  # A standalone type states the whole list, because adding towers to a medieval city's cathedral is not
  # what a medieval city is. An environment only ever adds to its kind's list, or drops what does not
  # belong in that climate.
  defp building_mix(_kind, %{mix_replace: entries}) when is_list(entries), do: entries

  defp building_mix(kind, env) do
    Enum.reject(kind.mix ++ env.mix_adds, fn {type, _lo, _hi} -> type in env.mix_drops end)
  end

  defp wilderness_row(env, position) do
    %{
      category: "wilderness",
      key: "forest_#{env.key}",
      name: env.name,
      layout: env.layout,
      variant: "forest",
      position: position,
      zones: env.seasons,
      description: env.wild_blurb,
      config: %{
        "pathway" => pathway(env.ways["wild"]),
        "grid" => @small_grid,
        "nature" => env.nature,
        "units" => townsfolk(env.folk),
        "palette" => env.palette,
        "formation" => env.formation,
        "trees" => env.trees,
        "subZones" => wild_regions(env),
        "crossings" => @crossings
      },
      options: @way_options ++ region_options(@wild_regions) ++ water_options(env.river)
    }
  end

  defp settlement_row(kind, env, position) do
    %{
      category: kind.key,
      key: settlement_key(kind, env),
      name: "#{env.name} #{kind.noun}",
      layout: kind.layout,
      variant: kind.variant,
      position: position,
      zones: env.seasons,
      description: "#{kind.blurb} #{env.place_blurb}",
      config: settlement_config(kind, env),
      options: @settlement_way_options ++ region_options(kind.sub_zones) ++ @water_options
    }
  end

  defp settlement_config(kind, env) do
    tuning =
      settlement(
        plaza: kind.plaza,
        road_width: kind.road_width,
        lot_gap: kind.lot_gap,
        max_per_frontage: kind.max_per_frontage,
        cap: kind.cap,
        houses: kind.houses,
        demanded_houses: kind.demanded_houses,
        nature_mult: Float.round(kind.nature_mult * env.nature_scale, 2),
        mix: building_mix(kind, env)
      )

    %{
      "pathway" => pathway(Map.fetch!(env.ways, kind.key)),
      "grid" => kind.grid,
      "settlement" => Map.merge(tuning, env.settlement_overrides),
      "nature" => env.settlement_nature,
      "entrance" => "town_entrance",
      "units" => townsfolk(settlement_folk(env, kind)),
      "buildings" => Map.merge(@building_palette, Map.merge(kind.buildings, env.buildings))
    }
    |> with_sub_zones(kind.sub_zones)
  end

  defp with_sub_zones(config, []), do: config
  defp with_sub_zones(config, zones), do: Map.put(config, "subZones", zones)

  @doc """
  The categories to seed, in menu order.

  A category is the TERRAIN KIND now, and each one means something you can point at. The old four had a
  `settlement` bucket holding a town and a city, which are not the same kind of place at all, and a
  `forest` bucket that had to hold a swamp and a beach as well.
  """
  def categories do
    [
      %{key: "wilderness", name: "Wilderness", position: 0,
        description: "Wild country with nobody living in it: wood, marsh, rock, sand and ruin."},
      %{key: "village", name: "Village", position: 1,
        description: "A rural place. Small houses, nothing in concrete, nothing modern."},
      %{key: "town", name: "Town", position: 2,
        description: "A decent size settlement with defined areas and better architecture, and nothing tall."},
      %{key: "city", name: "City", position: 3,
        description: "A large settlement of many zones, modern architecture and towers."},
      %{key: "cave", name: "Cave", position: 4, description: "A seasonal cavern with enemies instead of townsfolk."},
      %{key: "temple", name: "Temple", position: 5, description: "A seasonal temple dungeon."}
    ]
  end

  @doc """
  The generators to seed, keyed to their category.

  Four of the six categories are the SAME environment list, so they are generated as a cross product
  rather than written out. Nothing here is a hand-copied row.
  """
  def generators do
    wild = for {env, i} <- Enum.with_index(Enum.filter(environments(), & &1.wild)), do: wilderness_row(env, i)

    settlements =
      for kind <- @settlement_kinds,
          {env, i} <- Enum.with_index(Enum.filter(environments(), &(kind.key in &1.kinds))),
          do: settlement_row(kind, env, i)

    wild ++ settlements ++ dungeons()
  end

  defp dungeons do
    [
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
        |> streets_follow_the_pathway()
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
      # A village's lanes are narrower than a town's and a city's, which is one of the things you read as
      # rural before you have looked at a single building.
      "roadWidth" => Keyword.fetch!(opts, :road_width),
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
      # WHAT THIS PLACE PAVES ITS STREETS WITH, and it is no longer stated here.
      #
      # Measured before this existed: the settlement pass painted every street `road` for a town and a city
      # alike, so a village had asphalt through it. Naming it per settlement fixed that and introduced a
      # second problem, because a settlement's streets and its `pathway` are the same fact written twice, and
      # written twice they drifted. `streets_follow_the_pathway/1` derives it at seed time from the row's own
      # pathway, so the two cannot disagree. A placeholder is kept so the key exists at the shape the editor
      # and the frontend expect; the derivation overwrites it for every row that states a pathway.
      "streets" => Keyword.get(opts, :streets, "path_stone")
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
  defp mix(entries, demanded_houses) do
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
  THE GENERATION LAYERS: the model, as rows.

  A layer is a set of things in a given context, and the context is A LEVEL BEING COMPLETE, which is wider
  than the map generator: a layer does not necessarily run in the generator, it is a thing in the context of
  the level being finished. Units are a layer even though the generator does not scatter them.

  The order: grid (size, cell, rows) > terrain (by zone, region and season, which decides what objects will
  be added and what the floor is) > water (which blocks pathways) > pathways (which adapt to the space the
  water left) > objects (where the generator enters into play) > fog (distance, and optimizing for it) >
  lightning (which affects every element) > shadow (which depends on the light and on where things ended up
  standing) > post processing and optimization.

  GRID AND TERRAIN ARE ONE LAYER, and the inputs are its parameters rather than a layer of their own: every
  input on the generator UI does the same thing, it sets a parameter in a given layer of the system.

  `group` is the name for a run of layers. `layout` is terrain, water and pathways together; `objects` is
  buildings, nature and decor. Both used to be served as if they were layers themselves, which is exactly what
  let a SECOND pathways layer be added beside the first without anything noticing.

  PATHWAYS IS STRUCTURE, NOT LOOK: what the pathways decide is the map's structure, which cells are a way,
  which are a section to put objects in, where the exits are and how a way is drawn. The objects phase then
  picks the KIND of way and the kind of exit. Which tile a way is surfaced with, and what lines it, belong to
  objects.

  `seedable: false` is the honest half: a layer nothing re-rolls yet gets no button rather than one that does
  nothing.
  """
  def seed_generation_layers do
    layers = [
      %{key: "terrain", label: "Terrain", position: 10, group: "layout", seedable: true,
        hint: "the grid and the ground on it, by zone, region and season. decides the floor and what may grow"},
      %{key: "water", label: "Water", position: 20, group: "layout", seedable: true,
        hint: "rivers, pools and shallows. water is laid before the paths, because it is what they go around"},
      %{key: "pathways", label: "Pathways", position: 30, group: "layout", seedable: true,
        hint: "the map's structure: where the ways run, where the exits are, and which ground is left to build on"},
      %{key: "buildings", label: "Buildings", position: 40, group: "objects", seedable: true,
        hint: "the structures, re-rolled in place"},
      %{key: "nature", label: "Nature", position: 50, group: "objects", seedable: true,
        hint: "the trees, plants and greenery"},
      %{key: "decor", label: "Decor", position: 60, group: "objects", seedable: true,
        hint: "the dressing: what surfaces a way, what lines it, plazas, lamps and fountains"},
      %{key: "units", label: "Units", position: 70, seedable: true,
        hint: "the creatures and townsfolk. they depend on everything above them"},
      %{key: "fog", label: "Fog", position: 80, seedable: false,
        hint: "distance and what it hides. not built yet"},
      %{key: "lightning", label: "Lightning", position: 90, seedable: false,
        hint: "the light, which affects every element on the map. not built yet"},
      %{key: "shadow", label: "Shadow", position: 100, seedable: false,
        hint: "cast from the light and from where things ended up standing. not built yet"},
      %{key: "post_processing", label: "Post processing", position: 110, seedable: false,
        hint: "the final pass over the finished frame. not built yet"}
    ]

    for attrs <- layers, do: {:ok, _} = Nebulith.Catalog.upsert_generation_layer(attrs)
    :ok
  end

end

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
  @building_palette %{
    "materials" => ["wall_brick", "wall_wood", "wall_stone"],
    "roofColors" => ["#b5533a", "#5a636b", "#5c4433", "#4a6a7a"],
    "wallColors" => ["#9e4b3b", "#c9a66b", "#e8dcc0", "#8a8580", "#a89f7a"],
    "storeRoof" => "#235a96",
    "hospitalRoof" => "#2f7e50",
    "fixedWall" => "#f0f0ea"
  }

  # The light dressing every outdoor map gets: flat ground tufts + a few standing blooms.
  @outdoor_nature %{"groundCover" => 0.12, "flowers" => 0.06}

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
  @woodland_nature %{"groundCover" => 0.2, "flowers" => 0.04, "canopy" => 0.434}

  # A JUNGLE is a woodland grown over: the canopy Alexander already accepted as forest-dense (the 0.62 the
  # woodland used to carry), plus the thing that actually distinguishes a jungle from a wood — UNDERGROWTH.
  # Ground cover more than doubles and the blooms go with it, so the floor is choked rather than walkable
  # lawn between trunks. Same STRUCTURE as the woodland (clearings, trails); only these numbers differ, which
  # is why it needs no generator of its own. Starting values — tune them here by eye.
  @jungle_nature %{"groundCover" => 0.5, "flowers" => 0.1, "canopy" => 0.62}

  @doc "The categories to seed, in menu order (`editorConfig.ts` STAGE_VARIANTS)."
  def categories do
    [
      %{key: "forest", name: "Forest", position: 0, description: "Woodland and open meadows — no settlement."},
      %{key: "town", name: "Town", position: 1, description: "A modest, leafy settlement around a square."},
      %{key: "city", name: "City", position: 2, description: "The same lots packed far harder — roughly 4x a town."},
      %{key: "cave", name: "Cave", position: 3, description: "A seasonal cavern with enemies instead of townsfolk."},
      %{key: "temple", name: "Temple", position: 4, description: "A seasonal temple dungeon."}
    ]
  end

  @doc "The generators to seed, keyed to their category."
  def generators do
    [
      %{
        category: "forest", key: "forest_woodland", name: "Woodland", layout: "woodland", position: 0,
        description: "Dense trees with clearings cut into them, joined by paths.",
        config: %{"grid" => @small_grid, "nature" => @woodland_nature, "units" => townsfolk(3)}
      },
      %{
        category: "forest", key: "forest_woodland_river", name: "Woodland + River", layout: "woodland_river", position: 1,
        description: "The woodland, cut by a river with a bridge across it.",
        config: %{"grid" => @small_grid, "nature" => @woodland_nature, "units" => townsfolk(3)}
      },
      %{
        category: "forest", key: "forest_jungle", name: "Jungle", layout: "jungle", position: 2,
        description: "A closed canopy over choked undergrowth, with clearings cut into it.",
        config: %{"grid" => @small_grid, "nature" => @jungle_nature, "units" => townsfolk(2)}
      },
      %{
        category: "forest", key: "forest_meadow", name: "Meadow", layout: "meadow", position: 3,
        # WAS "Clearings wired by corridors, tree masses filling the rest." It never built tree masses —
        # `scatterFramingTrees` frames the edges and leaves the centre open, which is a meadow. The
        # description promised the thing the new Woodland preset actually does.
        description: "An open clearing framed by trees, with two ways in.",
        config: %{"grid" => @small_grid, "nature" => @outdoor_nature, "units" => townsfolk(5)}
      },
      %{
        category: "forest", key: "forest_meadow_river", name: "Meadow + River", layout: "meadow_river", position: 4,
        description: "The meadow, cut by a river with a bridge across it.",
        config: %{"grid" => @small_grid, "nature" => @outdoor_nature, "units" => townsfolk(5)}
      },
      %{
        category: "town", key: "town_default", name: "Town", position: 0,
        description: "Streets, a central square, houses fronting the roads.",
        config: %{
          "grid" => @small_grid,
          "settlement" => settlement(plaza: 5, lot_gap: [1, 2], max_per_frontage: 6, cap: 18,
                                     houses: [4, 6], big: [1, 3], nature_mult: 1.15),
          "nature" => @outdoor_nature,
          "units" => townsfolk(8),
          "buildings" => @building_palette
        }
      },
      %{
        category: "city", key: "city_default", name: "City", position: 0,
        description: "The town's rules on a bigger grid with tighter lots and no per-street limit.",
        config: %{
          "grid" => @city_grid,
          "settlement" => settlement(plaza: 7, lot_gap: [1, 1], max_per_frontage: 99, cap: 72,
                                     houses: [7, 11], big: [3, 5], nature_mult: 0.4),
          "nature" => @outdoor_nature,
          "units" => townsfolk(14),
          "buildings" => @building_palette
        }
      },
      %{
        category: "cave", key: "cave_default", name: "Cave", position: 0,
        description: "A cavern floor — bats, spiders and skeletons instead of townsfolk.",
        config: %{"grid" => @small_grid, "units" => enemies(~w(bat spider skeleton))}
      },
      %{
        category: "temple", key: "temple_default", name: "Temple", position: 0,
        description: "A temple dungeon — skeletons, guardians and wraiths.",
        config: %{"grid" => @small_grid, "units" => enemies(~w(skeleton guardian wraith))}
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

    for attrs <- generators() do
      params = attrs |> Map.delete(:category) |> Map.put(:category_id, Map.fetch!(ids, attrs.category)) |> Map.put(:zones, @zones)

      {:ok, _} =
        (Repo.get_by(Generator, key: attrs.key) || %Generator{})
        |> Generator.changeset(params)
        |> Repo.insert_or_update()
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
      "natureMultiplier" => Keyword.fetch!(opts, :nature_mult)
    }
  end

  defp townsfolk(count), do: %{"townsfolk" => count, "enemies" => 0, "enemyTypes" => []}
  defp enemies(types), do: %{"townsfolk" => 0, "enemies" => 10, "enemyTypes" => types}
end

defmodule Nebulith.DataMigration.EveryRegionIsAPlace do
  @moduledoc """
  Every region gets the MAP DESIGN that makes it the place it is named after.

  *"it's ALL EXISTING REGIONS IN ALL EXISTING TYPES/BIOMAS SUCK ... there's not (or wasn't) a single region
  that LOOKED LIKE THE REGION it says it was on ALL fronts, architecture, map design, vegetation"*.

  Measured before writing anything, against what this table served:

      forest_beach      5 regions, ZERO map-design fields between them
      forest_meadow     1 of 5 states anything (a pool share its builder threw away)
      forest_woodland   1 of 5 states anything (the same, thrown away the same way)
      forest_mountain   levels, and nothing else
      city / city_*     3 regions, differing by ONE floor colour repeated on all three
      town_* village_*  no regions at all

  So a region could describe its trees and its leaf tone and almost nothing about the GROUND. That is the
  whole of *"different layout, different everything to represent the actual region"* going missing, and it is
  a data gap: the engine reads `floor`, `level`, `pools`, `stone` and now `built` in every layout, and almost
  nothing was served for any of them.

  ## What the numbers mean

  `pools` is a share scored against uniform noise as `noise > share * 2`, so 0.25 wets about half a region and
  anything from 0.5 up wets all of it. A body of 24 cells or more is painted as real water with a shore rim
  (a lake, or a sea where it runs along a map edge); below that it stays a film over the floor, which is what
  a swamp hollow should be.

  `built` is the share of a settlement's PLOTS that carry a building. A park is 0, a market is nearly 0, a
  terrace is 1. Nothing could say so before, which is why a city's neighbourhoods were three names for one
  thing.

  ## What changes

  Wild regions are MERGED, never replaced: the species, formations and leaf tones each one already carries are
  left exactly as they are and only the ground fields are written. Replacing them is how a previous pass
  dropped `leafHue`/`leafValue` from five biomes and took their leaf tones from twenty down to four.

  Settlements gain the regions they never had: a city gets a park, a market and a graveyard beside its three
  wealth tiers, a town gets a green and a market at its own scale, and a village gets commons and garden plots
  rather than one undifferentiated mass of huts.

  Idempotent: merging the same overlay twice writes the same map.
  """
  require Logger

  alias Nebulith.Repo

  # ── the ground each wild region stands on ───────────────────────────────────
  # Merged into whatever that region already says about its trees.
  @wild %{
    "forest_beach" => %{
      # The sea is the map's, painted by the `shore` course. What the BAND adds is the land: wet sand at the
      # water, a dune ridge standing above it, then the ground greening inland.
      "shore" => %{"floor" => "#e8dcc0", "pools" => 0.08},
      "dunes" => %{"floor" => "#dfd0a8", "level" => 1},
      "palms" => %{"floor" => "#cdbf95"},
      "backshore" => %{"floor" => "#b9ad86"},
      "inland" => %{"floor" => "#93a06a", "level" => 1}
    },
    "forest_mountain" => %{
      # The levels were already served. What was missing is that a crag is BROKEN ROCK and a summit is bare.
      "foot" => %{"floor" => "#5f6b4a"},
      "slope" => %{"floor" => "#6b6f55"},
      "treeline" => %{"floor" => "#7a7a68"},
      "crag" => %{"floor" => "#8b8b84", "stone" => 0.16},
      "summit" => %{"floor" => "#b9bcc2", "stone" => 0.3}
    },
    "forest_swamp" => %{
      # The pool shares were right and invisible: with no floor of its own every band read as the same green,
      # so a margin and a bog were one place at two wetnesses.
      "margin" => %{"floor" => "#4a5638"},
      "mire" => %{"floor" => "#414d33"},
      "bog" => %{"floor" => "#39442c"},
      "sink" => %{"floor" => "#333d28"},
      "open_water" => %{"floor" => "#2d3624"}
    },
    "forest_desert" => %{
      # An erg is a sea of DUNES, so it stands above the hardpan. An oasis is water you can see from across
      # the map, which 0.18 never was: at that share it broke into films instead of making one pool.
      "erg" => %{"floor" => "#d9b98a", "level" => 1},
      "hardpan" => %{"floor" => "#b39469"},
      "wadi" => %{"floor" => "#a08a63"},
      "oasis" => %{"floor" => "#6f7a4a", "pools" => 0.34}
    },
    "forest_ruins" => %{
      # The stone was served and the GROUND under it was not, so a heart and a forest wore one floor.
      "heart" => %{"floor" => "#7a7a6a", "level" => 1},
      "courts" => %{"floor" => "#6f7360", "level" => 1},
      "terraces" => %{"floor" => "#666d52"},
      "overgrown" => %{"floor" => "#5c6746"},
      "forest" => %{"floor" => "#4f5c3c"}
    },
    "forest_volcanic" => %{
      # A volcano is something you climb. The floors were already served; the CONE never was, so every ring
      # sat at the same height and there was nothing to approach.
      "crater" => %{"level" => 3, "stone" => 0.22},
      "burnt" => %{"level" => 2},
      "ashfall" => %{"level" => 1},
      "lavaside" => %{"pools" => 0.3}
    },
    "forest_meadow" => %{
      # A bank is the LOW ground beside water and a pasture is the high ground above it. That is the one piece
      # of relief a meadow has, and without it the five regions were one flat field.
      "pasture" => %{"level" => 1},
      "orchard" => %{"level" => 1},
      "bank" => %{"pools" => 0.3}
    },
    "forest_woodland" => %{
      # A lakeside with a lake in it, at a share that makes one body rather than a pepper of films.
      "lakeside" => %{"pools" => 0.32},
      "glade" => %{"level" => 1}
    },
    "forest_jungle" => %{
      "lakeside" => %{"pools" => 0.32}
    }
  }

  # ── the settlement regions ──────────────────────────────────────────────────
  # `built` is the share of plots that carry a building. Everything else is the ground.
  @city_additions [
    %{
      "key" => "park",
      "name" => "Park",
      "weight" => 1,
      "built" => 0.0,
      "canopy" => 1.4,
      "floor" => "#6f7a4a"
    },
    %{
      "key" => "market",
      "name" => "Market",
      "weight" => 1,
      "built" => 0.12,
      "canopy" => 0.1,
      "floor" => "#a89880"
    },
    %{
      "key" => "graveyard",
      "name" => "Graveyard",
      "weight" => 1,
      "built" => 0.04,
      "canopy" => 0.5,
      "stone" => 0.3,
      "floor" => "#6b6f5c"
    }
  ]

  @city_overlay %{
    "upper" => %{"built" => 1.0, "level" => 1, "floor" => "#b9b6a8"},
    "middle" => %{"built" => 1.0, "floor" => "#a8a89c"},
    "lower" => %{"built" => 1.0, "floor" => "#94907f"}
  }

  @town_regions [
    %{
      "key" => "centre",
      "name" => "Centre",
      "weight" => 2,
      "built" => 1.0,
      "canopy" => 0.4,
      "floor" => "#a8a394"
    },
    %{
      "key" => "lanes",
      "name" => "Lanes",
      "weight" => 3,
      "built" => 0.9,
      "canopy" => 0.7,
      "floor" => "#9c9888"
    },
    %{
      "key" => "green",
      "name" => "Green",
      "weight" => 2,
      "built" => 0.0,
      "canopy" => 1.3,
      "floor" => "#6f7a4a"
    },
    %{
      "key" => "market",
      "name" => "Market",
      "weight" => 1,
      "built" => 0.15,
      "canopy" => 0.1,
      "floor" => "#a89880"
    },
    %{
      "key" => "outskirts",
      "name" => "Outskirts",
      "weight" => 2,
      "built" => 0.5,
      "canopy" => 1.1,
      "floor" => "#8a8f6e"
    }
  ]

  @village_regions [
    %{
      "key" => "huts",
      "name" => "Huts",
      "weight" => 4,
      "built" => 1.0,
      "canopy" => 0.5,
      "floor" => "#9a8f72"
    },
    %{
      "key" => "commons",
      "name" => "Commons",
      "weight" => 2,
      "built" => 0.0,
      "canopy" => 0.9,
      "floor" => "#7a8452"
    },
    %{
      "key" => "plots",
      "name" => "Garden plots",
      "weight" => 2,
      "built" => 0.25,
      "canopy" => 0.3,
      "floor" => "#8c8a5e"
    },
    %{
      "key" => "edge",
      "name" => "Edge",
      "weight" => 2,
      "built" => 0.45,
      "canopy" => 1.2,
      "floor" => "#6f7a4a"
    }
  ]

  @picker %{
    "key" => "region",
    "label" => "Region",
    "type" => "choice",
    "group" => "layout",
    "default" => "random"
  }

  def run do
    wild = Enum.sum(for {key, overlay} <- @wild, do: merge_regions(key, overlay))
    cities = Enum.sum(for key <- keys_like("city"), do: build_city(key))
    towns = Enum.sum(for key <- keys_like("town"), do: set_regions(key, @town_regions))
    villages = Enum.sum(for key <- keys_like("village"), do: set_regions(key, @village_regions))

    # AND THE PICKER, from the same list, in the same run. A region lives in two places: `config.subZones` is
    # the map and the `region` option's `choices` is the dropdown, and a previous pass wrote the first without
    # the second, so the map grew regions nobody could select. Rebuilding it here from what was just written
    # is what keeps the two from drifting: a town and a village had no picker at all, because they had no
    # regions to offer.
    pickers = Enum.sum(for key <- touched(), do: offer_regions(key))

    Logger.info(
      "[data_migrate] map design on #{wild} wild templates, #{cities} cities, #{towns} towns, " <>
        "#{villages} villages, #{pickers} region pickers rebuilt"
    )

    :ok
  end

  defp touched do
    Map.keys(@wild) ++ keys_like("city") ++ keys_like("town") ++ keys_like("village")
  end

  defp offer_regions(key) do
    zones = sub_zones(key)
    if zones == [], do: 0, else: put_picker(key, zones)
  end

  defp put_picker(key, zones) do
    choices =
      [%{"key" => "random", "label" => "Random"}] ++
        for zone <- zones, do: %{"key" => zone["key"], "label" => zone["name"] || zone["key"]}

    %{rows: [[options]]} = Repo.query!("SELECT options FROM generators WHERE key = $1", [key])
    options = options || []
    picker = Map.put(@picker, "choices", choices)

    updated =
      if Enum.any?(options, &(&1["key"] == "region")),
        do:
          Enum.map(options, fn
            %{"key" => "region"} = o -> Map.put(o, "choices", choices)
            other -> other
          end),
        else: options ++ [picker]

    %{num_rows: rows} =
      Repo.query!("UPDATE generators SET options = $2::text::jsonb WHERE key = $1", [
        key,
        Jason.encode!(updated)
      ])

    rows
  end

  # Every generator row whose key is the name itself or starts with "<name>_", so `city`, `city_beach` and
  # `city_medieval` are all caught and `forest_*` never is.
  defp keys_like(name) do
    %{rows: rows} =
      Repo.query!("SELECT key FROM generators WHERE key = $1 OR key LIKE $2", [
        name,
        name <> "\\_%"
      ])

    List.flatten(rows)
  end

  defp sub_zones(key) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) -> zones
      _ -> []
    end
  end

  # MERGE, never replace. A region carries species, formations and leaf tones this migration knows nothing
  # about, and a previous pass that rewrote region sets wholesale dropped `leafHue`/`leafValue` from five
  # biomes without anything failing.
  defp merge_regions(key, overlay) do
    zones = sub_zones(key)

    if zones == [],
      do: 0,
      else: write(key, Enum.map(zones, &Map.merge(&1, Map.get(overlay, &1["key"], %{}))))
  end

  # A city keeps its three wealth tiers, gains the ground they never stated, and gains the three places that
  # make a city somewhere to walk through rather than a grid of houses.
  defp build_city(key) do
    zones = sub_zones(key)
    if zones == [], do: 0, else: write(key, merged_city(zones))
  end

  defp merged_city(zones) do
    kept = Enum.map(zones, &Map.merge(&1, Map.get(@city_overlay, &1["key"], %{})))
    have = MapSet.new(kept, & &1["key"])
    kept ++ Enum.reject(@city_additions, &MapSet.member?(have, &1["key"]))
  end

  # A town and a village had NO regions, so there is nothing to merge and nothing to lose.
  defp set_regions(key, regions) do
    write(key, regions)
  end

  defp write(key, regions) do
    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{subZones}', $2::text::jsonb) WHERE key = $1",
        [key, Jason.encode!(regions)]
      )

    rows
  end
end

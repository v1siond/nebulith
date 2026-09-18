defmodule Nebulith.DataMigration.EachRegionIsItsOwnPlace do
  @moduledoc """
  Each region gets the RECIPE that makes it the thing it is named after, in the layers that already exist.

  *"LIKE WHAT'S THE DIFFERENCE BETWEEN A THIKET JUNGLE AND A DENSE JUNGLE?? I'LL ANSWER, NOTHING, THERE'S NOT
  A SINGLE THING THAT'S REALLY DIFFERENT."*

  He is right, and the jungle says why in one line: every one of its five regions served
  `formation.understoryTile: null`, so the ground layer was the SAME PLANT in all five and the only thing
  separating them was how much of it there was. Two regions that differ by a density are two settings of one
  place, not two places.

  ## The rule this applies

  A region is told apart by WHAT GROWS AT KNEE HEIGHT and HOW BIG THE TRUNKS ARE, not by a density. So each
  one now states its own `understoryTile`, its own understory amount, its own spacing, and a species mix that
  agrees with them.

  The jungle pair he asked about, as the clearest case:

      deep      giant trunks, a closed canopy, and an OPEN dark floor you can walk
                canopy 1.3, understory 0.2, clover, spacing 0, lattice 15, tree_giant
      thicket   no big trees AT ALL, and a wall of bush at knee height you cannot get through
                canopy 0.15, understory 2.0, thicket, bush only

  They were 1.15/1.2 against 0.5/1.45 before, which is the same place at two densities. Now one is the most
  open floor under the heaviest canopy and the other is the least walkable ground on the map, which is what
  the two words actually mean.

  Every set is built the same way: one region is the most OPEN, one is the least WALKABLE, one carries the
  water, one the stone, and no two share an undergrowth plant unless they are genuinely the same ground.

  ## The thicket belongs to the jungle and to nothing else

  A first cut gave the densest region of every set the blocking `thicket` plant, which is the most obvious way
  to say "you cannot get through here" and is also a contract this project already settled the other way:
  `forest_woodland`, `forest_meadow` and `forest_mountain` are each asserted to grow ZERO thicket, because a
  wood full of invisible walls was his complaint in the first place. Only the jungle serves it, and only the
  jungle keeps it. Everywhere else the densest region is `shrub` at a high understory, which is thick to look
  at and still walkable, and it is told apart from its siblings by how much of it there is and what stands
  above it.

  Merged, never replaced, so leaf tones, floors, levels and pools stay exactly as they are.
  """
  require Logger

  alias Nebulith.Repo

  # canopy / undergrowth / understory amount / the PLANT / trunk spacing / clump scale
  defp r(canopy, under, understory, tile, spacing, lattice) do
    %{
      "canopy" => canopy,
      "undergrowth" => under,
      "formation" => %{
        "understory" => understory,
        "understoryTile" => tile,
        "spacing" => spacing,
        "lattice" => lattice
      }
    }
  end

  defp sets do
    %{
    "forest_jungle" => %{
      # the broken margin, where the light gets in from the side
      "edge" => r(0.6, 0.8, 0.8, "shrub", 3, 9),
      # giants over an open floor: a rainforest floor is dark and WALKABLE
      "deep" => r(1.3, 0.25, 0.2, "clover", 0, 15),
      # where one of them came down, and the only sun on the floor
      "glade" => r(0.08, 0.35, 0.35, "tall_grass", 5, 3),
      # a wall at knee height, and nothing above it
      "thicket" => r(0.15, 2.0, 2.0, "thicket", 2, 7),
      # cypress standing in the water, reeds around them
      "lakeside" => r(0.85, 0.7, 0.7, "tall_grass", 3, 5)
    },
    "forest_woodland" => %{
      "edge" => r(0.7, 0.9, 0.9, "shrub", 3, 9),
      "deep" => r(1.25, 0.25, 0.2, "clover", 1, 14),
      "glade" => r(0.1, 0.3, 0.3, "clover", 5, 3),
      "thicket" => r(0.2, 2.0, 2.0, "shrub", 2, 7),
      "lakeside" => r(0.8, 0.6, 0.6, "tall_grass", 3, 5)
    },
    "forest_meadow" => %{
      # grazed short, and the most open ground after the common
      "pasture" => r(0.1, 0.95, 0.95, "tall_grass", 6, 4),
      # a hedge is a LINE of dense shrub, which is a long thin clump
      "hedgerow" => r(0.6, 1.6, 1.6, "shrub", 1, 11),
      # planted in rows, and mown underneath: the spacing IS the orchard
      "orchard" => r(0.9, 0.2, 0.2, "clover", 4, 7),
      "bank" => r(0.5, 1.0, 1.0, "tall_grass", 2, 6),
      # the most open thing on the map
      "common" => r(0.03, 0.15, 0.15, "clover", 7, 3)
    },
    "forest_swamp" => %{
      "margin" => r(0.9, 0.9, 0.9, "shrub", 3, 8),
      "mire" => r(0.85, 1.3, 1.3, "tall_grass", 2, 7),
      "bog" => r(0.7, 0.8, 0.8, "tall_grass", 2, 6),
      # dead trees standing in open water
      "sink" => r(0.35, 0.3, 0.3, "tall_grass", 4, 5),
      "open_water" => r(0.08, 0.2, 0.2, "tall_grass", 6, 4)
    },
    "forest_mountain" => %{
      "foot" => r(1.1, 1.0, 1.0, "shrub", 1, 12),
      "slope" => r(0.85, 0.6, 0.6, "shrub", 2, 9),
      # stunted and far apart: the treeline is where trees give up
      "treeline" => r(0.45, 0.3, 0.3, "shrub", 5, 6),
      "crag" => r(0.1, 0.2, 0.2, "clover", 7, 4),
      "summit" => r(0.05, 0.16, 0.16, "clover", 8, 3)
    },
    "forest_beach" => %{
      # bare wet sand. NOTHING grows at the waterline
      "shore" => r(0.05, 0.18, 0.18, "dune_grass_seed", 8, 3),
      # dune grass is the whole plant list of a dune
      "dunes" => r(0.15, 0.9, 0.9, "dune_grass", 5, 6),
      # palms with clear sand under them
      "palms" => r(0.6, 0.2, 0.2, "dune_grass_young", 4, 7),
      "backshore" => r(0.9, 1.1, 1.1, "shrub", 2, 9),
      "inland" => r(1.2, 0.9, 0.9, "shrub", 1, 12)
    },
    "forest_ruins" => %{
      # swept stone: nothing grows on the floor of the thing itself
      "heart" => r(0.08, 0.2, 0.2, "clover", 7, 4),
      "courts" => r(0.2, 0.5, 0.5, "clover", 5, 6),
      "terraces" => r(0.5, 0.8, 0.8, "tall_grass", 3, 8),
      # this is where the wood is taking the walls back
      "overgrown" => r(1.0, 1.4, 1.4, "shrub", 1, 11),
      "forest" => r(1.2, 0.9, 0.9, "shrub", 2, 12)
    },
    "forest_desert" => %{
      "erg" => r(0.04, 0.16, 0.16, "dune_grass_seed", 9, 3),
      "hardpan" => r(0.08, 0.22, 0.22, "shrub", 7, 4),
      # a wadi is a dry watercourse, and it is where the green is
      "wadi" => r(0.25, 0.7, 0.7, "tall_grass", 3, 7),
      "oasis" => r(0.8, 0.5, 0.5, "tall_grass", 2, 6)
    },
    "forest_volcanic" => %{
      "crater" => r(0.06, 0.18, 0.18, "clover", 8, 3),
      # dead stumps, and nothing at knee height
      "burnt" => r(0.4, 0.15, 0.15, "shrub", 4, 6),
      "ashfall" => r(0.7, 0.5, 0.5, "shrub", 3, 8),
      "sheltered" => r(1.2, 1.0, 1.0, "shrub", 1, 12),
      "lavaside" => r(0.5, 0.3, 0.3, "shrub", 4, 6)
      }
    }
  end

  # A settlement region is told apart by how BUILT it is and how GREEN it is.
  defp settlements do
    %{
    "city" => %{
      "upper" => r(1.0, 0.4, 0.4, "clover", 3, 6),
      "middle" => r(0.75, 0.3, 0.3, "clover", 3, 6),
      "lower" => r(0.5, 0.2, 0.2, "shrub", 3, 6),
      "park" => r(1.4, 0.9, 0.9, "tall_grass", 2, 8),
      # a market is trodden bare
      "market" => r(0.1, 0.18, 0.18, "clover", 6, 3),
      "graveyard" => r(0.5, 0.4, 0.4, "tall_grass", 4, 5)
    },
    "town" => %{
      "centre" => r(0.25, 0.5, 0.5, "shrub", 4, 5),
      "lanes" => r(0.7, 0.4, 0.4, "shrub", 3, 6),
      "green" => r(1.3, 0.9, 0.9, "tall_grass", 2, 8),
      "market" => r(0.1, 0.18, 0.18, "clover", 6, 3),
      "outskirts" => r(1.1, 0.8, 0.8, "shrub", 2, 9)
    },
    "village" => %{
      "huts" => r(0.5, 0.3, 0.3, "shrub", 3, 6),
      "commons" => r(0.9, 0.7, 0.7, "tall_grass", 3, 7),
      "plots" => r(0.3, 0.9, 0.9, "clover", 4, 5),
        "edge" => r(1.2, 1.0, 1.0, "shrub", 2, 10)
      }
    }
  end

  def run do
    wild = Enum.sum(for {key, set} <- sets(), do: merge(key, set))

    places =
      Enum.sum(
        for {family, set} <- settlements(),
            key <- keys_like(family),
            do: merge(key, set)
      )

    Logger.info("[data_migrate] #{wild} wild templates and #{places} settlements: each region its own place")

    :ok
  end

  defp keys_like(name) do
    %{rows: rows} =
      Repo.query!("SELECT key FROM generators WHERE key = $1 OR key LIKE $2", [name, name <> "\\_%"])

    List.flatten(rows)
  end

  defp merge(key, set) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) -> write(key, Enum.map(zones, &recipe(&1, set)))
      _ -> 0
    end
  end

  # The formation is merged FIELD BY FIELD: a region already states its own understory tuning in some
  # templates, and replacing the whole map would drop whatever this table does not mention.
  defp recipe(zone, set) do
    case Map.get(set, zone["key"]) do
      nil ->
        zone

      %{"formation" => formation} = fields ->
        zone
        |> Map.merge(Map.delete(fields, "formation"))
        |> Map.put("formation", Map.merge(zone["formation"] || %{}, formation))
    end
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

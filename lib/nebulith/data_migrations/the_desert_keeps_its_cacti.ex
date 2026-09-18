defmodule Nebulith.DataMigration.TheDesertKeepsItsCacti do
  @moduledoc """
  Put the cactus back in the desert. It vanished, and nothing in the data looked wrong.

  ## How it was lost

  Three migrations, in registration order:

    122  `NoTwoCactiAlike`        wrote seven cactus forms into the desert's regions, which at that
                                  point were named deep / edge / glade / thicket / lakeside
    130  `EveryBiomeItsOwnRegions` renamed the desert's regions to erg / hardpan / wadi / oasis
    139  `TheSpeciesARegionLost`   filled those new names with bushes and saplings

  The rename at 130 orphaned every cactus list 122 had written, because they were keyed to region
  names the desert no longer had. 139 then filled the new names without them and made it permanent.

  Nothing looked broken from the data: the desert's TOP-LEVEL `trees` still advertises six cactus
  species carrying 72 of its 120 weight. It is simply never read, because the region's own list wins.
  A served value that changes nothing, because something downstream is a share of what is left.

  ## What this writes

  122's intent, remapped onto the regions that actually exist, region by region:

      erg       the sand sea, the harshest ground   <- its "deep": the old giants and the dead wood
      hardpan   stony flat, low and spiny           <- its "glade" + "thicket": barrels and pads
      wadi      a dry watercourse, water sometimes  <- its "edge": hardy trees with cactus between
      oasis     watered, the one green place        <- its "lakeside": palms, with prickly at the rim

  Beach is deliberately NOT touched. Checked every migration: no beach region has ever been served a
  cactus. The cactus art does carry a beach TINT, which is a colour for one drawn there, not a species
  list that would place one.
  """
  require Logger

  alias Nebulith.Repo

  @regions %{
    "erg" => [
      %{"kind" => "cactus_saguaro", "weight" => 22},
      %{"kind" => "cactus_saguaro_young", "weight" => 20},
      %{"kind" => "tree_dead", "weight" => 18},
      %{"kind" => "cactus_saguaro_old", "weight" => 14},
      %{"kind" => "cactus_barrel", "weight" => 14},
      %{"kind" => "cactus_saguaro_one", "weight" => 12}
    ],
    "hardpan" => [
      %{"kind" => "cactus_barrel", "weight" => 24},
      %{"kind" => "cactus_prickly", "weight" => 22},
      %{"kind" => "cactus_barrel_pair", "weight" => 18},
      %{"kind" => "cactus_prickly_tall", "weight" => 16},
      %{"kind" => "tree_stub", "weight" => 12},
      %{"kind" => "bush_round", "weight" => 8}
    ],
    "wadi" => [
      %{"kind" => "tree_encina", "weight" => 22},
      %{"kind" => "tree_gnarled", "weight" => 20},
      %{"kind" => "cactus_prickly_tall", "weight" => 16},
      %{"kind" => "cactus_saguaro_young", "weight" => 16},
      %{"kind" => "bush_round", "weight" => 14},
      %{"kind" => "cactus_barrel_pair", "weight" => 12}
    ],
    "oasis" => [
      %{"kind" => "tree_palm", "weight" => 38},
      %{"kind" => "tree_coconut", "weight" => 26},
      %{"kind" => "tree_encina", "weight" => 18},
      %{"kind" => "cactus_prickly", "weight" => 12},
      %{"kind" => "bush_round", "weight" => 10}
    ]
  }

  # Every desert template that has regions. The city variants already kept their cacti, they were
  # never renamed; this is the wilderness one, and the settlements for when they gain regions.
  @desert_keys ~w(forest_desert)

  def run do
    rows = Enum.sum(for key <- @desert_keys, do: give(key))
    Logger.info("[data_migrate] #{rows} desert templates grow cacti in their own regions again")
    :ok
  end

  # Read the regions, swap the `trees` of the ones named here, write them back. Matching on the
  # region's own key rather than its position means a reorder or a rename cannot silently miss.
  defp give(key) do
    case regions_of(key) do
      nil -> 0
      regions -> write(key, Enum.map(regions, &replant/1))
    end
  end

  defp replant(%{"key" => region} = z) do
    case Map.fetch(@regions, region) do
      {:ok, trees} -> Map.put(z, "trees", trees)
      :error -> z
    end
  end

  defp replant(z), do: z

  defp regions_of(key) do
    %{rows: rows} =
      Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[regions]] when is_list(regions) -> regions
      _other -> nil
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

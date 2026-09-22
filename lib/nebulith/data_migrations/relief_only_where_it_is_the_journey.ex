defmodule Nebulith.DataMigration.ReliefOnlyWhereItIsTheJourney do
  @moduledoc """
  A region stands above the rest of the map only where the CLIMB is the point of the set.

  *"looks like you implemented some type of rough elevation through cells usage, but that wasn't part of the
  requirements either, that said, don't remove it, we'll improve it."*

  It stays, and it is narrowed to where it means something. A first cut also raised a woodland's `glade`, a
  meadow's `pasture` and `orchard`, and a city's `upper`, and none of those is a climb: what they are is a
  step in the middle of flat ground, and a river crossing one comes out with a bank at the water's own level
  on the low side. Measured: `forest_woodland`, `forest_meadow` and `city_futuristic` each broke the contract
  that says the ground beside a channel stands above it.

  Kept, because in these the relief IS the region set:

      mountain   foot 0 to summit 4, which is the whole template
      volcanic   sheltered 0 up to the crater at 3, the approach to the cone
      ruins      the heart and its courts on their platform
      beach      the dune ridge and the ground inland standing over the shore
      desert     the erg's dunes standing over the hardpan

  Idempotent: drops the same four keys each run.
  """
  require Logger

  alias Nebulith.Repo

  @drop %{
    "forest_woodland" => ["glade"],
    "forest_meadow" => ["pasture", "orchard"]
  }

  def run do
    wild = Enum.sum(for {key, regions} <- @drop, do: flatten(key, regions))
    cities = Enum.sum(for key <- city_keys(), do: flatten(key, ["upper"]))

    Logger.info(
      "[data_migrate] relief narrowed to the climbs: #{wild} wild templates, #{cities} cities"
    )

    :ok
  end

  defp city_keys do
    %{rows: rows} =
      Repo.query!("SELECT key FROM generators WHERE key = $1 OR key LIKE $2", ["city", "city\\_%"])

    List.flatten(rows)
  end

  defp flatten(key, regions) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) ->
        write(key, Enum.map(zones, &drop_level(&1, regions)))

      _ ->
        0
    end
  end

  # A region on the list loses its authored level and takes the terrain's; every other one keeps what
  # it had.
  defp drop_level(zone, regions) do
    case zone["key"] in regions do
      true -> Map.delete(zone, "level")
      false -> zone
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

defmodule Nebulith.DataMigration.ARegionsWaterIsTheMapsWater do
  @moduledoc """
  A region's water is the map's water: less of it, and none where the map already has a sea.

  *"why aren't we using the same water layer we already use for everything else???"*, and on a beach with the
  `shore` region picked: *"i pick shore and the beach is stupid, like we already have a beach, why are you
  usiong that ugly green water????"*

  Three separate mistakes, and the shares here are two of them.

  ## Too much of it

  The share is scored as `noise > share * 2`, so 0.32 wets about two thirds of a region, not a third. Measured
  on a jungle with `lakeside` picked: the lake covered most of the map. A `lakeside` is a wood BESIDE a lake,
  so the lake is a feature in it, not the region itself. Halved across the board.

  ## A beach's water is the SEA

  The beach's `shore` was given a small pool share for tide pools. With a beach's own sea switched off, what
  it produced was one rectangular pond sitting on the sand, which is the screenshot. *"we already have a
  beach"* is exactly right: a beach's water is the `shore` COURSE, which these templates already default to.
  The region's job is the sand, so it states no water at all now.

  ## And a crag is not a ruin

  `stone` means FALLEN MASONRY: the engine stamps a stone platform with columns around its edge, which is why
  a mountain summit came out wearing rows of boxes. Bare mountain rock is not masonry, and the mountain should
  never have been given the field.

  Idempotent: sets the same numbers and drops the same keys each run.
  """
  require Logger

  alias Nebulith.Repo

  # {generator, region} => the new pool share. Halved, because the share wets twice what it reads as.
  @shares %{
    "forest_woodland" => %{"lakeside" => %{"pools" => 0.22}},
    "forest_jungle" => %{"lakeside" => %{"pools" => 0.22}},
    "forest_meadow" => %{"bank" => %{"pools" => 0.22}},
    "forest_desert" => %{"oasis" => %{"pools" => 0.22}},
    "forest_volcanic" => %{"lavaside" => %{"pools" => 0.21}}
  }

  # {generator, region} => the fields that should never have been served for it.
  @drop %{
    "forest_beach" => %{"shore" => ["pools"]},
    "forest_mountain" => %{"crag" => ["stone"], "summit" => ["stone"]}
  }

  def run do
    changed =
      for key <- Map.keys(@shares) ++ Map.keys(@drop), reduce: 0 do
        acc -> acc + rewrite(key)
      end

    Logger.info("[data_migrate] #{changed} templates: a region's water is the map's water, and less of it")

    :ok
  end

  defp rewrite(key) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) -> write(key, Enum.map(zones, &apply_to(key, &1)))
      _ -> 0
    end
  end

  defp apply_to(generator, zone) do
    region = zone["key"]

    zone
    |> Map.merge(@shares |> Map.get(generator, %{}) |> Map.get(region, %{}))
    |> Map.drop(@drop |> Map.get(generator, %{}) |> Map.get(region, []))
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

defmodule Nebulith.DataMigration.TheHeartAloneStandsOnItsPlatform do
  @moduledoc """
  A ruin's `heart` and its `courts` were the same place at two settings: masonry 0.6 against 0.42 and both
  standing a level above the rest, which measured as 52% stone against 48% and read identically.

  The heart is the building itself, so it alone keeps the platform, and the courts fall back to the ground
  around it with noticeably less of the stone left standing. That is also what the two words mean.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{rows: [[zones]]} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = 'forest_ruins'", [])

    updated =
      Enum.map(zones, fn
        %{"key" => "courts"} = z -> z |> Map.put("stone", 0.26) |> Map.delete("level")
        %{"key" => "heart"} = z -> Map.put(z, "stone", 0.62)
        z -> z
      end)

    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{subZones}', $1::text::jsonb) WHERE key = 'forest_ruins'",
        [Jason.encode!(updated)]
      )

    Logger.info("[data_migrate] #{rows} ruin: the heart alone stands on its platform")
    :ok
  end
end

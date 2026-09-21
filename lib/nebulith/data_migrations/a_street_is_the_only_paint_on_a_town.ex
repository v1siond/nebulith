defmodule Nebulith.DataMigration.AStreetIsTheOnlyPaintOnATown do
  @moduledoc """
  A settlement's neighbourhoods keep their character and give back their floor TONE.

  A region's `floor` colours every cell of it, and in a settlement that collides with the one thing the floor
  colour already meant: a street. The count of streets a town paints is read as the rows and columns that
  carry a colour all the way across, which was exact while the street was the only thing colouring a floor.
  Measured after the neighbourhoods got tones: a town asked for ONE street painted two.

  A neighbourhood does not need the tone. It is told apart by how much of it is BUILT, by how green it is,
  and by the plant growing at knee height, all of which it states and all of which are measured per region.
  The wilderness keeps its floors, where nothing counts streets.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    rows = Enum.sum(for key <- settlement_keys(), do: strip(key))

    Logger.info(
      "[data_migrate] #{rows} settlements: the street is the only paint that crosses them"
    )

    :ok
  end

  defp settlement_keys do
    %{rows: rows} =
      Repo.query!("""
      SELECT key FROM generators
      WHERE key IN ('city', 'town', 'village')
         OR key LIKE 'city\\_%' OR key LIKE 'town\\_%' OR key LIKE 'village\\_%'
      """)

    List.flatten(rows)
  end

  defp strip(key) do
    %{rows: rows} = Repo.query!("SELECT config->'subZones' FROM generators WHERE key = $1", [key])

    case rows do
      [[zones]] when is_list(zones) -> write(key, Enum.map(zones, &Map.delete(&1, "floor")))
      _ -> 0
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

defmodule Nebulith.DataMigration.TheGroundAPlaceIsMadeOf do
  @moduledoc """
  A biome says which TILE its open ground is made of, not just what colour it is.

  *"town, village, city and reglar forest desert all show the same colors as before"*.

  Two things were wrong and the colour was only one of them. The other: the ground TILE came from the SEASON
  (`zonePalette(zone).groundTypes[0]`), so a desert city was paved in spring meadow grass. Measured: 749
  cells of `#a4ac48`, the `meadow` tile's own colour, on a desert city.

  The ground a place is MADE of is a fact about the place. The season is what colour it happens to be today.

  Only the three where the season's grass is plainly wrong are served here. Woodland, Jungle, Meadow,
  Mountain, Swamp and Ruins keep the season's tile on purpose, because grass IS what they are made of and
  changing them would be a change nobody asked for.

  Idempotent: sets a stated tile by name, settlements included.
  """
  require Logger

  alias Nebulith.Repo

  @ground %{"Desert" => "sand", "Beach" => "beach-sand", "Volcanic" => "ash"}

  def run do
    rows =
      for {name, tile} <- @ground, reduce: 0 do
        acc ->
          %{num_rows: n} =
            Repo.query!(
              """
              UPDATE generators
              SET config = jsonb_set(config, '{palette,groundTile}', $2::text::jsonb)
              WHERE (name = $1 OR name LIKE $1 || ' %') AND config->'palette' IS NOT NULL
              """,
              [name, Jason.encode!(tile)]
            )

          acc + n
      end

    Logger.info("[data_migrate] #{rows} generators state the ground they are made of")

    :ok
  end
end

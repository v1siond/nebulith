defmodule Nebulith.DataMigration.GrassIsASingleTileToo do
  @moduledoc """
  The grass a person walks through draws as ONE tile, not as a block.

  *"all the grass should be of type single too"* (Image #150: tall grass tiling edge to edge across the
  cells, which reads as wallpaper rather than as grass standing in a field).

  Same rule he gave for the ornaments: *"we don't really want to render ornaments as blocks, we want to use
  the single tile setting, like we do with flowers"*. `bush`, `shrub` and `thicket` were fixed then.
  `tall_grass`, `grass_tall`, `clover` and `wheat` were missed and still drew as blocks.

  ## The line this draws, and it matters

  A GRASS PLANT is a thing standing in a cell: `tall_grass` and `grass_tall` are what `scatterTallGrass` and
  the understory place, and `clover` and `wheat` are scattered the same way. Those get `display: single` and
  `transparent`, so each is one centred picture with no cube around it.

  THE GROUND ITSELF is not touched: `grass`, `grass-field`, `dark-grass`, `dead_grass` and `tropical_grass`
  are floor slugs, the surface a cell is made of. A floor is meant to fill its cell edge to edge, and making
  it a billboard would punch holes in the map.

  Idempotent: merges the two settings.
  """
  require Logger

  alias Nebulith.Repo

  # The grass and ground-cover PLANTS. Every one of these is placed as a prop standing in a cell.
  @plants ~w(tall_grass grass_tall clover wheat)

  def run do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
        SET settings = COALESCE(settings, '{}'::jsonb) || '{"display": "single", "transparent": true}'::jsonb
        WHERE label = ANY($1)
        """,
        [@plants]
      )

    Logger.info("[data_migrate] #{rows} grass and ground-cover tiles draw as a single tile")

    :ok
  end
end

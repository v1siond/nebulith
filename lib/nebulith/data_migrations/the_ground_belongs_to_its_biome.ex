defmodule Nebulith.DataMigration.TheGroundBelongsToItsBiome do
  @moduledoc """
  The floor of a map is the colour that place actually is.

  *"the ground is green. That's the floor palette, where Beach and Desert still share #7c8a4e"*, and his
  answer: *"fix it"*.

  ## What was served, measured off `/api/generators`

      Beach == Desert              #7c8a4e   hue 74d, an olive GREEN
      Jungle == Swamp == Ruins     #2f4a2a   hue 111d
      Woodland == Mountain         #6f7f4a   hue 78d

  A desert's ground was a green olive, byte-identical to a beach's. The same shared-pairs defect the canopy
  had, and the undergrowth after it, one layer further down.

  ## Where these colours come from

  `TERRAIN.md`, written before this and grounded by sampling GROUND pixels off his own reference photos
  (warm hues plus anything desaturated and bright, excluding vegetation and sky):

      desert-simpson-australia   74% of the frame, hue 23d, sat 0.48   red-orange sand
      desert-plants              hue 4d, sat 0.39                      pale red sand
      beach, both references     sat 0.13, val 0.69 to 0.79            pale and near NEUTRAL
      mountain-california        sat 0.16, val 0.52                    grey rock

  Two readings are deliberately not used as hues and the doc says so: at saturation 0.13 a hue is
  meaningless, so beach is "pale and bright" and nothing more, and the jungle sample came back as sky haze
  between leaves rather than ground, so the jungle floor is reasoned from leaf litter and marked as reasoned.

  Value is held inside a band the tile art can carry, because the tint moves the HUE and the art carries the
  tone (`colour-tints-luminance-stays`).

  ## What is deliberately untouched

  **Woodland**, because it is the one he has already approved and it is the reference the others are placed
  against. **Meadow**, which serves no floor on purpose and paints a season gradient instead. **Volcanic**,
  which already has its own ash. **Every region's own `floor`**, which still wins over the biome.

  Idempotent: sets stated values by name.
  """
  require Logger

  alias Nebulith.Repo

  # {floor, floorAlt, litter}
  @ground %{
    # the strongest signal in the reference set, 74 percent of one frame: red-orange sand
    "Desert" => {"#9e765f", "#b88863", "#c9a077"},
    # pale and BRIGHT is the whole character of a beach, and the hue barely matters at this saturation
    "Beach" => {"#bdaf93", "#d6cdb4", "#e8dcc2"},
    # bare stone, and it thins toward stone with altitude
    "Mountain" => {"#757263", "#8f8c7c", "#9a9384"},
    # reasoned rather than measured: dark wet leaf litter under a closed canopy
    "Jungle" => {"#354228", "#425434", "#4a4630"},
    # the darkest floor in the set. a swamp reads as murk, not as green
    "Swamp" => {"#323825", "#414a34", "#454328"},
    # stone showing through growth
    "Ruins" => {"#5c6652", "#6f7a66", "#6b6a52"}
  }

  def run do
    rows = Enum.sum(for {name, tones} <- @ground, do: paint(name, tones))
    Logger.info("[data_migrate] #{rows} generators stand on their own ground")
    :ok
  end

  # The settlements too, by name prefix: a desert town stands on the desert.
  defp paint(name, {floor, alt, litter}) do
    patch = %{"floor" => floor, "floorAlt" => alt, "litter" => litter}

    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette}', COALESCE(config->'palette', '{}'::jsonb) || $2::text::jsonb)
        WHERE (name = $1 OR name LIKE $1 || ' %') AND config->'palette' IS NOT NULL
        """,
        [name, Jason.encode!(patch)]
      )

    rows
  end
end

defmodule Nebulith.DataMigration.OneWaterColour do
  @moduledoc """
  All three water bands wear ONE surface colour.

  The bands carried their own tints (`water_deep` #1144aa, `water_shallow` #4488dd) left over from the
  per-depth shading that was reversed. A map only looked uniform because `settleWaterDepth` overwrites every
  wet cell with the template's served water colour, so wherever a template serves none, the deep band showed
  through as a dark navy patch in the middle of an otherwise even river.

  The band still decides the LABEL and what you can wade through. It no longer decides a colour.

  Idempotent: one fixed colour merged into the settings map.
  """
  require Logger

  alias Nebulith.Repo

  @bands ~w(water_shallow water_deep)

  def run do
    %{num_rows: count} =
      Repo.query!(
        """
        UPDATE tiles
           SET settings = COALESCE(settings, '{}'::jsonb) || '{"color": "#4f93b3"}'::jsonb
         WHERE label = ANY($1)
        """,
        [@bands]
      )

    Logger.info("[data_migrate] one water colour across the bands (#{count} rows)")
    :ok
  end
end

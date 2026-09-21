defmodule Nebulith.DataMigration.TwoBiomesOutOfOrder do
  @moduledoc """
  Meadow and mountain wear the hue their own reference gives them.

  `docs/references/SOURCES.md` measured six real vegetation photographs and recorded the rule for using them:
  *"Use the HUE relationships and the RELATIVE ordering, never the absolute value"*, because a photo's numbers
  carry that scene's lighting.

  ## Measured, against `/api/generators`

      biome      served hue   reference   
      desert     44           30-40       
      beach      58           51-63       
      jungle     78           74          
      meadow     81           40          41 degrees off
      mountain   68           52          16 degrees off

  Read as an ORDERING it is worse than the individual errors look. The references rank the five
  `desert <= meadow < mountain ~ beach < jungle`, and the engine served meadow as the HIGHEST hue of all five
  and mountain above beach. Meadow being the greenest biome on the map is the exact inversion of what its
  photograph shows, and of *"more mix of colors, due to flowers, they even have trees that are orange, pink,
  more varied"*: the meadow reference is the most YELLOW of the set and carries the highest saturation of any
  of them, 0.67, which is the measured form of "more varied".

  ## What changes, and what deliberately does not

  Hue and saturation only. Value stays at 0.55 on both, because a tint moves the HUE and the ART carries the
  tone, and every biome already sits at one value for exactly that reason. `leafSeasonality` and `leafValue`
  are untouched: they are the other two axes and neither is what was measured wrong.

      meadow    #728c43 -> #8c7835    hue 81 -> 46, saturation 0.52 -> 0.62, now the highest served
      mountain  #868c5d -> #8c875a    hue 68 -> 54, saturation 0.34 -> 0.36, now the lowest served

  The placement is by RANK, not by copying the photograph's number: meadow lands just above desert and
  mountain just below beach, which is where the references put them, and the served order comes out
  `desert 44, meadow 46, mountain 54, beach 58, jungle 78` against the reference order exactly.

  Applies to every generator of both biomes, the wild one and its village, town and city, which is the same
  sweep `ATownGrowsWhatSurroundsIt` made: a town in a meadow is in the meadow.

  Idempotent: sets an absolute colour rather than shifting the one it finds.
  """
  require Logger

  alias Nebulith.Repo

  @leaf %{"meadow" => "#8c7835", "mountain" => "#8c875a"}

  def run do
    rows =
      for {biome, leaf} <- @leaf, reduce: 0 do
        acc -> acc + repaint(biome, leaf)
      end

    Logger.info("[data_migrate] #{rows} generators wear the leaf hue their reference gives them")

    :ok
  end

  # MATCH ON `key`, NOT ON `name`. `name` is what a person reads in the picker, "Meadow city", and `key` is the
  # identifier, "city_meadow". Written against `name` this matched nothing at all and still reported success,
  # which is why the API gets read back rather than the migration being believed.
  defp repaint(biome, leaf) do
    # `$2::text::jsonb`, never `$2::jsonb`: typed as jsonb straight off, Postgrex encodes the Elixir string as
    # a JSON string SCALAR, so the write lands as a quoted string instead of a value and the UPDATE reports
    # rows while changing nothing.
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette,leaf}', $2::text::jsonb)
        WHERE key LIKE $1 AND config->'palette'->>'leaf' IS NOT NULL
        """,
        ["%\\_" <> biome, Jason.encode!(leaf)]
      )

    rows
  end
end

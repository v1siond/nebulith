defmodule Nebulith.DataMigration.AForestWearsItsOwnRegion do
  @moduledoc """
  Foliage colour per BIOME, per REGION and per SEASON, measured off his own references.

  *"add more tree variants with colors per biome, per region, per season"*, and before that *"i want colors
  that follow every single distinct type of forest and region, exactly how the references from real life I
  shared"*.

  ## What was actually wrong, measured, not asserted

  Nine wild generators shared FOUR canopy colour pairs between them, and the settlements served none at all:

      Woodland  == Mountain              #5d7340
      Jungle    == Ruins == Swamp        #2e6b32
      Beach     == Desert                #4f9147
      every city / town / village        nil

  Against the vegetation references (`docs/references/SOURCES.md`), sampling only vegetation pixels:

      jungle    served 124d,  reference  74d   ->  50d too far toward pure green
      mountain  served  86d,  reference  52d   ->  34d off, far too bright
      desert    served 114d,  reference  30-40d -> a GREEN where every reference is olive and ochre
      beach     served 114d,  reference  51-63d -> the same green as desert, byte-identical

  Not one real vegetation photo in the set sits above 74 degrees. The engine served 86 to 124 everywhere,
  which is why every biome read as the same plastic green.

  ## The three fields, and why colour is not simply replaced

  `palette.canopy` is NOT touched: it is read in exactly one place, as the floor tint for a jungle light gap,
  and it was never a tree colour at all. Trees get their own axis.

    * `palette.leaf` carries the biome's HUE and SATURATION. Its own value is ignored.
    * `leafSeasonality` is how much the season moves that hue. 1 is fully deciduous, 0 evergreen.
    * `leafValue` scales the season shade's brightness. Value separated the references more than hue did.

  The four shades a season already serves on `leaf_center` stay exactly as they are, and a tree's `variant`
  still picks between them. That per-tree variance is what an earlier attempt destroyed by stamping one flat
  green per map: *"none of the trees is different color or different tone"*. The biome BENDS those four, it
  does not replace them.

  **Seasonality is the fact that makes this correct rather than merely colourful.** An autumn woodland turns
  orange; an autumn jungle does not, because it is evergreen. Hue alone would erase one or the other.

  Woodland is authored at seasonality 1 and value 1, which returns the season shade untouched, so the biome
  he already approved renders byte-identical and only the ones that measured wrong move.

  ## Regions

  A sub-zone shifts its biome slightly, by how much light reaches it. Small on purpose: a glade is the same
  wood in better light, not another biome.

  Idempotent: every write is keyed by name and sets the same values again.
  """
  require Logger

  alias Nebulith.Repo

  # hue and saturation from the measured references, at a neutral value the frontend does not read.
  @foliage %{
    "Woodland" => %{"leaf" => "#6a8c51", "leafSeasonality" => 1.0, "leafValue" => 1.0},
    "Meadow" => %{"leaf" => "#728c43", "leafSeasonality" => 0.95, "leafValue" => 1.02},
    "Mountain" => %{"leaf" => "#868c5d", "leafSeasonality" => 0.4, "leafValue" => 0.86},
    "Jungle" => %{"leaf" => "#748c3b", "leafSeasonality" => 0.05, "leafValue" => 0.8},
    "Swamp" => %{"leaf" => "#848c4f", "leafSeasonality" => 0.15, "leafValue" => 0.76},
    "Ruins" => %{"leaf" => "#758c5a", "leafSeasonality" => 0.8, "leafValue" => 0.94},
    "Beach" => %{"leaf" => "#8c8943", "leafSeasonality" => 0.2, "leafValue" => 1.12},
    "Desert" => %{"leaf" => "#8c7c4f", "leafSeasonality" => 0.1, "leafValue" => 1.0},
    "Volcanic" => %{"leaf" => "#8c8076", "leafSeasonality" => 0.0, "leafValue" => 0.55}
  }

  # How much light a region gets, as a hue rotation and a brightness offset. A glade is the ABSENCE of
  # canopy, so it takes the most; a deep wood is closed over and takes the least.
  @regions %{
    "glade" => %{"leafHue" => 4, "leafValue" => 0.1},
    "edge" => %{"leafHue" => 2, "leafValue" => 0.05},
    "deep" => %{"leafHue" => -4, "leafValue" => -0.08},
    "thicket" => %{"leafHue" => -2, "leafValue" => -0.04},
    "lakeside" => %{"leafHue" => -6, "leafValue" => 0.02}
  }

  def run do
    biomes = Enum.sum(for {name, foliage} <- @foliage, do: dress_biome(name, foliage))
    regions = dress_regions()

    Logger.info(
      "[data_migrate] #{biomes} generators carry their own foliage palette, #{regions} carry per-region light"
    )

    :ok
  end

  # EVERY generator of that environment, the settlements included. A woodland town stands in a woodland and
  # grows what the woodland grows; serving nil is why a town's trees had no biome at all.
  defp dress_biome(name, foliage) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette}', COALESCE(config->'palette', '{}'::jsonb) || $2::text::jsonb)
        WHERE name = $1 OR name LIKE $1 || ' %'
        """,
        [name, Jason.encode!(foliage)]
      )

    rows
  end

  # `$2::text::jsonb`, never `$2::jsonb`: Postgrex types the parameter as jsonb and encodes the string as a
  # JSON string SCALAR, so a has-key test answers false for a key that is plainly there and the UPDATE reports
  # rows while changing nothing.
  defp dress_regions do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE
              WHEN $1::text::jsonb ? (z->>'key') THEN z || ($1::text::jsonb -> (z->>'key'))
              ELSE z
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE config->'subZones' IS NOT NULL
        """,
        [Jason.encode!(@regions)]
      )

    rows
  end
end

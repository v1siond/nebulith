defmodule Nebulith.DataMigration.ATownGrowsWhatSurroundsIt do
  @moduledoc """
  Every village, town and city grows the vegetation of the place it stands in.

  *"make sure ALL FOREST VARIANTS AND ALL TOWN VARIANTS AND ALL VILLAGE VARIANTS AND ALL CITY VARIANTS ALSO
  USE VEGETATION THAT MAKES SENSE IN THE CONTEXT OF THEIR BIOM, REGION AND SEASON."*

  ## Measured off `/api/generators` before this

  All 27 settlements served `trees: null`. Not one of them had a species mix, so every town in the game fell
  back to one global default regardless of where it stood: a woodland town and a desert town grew the same
  trees. On top of that, the Woodland, Meadow, Ruins, Swamp and Volcanic settlements served no
  `nature.canopy` either, so they had no density to plant from at all.

  `TREES.md` §2 recorded this as finding 3 ("A settlement has no trees of its own") and nothing had acted on
  it. The earlier foliage work gave settlements their environment's leaf COLOUR, which made the gap worse
  rather than better: they were carrying a woodland's green with no woodland trees to put it on.

  ## What it does

  For each settlement, the environment it belongs to is found by NAME PREFIX ("Woodland town" belongs to
  "Woodland"), and the settlement copies that environment's own served values:

    * `trees`, the species mix, verbatim. A beach town grows the beach's trees.
    * `nature`, merged, with the canopy density SCALED DOWN, because a settlement is cleared ground:

          village  0.60 of the wild density, still half rural
          town     0.40
          city     0.25, the most built over

    * the city neighbourhood sub-zones (`upper`, `middle`, `lower`) get the mix too, because a region's list
      SHADOWS the environment's and without it the environment entry is dead data on exactly the generators
      that have regions.

  Nothing is invented and nothing is retyped: every value is read from the environment row at run time, so a
  later change to a biome reaches its settlements for free.

  ## What this deliberately does NOT do

  It does not make settlements distinct from each other beyond their biome, and it does not touch buildings,
  streets or infrastructure. His words: *"We'll work on the settlements later to make them unique and with
  adecuate infrastructure, but for now having the correct nature is enough."*

  Idempotent: reads the environments and writes the same derived values again.
  """
  require Logger

  alias Nebulith.Repo

  # A settlement is cleared ground. How much of the surrounding wild density survives in it.
  @density %{"village" => 0.6, "town" => 0.4, "city" => 0.25}

  # The three city neighbourhoods. Upper class keeps the most planting, which is the one real difference
  # worth having before the settlements get their own pass.
  @neighbourhood %{"upper" => 1.0, "middle" => 0.75, "lower" => 0.5}

  def run do
    environments = load_environments()
    updated = Enum.sum(for env <- environments, kind <- Map.keys(@density), do: dress(env, kind))

    Logger.info("[data_migrate] #{updated} settlements grow what surrounds them")

    :ok
  end

  # THE ENVIRONMENTS THAT ACTUALLY HAVE VEGETATION. A generator with no tree mix has nothing to hand down,
  # and the standalone types (Futuristic, Medieval, Cave, Temple) are deliberately among them.
  defp load_environments do
    %{rows: rows} =
      Repo.query!("""
      SELECT name, config->'trees', config->'nature'
      FROM generators
      WHERE config->'trees' IS NOT NULL AND name NOT LIKE '% %'
      ORDER BY name
      """)

    for [name, trees, nature] <- rows, do: %{name: name, trees: trees, nature: nature || %{}}
  end

  defp dress(env, kind) do
    name = "#{env.name} #{kind}"
    nature = scaled_nature(env.nature, Map.fetch!(@density, kind))

    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(
              jsonb_set(config, '{trees}', $2::text::jsonb),
              '{nature}', COALESCE(config->'nature', '{}'::jsonb) || $3::text::jsonb
            )
        WHERE name = $1
        """,
        [name, Jason.encode!(env.trees), Jason.encode!(nature)]
      )

    dress_neighbourhoods(name, env.trees)
    rows
  end

  # The canopy thins, the rest of the nature block is carried across untouched so a settlement keeps whatever
  # flowers and ground cover its environment serves.
  defp scaled_nature(nature, factor) do
    nature
    |> Map.take(["canopy", "groundCover", "tallGrass", "flowers"])
    |> Map.new(fn {k, v} -> {k, thin(k, v, factor)} end)
  end

  # Only the CANOPY thins with building. Flowers and ground cover are as likely in a garden as in a meadow.
  defp thin("canopy", v, factor) when is_number(v), do: Float.round(v * factor, 3)
  defp thin(_key, v, _factor), do: v

  defp dress_neighbourhoods(name, trees) do
    for {key, weight} <- @neighbourhood do
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE WHEN z->>'key' = $2 THEN jsonb_set(jsonb_set(z, '{trees}', $3::text::jsonb), '{canopy}', $4::text::jsonb) ELSE z END
            ORDER BY ord
          )
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE name = $1 AND config->'subZones' IS NOT NULL
        """,
        [name, key, Jason.encode!(trees), Jason.encode!(weight)]
      )
    end

    :ok
  end
end

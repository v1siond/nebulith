defmodule Nebulith.DataMigration.ADesertIsNotARainforest do
  @moduledoc """
  The desert grows what a desert grows, and the palm stands at the oasis.

  *"expand the types of trees, for example, desert trees makes no sense in the context, we have no cactus for
  example"*.

  ## What it was growing, measured

      Desert (environment)  palm 40, coconut 25, stub 20, bush_round 15
      Desert / deep         banana 30, coconut 25, MANGROVE 25, bush 20
      Desert / lakeside     mangrove 60, palm 25, bush_round 15

  A banana plantation and a mangrove swamp in the Simpson Desert. The region mixes are what actually run on a
  partitioned map, so the deep desert, the part that should be emptiest, was the most tropical thing on it.

  ## What it grows now

  Four new species carry it, three of them built from the `cactus` tile that already had baked art in both
  styles and was used by nothing at all:

      cactus_column    the saguaro, a tall narrow column
      cactus_barrel    a squat dome
      cactus_prickly   a low wide clump
      tree_acacia      the umbrella: a bare bole under a wide FLAT crown, the dry-savanna silhouette

  Distributed by how harsh the ground is, which is the thing a desert's regions should actually mean:

      edge      the softest margin: acacia and encina, with cactus between them
      deep      the harshest: columns, barrels and dead wood, nothing broadleaf
      glade     open sand: low cactus and stubs
      thicket   dry scrub: prickly pear and bush
      lakeside  THE OASIS, and the only place a palm or a coconut belongs on this map

  That last line is the whole point of the change. A palm is not a desert tree, it is an oasis tree, and
  putting it everywhere is what made the biome read as tropical.

  Idempotent: each mix is replaced with a stated list, so running twice writes the same thing.
  """
  require Logger

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  @environment [
    %{"kind" => "cactus_column", "weight" => 20},
    %{"kind" => "tree_acacia", "weight" => 18},
    %{"kind" => "tree_encina", "weight" => 18},
    %{"kind" => "cactus_prickly", "weight" => 16},
    %{"kind" => "cactus_barrel", "weight" => 14},
    %{"kind" => "tree_stub", "weight" => 14}
  ]

  @regions %{
    "edge" => [
      %{"kind" => "tree_acacia", "weight" => 24},
      %{"kind" => "tree_encina", "weight" => 22},
      %{"kind" => "cactus_prickly", "weight" => 18},
      %{"kind" => "cactus_column", "weight" => 16},
      %{"kind" => "bush_round", "weight" => 12}
    ],
    # the emptiest part of the map, and the one that was a banana plantation
    "deep" => [
      %{"kind" => "cactus_column", "weight" => 34},
      %{"kind" => "cactus_barrel", "weight" => 26},
      %{"kind" => "tree_dead", "weight" => 22},
      %{"kind" => "cactus_prickly", "weight" => 18}
    ],
    "glade" => [
      %{"kind" => "cactus_barrel", "weight" => 30},
      %{"kind" => "cactus_prickly", "weight" => 26},
      %{"kind" => "cactus_column", "weight" => 22},
      %{"kind" => "tree_stub", "weight" => 22}
    ],
    "thicket" => [
      %{"kind" => "cactus_prickly", "weight" => 34},
      %{"kind" => "bush_round", "weight" => 26},
      %{"kind" => "tree_encina", "weight" => 22},
      %{"kind" => "cactus_barrel", "weight" => 18}
    ],
    # THE OASIS. The one place on a desert map where a palm makes sense.
    "lakeside" => [
      %{"kind" => "tree_palm", "weight" => 40},
      %{"kind" => "tree_coconut", "weight" => 25},
      %{"kind" => "tree_encina", "weight" => 20},
      %{"kind" => "bush_round", "weight" => 15}
    ]
  }

  def run do
    TileSource.seed_compositions()

    env = set_environment()
    reg = set_regions()

    Logger.info("[data_migrate] #{env} desert generators re-mixed, #{reg} carry desert regions")

    :ok
  end

  defp set_environment do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{trees}', $1::text::jsonb)
        WHERE (name = 'Desert' OR name LIKE 'Desert %') AND config->'trees' IS NOT NULL
        """,
        [Jason.encode!(@environment)]
      )

    rows
  end

  defp set_regions do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE
              WHEN $1::text::jsonb ? (z->>'key') THEN jsonb_set(z, '{trees}', $1::text::jsonb -> (z->>'key'))
              ELSE z
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE (name = 'Desert' OR name LIKE 'Desert %') AND config->'subZones' IS NOT NULL
        """,
        [Jason.encode!(@regions)]
      )

    rows
  end
end

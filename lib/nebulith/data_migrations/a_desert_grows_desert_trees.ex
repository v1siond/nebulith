defmodule Nebulith.DataMigration.ADesertGrowsDesertTrees do
  @moduledoc """
  The desert grows desert TREES, from compositions that already exist.

  *"desert trees makes no sense in the context"*.

  ## What it grows today, measured

      Desert (environment)  palm 40, coconut 25, stub 20, bush_round 15, encina 20
      Desert / deep         banana 30, coconut 25, MANGROVE 25, bush 20
      Desert / lakeside     mangrove 60, palm 25, bush_round 15

  A banana plantation and a mangrove swamp in the Simpson. And because a region's mix SHADOWS the
  environment's on a partitioned map, the deep desert, the part that should be emptiest, was the most
  tropical thing on it.

  ## What changes, and what deliberately does not

  Only the MIXES. Every species named here is a composition that already exists and has already been
  accepted: `tree_gnarled`, `tree_stub`, `tree_dead`, `tree_encina`, `tree_sapling`, `bush`, `bush_round`,
  `tree_palm`, `tree_coconut`. No tile is authored, no composition is invented.

  That is the point. The previous attempt at this added single-cell billboard TILES and was rejected: *"I
  requested trees, WHICH MEAN OBJECTS, COMPOSITIONS, AND YOU JUST USED A FUCKING TILE IN A FUCKING CELL."*
  A cactus is still worth having and is still missing, but it has to arrive as a composition of cells, which
  is separate work.

  ## The distribution, by how harsh the ground is

  Which is what a desert's regions should actually mean, and the axis that was doing nothing before:

      edge      the soft margin: encina and gnarled scrub, the most life on the map
      deep      the harshest: dead wood and stubs, sparse and bare, nothing broadleaf
      glade     open sand: stubs and saplings, low and scattered
      thicket   dry scrub: bush and bush_round
      lakeside  THE OASIS, and the only place a palm or a coconut belongs

  That last line is the load-bearing one. A palm is not a desert tree, it is an oasis tree, and serving it
  across the whole map is what made the biome read tropical.

  Idempotent: each mix is replaced with a stated list.
  """
  require Logger

  alias Nebulith.Repo

  @environment [
    %{"kind" => "tree_gnarled", "weight" => 24},
    %{"kind" => "tree_stub", "weight" => 22},
    %{"kind" => "tree_encina", "weight" => 20},
    %{"kind" => "tree_dead", "weight" => 18},
    %{"kind" => "bush_round", "weight" => 16}
  ]

  @regions %{
    "edge" => [
      %{"kind" => "tree_encina", "weight" => 28},
      %{"kind" => "tree_gnarled", "weight" => 24},
      %{"kind" => "bush_round", "weight" => 18},
      %{"kind" => "tree_stub", "weight" => 16}
    ],
    # the emptiest part of the map, and the one that was a banana plantation
    "deep" => [
      %{"kind" => "tree_dead", "weight" => 34},
      %{"kind" => "tree_stub", "weight" => 30},
      %{"kind" => "tree_gnarled", "weight" => 22}
    ],
    "glade" => [
      %{"kind" => "tree_stub", "weight" => 32},
      %{"kind" => "tree_sapling", "weight" => 24},
      %{"kind" => "bush_round", "weight" => 24}
    ],
    "thicket" => [
      %{"kind" => "bush_round", "weight" => 40},
      %{"kind" => "bush", "weight" => 26},
      %{"kind" => "tree_stub", "weight" => 20}
    ],
    # THE OASIS
    "lakeside" => [
      %{"kind" => "tree_palm", "weight" => 40},
      %{"kind" => "tree_coconut", "weight" => 28},
      %{"kind" => "tree_encina", "weight" => 18},
      %{"kind" => "bush_round", "weight" => 14}
    ]
  }

  def run do
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

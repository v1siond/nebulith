defmodule Nebulith.DataMigration.NoTwoCactiAlike do
  @moduledoc """
  Seven cactus forms instead of three, so a desert stops repeating one silhouette.

  *"add some type of cactus randomizer, we can't have all of them looking the same"*.

  ## Where the variety comes from

  Not from jitter. From AGE and from asymmetry, which is what actually varies on real ones:

      cactus_saguaro_young   no arms yet, a short column
      cactus_saguaro_one     a single arm, on one side
      cactus_saguaro         two arms, the right one taller
      cactus_saguaro_old     taller still, with a third arm higher up the trunk
      cactus_barrel          one squat dome
      cactus_barrel_pair     a large one with a small one beside it
      cactus_prickly         two pads
      cactus_prickly_tall    three pads, stepping sideways as they climb

  A saguaro grows its first arm at around 70 years, so a stand of them is a stand of different ages. That
  gives four honestly different silhouettes without a single new tile, and the existing weighted mix is the
  randomiser: the generator already rolls a species per cell.

  The young form is weighted heaviest, because in a real stand the armless young outnumber the old giants.

  ## Why not per-instance jitter

  It was the obvious alternative and it is worse here. Jittering height or width per instance makes every
  cactus a slightly different size of the SAME shape, which reads as sloppy rather than varied, and it puts
  a rule in the generator that the catalog cannot see. Separate forms stay inspectable and editable, which
  `VISION.md` requires of anything generated.

  Idempotent: sets stated mixes by name.
  """
  require Logger

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  @environment [
    %{"kind" => "cactus_saguaro_young", "weight" => 18},
    %{"kind" => "tree_gnarled", "weight" => 16},
    %{"kind" => "cactus_prickly", "weight" => 14},
    %{"kind" => "tree_stub", "weight" => 14},
    %{"kind" => "cactus_saguaro", "weight" => 12},
    %{"kind" => "cactus_barrel", "weight" => 12},
    %{"kind" => "tree_encina", "weight" => 10},
    %{"kind" => "cactus_saguaro_one", "weight" => 10},
    %{"kind" => "tree_dead", "weight" => 8},
    %{"kind" => "cactus_saguaro_old", "weight" => 6}
  ]

  @regions %{
    # the harshest ground: the old giants stand here, and so does the dead wood
    "deep" => [
      %{"kind" => "cactus_saguaro", "weight" => 22},
      %{"kind" => "cactus_saguaro_young", "weight" => 20},
      %{"kind" => "tree_dead", "weight" => 18},
      %{"kind" => "cactus_saguaro_old", "weight" => 14},
      %{"kind" => "cactus_barrel", "weight" => 14},
      %{"kind" => "cactus_saguaro_one", "weight" => 12}
    ],
    "edge" => [
      %{"kind" => "tree_encina", "weight" => 22},
      %{"kind" => "tree_gnarled", "weight" => 20},
      %{"kind" => "cactus_prickly_tall", "weight" => 16},
      %{"kind" => "cactus_saguaro_young", "weight" => 16},
      %{"kind" => "bush_round", "weight" => 12},
      %{"kind" => "cactus_barrel_pair", "weight" => 10}
    ],
    "glade" => [
      %{"kind" => "cactus_barrel", "weight" => 24},
      %{"kind" => "cactus_barrel_pair", "weight" => 20},
      %{"kind" => "cactus_prickly", "weight" => 20},
      %{"kind" => "tree_stub", "weight" => 18},
      %{"kind" => "cactus_saguaro_young", "weight" => 14}
    ],
    "thicket" => [
      %{"kind" => "cactus_prickly", "weight" => 28},
      %{"kind" => "cactus_prickly_tall", "weight" => 22},
      %{"kind" => "bush_round", "weight" => 20},
      %{"kind" => "cactus_barrel_pair", "weight" => 16},
      %{"kind" => "bush", "weight" => 12}
    ],
    "lakeside" => [
      %{"kind" => "tree_palm", "weight" => 38},
      %{"kind" => "tree_coconut", "weight" => 26},
      %{"kind" => "tree_encina", "weight" => 18},
      %{"kind" => "cactus_prickly", "weight" => 12},
      %{"kind" => "bush_round", "weight" => 10}
    ]
  }

  def run do
    TileSource.seed_compositions()
    env = set(@environment, nil)
    reg = set_regions()

    Logger.info(
      "[data_migrate] #{env} desert generators and #{reg} with regions grow seven cactus forms"
    )

    :ok
  end

  defp set(mix, _) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{trees}', $1::text::jsonb)
        WHERE (name = 'Desert' OR name LIKE 'Desert %') AND config->'trees' IS NOT NULL
        """,
        [Jason.encode!(mix)]
      )

    rows
  end

  defp set_regions do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE WHEN $1::text::jsonb ? (z->>'key') THEN jsonb_set(z, '{trees}', $1::text::jsonb -> (z->>'key')) ELSE z END
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

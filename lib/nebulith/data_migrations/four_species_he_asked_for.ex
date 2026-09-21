defmodule Nebulith.DataMigration.FourSpeciesHeAskedFor do
  @moduledoc """
  Oak, weeping willow, cherry and encina, and the biomes that actually grow them.

  *"I like to see pines, palm tree, cypress, oak, weeping willow, cherry tree, encina"*, and then *"then add
  the variants"*. Pine is `tree_conifer`, cypress and palm were already in the catalog, so these four are the
  remainder.

  ## Built the way the existing ones are, deliberately

  Each is `tree_comp/1` with its own proportions, which is what the nineteen before it are. That matters
  because the previous attempt at more species replaced the model with per-species crown art and was
  reverted: *"all i wanted was to add more variants of types of trees and different coloring and we ended up
  changing the whole fucking system entirely"*. `tree_comp/1` asserts the crown is wider than the trunk and
  seats it at `round(trunk_h * trunk_zoom)`, so none of these can come out detached or thinner than its own
  bole, which were the two complaints that killed the crowns.

  They differ by SILHOUETTE, which is the only axis a shared leaf tile leaves open:

      oak      short heavy bole, the widest crown in the temperate set (2.0 zoom)
      willow   slim trunk under a tall wide FALL of leaf, mass low and spreading
      cherry   small and light, a thin trunk; its blossom is the spring shade array's pink, not new art
      encina   short and sturdy under a dense rounded evergreen dome, a dry open-country tree

  ## Where each one grows, and why there

  Not everywhere. A species that grows on every map is the thing being fixed, not a fix.

      oak       woodland, ruins             the temperate broadleaf
      cherry    woodland, meadow            his meadow note asks for orange and pink, and a cherry is that
      willow    the LAKESIDE region, swamp  it grows with its feet in water and nowhere else
      encina    desert, beach               the dry open dehesa tree, which is what those two lacked

  Willow is added per REGION rather than per environment, because a woodland's lakeside is where it belongs
  and its deep wood is not. The sub-zone mix already exists for exactly this and nothing used it this way.

  Idempotent: each mix is rebuilt only when it does not already name the species.
  """
  require Logger

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  # {generator name match, species, weight}
  @environment [
    {"Woodland", "tree_oak", 22},
    {"Woodland", "tree_cherry", 10},
    {"Ruins", "tree_oak", 18},
    {"Meadow", "tree_cherry", 16},
    {"Meadow", "tree_oak", 14},
    {"Swamp", "tree_willow", 18},
    {"Desert", "tree_encina", 20},
    {"Beach", "tree_encina", 14}
  ]

  # {sub-zone key, species, weight, the environments whose lakeside grows it}
  #
  # SCOPED BY BIOME, not applied to every lakeside there is. The first run put a weeping willow on the
  # waterline of the desert, the jungle and the volcano, which is the exact "one species everywhere" failure
  # this work exists to end. A willow is temperate and wet.
  #
  # AND THE REGION MIX IS THE ONE THAT ACTUALLY RUNS on a partitioned map. The engine reads
  # `zoneAt[row][col].trees ?? ctx.treeMix`, so on any environment with sub-zones the region SHADOWS the
  # environment list entirely. Measured after the first run: woodland grew the willow its lakeside names and
  # neither the oak nor the cherry added to its environment mix, and desert and beach grew no encina at all.
  # An environment entry alone is dead data on every generator that partitions itself.
  @regional [
    {"lakeside", "tree_willow", 26, ~w(Woodland Meadow Ruins Swamp Mountain)},
    # oak in the body of the wood, where a broadleaf stands
    {"deep", "tree_oak", 20, ~w(Woodland Ruins)},
    {"edge", "tree_oak", 16, ~w(Woodland Ruins)},
    # cherry where the light is: a glade and the open edge, never the closed canopy
    {"glade", "tree_cherry", 18, ~w(Woodland Meadow)},
    {"edge", "tree_cherry", 12, ~w(Woodland Meadow)},
    # encina in the open dry country, which is the whole of where a holm oak grows
    {"edge", "tree_encina", 24, ~w(Desert Beach)},
    {"glade", "tree_encina", 20, ~w(Desert Beach)},
    {"thicket", "tree_encina", 14, ~w(Desert Beach)}
  ]

  def run do
    # The four compositions themselves. `seed_compositions/0` is the one that writes the tree species; the
    # crowns migration proved the hard way that `seed_tree_pieces/0` writes the leaf TILES and not these.
    TileSource.seed_compositions()

    env =
      Enum.sum(
        for {name, kind, weight} <- @environment, do: add_to_environment(name, kind, weight)
      )

    reg =
      Enum.sum(
        for {zone, kind, weight, envs} <- @regional, do: add_to_region(zone, kind, weight, envs)
      )

    Logger.info(
      "[data_migrate] 4 species composed, #{env} environment mixes and #{reg} region mixes grow them"
    )

    :ok
  end

  # Appended to the mix rather than replacing it: the existing species and their weights are what a woodland
  # already is, and this adds to it.
  defp add_to_environment(name, kind, weight) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{trees}', (config->'trees') || $3::text::jsonb)
        WHERE (name = $1 OR name LIKE $1 || ' %')
          AND config->'trees' IS NOT NULL
          AND NOT config->'trees' @> $2::text::jsonb
        """,
        [
          name,
          Jason.encode!([%{"kind" => kind}]),
          Jason.encode!([%{"kind" => kind, "weight" => weight}])
        ]
      )

    rows
  end

  defp add_to_region(zone_key, kind, weight, envs) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE
              WHEN z->>'key' = $1 AND z->'trees' IS NOT NULL AND NOT z->'trees' @> $2::text::jsonb
                THEN jsonb_set(z, '{trees}', (z->'trees') || $3::text::jsonb)
              ELSE z
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE config->'subZones' IS NOT NULL
          AND EXISTS (SELECT 1 FROM unnest($4::text[]) env WHERE generators.name = env OR generators.name LIKE env || ' %')
        """,
        [
          zone_key,
          Jason.encode!([%{"kind" => kind}]),
          Jason.encode!([%{"kind" => kind, "weight" => weight}]),
          envs
        ]
      )

    rows
  end
end

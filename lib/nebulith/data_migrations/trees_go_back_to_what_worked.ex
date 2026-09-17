defmodule Nebulith.DataMigration.TreesGoBackToWhatWorked do
  @moduledoc """
  Undoes the species-crown tree system and puts the old trees back, exactly as they were.

  ## What is being undone, and why

  The old trees were a trunk plus a `leaf_center`, and the leaf carried four shades PER SEASON that a
  tree's `variant` picked between. The ask was narrow: more species variants, and colouring that follows
  each kind of forest and region. What got built instead replaced the whole model with per-species crown
  textures on their own cube, and it came out worse on every axis that mattered: proportions, the leaf
  sitting detached from the trunk, and a forest with no tone variation left in it.

  So this is not a partial fix or a tuning pass. The crowns come out entirely and the catalog goes back to
  the state the old trees rendered from, which is the base the variants-and-colour work restarts from.

  ## What it touches

    1. Every `crown_*` tile row, deleted. Their art is gone from `tiles.json` and `priv/static`, so a row
       pointing at a missing PNG would render nothing at all.
    2. The four `tree_burned_*` compositions, deleted. They were crowns with a scorched texture, so they
       cannot outlive the crowns. A burned volcanic wood is worth having and gets rebuilt on whatever the
       new species model turns out to be.
    3. Every tree composition, rebuilt from `TileSource.seed_compositions/0`, which now matches the old
       definitions byte for byte. This is what repoints the 23 cells that name a crown back at `leaf_center`.
    4. The volcanic generators' tree mix, restored from the AUTHORED config rather than retyped here, so
       there is one source for it. Their ash palette and the lava liquid stay: neither is part of the tree
       system, and neither was asked to be reverted.

  Idempotent: the deletes match nothing on a second run and the reseed upserts.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  @burned ~w(tree_burned_pine tree_burned_oak tree_burned_birch tree_burned_encina)

  def run do
    volcanic = restore_the_volcanic_mix()
    burned = drop_the_burned_compositions()
    crowns = drop_the_crown_tiles()

    # AFTER the deletes, not before: it rewrites the tree compositions to name `leaf_center` again, and
    # running it first would leave the cells correct and then delete tiles out from under nothing.
    TileSource.seed_compositions()

    Logger.info(
      "[data_migrate] #{crowns} crown tiles and #{burned} burned compositions removed, " <>
        "#{volcanic} volcanic generators back on their authored tree mix, tree compositions rebuilt"
    )

    :ok
  end

  defp drop_the_crown_tiles do
    %{num_rows: rows} = Repo.query!("DELETE FROM tiles WHERE label LIKE 'crown\\_%'")
    rows
  end

  defp drop_the_burned_compositions do
    # Cells first: nothing cascades, so deleting the parent would orphan them.
    Repo.query!(
      "DELETE FROM composition_cells WHERE composition_id IN (SELECT id FROM compositions WHERE name = ANY($1))",
      [@burned]
    )

    %{num_rows: rows} = Repo.query!("DELETE FROM compositions WHERE name = ANY($1)", [@burned])
    rows
  end

  # The authored config is the source for what a volcanic wood grows. Reading it here rather than copying
  # the list in means a later change to the environment reaches this too, and there is nothing to keep in
  # sync by hand.
  defp restore_the_volcanic_mix do
    GeneratorSource.generators()
    |> Enum.filter(&volcanic?/1)
    |> Enum.map(&restore_one/1)
    |> Enum.sum()
  end

  defp volcanic?(%{name: name}) when is_binary(name), do: String.contains?(String.downcase(name), "volcanic")
  defp volcanic?(_), do: false

  defp restore_one(%{name: name, config: config}) do
    zones = config["subZones"] || []

    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{trees}', $2::text::jsonb) WHERE name = $1",
        [name, Jason.encode!(config["trees"])]
      )

    # Two halves, because the liquids migration wrote a tree mix into EVERY sub-zone. A wild region authors
    # one and gets its own back. A city neighbourhood authors none, so the key it grew has to come off
    # rather than be filled with something else.
    restore_zone_mixes(name, for(z <- zones, z["trees"], into: %{}, do: {z["key"], z["trees"]}))
    strip_zone_mixes(name, for(z <- zones, is_nil(z["trees"]), do: z["key"]))
    rows
  end

  defp restore_zone_mixes(_name, zones) when map_size(zones) == 0, do: :ok

  defp restore_zone_mixes(name, zones) do
    # `$2::text::jsonb`, NOT `$2::jsonb`. Postgrex types the parameter as jsonb and encodes the string as a
    # JSON string SCALAR, so a has-key test answers false for a key that is plainly in the map and the UPDATE
    # reports rows while changing nothing. Every migration in this directory uses the double cast.
    rewrite_zones(name, "jsonb_set(z, '{trees}', $2::text::jsonb -> (z->>'key'))", Jason.encode!(zones))
  end

  defp strip_zone_mixes(_name, []), do: :ok

  defp strip_zone_mixes(name, keys), do: rewrite_zones(name, "z - 'trees'", Jason.encode!(Map.new(keys, &{&1, true})))

  # One rewrite for both halves: walk the sub-zones in order, apply `change` to the ones the map names, leave
  # the rest untouched. ORDINALITY keeps the order, which a bare jsonb_agg does not promise.
  defp rewrite_zones(name, change, keys_json) do
    Repo.query!(
      """
      UPDATE generators SET config = jsonb_set(config, '{subZones}', (
        SELECT jsonb_agg(
          CASE WHEN $2::text::jsonb ? (z->>'key') THEN #{change} ELSE z END
          ORDER BY ord
        )
        FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
      ))
      WHERE name = $1 AND config->'subZones' IS NOT NULL
      """,
      [name, keys_json]
    )

    :ok
  end
end

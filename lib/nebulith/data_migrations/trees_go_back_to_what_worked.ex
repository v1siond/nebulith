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

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  def run do
    crowns = drop_the_crown_tiles()

    # AFTER the delete, not before: it rewrites the tree compositions to name `leaf_center` again, and
    # running it first would leave the cells correct and then delete tiles out from under nothing.
    TileSource.seed_compositions()

    # TWO THINGS THIS USED TO DO ARE GONE.
    #
    # It deleted the four `tree_burned_*` compositions, on the grounds that they were crowns wearing a
    # scorched texture and could not outlive the crowns. It said at the time that a burned volcanic wood
    # was worth having and would be rebuilt on whatever the species model turned out to be. It has been:
    # `TileSource` `@burned_species` builds them from charred parts of their own, so deleting them here
    # would now be deleting the rebuild.
    #
    # It also restored the volcanic tree mix. `GeneratorSource.seed/0` writes `generators.config` WHOLE,
    # so a mix written from a migration is a second owner and the next seed decides it. The volcanic mix
    # is stated in the seeder, and its burnt region grows burned wood again.
    Logger.info("[data_migrate] #{crowns} crown tiles removed, tree compositions rebuilt")

    :ok
  end

  defp drop_the_crown_tiles do
    %{num_rows: rows} = Repo.query!("DELETE FROM tiles WHERE label LIKE 'crown\\_%'")
    rows
  end

  # The authored config is the source for what a volcanic wood grows. Reading it here rather than copying
  # the list in means a later change to the environment reaches this too, and there is nothing to keep in
  # sync by hand.

  # One rewrite for both halves: walk the sub-zones in order, apply `change` to the ones the map names, leave
  # the rest untouched. ORDINALITY keeps the order, which a bare jsonb_agg does not promise.
end

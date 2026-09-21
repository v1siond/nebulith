defmodule Nebulith.DataMigration.ABloomIsNotGroundCover do
  @moduledoc """
  `decor_blossom` and `decor_flower` are FLOWERS, so they leave the ground cover pool.

  Ground cover is picked uniformly from every tile of category `decor` that serves a colour for the season,
  and two of the eleven in that pool are blooms. So roughly a fifth of every cell that takes ground cover got
  a flower, on every map, whatever it was: measured, 96 blooms on a volcanic forest and 98 on a woodland,
  neither of which serves a bloom set at all. Which blooms grow somewhere is the environment's to say and the
  generator catalogue already says it, region by region.

  A bloom is `nature`, which is where the `flower`, `rose` and `blossom` tiles already sit. Moving these two
  there takes them out of the cover pool and leaves it what it is for: clover, pebbles, grit, shells, ripples.

  Spring's own `tiles.decor` is changed with them, for the same reason: it named `blossom`, a flower, in a
  field that means ground cover. Nothing reads it today, so this is the data agreeing with itself rather than
  a behaviour change.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    # ONE KEY, not the whole map. `tiles` carries the season's whole tile set, so setting the field would
    # delete every other key in it.
    %{num_rows: zones} =
      Repo.query!("""
      UPDATE zones
      SET tiles = jsonb_set(tiles, '{decor}', '"emoji:clover"'::jsonb)
      WHERE key = 'spring' AND tiles->>'decor' = 'emoji:blossom'
      """)

    # ONE KEY, not the whole map, and only the two that are blooms. `decor_clover`, `decor_pebbles`,
    # `decor_grit`, `decor_dot`, `decor_shell`, `decor_spark` and the ripples stay where they are: they are
    # what ground cover means.
    %{num_rows: tiles} =
      Repo.query!("""
      UPDATE tiles SET category = 'nature'
      WHERE label IN ('decor_blossom', 'decor_flower') AND category = 'decor'
      """)

    # AND SPRING GETS NO SUBSTITUTE COVER. Those two blooms were the only decor tiles serving a spring
    # colour, and clover was given one here so spring would not be bare. Rejected on sight: 85 clovers a map,
    # and none of the flat decor has baked art for the emoji style anyway, so each one draws as a coloured
    # square. Ground cover comes back when it has art and a reason to be there, not before.
    %{num_rows: cover} =
      Repo.query!("""
      UPDATE tiles
      SET settings = settings #- '{colors,spring}'
      WHERE label = 'decor_clover' AND settings->'colors' ? 'spring'
      """)

    Logger.info(
      "[data_migrate] blooms out of ground cover: #{tiles} tiles recategorised, #{zones} zone, #{cover} cover"
    )

    :ok
  end
end

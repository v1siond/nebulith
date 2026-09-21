defmodule Nebulith.DataMigration.WaterBendTile do
  @moduledoc """
  A water tile whose current CURVES, for the cells where the channel turns.

  Water is not linear: it runs straight down a reach and bends at a corner. Every wet cell used to draw the
  one straight-wave picture turned by quarter turns, so a bend drew the same straight lines rotated, which is
  a step a river never makes.

  This is the corner piece of the pair: four nested arcs turning about one corner of the cell, in the same
  blue and the same stroke as the straight tile, baked from `priv/tilegen/tiles.json`. Four quarter turns of
  it cover all four bends, so the whole set is two pictures rather than eight.

  It copies the `water` row rather than restating it, so height, stacking and colour cannot drift apart from
  the band it belongs to. Idempotent: the insert skips a tileset that already has the row.

  Solidity rides in `settings`, which carries the collision boxes. It used to be copied through a separate
  `occupies` column too; that column was the old blocking flag and is gone, so naming it here raised on
  every database that had not already recorded this migration as done, which made one unbuildable.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: count} =
      Repo.query!("""
      INSERT INTO tiles (tileset_id, label, title, category, image_url, height,
                         settings, inserted_at, updated_at)
      SELECT t.tileset_id,
             'water_bend',
             'Water (bend)',
             t.category,
             replace(t.image_url, 'water.png', 'water_bend.png'),
             t.height,
             t.settings,
             NOW(),
             NOW()
        FROM tiles t
        JOIN tilesets ts ON ts.id = t.tileset_id
       WHERE t.label = 'water'
         AND NOT EXISTS (SELECT 1 FROM tiles x WHERE x.tileset_id = t.tileset_id AND x.label = 'water_bend')
      """)

    Logger.info("[data_migrate] water bend tile (#{count} rows inserted)")
    :ok
  end
end

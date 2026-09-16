defmodule Nebulith.DataMigration.ASolidBlockAndAStoneThatReadsAsStone do
  @moduledoc """
  Three corrections taken off screenshots of the running map, not off a render of an object on its own.

  ## 1. The open crate, and it was never really about bridges

  `sq_brown.png` is baked from the emoji glyph, which is a ROUNDED square with a transparent margin measured
  at 31%. Every block extruded from it shows its own dark interior through that gap, which is the open crate.
  `seed_bridge_tiles/0` documents the effect and worked around it for two tiles by authoring them full bleed.

  It was never two tiles. Counted on the live emoji tileset, **18 tiles point at `sq_brown`**, and they are
  the ground and the structures: `wooden_planks`, `path_dirt`, `bridge`, `stairs`, `cave_floor`,
  `crypt_floor`, `ancient_stone`, `inca_stone`, `red_earth`, `grave_dirt`, `autumn_ground`, `dead_grass`,
  `ash`, `cliff_face`, `mud_hut` and the three flat decors. A swamp's boardwalk is `wooden_planks`, so every
  cell of it drew as an open box, which is what a crossing there actually looked like. `sq_green` and
  `sq_white` are the same glyph in other colours, 30.4% and 31.0%.

  All three are authored as full-bleed art now and re-baked, so all 18 draw as solid bodies and each keeps
  its own colour. Nothing is worked around per tile any more.

  ## 2. Stone that does not read as stone

  The bridge's masonry was measured off the reference, which is a RED sandstone bridge, and #893640 is
  faithful to it. On the map, against blue water and green ground, it reads as red brick rather than as
  stone. The reference is the shape to match; the material has to read in the place it stands. Grey.

  ## 3. The plank walkway goes

  A third crossing kind, "Plank walkway", sat between the wooden bridge and the stone one and named nothing
  anybody could picture. Removed here and from `GeneratorSource`: the choice, the crossing entry, the five
  `bridge_plank_*` compositions and the flat-crossing branch that was authored for it alone.

  Idempotent: the seeders upsert, and the deletes match only what is still there.
  """
  require Logger

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  def run do
    TileSource.seed_bridge_tiles()
    TileSource.seed_compositions()

    %{num_rows: kinds} =
      Repo.query!("""
      UPDATE generators
      SET config = jsonb_set(config, '{crossings}', (config->'crossings') - 'planks')
      WHERE config->'crossings' ? 'planks'
      """)

    # A composition is identified by `name`, not by a `key` column. Getting that wrong is why the first run of
    # this pass left five plank compositions standing while reporting nothing amiss.
    %{num_rows: cells} =
      Repo.query!("""
      DELETE FROM composition_cells
      WHERE composition_id IN (SELECT id FROM compositions WHERE name LIKE 'bridge_plank_%')
      """)

    %{num_rows: comps} = Repo.query!("DELETE FROM compositions WHERE name LIKE 'bridge_plank_%'")

    # AND THE CHOICE ITSELF. The crossings map says what a kind IS; `options` is the list a person picks from,
    # and they are separate columns. Dropping one and not the other leaves "Plank walkway" in the panel
    # selecting a kind that no longer exists.
    %{num_rows: choices} =
      Repo.query!("""
      UPDATE generators SET options = (
        SELECT jsonb_agg(
          CASE WHEN opt->>'key' = 'bridge'
            THEN jsonb_set(opt, '{choices}', (
              SELECT jsonb_agg(c) FROM jsonb_array_elements(opt->'choices') c WHERE c->>'key' <> 'planks'
            ))
            ELSE opt END
        )
        FROM jsonb_array_elements(options) opt
      )
      WHERE options @> '[{"key": "bridge"}]'
      """)

    Logger.info(
      "[data_migrate] solid squares re-baked, stone greyed, plank walkway gone " <>
        "(#{kinds} generators, #{choices} option lists, #{comps} compositions, #{cells} cells)"
    )

    :ok
  end
end

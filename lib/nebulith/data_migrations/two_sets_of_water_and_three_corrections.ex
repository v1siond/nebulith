defmodule Nebulith.DataMigration.TwoSetsOfWaterAndThreeCorrections do
  @moduledoc """
  The two new water sets, and the three corrections he gave reviewing the map at :3000.

  ## 1. Two sets of water, built from scratch

  `TileSource.seed_water_sets/0` seeds `water_smooth` and `water_lined`, nine autotile pieces each over four
  frames, in both styles. What they are and why they are drawn the way they are is in that function's own
  doc and in `docs/WATER.md`.

  The point of two is that a body of water can CHOOSE its look. Until now every river, pool and lake in the
  game drew the single `water` picture, and not because the data said so: `groundKind` folds every label
  matching water onto one kind and `assetTileImage` resolves a floor by kind before it ever reads the label.
  So a second set of art is invisible until the label wins, which is the engine half of this work.

  ## 2. The water over a ford is too opaque to see the dirt

  *"Dirt path is better, water have to be a bit more transparent to see more of the dirt"*. The film is
  `water_still` carrying a settings animation with a flat opacity track, authored at 0.72. At 0.5 the route
  underneath reads as a dirt crossing with water running over it rather than as water with a hint of brown.

  ## 3. An ornament is a single tile, not a block

  *"we don't really want to render ornaments as blocks, we want to use the single tile setting, like we do
  with flowers"*. The flowers already carry `display: single` plus `transparent: true`, which draws the art
  as one billboard inside the block instead of extruding it into a cube. Nine ornaments that lie on the
  ground did not: boulder, both mushrooms, both shells, pebbles, shamrock and the log. They are ornaments, so
  they get what the flowers get.

  `rock` included, on his correction that this is a setting and not an authoring job. The objection had been
  that `makeCaveWall` writes the same label; measured, a generated cave carries five `rock` assets, so the
  scales are nothing alike and the setting is the right lever.

  Idempotent: every write is an upsert or a targeted setting write.
  """
  require Logger

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  # Things that LIE ON the ground and are read as one object, never as a volume of material. The floor and
  # road surfaces that share a word with them (cobblestone, path_stone, ancient_stone) are deliberately not
  # here: those are surfaces, and a surface is not an ornament.
  #
  # `rock` IS HERE, on his correction: *"it is a setting, all we have to do is turn on or off the 'render tile
  # in all faces or in center' setting and that's it"*. The worry was that `makeCaveWall` writes the same
  # label, so a cave's walls would turn into pebbles. Measured before arguing it: a generated cave carries
  # FIVE `rock` assets, not a cavern's worth, so the two uses are nowhere near the same scale and the setting
  # is the right lever. If a cave wall ever does need to be a mass, it needs its own label, which is a
  # separate job from this one.
  @ornaments ~w(rock boulder mushroom red-mushroom seashell decor_shell decor_pebbles shamrock wood-log)

  @ford_film_opacity 0.5

  # The kinds the families are named for, mirrored from TileSource so the cleanup knows what is current.
  @water_kind_names ~w(river lake beach)

  def run do
    TileSource.seed_water_sets()

    orphans = drop_the_kindless_pass()
    ornaments = single_tile_ornaments()
    ford = thinner_ford_film()

    Logger.info(
      "[data_migrate] two water sets seeded, #{ornaments} ornaments draw as single tiles, " <>
        "#{orphans} kindless rows dropped, #{ford} ford film rows thinned to #{@ford_film_opacity}"
    )

    :ok
  end

  # THE FIRST PASS SEEDED `water_smooth_<piece>` with no kind in the name. The families carry a kind now
  # (`water_smooth_river_<piece>`), so those rows name art nothing asks for any more. A label that has left the
  # vocabulary has to leave the catalog too, or the style-parity checks and his tile library keep offering it.
  defp drop_the_kindless_pass do
    kinds = Enum.join(@water_kind_names, "|")

    %{num_rows: rows} =
      Repo.query!(
        """
        DELETE FROM tiles
        WHERE label ~ '^water_(smooth|lined)_'
          AND label !~ ('^water_(smooth|lined)_(' || $1 || ')_')
        """,
        [kinds]
      )

    rows
  end

  # `put_tile_setting` answers {0, nil} for a label a style does not carry, so the count is the number of rows
  # that actually changed rather than the number attempted.
  defp single_tile_ornaments do
    for label <- @ornaments, tileset <- Catalog.list_tilesets(), reduce: 0 do
      acc ->
        {hit, _} = Catalog.put_tile_setting(tileset.id, label, "display", "single")
        Catalog.put_tile_setting(tileset.id, label, "transparent", true)
        acc + hit
    end
  end

  # The opacity lives inside a settings ANIMATION rather than on the tile, because the renderer's only
  # unconditional alpha is the one an animation track supplies. A plain `settings.opacity` would be read by
  # nothing, which is why this edits the track in place instead of adding a field.
  #
  # `$1::text::jsonb`, not `$1::jsonb`. A bare jsonb parameter is JSON-encoded by the driver on its way in, so
  # the array arrived as a jsonb STRING holding the array's text and the track list became one scalar. Casting
  # through text parses it back into a real array. Read the value off the API to see which you got.
  defp thinner_ford_film do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles SET settings = jsonb_set(
          settings, '{animations}',
          (
            SELECT jsonb_agg(
              CASE WHEN anim->>'id' = 'puddle_translucence'
                THEN jsonb_set(anim, '{tracks}', $1::text::jsonb)
                ELSE anim END
            )
            FROM jsonb_array_elements(settings->'animations') anim
          )
        )
        WHERE label = 'water_still'
          AND settings->'animations' @> '[{"id": "puddle_translucence"}]'
        """,
        [
          Jason.encode!([
            %{"setting" => "opacity", "from" => @ford_film_opacity, "to" => @ford_film_opacity}
          ])
        ]
      )

    rows
  end
end

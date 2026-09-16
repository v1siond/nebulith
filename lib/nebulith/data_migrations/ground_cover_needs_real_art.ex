defmodule Nebulith.DataMigration.GroundCoverNeedsRealArt do
  @moduledoc """
  The four ground-cover tiles that draw as a plain coloured SQUARE leave the cover pool.

  ## What was measured

  Ground cover is picked uniformly from every `decor` tile that serves a colour for the season
  (`decorTilesForZone`), and in the emoji style six of the nine in that pool have no art of their own. They
  point at a solid swatch:

      decor_clover   -> /tiles/emoji/sq_green.png   #5aaf5a    a green square
      decor_pebbles  -> /tiles/emoji/sq_brown.png   #b0894e    a brown square
      decor_dot      -> /tiles/emoji/sq_brown.png   #a06a2c    a brown square
      decor_grit     -> /tiles/emoji/sq_brown.png   #bba360    a yellow-brown square
      decor_shell    -> /tiles/emoji/sq_white.png   #cfe6ee    a white square
      decor_spark    -> /tiles/emoji/sq_white.png   #ccdbe7    a white square

  Counted on a 60x40 map: 167 clover squares on a woodland, 155 on a town, 155 on a futuristic city, plus 22
  to 35 pebble squares on each. In ascii the same two are the `♣` clover glyph and a pebble scatter, which is
  where the "trebols" come from. One tile, two styles, the same defect either way.

  ## Why the data and not the placer

  The rule is already written in `ABloomIsNotGroundCover`: *"none of the flat decor has baked art for the emoji
  style anyway, so each one draws as a coloured square. Ground cover comes back when it has art and a reason to
  be there, not before."* That pass applied it to the two blooms and left these named as "what ground cover
  means". They are not: they are placeholders standing in for art nobody has drawn yet.

  A tile is eligible for a season's cover because it serves a colour for that season, so "this is not that
  season's ground cover" is said by dropping the season key. The tiles stay in the catalogue with their own
  colour and stay placeable by hand, which is what a placeholder is actually good for.

  ## What this leaves

      summer  -> nothing        autumn -> nothing        desert -> nothing
      lava    -> decor_spark    winter -> decor_spark    beach  -> the ripples + decor_shell

  A season with no cover tile gets no cover: `pickGroundDecor` returns nil and the placer skips the cell. That
  is the same answer the spring case already gives, and it is ~190 fewer props on every woodland, town and
  city.

  ## Deliberately NOT touched

  `decor_shell` and `decor_spark` draw as white squares and share the whole defect above. They were left
  because white is not what was reported and a shell on a beach is plausible art once someone draws it. They
  are named here so the next pass does not have to rediscover them.

  Idempotent: each statement matches only a row that still carries the key.
  """
  require Logger

  alias Nebulith.Repo

  # The season each tile is opting into, as `settings.colors` carries it. Dropping the key is what takes the
  # tile out of that season's pool; the tile's own `color` is untouched so it still draws when placed by hand.
  @out_of_the_pool [
    {"decor_clover", ["summer"]},
    {"decor_pebbles", ["autumn", "desert", "lava", "winter"]},
    {"decor_dot", ["autumn"]},
    {"decor_grit", ["desert"]}
  ]

  def run do
    dropped = Enum.sum(Enum.map(@out_of_the_pool, &drop_seasons/1))

    Logger.info("[data_migrate] ground cover without art: #{dropped} season colours dropped")
    :ok
  end

  defp drop_seasons({label, seasons}), do: Enum.sum(Enum.map(seasons, &drop_season(label, &1)))

  defp drop_season(label, season) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
        SET settings = settings #- ARRAY['colors', $2]
        WHERE label = $1 AND category = 'decor' AND settings->'colors' ? $2
        """,
        [label, season]
      )

    rows
  end
end

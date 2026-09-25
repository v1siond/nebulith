defmodule Nebulith.DataMigration.RockIsGreyNotViolet do
  @moduledoc """
  A CLIFF FACE IN A WOOD IS GREY, and every one of them was violet.

  `rockShades` is the palette an outdoor rock face takes its colour from: the border of a bare place on
  an open map, and an arena's wall. It was authored in the props block beside `caveDecor` and
  `mushroomTones`, which is where it came from, and it held five shades of dark violet.

  A cave never used it. A cave and its entrance seal with `pal.wall`, which is grey brown and always
  was. So the only thing wearing these was the thing they suited least.

  Measured on a generated woodland: 27 `cliff_face` tiles wearing #443b50, #3d3543 and #3a3340, which
  is what a row of dark violet cubes standing in a forest looks like.

  An earlier pass moved `cliff_face` out of terrain so it would stop being flattened to height 0. That
  was right and it is why these now stand up as blocks rather than lying down as diamonds, which made
  them MORE visible, not less. The colour is the half that was missed.
  """
  require Logger

  alias Nebulith.Repo

  @grey ["#5a5f55", "#4e5349", "#646a5e", "#454a42", "#585d52"]

  def run do
    # THE PROPS BUNDLE IS A GAME RULE, not a zone. It is season independent, which is the whole reason
    # it is one table and not seven, and it reaches the engine through /api/combat rather than /zones.
    %{num_rows: n} =
      Repo.query!(
        """
        UPDATE game_rules
        SET value = jsonb_set(value, '{rockShades}', $1::text::jsonb)
        WHERE key = 'props' AND value ? 'rockShades'
        """,
        [Jason.encode!(@grey)]
      )

    Logger.info("rock is grey now, not violet: #{n} zone(s)")
    :ok
  end
end

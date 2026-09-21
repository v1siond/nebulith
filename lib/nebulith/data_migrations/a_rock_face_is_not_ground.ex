defmodule Nebulith.DataMigration.ARockFaceIsNotGround do
  @moduledoc """
  A ROCK FACE IS NOT GROUND, so it stops being filed as terrain.

      WHAT THE FUCK ARE THESE PURPLE GROUND TILES??? REMOVE THEM

  Measured on a generated woodland: the purple diamonds were `cliff_face`, nineteen of them, wearing
  #443b50 / #3d3543 / #3a3340.

  `makeRockFace` calls it "a blocking, full-height wall of natural stone" and uses it to close a cavern,
  a boss arena and the border of a bare place. The catalogue filed it under terrain, which puts it in
  the set `flatten_ground_heights/0` forces to height 0, so the wall was zero blocks tall and drew as a
  dark diamond lying on the floor.

  It was invisible while a renderer read a placement's height through a fallback chain. Now that a
  placement carries the height its catalogue states, a wall filed as ground draws as ground.

  `walls` puts it where `wall` already is, out of the flattening set and into the one
  `reconcile_tile_heights/0` holds at a block or more.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: n} =
      Repo.query!("""
      UPDATE tiles SET category = 'walls', height = GREATEST(height, 1.0)
      WHERE label = 'cliff_face' AND category <> 'walls'
      """)

    Logger.info("a rock face is a wall, not ground (#{n} rows)")
    :ok
  end
end

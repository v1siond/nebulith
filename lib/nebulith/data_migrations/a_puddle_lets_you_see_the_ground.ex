defmodule Nebulith.DataMigration.APuddleLetsYouSeeTheGround do
  @moduledoc """
  A puddle lies FLAT on the floor and you can see through it.

  *"except when it's a pool/puddle of water which should have height 0 and elevation == floor level and also
  have transparency/opacity edited to see whatever terrain is below. a puddle of water ALWAYS goes above
  something else, like regular terrain, vegetation, etc. NEVER alone"*.

  `water_still` is that puddle: the film a ford, a pool and a swamp puddle all lay over ground that stays
  ground. Two of the three were already true. It is stacked (`stackAt` 0, so it neither lifts you nor drops
  you), and it is already SEE-THROUGH: the opacity rides an animation track at 0.5, because a plain
  `settings.opacity` is read by nothing, which the seeder says out loud.

  What was left is the height. It carried 0.05, a hair proud of the floor, and the ask is 0. That was safe to
  do only once the ground tiles were flattened to 0 themselves: the seeder's own comment records that height 0
  once dropped a puddle a whole block, back when `meadow` stood at 1.0.

  The ZONE of water is a different thing and is cut one block below its floor, which the engine does
  (`levelTheWater`), not the catalog.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!("""
      UPDATE tiles SET height = 0.0 WHERE label = 'water_still' AND height <> 0.0
      """)

    Logger.info("[data_migrate] a puddle lets you see the ground: #{rows} tile row(s)")
    :ok
  end
end

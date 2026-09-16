defmodule Nebulith.DataMigration.APathIsLighterThanTheGround do
  @moduledoc """
  The jungle's trail goes from #57502f to #8a7550, so a path reads as a path.

  Measured on the five isometric pathway references, the path is LIGHTER than the field every single time,
  by 35 to 128 points of luminance:

      woodland crossroads     field 121.0   path 213.0
      park path               field  69.4   path 104.5
      forest alongside river  field  38.0   path 166.4
      clifftop above a beach  field 128.0   path 203.5
      swamp trail to a temple field  36.8   path 100.9

  Ours ran the other way. The jungle's trail sat at 79.1 against an open canopy floor of 85.0, so the way
  through was DARKER than the ground it crossed and read as a stain rather than a route. 118.8 now, clear of
  every region a jungle has: dense 49.9, base 65.9, swamp 68.8, ruins 73.0, open 85.0.

  The woodland's own trail was already lighter than its floor (138.5 against 119.8) and nothing had ever
  applied that floor, because the only function in the engine that painted a template's served `palette.floor`
  was the jungle's. That half is fixed in the engine, not here.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] the jungle trail is lighter than its ground")
    :ok
  end
end

defmodule Nebulith.DataMigration.ApprovedEntrancesNamedForWhatTheyAre do
  @moduledoc """
  The three approved entrances, named for the OBJECT rather than the place: temple entrance, cave entrance
  cube, cave entrance rounded.

  `forest_entrance` named a place, and a place name says nothing about what the thing looks like, which is
  how it ended up holding a cave mouth. An object is always named in relation to the object itself.

  Each is built by the method the objects already approved are built by: proportion (`scale * scaleY` is the
  drawn height in levels), `depth` to span, `shape: circle` to make a mass, and no `display: single`
  anywhere. The two caves share one builder and differ by that single setting.

  They carry a category, so they are placeable objects in the palette rather than something only a generator
  can put down.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.seed_approved_entrances()

    Logger.info("[data_migrate] approved entrances seeded")
    :ok
  end
end

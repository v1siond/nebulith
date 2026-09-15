defmodule Nebulith.Repo.Migrations.ApprovedEntrancesNamedForWhatTheyAre do
  @moduledoc """
  The three entrances he approved, named for the OBJECT rather than the place.

  *"we need to rename them to temple entrance, cave entrance cube cave entrance rounded ... in short, always
  name in relation to the object itself"* (2026-09-14). `forest_entrance` named a place, and a place name says
  nothing about what the thing looks like, which is how it ended up holding a cave mouth.

  Each is built by the method the objects he already likes are built by: proportion (`scale * scaleY` is the
  drawn height in levels), `depth` to span, `shape: circle` to make a mass, and no `display: single` anywhere.
  The two caves share one builder and differ by that single setting.

  They carry a category, so they are placeable objects in the palette rather than something only a generator
  can put down.
  """
  use Ecto.Migration

  def up do
    Nebulith.Catalog.TileSource.seed_approved_entrances()
  end

  def down do
    # Nothing to undo: an entrance the editor can place is not worth deleting on a rollback, and the rows are
    # replaced wholesale by the next seed anyway.
    :ok
  end
end

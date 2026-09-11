defmodule Nebulith.Repo.Migrations.AddSlabBlocksToTemplate do
  use Ecto.Migration

  @moduledoc """
  Give a saved map its GROUND THICKNESS column.

  Alexander, 2026-09-10: *"the ground thicknes is not a per template setting, is just a general
  setting of the grid ... and the data is stored in the database"*.

  It was not. The frontend has sent `slabBlocks` with every save since `75f9685`, `Template` had no
  column for it, and `cast/3` drops what the schema does not declare — silently, which is why a saved
  map always came back one block deep. This is the fourth number that describes a map's shape and it
  sits with the other three (`cols`, `rows`, `cellSize`).

  Default 1 so every existing row keeps exactly the depth it renders with today.
  """

  def change do
    alter table("Template") do
      add :slabBlocks, :integer, null: false, default: 1
    end
  end
end

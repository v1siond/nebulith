defmodule Nebulith.Repo.Migrations.AddZIndexToCompositionCells do
  use Ecto.Migration

  # A composition cell's DRAW-PRIORITY (CSS z-index style): a higher value renders LATER (on top / in front),
  # overriding the positional depth sort so a tile can be given explicit visibility priority regardless of its
  # grid position. The town-square fountain's WATER cells use it so the water reads IN FRONT of a wall behind
  # it (Images #34/#36). Additive, non-null with a 0 default so every existing cell sorts EXACTLY as before
  # (0 vs 0 is a no-op in the sort → the positional key still decides). nebulith only ADDs to its own table
  # here; it never touches the Prisma-owned tables.
  def change do
    alter table(:composition_cells) do
      add :z_index, :integer, null: false, default: 0
    end
  end
end

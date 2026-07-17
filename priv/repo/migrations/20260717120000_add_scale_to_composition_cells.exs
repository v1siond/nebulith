defmodule Nebulith.Repo.Migrations.AddScaleToCompositionCells do
  use Ecto.Migration

  # A composition cell's uniform draw ZOOM — the render multiplies every axis by it, so a single cell can
  # hold a tile bigger than one block (the tree's canopy is ONE leaf cell at scale 2, a 2×2 crown). Additive,
  # non-null with a 1.0 default so every existing cell renders exactly as before. nebulith only ADDs to its
  # own table here; it never touches the Prisma-owned tables.
  def change do
    alter table(:composition_cells) do
      add :scale, :float, null: false, default: 1.0
    end
  end
end

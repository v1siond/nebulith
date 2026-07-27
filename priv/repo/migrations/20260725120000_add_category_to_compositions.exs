defmodule Nebulith.Repo.Migrations.AddCategoryToCompositions do
  use Ecto.Migration

  # A composition's sidebar BUCKET — the SAME `category` vocabulary a tile carries (buildings/nature/
  # props/terrain). It marks the composition browseable in the paint palette and GROUPS it there, exactly
  # like a tile's category, so the editor stops deriving the group on the frontend (door/name heuristic).
  # Additive + nullable: existing rows are backfilled by the 0006 data migration. nebulith only ADDs its
  # own column here; it never touches the Prisma-owned tables.
  def change do
    alter table(:compositions) do
      add :category, :string
    end
  end
end

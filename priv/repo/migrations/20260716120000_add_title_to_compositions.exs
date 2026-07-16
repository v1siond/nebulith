defmodule Nebulith.Repo.Migrations.AddTitleToCompositions do
  use Ecto.Migration

  # A composition's human NAME — the apex signage the renderer badges a building with (a store
  # reads "Store", a hospital "Hospital"). Additive + nullable: houses/trees carry no title, so no
  # badge. nebulith only ADDs its own column here; it never touches the Prisma-owned tables.
  def change do
    alter table(:compositions) do
      add :title, :string
    end
  end
end

defmodule Nebulith.Repo.Migrations.AddParentToGenerators do
  @moduledoc """
  Generators become a TREE. Alexander, 2026-09-11: *"when selecting a zone, we should also have extra options
  to select different types of the selected zone, or just randomize, and we can go various levels deeper /
  forest > type of forest > sub type of type of forest > etc / like maybe it's an island jungle, maybe it's a
  mountain forest"*.

  A row with a parent is a subtype of it. Any depth, because he said "various levels deeper" and named no
  limit. Deleting a parent takes its subtypes with it.
  """
  use Ecto.Migration

  def change do
    alter table(:generators) do
      add :parent_id, references(:generators, type: :binary_id, on_delete: :delete_all)
    end

    create index(:generators, [:parent_id])
  end
end

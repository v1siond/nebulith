defmodule Nebulith.Repo.Migrations.AddParentToGenerators do
  @moduledoc """
  Generators become a TREE.

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

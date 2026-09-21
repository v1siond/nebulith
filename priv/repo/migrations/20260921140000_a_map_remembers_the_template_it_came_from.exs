defmodule Nebulith.Repo.Migrations.AMapRemembersTheTemplateItCameFrom do
  @moduledoc """
  A MIGRATION BRIDGE, and nothing more.

  `Template` is not in the target schema. `maps` replaces it, and phase 3 moves a map's contents off
  its three JSON blobs onto rows. What is left on that row afterwards is not map content: connectors,
  entities and quests, which get real tables in phases 10 and 11.

  So for the length of the migration a map and a template both exist and have to be the same place.
  This column is how the editor finds one from the other. It is deliberately a plain text column with
  no reference, because `Template` is Prisma's table with a text id, and this dies with it.

  Delete this column when `Template` is dropped.
  """
  use Ecto.Migration

  def change do
    alter table(:maps) do
      add :template_id, :text
    end

    create unique_index(:maps, [:template_id])
  end
end

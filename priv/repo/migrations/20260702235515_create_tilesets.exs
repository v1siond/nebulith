defmodule Nebulith.Repo.Migrations.CreateTilesets do
  use Ecto.Migration

  def change do
    create table(:tilesets) do
      add :key, :string
      add :name, :string
      add :data, :map

      timestamps(type: :utc_datetime)
    end

    create unique_index(:tilesets, [:key])
  end
end

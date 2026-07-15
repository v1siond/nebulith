defmodule Nebulith.Repo.Migrations.CreateTiles do
  use Ecto.Migration

  def change do
    create table(:tiles) do
      add :tileset_id, references(:tilesets, on_delete: :delete_all), null: false
      add :label, :string, null: false
      add :glyph, :string
      add :emoji, :string
      add :color_role, :string
      add :blocking, :boolean, default: false, null: false
      add :height, :integer, default: 0, null: false
      add :category, :string
      add :title, :string
      add :image_url, :string
      add :settings, :map, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:tiles, [:tileset_id, :label])

    create table(:compositions) do
      add :name, :string, null: false
      add :footprint_w, :integer, null: false
      add :footprint_h, :integer, null: false
      timestamps(type: :utc_datetime)
    end

    create unique_index(:compositions, [:name])

    create table(:composition_cells) do
      add :composition_id, references(:compositions, on_delete: :delete_all), null: false
      add :dx, :integer, null: false
      add :dy, :integer, null: false
      add :level, :integer, null: false
      add :label, :string, null: false
      add :walkable, :boolean, default: false, null: false
      timestamps(type: :utc_datetime)
    end

    create index(:composition_cells, [:composition_id])
  end
end

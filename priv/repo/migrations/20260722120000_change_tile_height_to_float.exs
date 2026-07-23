defmodule Nebulith.Repo.Migrations.ChangeTileHeightToFloat do
  use Ecto.Migration

  # SCHEMA-ONLY (DDL). A tile's `height` is its size in BLOCKS (how tall it extrudes in iso). As an integer a
  # FLAT tile could only be 0 ("no height"), forcing the frontend to invent what "0" looks like. As a FLOAT a
  # flat tile can carry its REAL minimal height (0.1 blocks) as DATA. The actual per-tile VALUES are set by the
  # data migration (Nebulith.DataMigration.FlatTilesMinimalHeight, run via `mix data_migrate`) — never here, so
  # this stays a cheap DDL that is safe to run at startup.

  def up do
    alter table(:tiles) do
      modify :height, :float, default: 0.0, null: false
    end
  end

  def down do
    execute("ALTER TABLE tiles ALTER COLUMN height TYPE integer USING round(height)::integer")

    alter table(:tiles) do
      modify :height, :integer, default: 0, null: false
    end
  end
end

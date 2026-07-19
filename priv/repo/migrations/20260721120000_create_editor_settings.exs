defmodule Nebulith.Repo.Migrations.CreateEditorSettings do
  use Ecto.Migration

  def change do
    # Editor UI settings — a small backend-owned key→value store for editor chrome state
    # (today: a floating panel's remembered position + size). key = a stable modal id
    # ("settings"/"animation"/"triggers"); value = an opaque jsonb blob ({x,y,w,h} today).
    # nebulith-owned table — snake_case columns, one global record per key (no per-user auth
    # in the editor, so one shared config IS the store).
    create table(:editor_settings, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :value, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:editor_settings, [:key])
  end
end

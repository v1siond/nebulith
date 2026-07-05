defmodule Nebulith.Repo.Migrations.CreateGamesAndGameTemplates do
  use Ecto.Migration

  def change do
    # A GAME is a named flow of templates (many-to-many via game_templates). nebulith-owned tables —
    # snake_case columns (mapped to camelCase in the JSON view). We do NOT add an FK to the Prisma-owned
    # "Template" table (never constrain across owners); missing templates are filtered in the app.
    create table(:games, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :name, :string, null: false
      add :description, :string
      add :last_template_id, :string

      timestamps(type: :utc_datetime)
    end

    create table(:game_templates, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :game_id, references(:games, type: :binary_id, on_delete: :delete_all), null: false
      add :template_id, :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create index(:game_templates, [:game_id])
    create index(:game_templates, [:template_id])
    create unique_index(:game_templates, [:game_id, :template_id])
  end
end

defmodule Nebulith.Repo.Migrations.CreateGenerators do
  use Ecto.Migration

  def change do
    # MAP GENERATORS AS DATA (T-113). A generator used to be frontend code plus a scatter of
    # hardcoded constants — grid ranges in the page, settlement tuning in `villageLayout`, nature
    # densities and unit counts in `stageGenerator`.
    #
    # A CATEGORY is a map type the editor offers (forest / town / city / cave / temple) — the
    # `STAGE_VARIANTS` menu. A GENERATOR is one named, runnable configuration inside a category (a
    # forest's "Meadow" and "Meadow + River"; a town's default). Its knobs live in a jsonb `config`
    # for the same reason a tile's do: they are heterogeneous per category, the frontend reads them
    # as one typed blob, and adding a knob must not need a migration.
    create table(:generator_categories, primary_key: false) do
      add :id, :binary_id, primary_key: true

      # The engine's own variant id (`forest`/`town`/`city`/`cave`/`temple`) — the key the generate
      # call already speaks, so nothing has to translate names.
      add :key, :string, null: false
      add :name, :string, null: false
      add :description, :string
      # Menu order. The editor renders categories by this, never by insertion order or name.
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:generator_categories, [:key])

    create table(:generators, primary_key: false) do
      add :id, :binary_id, primary_key: true

      add :category_id,
          references(:generator_categories, type: :binary_id, on_delete: :delete_all), null: false

      add :key, :string, null: false
      add :name, :string, null: false
      add :description, :string
      # The engine LAYOUT id this generator runs (`meadow`, `meadow_river`), when its category has
      # named layouts. NULL = the category's default pass.
      add :layout, :string
      # The zones (seasons) this generator supports. Empty = every zone the editor offers.
      add :zones, {:array, :string}, null: false, default: []
      # Every knob the run takes: grid ranges + cell size, settlement tuning, nature densities,
      # unit counts, building materials/colours. Shape is documented on Catalog.Generator.
      add :config, :map, null: false, default: %{}
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:generators, [:key])
    create index(:generators, [:category_id])
  end
end

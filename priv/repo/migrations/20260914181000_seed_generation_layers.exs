defmodule Nebulith.Repo.Migrations.SeedGenerationLayers do
  @moduledoc """
  Puts the six layers we have into the table the migration before this one created.

  They were a hardcoded list in the engine and a second hardcoded list in the editor panel. They are rows now,
  which is what makes *"I just don't want anything hardcoded on the frontend"* true rather than aspirational.

  Idempotent: `upsert_generation_layer` goes by key, so re-running never duplicates a layer and never clobbers
  an edit made through the CRUD with whatever the code happens to say today.
  """
  use Ecto.Migration

  alias Nebulith.Catalog.GeneratorSource

  # ONLY A DATABASE THAT ALREADY HAS THE TABLE'S LATER SHAPE. This calls TODAY's seeder, and today's seeder
  # writes a `group` that a LATER migration adds, so on a database migrated from empty it selects a column
  # that does not exist yet and the whole run stops. A data migration edits data that is already there; a
  # database built from scratch gets its rows from priv/repo/seeds.exs, which runs against the final schema.
  def up, do: if(layers_table_ready?(), do: GeneratorSource.seed_generation_layers())

  defp layers_table_ready? do
    %{rows: [[count]]} =
      repo().query!("SELECT count(*) FROM information_schema.columns WHERE table_name = 'generation_layers' AND column_name = 'group'")

    count > 0
  end

  def down do
    # IRREVERSIBLE, and harmless: without rows the engine has no stack to run, so the useful "undo" is to fix
    # the rows rather than to delete them.
    :ok
  end
end

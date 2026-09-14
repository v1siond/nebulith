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

  def up, do: GeneratorSource.seed_generation_layers()

  def down do
    # IRREVERSIBLE, and harmless: without rows the engine has no stack to run, so the useful "undo" is to fix
    # the rows rather than to delete them.
    :ok
  end
end

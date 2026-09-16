defmodule Nebulith.DataMigration.SeedGenerationLayers do
  @moduledoc """
  Puts the layers into `generation_layers`.

  They were a hardcoded list in the engine and a second hardcoded list in the editor panel. They are rows
  now, which is what makes "nothing hardcoded on the frontend" true rather than aspirational.

  Idempotent: `upsert_generation_layer` goes by key, so re-running never duplicates a layer and never
  clobbers an edit made through the CRUD with whatever the code happens to say today.

  The migration this came out of had to check that the table's LATER shape existed before it dared call the
  seeder, because a seeder always writes today's columns and a migration runs against a half-built schema.
  A data migration runs after the FULL schema, so that guard is gone.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed_generation_layers()

    Logger.info("[data_migrate] generation layers seeded")
    :ok
  end
end

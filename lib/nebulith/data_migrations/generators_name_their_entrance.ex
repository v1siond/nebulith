defmodule Nebulith.DataMigration.GeneratorsNameTheirEntrance do
  @moduledoc """
  Each generator says which entrance its gates wear.

  It was a lookup table in the engine, variant to composition name, which is the thing that keeps getting
  pulled back out: the objects come from the backend and the frontend methods process them. It is a field on
  the generator's own config now, beside `crossings` and `trees`, so a template chooses its entrance the same
  way it chooses its bridge.

  A generator with no `entrance` gets no entrance stamped, which is the honest default: a bare opening.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] generators name their entrance")
    :ok
  end
end

defmodule Nebulith.Repo.Migrations.GeneratorsNameTheirEntrance do
  @moduledoc """
  Each generator says which entrance its gates wear.

  It was a lookup table in the engine, `variant -> composition name`, which is the thing he keeps pulling out:
  *"this should be backend data, we receive the existing objects from backend and are correctly processed by
  the frontend methods"*. It is a field on the generator's own config now, beside `crossings` and `trees`, so a
  template chooses its entrance the same way it chooses its bridge.

  A generator with no `entrance` gets no entrance stamped, which is the honest default: a bare opening.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down do
    # IRREVERSIBLE, and harmless: dropping the field stops an entrance being stamped and changes nothing else.
    :ok
  end

  defp generators_present?, do: repo().aggregate(from(g in "generators"), :count) > 0
end

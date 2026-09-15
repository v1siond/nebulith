defmodule Nebulith.Repo.Migrations.TheLayersPanelIsTheFilter do
  @moduledoc """
  The "Build up to" option is removed. It was a second control for something the panel already had.

  *"now we have a duplicated function in UI 'build up to', and below we have 'layers' which is the same
  thing"*, and *"stop using deumb retarted laberls like 'build up to', the guidelines require descriptive
  onliners, hence why layers was better"*.

  The layers panel is served from `generation_layers` and already names every layer in run order. Stopping the
  system at one of them is a thing to do WITH that list, not a second dropdown listing the same layers under a
  worse name. The engine keeps `upTo`, because the filter itself is right; what was wrong was adding a
  duplicate way to say it.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down, do: :ok

  defp generators_present?, do: repo().aggregate(from(g in "generators"), :count) > 0
end

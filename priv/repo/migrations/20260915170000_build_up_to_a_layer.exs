defmodule Nebulith.Repo.Migrations.BuildUpToALayer do
  @moduledoc """
  Every template that has pathways offers "Build up to", which stops the system at a layer.

  *"LAYOUT IN THE UI JUST REFERS TO I WANT TO ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER. IE: ONLY GIVE
  ME AN EMPTY MAP WITH ALL PATHWAYS, GIVE AN EMPTY MAP WITH A RIVER, GIVE THE FULL MAP, ETC. IS JUST A FILTER,
  ANOTHER PARAMETER FOR THE GENERATOR"*, and *"we should also have preview for the exits and pathways
  selected"*, which is this stopping at `pathways`.

  The choice keys ARE the layer keys, so the option cannot drift from the layers it names. Nothing is drawn
  differently for a stop: the engine runs the same stack and stops early, so a preview is the real ground and
  the real tiles rather than a sketch of them, which is what *"anything added should be part of tiles and/or
  objects"* asks for.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down, do: :ok

  defp generators_present?, do: repo().aggregate(from(g in "generators"), :count) > 0
end

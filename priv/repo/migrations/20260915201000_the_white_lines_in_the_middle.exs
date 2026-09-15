defmodule Nebulith.Repo.Migrations.TheWhiteLinesInTheMiddle do
  @moduledoc """
  The centre line is a COLOUR the backend serves, not a tile to look up.

  It named `road_center` and asked the frontend to wear that tile's colour. Two problems with that: the
  tileset describes `road_center` as a piece of road with a line drawn ON it, so its colour is asphalt grey,
  not the line; and the same label resolves to two different colours depending on whether it has variants,
  which is a lookup with two answers. The colour is measured off the reference instead, #eae7db, the median
  of the marking pixels lying on its asphalt.
  """
  use Ecto.Migration

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down, do: :ok

  defp generators_present? do
    %{rows: [[count]]} = repo().query!("SELECT count(*) FROM generators")
    count > 0
  end
end

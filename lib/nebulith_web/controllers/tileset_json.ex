defmodule NebulithWeb.TilesetJSON do
  alias Nebulith.Catalog.Tileset

  @doc """
  Renders a list of tilesets.
  """
  def index(%{tilesets: tilesets}) do
    %{data: for(tileset <- tilesets, do: data(tileset))}
  end

  @doc """
  Renders a single tileset.
  """
  def show(%{tileset: tileset}) do
    %{data: data(tileset)}
  end

  defp data(%Tileset{} = tileset) do
    %{
      id: tileset.id,
      key: tileset.key,
      name: tileset.name,
      data: tileset.data
    }
  end
end

defmodule NebulithWeb.TilesetJSON do
  alias Nebulith.Catalog.Tileset

  @doc """
  Renders a list of tilesets, each carrying its tiles + the (style-agnostic) compositions.
  """
  def index(%{tilesets: tilesets, compositions: comps}) do
    %{data: for(%{tileset: ts, tiles: tiles} <- tilesets, do: data_with_tiles(ts, tiles, comps))}
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

  defp data_with_tiles(%Tileset{} = ts, tiles, comps) do
    %{
      id: ts.id,
      key: ts.key,
      name: ts.name,
      data: ts.data,
      tiles: Map.new(tiles, fn t -> {t.label, tile_data(t)} end),
      compositions: Map.new(comps, fn c -> {c.name, comp_data(c)} end)
    }
  end

  defp tile_data(t) do
    %{
      image_url: t.image_url,
      blocking: t.blocking,
      height: t.height,
      category: t.category,
      title: t.title,
      glyph: t.glyph,
      emoji: t.emoji,
      color_role: t.color_role,
      settings: t.settings
    }
  end

  defp comp_data(c) do
    %{
      footprint: %{w: c.footprint_w, h: c.footprint_h},
      cells:
        Enum.map(
          c.cells,
          &%{dx: &1.dx, dy: &1.dy, level: &1.level, label: &1.label, walkable: &1.walkable}
        )
    }
  end
end

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
      title: c.title,
      # DETERMINISTIC cell order: the DB heap order is unstable (a reseed's delete+insert reuses tuple slots),
      # which would make the served list — and any fixture captured from it — reorder run to run. Sort by grid
      # position (dx, dy, level, label) so the payload is reproducible; the render is order-independent (every
      # cell carries its own dx/dy/level and the views depth-sort), so this only stabilises the data, not the look.
      cells: c.cells |> Enum.sort_by(&{&1.dx, &1.dy, &1.level, &1.label}) |> Enum.map(&cell_data/1)
    }
  end

  # `zIndex` (camelCase) so the frontend loader maps it straight onto CompositionCell.zIndex — the same
  # pass-through `scale` uses. The DB column is `z_index`; the JSON key the renderer reads is `zIndex`.
  # `animations` (the cell's default `Animation[]`) is added ONLY when the cell carries some — so every
  # non-animated cell serves byte-identically to before (only the fountain's water cells gain the key).
  defp cell_data(cell) do
    base = %{dx: cell.dx, dy: cell.dy, level: cell.level, label: cell.label, walkable: cell.walkable, scale: cell.scale, zIndex: cell.z_index}

    base
    |> maybe_put_animations(cell.animations)
    |> maybe_put_settings(cell.settings)
  end

  defp maybe_put_animations(base, nil), do: base
  defp maybe_put_animations(base, []), do: base
  defp maybe_put_animations(base, animations), do: Map.put(base, :animations, animations)

  # The cell's TUNED tile settings (camelCase keys authored in TileSource — `scaleY`/`display`/`pose`) ride
  # through VERBATIM, added ONLY when the cell carries some, so every untuned cell serves byte-identically to
  # before (only the lamp_post's post + bulb cells gain the key). stampComposition applies them onto the asset.
  defp maybe_put_settings(base, nil), do: base
  defp maybe_put_settings(base, settings), do: Map.put(base, :settings, settings)
end

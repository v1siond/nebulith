defmodule NebulithWeb.TemplateJSON do
  alias Nebulith.Catalog.Template

  @doc """
  Renders the template gallery list: `{templates, total, limit, offset}` with a LIGHT projection per row
  (no heavy grid blobs — `groundData`/`heightData`/`assetsData` are omitted, exactly like the old list API).
  """
  def index(%{templates: templates, total: total, limit: limit, offset: offset}) do
    %{
      templates: for(template <- templates, do: list_item(template)),
      total: total,
      limit: limit,
      offset: offset
    }
  end

  @doc "Renders a single template as the FULL record (all fields incl. the grid blobs) — a bare object."
  def show(%{template: template}), do: full(template)

  defp list_item(%Template{} = t) do
    %{
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      cols: t.cols,
      rows: t.rows,
      thumbnail: t.thumbnail,
      isPublic: t.isPublic,
      tags: t.tags,
      connectors: t.connectors,
      entities: t.entities,
      quests: t.quests,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }
  end

  defp full(%Template{} = t) do
    %{
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      cols: t.cols,
      rows: t.rows,
      cellSize: t.cellSize,
      isoScale: t.isoScale,
      spawnCol: t.spawnCol,
      spawnRow: t.spawnRow,
      groundData: t.groundData,
      heightData: t.heightData,
      assetsData: t.assetsData,
      connectors: t.connectors,
      entities: t.entities,
      quests: t.quests,
      thumbnail: t.thumbnail,
      isPublic: t.isPublic,
      tags: t.tags,
      authorId: t.authorId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }
  end
end

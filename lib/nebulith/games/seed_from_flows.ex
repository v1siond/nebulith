defmodule Nebulith.Games.SeedFromFlows do
  @moduledoc """
  One-time data migration: read the current templates + their connectors, find the connected FLOWS
  (connected components of ≥2 templates, undirected edges = `connector.targetTemplateId`), and create one
  persisted GAME per flow. Mirrors the frontend `deriveFlows`. Guarded — only seeds when there are no
  games yet, so re-running is a no-op.
  """
  import Ecto.Query
  alias Nebulith.Repo
  alias Nebulith.Catalog.Template
  alias Nebulith.Games
  alias Nebulith.Games.Game

  def run do
    if Repo.aggregate(Game, :count, :id) > 0 do
      {:skipped, :games_already_exist}
    else
      templates = Repo.all(from(t in Template, select: %{id: t.id, name: t.name, connectors: t.connectors}))

      created =
        templates
        |> derive_flows()
        |> Enum.map(fn f ->
          {:ok, g} =
            Games.create_game(%{
              "name" => f.name,
              "templateIds" => f.template_ids,
              "lastTemplateId" => f.entry
            })

          %{id: g.id, name: f.name, count: length(f.template_ids)}
        end)

      {:created, created}
    end
  end

  @doc "Connected components (>=2) of the template connector graph → ordered flows. Pure."
  def derive_flows(templates) do
    ids = MapSet.new(templates, & &1.id)
    by_id = Map.new(templates, &{&1.id, &1})
    {adj, indeg} = build_graph(templates, ids)

    {_seen, flows} =
      Enum.reduce(templates, {MapSet.new(), []}, fn t, {seen, flows} ->
        if MapSet.member?(seen, t.id) do
          {seen, flows}
        else
          {comp, seen} = bfs([t.id], adj, MapSet.put(seen, t.id), [])

          if length(comp) < 2 do
            {seen, flows}
          else
            entry = entry_of(comp, indeg)
            {ordered, _} = bfs([entry], adj, MapSet.new([entry]), [])
            name = get_in(by_id, [entry, :name]) || "Flow"
            {seen, [%{name: name, template_ids: ordered, entry: entry} | flows]}
          end
        end
      end)

    Enum.reverse(flows)
  end

  defp build_graph(templates, ids) do
    base_adj = Map.new(templates, &{&1.id, MapSet.new()})
    base_indeg = Map.new(templates, &{&1.id, 0})

    Enum.reduce(templates, {base_adj, base_indeg}, fn t, acc ->
      Enum.reduce(t.connectors || [], acc, fn c, {adj, indeg} ->
        tgt = conn_target(c)

        if tgt && MapSet.member?(ids, tgt) && tgt != t.id do
          adj = adj |> put_edge(t.id, tgt) |> put_edge(tgt, t.id)
          {adj, Map.update(indeg, tgt, 1, &(&1 + 1))}
        else
          {adj, indeg}
        end
      end)
    end)
  end

  defp conn_target(c) when is_map(c), do: c["targetTemplateId"] || c[:targetTemplateId]
  defp conn_target(_), do: nil

  defp put_edge(adj, a, b), do: Map.update(adj, a, MapSet.new([b]), &MapSet.put(&1, b))

  defp bfs([], _adj, seen, acc), do: {Enum.reverse(acc), seen}

  defp bfs([id | q], adj, seen, acc) do
    neighbours = adj |> Map.get(id, MapSet.new()) |> MapSet.to_list() |> Enum.sort()

    {q, seen} =
      Enum.reduce(neighbours, {q, seen}, fn n, {q, seen} ->
        if MapSet.member?(seen, n), do: {q, seen}, else: {q ++ [n], MapSet.put(seen, n)}
      end)

    bfs(q, adj, seen, [id | acc])
  end

  defp entry_of(comp, indeg) do
    case comp |> Enum.filter(&((indeg[&1] || 0) == 0)) |> Enum.sort() do
      [source | _] -> source
      [] -> comp |> Enum.sort() |> hd()
    end
  end
end

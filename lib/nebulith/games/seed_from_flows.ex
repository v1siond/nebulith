defmodule Nebulith.Games.SeedFromFlows do
  @moduledoc """
  One-time data migration: read the current templates + their connectors, find the connected FLOWS
  (connected components of ≥2 templates, undirected edges = `connector.targetTemplateId`), and create one
  persisted GAME per flow. Mirrors the frontend `deriveFlows`. Guarded, only seeds when there are no
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
      templates =
        Repo.all(from(t in Template, select: %{id: t.id, name: t.name, connectors: t.connectors}))

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
      Enum.reduce(templates, {MapSet.new(), []}, &collect_flow(&1, &2, adj, indeg, by_id))

    Enum.reverse(flows)
  end

  # One template's component, if it has not already been walked as part of somebody else's.
  defp collect_flow(template, {seen, flows}, adj, indeg, by_id) do
    case MapSet.member?(seen, template.id) do
      true -> {seen, flows}
      false -> walk_component(template, seen, flows, adj, indeg, by_id)
    end
  end

  defp walk_component(template, seen, flows, adj, indeg, by_id) do
    {component, seen} = bfs([template.id], adj, MapSet.put(seen, template.id), [])
    {seen, flow_from(component, flows, adj, indeg, by_id)}
  end

  # A FLOW IS TWO TEMPLATES OR MORE. One map connected to nothing is a map, not a journey through maps.
  defp flow_from([_only], flows, _adj, _indeg, _by_id), do: flows
  defp flow_from([], flows, _adj, _indeg, _by_id), do: flows

  defp flow_from(component, flows, adj, indeg, by_id) do
    entry = entry_of(component, indeg)
    {ordered, _} = bfs([entry], adj, MapSet.new([entry]), [])
    name = get_in(by_id, [entry, :name]) || "Flow"
    [%{name: name, template_ids: ordered, entry: entry} | flows]
  end

  defp build_graph(templates, ids) do
    base_adj = Map.new(templates, &{&1.id, MapSet.new()})
    base_indeg = Map.new(templates, &{&1.id, 0})

    Enum.reduce(templates, {base_adj, base_indeg}, &link_connectors(&1, &2, ids))
  end

  defp link_connectors(template, acc, ids) do
    Enum.reduce(template.connectors || [], acc, fn connector, graph ->
      add_edge(conn_target(connector), template.id, ids, graph)
    end)
  end

  # A connector that names nothing, names itself, or names a template this game does not hold is not
  # an edge. Each of those is its own clause rather than three conditions joined by ands.
  defp add_edge(nil, _from, _ids, graph), do: graph
  defp add_edge(target, from, _ids, graph) when target == from, do: graph

  defp add_edge(target, from, ids, {adj, indeg} = graph) do
    case MapSet.member?(ids, target) do
      false ->
        graph

      true ->
        {adj |> put_edge(from, target) |> put_edge(target, from),
         Map.update(indeg, target, 1, &(&1 + 1))}
    end
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

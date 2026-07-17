defmodule Nebulith.Games do
  @moduledoc """
  The Games context. A game is a named flow of templates (many-to-many, ordered, via `game_templates`).
  `create_game`/`update_game` accept the frontend's camelCase `templateIds` (ordered) and `lastTemplateId`
  and keep the join table in sync.
  """
  import Ecto.Query, warn: false
  alias Nebulith.Repo
  alias Nebulith.Games.{Game, GameTemplate}

  @doc "All games, each with its ordered template ids preloaded, newest name first."
  def list_games do
    Repo.all(from(g in Game, order_by: [asc: g.name])) |> Enum.map(&preload_ordered/1)
  end

  @doc "One game with its ordered templates. Raises if missing."
  def get_game!(id), do: Repo.get!(Game, id) |> preload_ordered()

  @doc "Ordered template ids of a (loaded) game."
  def template_ids(%Game{game_templates: gts}) when is_list(gts),
    do: Enum.map(gts, & &1.template_id)

  def template_ids(_), do: []

  def create_game(attrs) do
    attrs = normalize(attrs)

    with {:ok, game} <- %Game{} |> Game.changeset(attrs) |> Repo.insert() do
      {:ok, sync_templates(game, attrs)}
    end
  end

  def update_game(%Game{} = game, attrs) do
    attrs = normalize(attrs)

    with {:ok, game} <- game |> Game.changeset(attrs) |> Repo.update() do
      {:ok, sync_templates(game, attrs)}
    end
  end

  def delete_game(%Game{} = game), do: Repo.delete(game)

  # ── template membership ─────────────────────────────────────────────────────

  @doc "Replace a game's templates with an ordered list of template ids (positions 0..n)."
  def set_templates(%Game{} = game, template_ids) when is_list(template_ids) do
    Repo.transaction(fn ->
      Repo.delete_all(from(gt in GameTemplate, where: gt.game_id == ^game.id))

      template_ids
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.uniq()
      |> Enum.with_index()
      |> Enum.each(fn {tid, i} ->
        Repo.insert!(%GameTemplate{game_id: game.id, template_id: tid, position: i})
      end)
    end)

    get_game!(game.id)
  end

  @doc "Append a template to a game (idempotent — no-op if already a member)."
  def add_template(%Game{} = game, template_id) do
    next = Repo.one(from(gt in GameTemplate, where: gt.game_id == ^game.id, select: count())) || 0

    %GameTemplate{}
    |> GameTemplate.changeset(%{game_id: game.id, template_id: template_id, position: next})
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:game_id, :template_id])

    get_game!(game.id)
  end

  @doc "Remove a template from a game."
  def remove_template(%Game{} = game, template_id) do
    Repo.delete_all(
      from(gt in GameTemplate, where: gt.game_id == ^game.id and gt.template_id == ^template_id)
    )

    get_game!(game.id)
  end

  # ── helpers ─────────────────────────────────────────────────────────────────
  defp preload_ordered(game),
    do: Repo.preload(game, game_templates: from(gt in GameTemplate, order_by: [asc: gt.position]))

  # only touch the join when the caller actually sent `templateIds`
  defp sync_templates(game, attrs) do
    case Map.get(attrs, "templateIds") do
      ids when is_list(ids) -> set_templates(game, ids)
      _ -> get_game!(game.id)
    end
  end

  # map the frontend's camelCase into the schema's snake_case (and keep `templateIds` for sync_templates)
  defp normalize(attrs) do
    attrs
    |> stringify_keys()
    |> rename("lastTemplateId", "last_template_id")
  end

  defp stringify_keys(attrs) do
    Map.new(attrs, fn {k, v} -> {to_string(k), v} end)
  end

  defp rename(attrs, from, to) do
    case Map.pop(attrs, from) do
      {nil, rest} -> rest
      {val, rest} -> Map.put(rest, to, val)
    end
  end
end

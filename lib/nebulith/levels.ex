defmodule Nebulith.Levels do
  @moduledoc """
  The Levels context, the layer between a game and its maps.

  and on why it is a real layer: Five maps, one level.

  Ordering is by `position` everywhere, and a level's maps come back ordered, the editor renders the list it
  is given without sorting, so the order is the API's job.
  """
  import Ecto.Query, warn: false

  alias Nebulith.Repo
  alias Nebulith.Games.{Level, LevelTemplate}

  @doc "Every level in a game, in play order, each carrying its ordered map ids."
  def list_levels(game_id) do
    Repo.all(
      from(l in Level,
        where: l.game_id == ^game_id,
        order_by: [asc: l.position, asc: l.inserted_at]
      )
    )
    |> Enum.map(&preload_ordered/1)
  end

  @doc "One level with its ordered maps, or `{:error, :not_found}`, never a raise, so the controller's
  fallback can turn a miss into a real 404 instead of a 500."
  def get_level(id) do
    case Repo.get(Level, id) do
      nil -> {:error, :not_found}
      level -> {:ok, preload_ordered(level)}
    end
  end

  @doc "The ordered template ids of a loaded level."
  def template_ids(%Level{level_templates: lts}) when is_list(lts),
    do: Enum.map(lts, & &1.template_id)

  def template_ids(_), do: []

  @doc """
  Create a level in a game. `position` defaults to the END of the list rather than 0, because a new level is
  the next one you are building, and defaulting to 0 would collide with the level already sitting there.
  """
  def create_level(game_id, attrs) do
    attrs =
      attrs
      |> normalize()
      |> Map.put("game_id", game_id)
      |> Map.put_new_lazy("position", fn -> next_position(game_id) end)

    with {:ok, level} <- %Level{} |> Level.changeset(attrs) |> Repo.insert() do
      {:ok, sync_templates(level, attrs)}
    end
  end

  def update_level(%Level{} = level, attrs) do
    attrs = normalize(attrs)

    with {:ok, level} <- level |> Level.changeset(attrs) |> Repo.update() do
      {:ok, sync_templates(level, attrs)}
    end
  end

  def delete_level(%Level{} = level), do: Repo.delete(level)

  @doc """
  Replace a level's maps with exactly this ordered list.

  Delete-then-insert rather than a diff: the list is short, the order is the whole point, and a diff that has
  to renumber positions is more ways to be wrong than rewriting six rows.
  """
  def set_templates(%Level{} = level, template_ids) when is_list(template_ids) do
    Repo.delete_all(from(lt in LevelTemplate, where: lt.level_id == ^level.id))

    template_ids
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.uniq()
    |> Enum.with_index()
    |> Enum.each(fn {template_id, i} ->
      %LevelTemplate{}
      |> LevelTemplate.changeset(%{level_id: level.id, template_id: template_id, position: i})
      |> Repo.insert!()
    end)

    preload_ordered(level)
  end

  @doc "Add one map to the end of a level. Already there → unchanged, so the call is idempotent."
  def add_template(%Level{} = level, template_id) do
    level = preload_ordered(level)

    if template_id in template_ids(level) do
      level
    else
      set_templates(level, template_ids(level) ++ [template_id])
    end
  end

  @doc "Drop one map from a level, keeping the rest in order."
  def remove_template(%Level{} = level, template_id) do
    level = preload_ordered(level)
    set_templates(level, Enum.reject(template_ids(level), &(&1 == template_id)))
  end

  @doc "Reorder a game's levels to exactly this list of ids, first to last."
  def reorder(game_id, level_ids) when is_list(level_ids) do
    # Two passes, out of the way and back. A single pass renumbering in place trips the
    # (game_id, position) unique index the moment two levels swap.
    from(l in Level, where: l.game_id == ^game_id)
    |> Repo.update_all(inc: [position: 10_000])

    level_ids
    |> Enum.with_index()
    |> Enum.each(fn {id, i} ->
      from(l in Level, where: l.id == ^id and l.game_id == ^game_id)
      |> Repo.update_all(set: [position: i])
    end)

    list_levels(game_id)
  end

  defp next_position(game_id) do
    case Repo.one(from(l in Level, where: l.game_id == ^game_id, select: max(l.position))) do
      nil -> 0
      max -> max + 1
    end
  end

  defp preload_ordered(%Level{} = level) do
    Repo.preload(
      level,
      [level_templates: from(lt in LevelTemplate, order_by: [asc: lt.position])],
      force: true
    )
  end

  defp sync_templates(level, attrs) do
    case Map.get(attrs, "template_ids") do
      ids when is_list(ids) -> set_templates(level, ids)
      _ -> preload_ordered(level)
    end
  end

  # The frontend speaks camelCase; the schema speaks snake_case. One translation, here, so no controller has
  # to know about both.
  defp normalize(attrs) do
    attrs
    |> Enum.map(fn
      {"templateIds", v} -> {"template_ids", v}
      {:templateIds, v} -> {"template_ids", v}
      {k, v} when is_atom(k) -> {Atom.to_string(k), v}
      pair -> pair
    end)
    |> Map.new()
  end
end

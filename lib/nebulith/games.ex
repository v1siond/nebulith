defmodule Nebulith.Games do
  @moduledoc """
  The Games context. A game is a named flow of templates (many-to-many, ordered, via `game_templates`).
  `create_game`/`update_game` accept the frontend's camelCase `templateIds` (ordered) and `lastTemplateId`
  and keep the join table in sync.
  """
  import Ecto.Query, warn: false
  alias Nebulith.Repo
  alias Nebulith.Games.{Game, GameSettings, GameTemplate}

  @doc """
  The games this person may SEE, each with its ordered template ids, by name.

  `docs/AUTH.md` §5b. The acting user is an argument rather than something the controller remembers to
  check, because a check a caller has to remember is a check a caller will forget. Measured before this
  existed: `list_games/0` returned every game to every signed-in person, and `owner_id` appeared nowhere
  in `lib/nebulith_web` or `lib/nebulith/games` at all.
  """
  def list_games(user) do
    visible(user)
    |> order_by([g], asc: g.name)
    |> Repo.all()
    |> Enum.map(&preload_ordered/1)
  end

  @doc "One game this person may see, with its ordered templates, or nil."
  def get_game(user, id) do
    case Repo.one(from(g in visible(user), where: g.id == ^id)) do
      nil -> nil
      game -> preload_ordered(game)
    end
  end

  @doc """
  One game this person may see. Raises if there is none, which is what a controller wants.

  A game they may NOT see raises the same as one that does not exist. `docs/AUTH.md` §5b: telling a
  stranger that a game exists but is not theirs is itself a disclosure.
  """
  def get_game!(user, id) do
    case get_game(user, id) do
      nil -> raise Ecto.NoResultsError, queryable: Game
      game -> game
    end
  end

  @doc "Ordered template ids of a (loaded) game."
  def template_ids(%Game{game_templates: gts}) when is_list(gts),
    do: Enum.map(gts, & &1.template_id)

  def template_ids(_), do: []

  @doc "Creates a game BELONGING to this person."
  def create_game(user, attrs) do
    attrs = attrs |> normalize() |> Elixir.Map.put("owner_id", owner_id(user))

    with {:ok, game} <- %Game{} |> Game.changeset(attrs) |> Repo.insert() do
      settings_for(game, attrs)
      {:ok, sync_templates(game, attrs)}
    end
  end

  @doc """
  A GAME'S SETTINGS, made with the game and never missing.

  `docs/SPEC.md` §3.1 declares the table; phase 1 created it and stopped there. A settings row that exists
  only sometimes is worse than none: every reader then needs a default of its own, which is the invented
  value law 7 forbids. So a game gets its row when it is made, carrying the column defaults, and
  `settings/1` answers one for a game made before this existed.
  """
  def settings(%Game{} = game), do: settings(game.id)

  def settings(game_id) do
    case Repo.get_by(GameSettings, game_id: game_id) do
      nil -> create_settings(game_id, %{})
      found -> found
    end
  end

  @doc """
  Changes a game's settings. `{:error, :not_found}` when the game is not this person's.

  The map ceiling lives here because it is a NUMBER a person sets, not a constant an engine holds
  (law 12, D18). Raising it is how a bigger map becomes possible.
  """
  def update_settings(user, game_id, attrs) do
    with {:ok, game} <- own(user, game_id) do
      game
      |> settings()
      |> GameSettings.changeset(normalize(attrs))
      |> Repo.update()
    end
  end

  defp settings_for(game, attrs) do
    create_settings(game.id, Elixir.Map.take(normalize(attrs), settings_keys()))
  end

  defp create_settings(game_id, attrs) do
    {:ok, settings} =
      %GameSettings{}
      |> GameSettings.changeset(Elixir.Map.put(attrs, "game_id", game_id))
      |> Repo.insert(on_conflict: :nothing, conflict_target: [:game_id])

    settings || Repo.get_by!(GameSettings, game_id: game_id)
  end

  defp settings_keys do
    for field <- GameSettings.__schema__(:fields), do: to_string(field)
  end

  @doc """
  Updates a game this person OWNS.

  `{:error, :not_found}` when it is not theirs, the same answer as a game that does not exist, and
  nothing is written.
  """
  def update_game(user, id, attrs) do
    with {:ok, game} <- own(user, id) do
      attrs = normalize(attrs)

      with {:ok, game} <- game |> Game.changeset(attrs) |> Repo.update() do
        {:ok, sync_templates(game, attrs)}
      end
    end
  end

  @doc "Deletes a game this person owns. `{:error, :not_found}` otherwise, and nothing is deleted."
  def delete_game(user, id) do
    with {:ok, game} <- own(user, id), do: Repo.delete(game)
  end

  # WHAT THIS PERSON MAY SEE, as a query, so every read composes from one definition of the rule.
  # An admin sees everything; everyone else sees their own plus anything not private.
  defp visible(%{is_admin: true}), do: from(g in Game)

  defp visible(user) do
    id = owner_id(user)
    from(g in Game, where: g.owner_id == ^id or g.visibility != "private")
  end

  # WHAT THIS PERSON MAY CHANGE, which is narrower than what they may see: a public game is readable by
  # everyone and writable by its owner alone.
  defp own(%{is_admin: true} = _user, id) do
    case Repo.get(Game, id) do
      nil -> {:error, :not_found}
      game -> {:ok, game}
    end
  end

  defp own(user, id) do
    case Repo.get_by(Game, id: id, owner_id: owner_id(user)) do
      nil -> {:error, :not_found}
      game -> {:ok, game}
    end
  end

  # RELOAD AFTER A WRITE, with no authorisation check. The caller already passed one to get here, and
  # re-running it on an internal reload would be a second gate on a decision already made.
  defp reload(id), do: Game |> Repo.get!(id) |> preload_ordered()

  defp owner_id(%{id: id}), do: id
  defp owner_id(id) when is_binary(id), do: id

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

    reload(game.id)
  end

  @doc "Append a template to a game (idempotent, no-op if already a member)."
  def add_template(%Game{} = game, template_id) do
    next = Repo.one(from(gt in GameTemplate, where: gt.game_id == ^game.id, select: count())) || 0

    %GameTemplate{}
    |> GameTemplate.changeset(%{game_id: game.id, template_id: template_id, position: next})
    |> Repo.insert(on_conflict: :nothing, conflict_target: [:game_id, :template_id])

    reload(game.id)
  end

  @doc "Remove a template from a game."
  def remove_template(%Game{} = game, template_id) do
    Repo.delete_all(
      from(gt in GameTemplate, where: gt.game_id == ^game.id and gt.template_id == ^template_id)
    )

    reload(game.id)
  end

  # ── helpers ─────────────────────────────────────────────────────────────────
  defp preload_ordered(game),
    do: Repo.preload(game, game_templates: from(gt in GameTemplate, order_by: [asc: gt.position]))

  # only touch the join when the caller actually sent `templateIds`
  defp sync_templates(game, attrs) do
    case Map.get(attrs, "templateIds") do
      ids when is_list(ids) -> set_templates(game, ids)
      _ -> reload(game.id)
    end
  end

  # EVERY FIELD, ASKED OF THE SCHEMA. The frontend spells a field `lastTemplateId` and the column is
  # `last_template_id`, so something has to translate. It was a list of renames typed out by hand, which is
  # law 10: *"Anything that copies a record field by field must be generated from the schema, never typed
  # out."* It carried one entry, and the field added beside it (`default_tileset_id`) would have arrived as
  # `defaultTilesetId`, matched nothing, and been dropped by `cast` without a word.
  #
  # A key that is not a field passes through untouched, which is how `templateIds` still reaches
  # `sync_templates` on the other side.
  # `last_template_id` -> `lastTemplateId`, the spelling the frontend uses.
  defp lower_camel(name) do
    [first | rest] = String.split(name, "_")
    Enum.join([first | Enum.map(rest, &String.capitalize/1)])
  end

  # A function rather than a module attribute: an attribute is evaluated while the module is still being
  # defined, so it cannot call one of the module's own functions.
  defp by_camel do
    Map.new(Game.__schema__(:fields), fn field ->
      {field |> to_string() |> lower_camel(), to_string(field)}
    end)
  end

  defp normalize(attrs) do
    spelling = by_camel()

    attrs
    |> stringify_keys()
    |> Map.new(fn {key, value} -> {Map.get(spelling, key, key), value} end)
  end

  defp stringify_keys(attrs) do
    Map.new(attrs, fn {k, v} -> {to_string(k), v} end)
  end
end

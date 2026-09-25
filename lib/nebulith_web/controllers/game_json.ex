defmodule NebulithWeb.GameJSON do
  alias Nebulith.Games.Game

  def index(%{games: games}), do: %{games: for(game <- games, do: data(game))}

  def show(%{game: game}), do: data(game)

  defp data(%Game{} = game) do
    %{
      id: game.id,
      name: game.name,
      description: game.description,
      lastTemplateId: game.last_template_id,
      defaultTilesetId: game.default_tileset_id,
      templateIds: for(gt <- members(game), do: gt.template_id),
      # EVERY SETTING, ASKED OF THE SCHEMA. Typing the five out here is the hand-written field list law 10
      # names, and it is how a column added to the table would be served by nothing and quietly unreachable.
      settings: settings(game)
    }
  end

  defp settings(%Game{} = game) do
    game
    |> Nebulith.Games.settings()
    |> Elixir.Map.take(Nebulith.Games.GameSettings.served_fields())
  end

  # game_templates is preloaded (ordered) by the context; guard against a not-loaded assoc just in case.
  defp members(%Game{game_templates: gts}) when is_list(gts), do: gts
  defp members(_), do: []
end

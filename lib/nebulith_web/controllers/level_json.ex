defmodule NebulithWeb.LevelJSON do
  alias Nebulith.Games.Level
  alias Nebulith.Levels

  @doc "A game's levels, in play order."
  def index(%{levels: levels}), do: %{data: for(l <- levels, do: level(l))}

  @doc "One level."
  def show(%{level: level}), do: level(level)

  defp level(%Level{} = l) do
    %{
      id: l.id,
      gameId: l.game_id,
      name: l.name,
      description: l.description,
      position: l.position,
      # The maps this level is built from, in order.
      templateIds: Levels.template_ids(l),
      createdAt: l.inserted_at,
      updatedAt: l.updated_at
    }
  end
end

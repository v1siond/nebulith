defmodule Nebulith.Games.GameTemplate do
  @moduledoc "Join row: an ordered membership of a template in a game. `template_id` points at the Prisma-owned Template (no cross-owner FK)."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "game_templates" do
    field :template_id, :string
    field :position, :integer, default: 0

    belongs_to :game, Nebulith.Games.Game

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(game_template, attrs) do
    game_template
    |> cast(attrs, [:template_id, :position, :game_id])
    |> validate_required([:template_id, :game_id])
  end
end

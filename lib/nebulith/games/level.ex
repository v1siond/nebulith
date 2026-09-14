defmodule Nebulith.Games.Level do
  @moduledoc """
  A LEVEL — the layer between a game and its maps.

  And on why it has to be a real layer rather than a naming convention:

  That last part is the whole reason this table exists. Four caves and a jungle are FIVE maps that are ONE
  level, and there was previously nowhere to say so.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "levels" do
    field :name, :string
    field :description, :string
    field :position, :integer, default: 0

    belongs_to :game, Nebulith.Games.Game
    has_many :level_templates, Nebulith.Games.LevelTemplate, on_replace: :delete

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(level, attrs) do
    level
    |> cast(attrs, [:name, :description, :position, :game_id])
    |> validate_required([:name, :game_id])
    |> unique_constraint([:game_id, :position], name: :levels_game_id_position_index)
  end
end

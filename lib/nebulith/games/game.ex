defmodule Nebulith.Games.Game do
  @moduledoc "A GAME — a named flow of templates (many-to-many via `game_templates`). Own properties + a `last_template_id` (the template the game reopens to)."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "games" do
    field :name, :string
    field :description, :string
    field :last_template_id, :string

    has_many :game_templates, Nebulith.Games.GameTemplate, on_replace: :delete

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(game, attrs) do
    game
    |> cast(attrs, [:name, :description, :last_template_id])
    |> validate_required([:name])
  end
end

defmodule Nebulith.Games.Game do
  @moduledoc "A GAME, a named flow of templates (many-to-many via `game_templates`). Own properties + a `last_template_id` (the template the game reopens to)."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "games" do
    field :name, :string
    field :description, :string
    field :last_template_id, :string

    # THE ART STYLE A GAME'S MAPS START IN, with a per-map override on `maps.tileset_id`.
    # `docs/SPEC.md` phase 1 REWIRE, quoting him: *"I like the versatility of having one art style per
    # map, but I do want to be able to set the default at the game table level instead of hardcoding
    # ascii."* The column existed and the SCHEMA did not declare it, so nothing could read it and nothing
    # did, which is section 6 invariant 7: a column with no reader is a knob that does nothing.
    field :default_tileset_id, :integer

    # WHO IT BELONGS TO, and who else may see it. `docs/AUTH.md` §5b.
    #
    # Both columns existed in the database and NEITHER was declared here, which is why nothing could read
    # them and nothing did: `Games.list_games/0` returned every game to every signed-in person and
    # `update_game/2` took any id. A column the schema does not name is a column the application cannot
    # enforce, and it reads from the outside exactly like a rule that is being followed.
    field :owner_id, :binary_id
    field :visibility, :string, default: "private"

    has_many :game_templates, Nebulith.Games.GameTemplate, on_replace: :delete

    # A game is a list of LEVELS, and a level is a list of maps., Mario, then 1-1 / 1-2 / 1-3, then the maps each of
    # those is built from.
    has_many :levels, Nebulith.Games.Level, on_replace: :delete, preload_order: [asc: :position]

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(game, attrs) do
    game
    |> cast(attrs, [
      :name,
      :description,
      :last_template_id,
      :default_tileset_id,
      :owner_id,
      :visibility
    ])
    |> validate_required([:name])
  end
end

defmodule Nebulith.Games.LevelTemplate do
  @moduledoc """
  Join row: an ordered membership of a map in a LEVEL.

  `template_id` points at the Prisma-owned Template table, so there is no FK across owners — the same rule
  `game_templates` follows, and the reason both filter missing templates in the app rather than in the schema.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "level_templates" do
    field :template_id, :string
    field :position, :integer, default: 0

    belongs_to :level, Nebulith.Games.Level

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(level_template, attrs) do
    level_template
    |> cast(attrs, [:template_id, :position, :level_id])
    |> validate_required([:template_id, :level_id])
    |> unique_constraint([:level_id, :template_id], name: :level_templates_level_id_template_id_index)
  end
end

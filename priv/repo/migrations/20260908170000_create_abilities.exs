defmodule Nebulith.Repo.Migrations.CreateAbilities do
  @moduledoc """
  The ABILITY REGISTRY — §3.14b's #2 violation.

  `game/abilities.ts` declared 13 abilities (name, description, category, cooldown, and a
  damage/healing/shield/debuff effect) as frontend constants. belongs in the backend.

  `animation` names the FX tile the ability plays. That tile row already carries the ability's COLOUR in its
  own settings — which is why §3.14b called the old `ABILITY_TINT` map a duplicate of nine hexes the API was
  already serving, and why there is no colour column here: the tint is the tile's, resolved by label.
  """
  use Ecto.Migration

  def change do
    create table(:abilities) do
      add :slug, :string, null: false
      add :name, :string, null: false
      add :description, :text
      # offensive | defensive | healing | debuff — the bucket the browse modal groups by.
      add :category, :string, null: false
      # The FX tile label this ability plays (and takes its tint from).
      add :animation, :string
      add :cooldown_ms, :integer, null: false, default: 0
      # damage / healing / shield / debuff — one shape per category, so it is a map not columns.
      add :effect, :map, null: false, default: %{}
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:abilities, [:slug])
  end
end

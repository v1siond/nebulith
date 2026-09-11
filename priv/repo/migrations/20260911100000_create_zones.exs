defmodule Nebulith.Repo.Migrations.CreateZones do
  use Ecto.Migration

  @moduledoc """
  SEASONS AS DATA — the last big table the frontend still authored.

  `src/engine/zones.ts` held 302 lines of per-season values: ground palettes, the hazard and trail tile, the
  tree / decor / flower tile each season wears, its flower variants, and its temple and cave palettes. The
  file said where it belonged in its own comment: *"The true model end-state is these palettes living in the
  Nebulith backend"*.

  Alexander, 2026-09-10: *"any data that changes per level, per template ... basically anything that is DATA
  should be moved to the backend, the frontend just processes the data algorithmically"*.

  One row per season, with each group as jsonb: they are read whole by the generator, they differ in shape
  between groups, and adding a knob to one must not need a migration. The season-INDEPENDENT tables (tree
  shape weights, rock shades, cave decor, prop art) are not per-zone, so they go in `game_rules` instead of
  being repeated seven times.
  """

  def change do
    create table(:zones, primary_key: false) do
      add :id, :binary_id, primary_key: true
      # The engine's own zone id (spring / summer / …) — the key every generate call already speaks.
      add :key, :string, null: false
      add :name, :string, null: false
      add :position, :integer, null: false, default: 0
      # groundTypes / hazard / trail / wallColor / accentColor
      add :palette, :map, null: false, default: %{}
      # The curated catalog tile this season wears for tree / decor / flower.
      add :tiles, :map, null: false, default: %{}
      # The bloom variants it scatters, or null for a season that does not flower.
      add :flowers, :map
      add :temple, :map, null: false, default: %{}
      add :cave, :map, null: false, default: %{}

      timestamps(type: :utc_datetime)
    end

    create unique_index(:zones, [:key])
  end
end

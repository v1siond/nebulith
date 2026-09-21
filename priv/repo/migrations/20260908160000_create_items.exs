defmodule Nebulith.Repo.Migrations.CreateItems do
  @moduledoc """
  The ITEM CATALOG — §3.14b's #1 violation, the largest single block of game data living in the frontend.

  `game/gear.ts` declared 6 weapons, 10 armour pieces and 5 consumables with complete stat blocks
  (`baseDamage: 12, baseDefense: 2, strengthBonus: 3, reachCells: 1`) plus the two starter kits, in a file
  nothing validated.

  The art already lives here — the weapon TILES are seeded with baked PNGs and poses
  (`priv/repo/tilesets/emoji.json`), so only the numbers were missing.

  ## Shape

  The queryable facts get columns: what it is (`slot`), what family (`kind`), what it is called, and where
  it sorts. The STAT BLOCK is jsonb, because a weapon's block and an armour piece's block are genuinely
  different shapes and forcing them into one wide table would give every row a dozen null columns.

  `starter_kits` names the kits a row belongs to, so "the warrior starts with a sword and shield" is data
  rather than a second hardcoded list.
  """
  use Ecto.Migration

  def change do
    create table(:items) do
      add :slug, :string, null: false
      add :name, :string, null: false
      # 'weapon' | 'armor' | 'consumable' — the loadout slot family the item can occupy.
      add :slot, :string, null: false
      # The material/型 within the slot: sword/axe/bow/gun/staff/shield, iron/leather, or null.
      add :kind, :string

      # The stat block, shaped by `slot`. A weapon carries baseDamage/reachCells/hands/…; armour carries
      # defenseBonus/dodgeBonus/its gear slot; a consumable carries its effect.
      add :stats, :map, null: false, default: %{}
      # Which starter kits include this item ("warrior", "magician"). Empty = catalog-only.
      add :starter_kits, {:array, :string}, null: false, default: []
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:items, [:slug])
    create index(:items, [:slot])
  end
end

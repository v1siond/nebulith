defmodule Nebulith.Repo.Migrations.AKeyIsOneKeyHoweverItIsTyped do
  @moduledoc """
  `tilesets.key` and `tiles.label` become case-insensitive, which is what `citext` means.

  `docs/SPEC.md` §3.1 declares both as `citext ... UK`. They were plain unique indexes, so `ascii` and
  `ASCII` were two different art styles and `Door` and `door` were two different tiles. Nothing would say
  so: the second one simply exists, and every reader that asks for one of them gets whichever it named.

  There is no citext extension on this database. Phase 1 set the pattern for that and this follows it: a
  unique index on `lower(...)`, which is the same guarantee by a different route.

  Measured before the change: 374 labels, none with an uppercase letter, and no two that collide only by
  case. So this constrains what can be added rather than rejecting anything that exists.
  """
  use Ecto.Migration

  def up do
    drop index(:tilesets, [:key])
    create unique_index(:tilesets, ["lower(key)"], name: :tilesets_key_index)

    drop index(:tiles, [:tileset_id, :label])

    create unique_index(:tiles, [:tileset_id, "lower(label)"],
             name: :tiles_tileset_id_label_index
           )
  end

  def down do
    drop index(:tiles, [:tileset_id, "lower(label)"], name: :tiles_tileset_id_label_index)
    create unique_index(:tiles, [:tileset_id, :label])

    drop index(:tilesets, ["lower(key)"], name: :tilesets_key_index)
    create unique_index(:tilesets, [:key])
  end
end

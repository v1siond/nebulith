defmodule Nebulith.Repo.Migrations.PhaseTwoTilesetsAndTiles do
  @moduledoc """
  PHASE 2 OF THE REBUILD: a label owns every fact, a tileset owns only the picture.

  From `docs/SPEC.md` §8 phase 2, built to the column list in §3.1. The rule the shape enforces is one
  sentence there: *"a LABEL owns every fact; a TILESET owns only the picture. A new art style is one
  `tilesets` row plus N `tile_images` rows, and no fact is copied."*

  ## What is wrong today, measured

  `tiles` is keyed `(tileset_id, label)`, so every fact is stored TWICE, once per art style: 786 rows for
  393 labels. Height, category, title and colour role are facts about the LABEL, and storing them per
  style means the two copies can disagree. They have, repeatedly, and the fix each time was another pass
  over the catalog reconciling them. Measured across the two styles right now: the columns agree on all
  393 labels, and six SETTINGS keys disagree, every one of them about the art (`variants`, `frames`,
  `frameMs`, `artFrames`, `pose`, `animations`).

  That reconciliation machinery only exists because the schema allows the disagreement. This migration
  removes the possibility rather than the symptom.

  ## What this migration does, and what it deliberately leaves

  It is the TABLES half. It creates the four missing tables, moves the picture out of `tiles` into
  `tile_images`, and gives a tile the three columns §3.1 declares and it does not have: `category_id`,
  `autotile_slot` and `family`.

  It does NOT collapse `tiles` to one row per label yet, and it does not drop `image_url`, `height` or
  `settings`. The collapse can only happen once every reader is served from `tile_images`, and the
  facts in `settings` land in `cell_tiles` (phase 3), `collision_boxes` (phase 4) and the animation
  tables (phase 6). Deleting a column before its reader moves is how you get an engine inventing values,
  which is the thing being fixed.

  ## Types

  The diagram draws every key as a uuid. `tilesets` and `tiles` are bigint here, so the keys pointing at
  them are bigint: a foreign key has to match what it references. New tables get uuid ids, like the phase
  1 and phase 3 tables.

  `key` is declared citext. There is no citext extension on this database, and phase 1 set the pattern
  for that: a plain column with a unique index on `lower(key)`, which is the same guarantee.
  """
  use Ecto.Migration

  def up do
    # ── The categories a tile browses under ────────────────────────────────
    # A string repeated on 393 rows with no table behind it cannot be renamed, ordered, or listed without
    # reading every tile. The sidebar's order is a fact about the category.
    create table(:tile_categories, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :key, :string, null: false
      add :name, :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:tile_categories, ["lower(key)"], name: :tile_categories_key_index)

    # Built from what the catalog actually uses, so this works on any database rather than on a list
    # copied from one. The order is the sidebar's: ground first, then what stands on it.
    execute """
    INSERT INTO tile_categories (key, name, position, inserted_at, updated_at)
    SELECT c.category,
           initcap(replace(c.category, '_', ' ')),
           COALESCE(o.position, 99),
           now() AT TIME ZONE 'utc',
           now() AT TIME ZONE 'utc'
    FROM (SELECT DISTINCT category FROM tiles WHERE category IS NOT NULL AND category <> '') c
    LEFT JOIN (VALUES
      ('terrain', 1), ('floors', 2), ('roads', 3), ('walls', 4), ('roofs', 5),
      ('windows', 6), ('doors', 7), ('nature', 8), ('props', 9), ('decor', 10),
      ('units', 11)
    ) AS o(key, position) ON o.key = c.category
    """

    alter table(:tiles) do
      add :category_id, references(:tile_categories, type: :uuid, on_delete: :nilify_all)

      # Which piece of an autotiled run this picture is, and which run it belongs to. `docs/SPEC.md` §3.1:
      # *"Whether a picture is the centre of a run or its north edge is a fact about the picture, so it
      # belongs with the label."* It lives in `settings.position` today, on rows no control can write.
      add :autotile_slot, :string
      add :family, :string

      # NULL = built in. A person's own tile is theirs.
      add :owner_id, references(:users, type: :uuid, on_delete: :delete_all)
    end

    execute """
    UPDATE tiles t SET category_id = c.id
    FROM tile_categories c WHERE lower(c.key) = lower(t.category)
    """

    # The slot is the position the tile already carries. `single` is not a slot: it says the tile is not
    # autotiled at all, which is the absence of a slot, and absence is NULL.
    execute """
    UPDATE tiles
    SET autotile_slot = settings->>'position'
    WHERE settings->>'position' IS NOT NULL AND settings->>'position' <> 'single'
    """

    # The family is the label with its slot suffix taken off: `wall_stone_tl` belongs to `wall_stone`.
    # Derived from the LABEL rather than from a second list, so a new piece joins its family by being
    # named like one.
    execute """
    UPDATE tiles
    SET family = regexp_replace(label, '_(c|t|b|l|r|tl|tr|bl|br)$', '')
    WHERE autotile_slot IS NOT NULL
    """

    create index(:tiles, [:category_id])
    create index(:tiles, [:family])
    create index(:tiles, [:owner_id])

    # ── The picture, which is the only thing a tileset owns ────────────────
    create table(:tile_images, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :tileset_id, references(:tilesets, type: :bigint, on_delete: :delete_all), null: false
      add :tile_id, references(:tiles, type: :bigint, on_delete: :delete_all), null: false
      add :image_path, :text, null: false

      timestamps(type: :utc_datetime)
    end

    # An empty path is not a picture. A row that says "this style has art for this label" while pointing
    # at nothing is exactly the silent blank the catalog kept producing.
    create constraint(:tile_images, :image_path_is_not_empty, check: "image_path <> ''")

    # One picture per label per style. This is the whole point: parity becomes a count, not a pass.
    create unique_index(:tile_images, [:tileset_id, :tile_id])
    create index(:tile_images, [:tile_id])

    execute """
    INSERT INTO tile_images (tileset_id, tile_id, image_path, inserted_at, updated_at)
    SELECT tileset_id, id, image_url, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
    FROM tiles WHERE image_url IS NOT NULL AND image_url <> ''
    """

    alter table(:tilesets) do
      add :owner_id, references(:users, type: :uuid, on_delete: :delete_all)
    end

    create index(:tilesets, [:owner_id])

    # ── The lists a person extends without a deploy ────────────────────────
    # §3.1: *"A list a person can extend without new code lives here. A list the engine must switch on
    # stays in Elixir and is SERVED from there. The test is not 'is this list fixed', it is does adding
    # an entry require code."*
    create table(:enum_sets, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :key, :string, null: false
      add :name, :string, null: false

      timestamps(type: :utc_datetime)
    end

    create unique_index(:enum_sets, ["lower(key)"], name: :enum_sets_key_index)

    create table(:enum_values, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :enum_set_id, references(:enum_sets, type: :uuid, on_delete: :delete_all), null: false
      add :key, :string, null: false
      add :name, :string, null: false
      add :position, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:enum_values, [:enum_set_id, "lower(key)"], name: :enum_values_key_index)
  end

  def down do
    drop table(:enum_values)
    drop table(:enum_sets)
    drop table(:tile_images)

    alter table(:tilesets) do
      remove :owner_id
    end

    alter table(:tiles) do
      remove :category_id
      remove :autotile_slot
      remove :family
      remove :owner_id
    end

    drop table(:tile_categories)
  end
end

defmodule Nebulith.Repo.Migrations.PhaseThreeMapsGridsCellsAndTiles do
  @moduledoc """
  PHASE 3 OF THE REBUILD: a map stops being a blob.

  From `docs/SPEC.md` §8 phase 3, built to the column list in §3.2. A map's contents live in three JSON
  columns on `Template` today: `groundData`, `heightData` and `assetsData`. A blob has no schema, so
  nothing in it can carry a default, nothing can be constrained, and every reader has to invent what is
  missing. That is the whole reason the engine holds 116 places where a renderer makes up a value the
  backend should have served.

  Five tables:

    * `maps` and `grids`, splitting what a map IS from the shape of its grid. `cellSize`, `isoScale` and
      `slabBlocks` are written on every save today and never read back.

    * `cells`, one row per square, carrying the three things a square owns that had nowhere to live:
      its ground height, its surface (a ramp is a surface, not a tile) and its own texture.

    * `cell_tiles`, 53 columns, every setting a person can author in the Size and position, Appearance
      and Behaviour modals. Columns with DEFAULTS, which is the point: the default stops being something
      a renderer guesses and becomes something the database states.

    * `cell_tile_views`, sparse, for the tiles that genuinely need to differ between iso and top.

  ## What is deliberately NOT here

  No `walkable`, `blocking`, `blocked`, `blocks_movement`, `is_solid` or `occupies`. A cell is blocked
  where a collision box says so, and `collision_boxes` is phase 4.

  No `zoom`. Zoom is not a separate idea, it is the three axes set to the same number, so it multiplies
  them rather than replacing them: Width 2 with Zoom 2 draws at 4 and nothing in the panel says so (D20).

  `depth` is a SIZE in every view, and `thickness_*` is the only thing that thins a block. One control
  answering two questions depending on the camera is what the split ends.

  `rotation` is DEGREES. The control shows degrees and the value is stored as radians today, so every
  read and every write converts, and a number copied between two places that disagree is 57x wrong.

  ## Types that differ from the spec's diagram, and why

  The diagram draws every key as a uuid. `tilesets`, `tiles` and `compositions` are bigint here, so the
  keys pointing at them are bigint: a foreign key has to match what it references.

  `color_role` is text, not a check constraint. The live catalogue uses a dotted namespace
  (`building.roof`, `feature.spill`) with new roles added by data migrations, and a closed list would
  make adding a role need a schema change.

  `region_id` and `composition_instance_id` are plain uuid columns with no reference: `regions` arrives
  in phase 8 and `composition_instances` in phase 7, and the constraints come with them.
  """
  use Ecto.Migration

  # The four iso diagonals, the same four the engine's DepthDir already names.
  @axes "'right-up', 'left-up', 'left-down', 'right-down'"

  def up do
    create table(:maps, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :level_id, references(:levels, type: :uuid, on_delete: :delete_all)
      add :name, :string, null: false
      add :description, :text

      # Art style per map, defaulted from the game. Today the style is a marker asset hidden at cell
      # (-1, -1), with ascii assumed when the marker is absent.
      add :tileset_id, references(:tilesets, type: :bigint, on_delete: :nilify_all)
      # A dungeon is a ZONE, not a different kind of thing (D19).
      add :zone_id, references(:zones, type: :uuid, on_delete: :nilify_all)

      # Stops two editors overwriting each other. Ecto's optimistic lock reads this column by name.
      add :lock_version, :integer, null: false, default: 1

      timestamps(type: :utc_datetime)
    end

    create index(:maps, [:level_id])
    create index(:maps, [:tileset_id])
    create index(:maps, [:zone_id])

    create table(:grids, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :map_id, references(:maps, type: :uuid, on_delete: :delete_all), null: false
      add :cols, :integer, null: false, default: 50
      add :rows, :integer, null: false, default: 50
      # The three numbers a save writes today and a load never reads back.
      add :cell_size, :integer, null: false, default: 16
      add :iso_scale, :decimal, null: false, default: 2.5
      # The map body's thickness UNDER the ground. Not a tile's thickness.
      add :slab_blocks, :integer, null: false, default: 1
      add :generator_id, references(:generators, type: :uuid, on_delete: :nilify_all)
      add :seed, :bigint
      add :spawn_col, :integer, null: false, default: 25
      add :spawn_row, :integer, null: false, default: 25

      timestamps(type: :utc_datetime)
    end

    # A grid belongs to a map. Only. The uniqueness is the sentence.
    create unique_index(:grids, [:map_id])
    create index(:grids, [:generator_id])

    create table(:cells, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :grid_id, references(:grids, type: :uuid, on_delete: :delete_all), null: false
      add :col, :integer, null: false
      add :row, :integer, null: false

      # In BLOCKS, and signed: negative is dug out. Per-cell elevation persists today and is all zeros on
      # every map, because the generator zeroes it.
      add :ground_height, :smallint, null: false, default: 0
      # A ramp is something the ground DOES, not a tile standing on it.
      add :surface, :string, null: false, default: "flat"
      # The water film's depth on THIS cell, so a shore can be ankle deep and a channel cannot.
      add :submerge, :decimal, null: false, default: 0.0
      # The cell's own texture, which had no home at all.
      add :texture_tile_id, references(:tiles, type: :bigint, on_delete: :nilify_all)
      # regions arrives in phase 8; the reference comes with it.
      add :region_id, :uuid

      timestamps(type: :utc_datetime)
    end

    create unique_index(:cells, [:grid_id, :col, :row])
    create index(:cells, [:texture_tile_id])
    create index(:cells, [:region_id])

    create constraint(:cells, :cells_surface_known,
             check: "surface IN ('flat', 'ramp_n', 'ramp_e', 'ramp_s', 'ramp_w')"
           )

    create table(:cell_tiles, primary_key: false) do
      ## IDENTITY AND PLACEMENT (9)
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")

      # Exactly one of these two is set, which is the whole of D14 as one constraint: a tile is either
      # PLACED on a map or part of a PRESET, and never both.
      add :cell_id, references(:cells, type: :uuid, on_delete: :delete_all)
      add :composition_id, references(:compositions, type: :bigint, on_delete: :delete_all)
      add :tile_id, references(:tiles, type: :bigint, on_delete: :nilify_all)
      # Offset from the composition's anchor. All zero for a map placement.
      add :dx, :integer, null: false, default: 0
      add :dy, :integer, null: false, default: 0
      add :level, :integer, null: false, default: 0
      # Which tile in this cell's stack. NOT a height.
      add :stack_index, :smallint, null: false, default: 0
      # Which stamped instance this came from, so the whole object selects as one thing. Phase 7.
      add :composition_instance_id, :uuid

      ## SIZE (3). There is no zoom column.
      add :width, :decimal, null: false, default: 1.0
      # In BLOCKS. The one height (D6).
      add :height, :decimal, null: false, default: 1.0
      # How deep it draws INTO THE SCREEN. A size, in every view.
      add :depth, :decimal, null: false, default: 1.0

      ## THICKNESS (5). How much of its OWN cell it fills, per iso direction.
      # Pulling a face in leaves the block its own size and makes it thin, which is what a trunk is.
      add :thickness_lu, :decimal, null: false, default: 1.0
      add :thickness_ru, :decimal, null: false, default: 1.0
      add :thickness_ld, :decimal, null: false, default: 1.0
      add :thickness_rd, :decimal, null: false, default: 1.0
      add :thickness_axis, :string

      ## SPAN (5). How many WHOLE cells it covers. Called span because "depth" already means a size.
      add :span_forward, :integer, null: false, default: 1
      add :span_back, :integer, null: false, default: 1
      add :span_perp, :integer, null: false, default: 1
      add :span_perp_back, :integer, null: false, default: 1
      add :span_axis, :string

      ## POSE (6)
      add :nudge_x, :decimal, null: false, default: 0.0
      add :nudge_y, :decimal, null: false, default: 0.0
      # DEGREES, which is what the control shows.
      add :rotation, :decimal, null: false, default: 0.0
      add :mirror, :boolean, null: false, default: false
      add :art_scale, :decimal, null: false, default: 1.0
      # Weapons only: where the shot comes out.
      add :muzzle, :decimal

      ## ORDER AND SLIDE (4)
      # The control is "Toward and away", and a slide along an iso diagonal is not a lift.
      add :slide_amount, :decimal, null: false, default: 0.0
      add :slide_direction, :string
      add :draw_order, :integer, null: false, default: 0
      add :stack_level, :smallint, null: false, default: 0

      ## STACKING (2)
      # Default 1, with no ambiguity: a generator sets 0 for grass and water because that suits them.
      add :stack_at, :smallint, null: false, default: 1

      # The cell behaves as if a tile is already in it, so the next one stacks on top: a road, a deck.
      add :act_as_tile, :boolean, null: false, default: false

      ## APPEARANCE (19)
      add :display, :string, null: false, default: "all_faces"
      add :transparent, :boolean, null: false, default: false

      # cone, because a conifer and a cypress are not round, and today the catalogue can only say circle.
      add :shape, :string, null: false, default: "square"
      add :color, :string
      add :color_role, :string
      add :opacity, :decimal, null: false, default: 1.0
      # Written today and read by nothing. Wired up in this phase.
      add :brightness, :decimal, null: false, default: 1.0
      add :bg_color, :string
      # Written FROM the material, never derived by darkening the surface.
      add :side_color, :string
      add :leaf_color, :string
      add :fade_near, :boolean, null: false, default: false
      # A roof opens when the hero is under it.
      add :cutaway_near, :boolean, null: false, default: false
      add :min_alpha, :decimal
      add :sign_text, :string
      add :sign_color, :string
      add :foliage, :boolean, null: false, default: false
      # NULL is still water. Four frame sets, one per heading.
      add :water_heading, :string
      # A building wall's finish.
      add :surface, :string, null: false, default: "plain"
      add :pinned, :boolean, null: false, default: false

      timestamps(type: :utc_datetime)
    end

    create index(:cell_tiles, [:cell_id])
    create index(:cell_tiles, [:composition_id])
    create index(:cell_tiles, [:tile_id])
    create index(:cell_tiles, [:composition_instance_id])

    # Reading one cell's stack in draw order is the query the renderer makes for every visible cell.
    create index(:cell_tiles, [:cell_id, :stack_index])

    create constraint(:cell_tiles, :cell_tiles_placed_or_preset,
             check: "num_nonnulls(cell_id, composition_id) = 1"
           )

    create constraint(:cell_tiles, :cell_tiles_display_known,
             check: "display IN ('all_faces', 'single')"
           )

    create constraint(:cell_tiles, :cell_tiles_shape_known,
             check: "shape IN ('square', 'circle', 'cone')"
           )

    create constraint(:cell_tiles, :cell_tiles_surface_known,
             check: "surface IN ('plain', 'tiled', 'ornament')"
           )

    create constraint(:cell_tiles, :cell_tiles_water_heading_known,
             check: "water_heading IS NULL OR water_heading IN ('n', 'e', 's', 'w')"
           )

    for column <- ~w(thickness_axis span_axis slide_direction) do
      create constraint(:cell_tiles, "cell_tiles_#{column}_known",
               check: "#{column} IS NULL OR #{column} IN (#{@axes})"
             )
    end

    create table(:cell_tile_views, primary_key: false) do
      add :id, :uuid, primary_key: true, default: fragment("gen_random_uuid()")
      add :cell_tile_id, references(:cell_tiles, type: :uuid, on_delete: :delete_all), null: false

      # iso and top only (D16). 2D stays behind its flag and gets no authoring surface until it returns.
      add :view, :string, null: false
      add :width, :decimal
      add :height, :decimal
      add :depth, :decimal
      add :nudge_x, :decimal
      add :nudge_y, :decimal
      add :anchor_lift, :decimal

      timestamps(type: :utc_datetime)
    end

    # SPARSE. A row exists only where a tile genuinely needs to differ; no row means the base columns
    # apply. The 2026-07-05 design approved per-view overrides and zero of 366 tiles ever carried one.
    create unique_index(:cell_tile_views, [:cell_tile_id, :view])

    create constraint(:cell_tile_views, :cell_tile_views_view_known,
             check: "view IN ('iso', 'top')"
           )
  end

  def down do
    drop table(:cell_tile_views)
    drop table(:cell_tiles)
    drop table(:cells)
    drop table(:grids)
    drop table(:maps)
  end
end

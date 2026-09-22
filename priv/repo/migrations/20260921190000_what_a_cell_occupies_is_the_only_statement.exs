defmodule Nebulith.Repo.Migrations.WhatACellOccupiesIsTheOnlyStatement do
  @moduledoc """
  `composition_cells.walkable` is deleted. What a cell occupies is the only statement about walking
  through it.

  Phase 3 deletes `walkable`, `blocking`, `blocked`, `blocks_movement`, `is_solid` and `occupies`. This
  is the last of them that was ever a column: the other five never existed in this database, and a
  survey found `blocked` only as a local name for the grid's runtime collision map, which is derived
  state rather than anything a person authors.

  ## Why it is a law-1 case and not just a tidy-up

  The stamp already translated it. `stampRun` read `cell.walkable` and wrote
  `collision: walkable ? [] : [{x: 0, y: 0, w: 1, h: 1}]` onto the placed tile, so the flag's entire
  life was being turned into a box a few lines later. A second vocabulary whose whole job is to be
  translated back is not a concept.

  ## Nothing is lost

  The translation runs here, once, in SQL, before the column goes: every cell keeps saying exactly what
  it said, in the words the renderer and the picker already use. A cell that was walkable states an
  empty box list, which is "nothing here stops you"; one that was not states the box that fills its
  cell. Both are explicit, which is the point: absence stops meaning "blocked by default".

  The conversion and the drop are one migration on purpose. A data migration runs after the schema
  ones, so a separate pass would have had nothing left to read.
  """
  use Ecto.Migration

  def up do
    # A cell that already states its own collision keeps it: an authored box list is finer than the flag
    # and must not be overwritten by it.
    execute """
    UPDATE composition_cells
    SET settings = jsonb_set(
          COALESCE(settings, '{}'::jsonb),
          '{collision}',
          CASE WHEN walkable THEN '[]'::jsonb
               ELSE '[{"x": 0, "y": 0, "w": 1, "h": 1}]'::jsonb END
        )
    WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'collision')
    """

    alter table(:composition_cells) do
      remove :walkable
    end
  end

  def down do
    alter table(:composition_cells) do
      add :walkable, :boolean, default: false
    end

    # An empty box list is the only shape that meant "you may walk here".
    execute """
    UPDATE composition_cells
    SET walkable = (settings->'collision' = '[]'::jsonb)
    WHERE settings ? 'collision'
    """
  end
end

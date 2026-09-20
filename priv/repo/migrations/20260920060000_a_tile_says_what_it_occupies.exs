defmodule Nebulith.Repo.Migrations.ATileSaysWhatItOccupies do
  @moduledoc """
  Drops `tiles.blocking`.

  Two switches for one fact, and the one that owned the fact was the other one. `settings.collision` is the
  list of boxes a tile occupies, and an empty list SAYS "nothing solid here" where a missing flag only says
  nobody got round to it. `docs/HITBOXES-AND-ELEVATION.md` §3.1 has had this column marked for deletion since
  the box system landed, and everything that used to ask it asks `boxesForAsset` now.

  The boxes are backfilled from the flag before it goes, so no row loses what it knew.
  """
  use Ecto.Migration

  def up do
    execute("""
    update tiles
       set settings = coalesce(settings, '{}'::jsonb) ||
                      jsonb_build_object('collision', '[{"x":0,"y":0,"w":1,"h":1}]'::jsonb)
     where blocking = true
    """)

    execute("""
    update tiles
       set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('collision', '[]'::jsonb)
     where blocking = false and not (settings ? 'collision')
    """)

    alter table(:tiles) do
      remove :blocking
    end
  end

  def down do
    alter table(:tiles) do
      add :blocking, :boolean, default: false
    end

    execute("update tiles set blocking = jsonb_array_length(coalesce(settings->'collision', '[]'::jsonb)) > 0")
  end
end

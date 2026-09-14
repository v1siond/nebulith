defmodule Nebulith.Repo.Migrations.WaterSurfaceBelowTheBank do
  @moduledoc """
  The water surface sits 0.35 of a block above the channel floor, stacked from the cell's BOTTOM face.

  A river reads as a river because you can see the cut it runs in. The bands carried 0.5 and 1.0 and the
  frontend then overrode the height to `dug - 0.25`, which put the surface a quarter block under the bank:
  measurably below, visually flush, no rim. At 0.35 from the bottom face of a one-deep channel the surface
  lands 0.65 under the bank, so the bank shows its own edge the whole length of the river.

  `stackAt: 0` is what makes it fill UP from the bed instead of hanging from the top of the cell, which is
  also what lets a bridge be built over the channel rather than resting on the water.
  """
  use Ecto.Migration

  def up do
    execute("""
    UPDATE tiles
       SET height = 0.35,
           settings = COALESCE(settings, '{}'::jsonb) || '{"stackAt": 0}'::jsonb
     WHERE label IN ('water', 'water_shallow', 'water_deep')
    """)
  end

  def down do
    execute("UPDATE tiles SET height = 0.5 WHERE label = 'water'")
    execute("UPDATE tiles SET height = 1.0 WHERE label IN ('water_shallow', 'water_deep')")
  end
end

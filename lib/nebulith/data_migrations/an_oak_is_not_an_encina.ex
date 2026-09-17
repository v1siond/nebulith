defmodule Nebulith.DataMigration.AnOakIsNotAnEncina do
  @moduledoc """
  An oak goes up, an encina goes out.

  The last open item on his tree list. Reported as *"Oak and encina read similarly"*, and the reason they did
  is visible the moment the two are put side by side: they were the SAME TREE at two sizes.

      tree_oak        trunk 0.62 x (1.20, 2.8)   crown level 2, 2.00 x 2.4
      tree_encina     trunk 0.58 x (1.15, 2.4)   crown level 1, 1.90 x 2.0
      tree_broadleaf  trunk 0.55 x (1.10, 2.4)   crown level 1, 1.75 x 1.7

  Three trees at 100, 95 and 88 per cent of one shape. Nothing about that reads as three species.

  ## Why this needed no art after all

  It was written up as needing art: *"Oak and encina read similarly. Both are oaks, so more separation would
  need art, not proportion."* That was wrong, and measuring the two against life is what shows it. The
  difference between these two species IS their proportion:

    * a Quercus robur carries a big round crown well clear of the ground on a long bole, it goes UP
    * a holm oak branches low off a short thick bole and spreads into a broad flat dome, the dehesa shape,
      so it goes OUT

  So the same two pieces, at opposite proportions:

      tree_oak        trunk 0.64 x (1.15, 3.6)   crown level 2, 2.05 x 2.5    a tall bole under a round crown
      tree_encina     trunk 0.52 x (1.45, 1.5)   crown level 1, 2.70 x 1.35   a wide dome on a short thick bole

  The oak's trunk now draws 2.3 levels against the encina's 0.78, and the encina's crown is the widest of any
  tree in the catalog. They cannot be confused for each other at a glance, and `tree_broadleaf` sits clear of
  both without being touched.

  `tree_comp`'s guard still holds: the trunk's effective width and its zoom stay strictly under the crown's, so
  neither is an unbelievable tree.

  Idempotent: writes both compositions by name.
  """
  require Logger

  alias Nebulith.Catalog

  @trees %{
    # {trunk_zoom, trunk_scaleX, trunk_scaleY, crown_level, crown_zoom, crown_scaleY}
    "tree_oak" => {0.64, 1.15, 3.6, 2, 2.05, 2.5},
    "tree_encina" => {0.52, 1.45, 1.5, 1, 2.7, 1.35}
  }

  def run do
    for {name, {tz, tw, th, level, cz, ch}} <- @trees do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: 1, footprint_h: 1, category: "nature"},
          [
            %{dx: 0, dy: 0, level: 0, label: "trunk_mid", walkable: false, scale: tz,
              settings: %{"scaleY" => th, "scaleX" => tw}},
            %{dx: 0, dy: 0, level: level, label: "leaf_center", walkable: true, scale: cz,
              settings: %{"scaleY" => ch, "shape" => "circle"}}
          ]
        )
    end

    Logger.info("[data_migrate] an oak goes up and an encina goes out")

    :ok
  end
end

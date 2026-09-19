defmodule Nebulith.DataMigration.NoMoreBulbs do
  @moduledoc """
  Take the bulbs out. *"please remove the bulbs I really don't want to see them anymore"*.

  Two sources, and both are removed here because both put a yellow cube on the map.

  THE LINING. A pathway's served `lining` list named `"tile": "lamp"` on 20 town and city templates. `lamp` is
  not an object: it is the BULB cell of the two-cell `lamp_post`, whose post is scaled 7 high with the bulb
  posed on top. `placeLining` asks the catalog whether a name is a composition and places a bare tile when it
  is not, so every one of those came down as a bulb lying on the paving with nothing under it. Measured on one
  town, seed 3: 14 bulbs against 6 posts, so 8 of them had no post at all.

  THE STREET LAMPS. The generator also stamped `lamp_post` itself along street frontages and beside gateways.
  That one is a real composition, but its bulb reaches the grid carrying none of its cell settings, so it draws
  as a full cube at ground level instead of a lit head on a post. Until that is fixed there is nothing to see
  but more cubes, so the generators stop placing them too.

  The `lamp_post` and `lamp_post_failing` compositions are LEFT in the catalog. They are still placeable by
  hand, and they are what a street lamp should be rebuilt from.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!("""
      UPDATE generators
         SET config = jsonb_set(
               config,
               '{pathway,lining}',
               (SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
                  FROM jsonb_array_elements(config->'pathway'->'lining') AS item
                 WHERE item->>'tile' <> 'lamp')
             )
       WHERE config->'pathway' ? 'lining'
         AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(config->'pathway'->'lining') AS i
                WHERE i->>'tile' = 'lamp'
             )
      """)

    Logger.info("[data_migrate] no more bulbs: #{rows} generator(s) stop lining their ways with one")
    :ok
  end
end

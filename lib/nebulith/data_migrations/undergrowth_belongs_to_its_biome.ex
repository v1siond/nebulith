defmodule Nebulith.DataMigration.UndergrowthBelongsToItsBiome do
  @moduledoc """
  The undergrowth follows the biome too, and a tile says for itself whether it is foliage.

  *"finish the undergrowth"*. `AForestWearsItsOwnRegion` dressed the canopy and left everything under it, so a
  desert grew ochre trees standing on emerald shrubs.

  ## What was measured on a desert map

      thicket   193 placed, EVERY ONE #2f6b2a   a flat dark green, no variation at all
      shrub      12 placed, every one #4fa03f   brighter green
      floor     #618c48 on exactly 193 cells    the undergrowth tint, painted under each thicket

  And across the catalog, every tile whose own colour is vegetation green sits between 86 and 150 degrees,
  against references that never leave 30 to 74. The same defect as the canopy, one layer down.

  `palette.undergrowth` had the identical sharing problem: Beach == Desert `#618c48`,
  Jungle == Ruins == Swamp `#25532a`, Mountain == Woodland `#6d7f45`, Meadow none.

  ## Two changes, and why this shape

  1. **`palette.undergrowth` per biome**, same hue as that biome's `leaf`, a little more saturated and
     clearly darker. Undergrowth stands in the shade of the canopy over it, which is what separates the two
     in every reference. It becomes the HUE IDENTITY for the plants, exactly as `palette.leaf` is for the
     canopy, so the undergrowth runs the same three axes (season for tone and variance, biome for hue,
     region for light) through the same code rather than getting a second mechanism.

     It keeps its existing job as the floor tint under a thicket at the same time, so the patch and the plant
     standing on it stop disagreeing.

  2. **`settings.foliage` on the tiles that ARE green foliage.** The frontend was deciding this by label
     prefix (`leaf_`, `canopy_`), which is the frontend inventing a fact about backend data, and it could
     never have covered `thicket` or `shrub`. A tile now says what it is.

     Deliberately NOT tagged, because their colour is their own and a biome tint would be wrong: `rock`,
     every flower and blossom, the autumn litter (`fallen-leaf`, `maple-leaf`), `potted-plant` (a town prop),
     and the ground TERRAIN tiles (`grass`, `moss`, `meadow`, `tropical_grass`), whose colour is the floor
     palette's job.

  Idempotent: the tag is set to the same value and the palettes are keyed by name.
  """
  require Logger

  alias Nebulith.Repo

  @undergrowth %{
    "Woodland" => "#496635",
    "Meadow" => "#50662b",
    "Mountain" => "#61663d",
    "Jungle" => "#526625",
    "Swamp" => "#5f6633",
    "Ruins" => "#52663b",
    "Beach" => "#66632b",
    "Desert" => "#665833",
    "Volcanic" => "#665a50"
  }

  # The plants the generator actually places, plus the tree's own leaf and canopy families so one rule covers
  # every green thing rather than a prefix covering half of them.
  @foliage ~w(
    thicket shrub bush bush_round clover shamrock sapling cactus canopy_under tall_grass grass_tall
    leaf_center leaf_left leaf_right leaf_top
    canopy_tl canopy_t canopy_tr canopy_l canopy_c canopy_r canopy_bl canopy_b canopy_br
  )

  def run do
    tints = Enum.sum(for {name, hex} <- @undergrowth, do: tint_biome(name, hex))
    tagged = tag_foliage()

    Logger.info(
      "[data_migrate] #{tints} generators carry their own undergrowth tint, #{tagged} tiles say they are foliage"
    )

    :ok
  end

  defp tint_biome(name, hex) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette,undergrowth}', $2::text::jsonb)
        WHERE (name = $1 OR name LIKE $1 || ' %') AND config->'palette' IS NOT NULL
        """,
        [name, Jason.encode!(hex)]
      )

    rows
  end

  # BOTH tilesets. A style is only a different picture for the same label, so what a tile IS cannot differ
  # between ascii and emoji.
  defp tag_foliage do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
        SET settings = COALESCE(settings, '{}'::jsonb) || '{"foliage": true}'::jsonb
        WHERE label = ANY($1)
        """,
        [@foliage]
      )

    rows
  end
end

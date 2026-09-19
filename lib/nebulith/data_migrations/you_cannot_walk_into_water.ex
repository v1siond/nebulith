defmodule Nebulith.DataMigration.YouCannotWalkIntoWater do
  @moduledoc """
  Water stops you, stands proud of its bed, and everything sinks into it.

  Three facts he asked for in one breath, all of them facts about the water TILE, so all of them live here
  rather than in a generator:

  > *"collissions aren't correct on water zones, I shouldn't be able to walk into ANY real water zone.
  > Additionally, increase the elevation of the water, looks like it's at 0, but I think we can increase it to
  > .4 or .5 to better simulate the terrain edges. and again, all water should have Y stack at 0, all water.
  > because what happens when you put something in water? it sinks, hence why ystack at 0"*

  ## Why the collision belongs on the tile and not in the generator

  The generator already decides this correctly, in one line of `riverNetwork.ts`:
  `collision = frozen || decks.has(key) ? false : !wadeable.has(key)`. Water stops you unless it is ice, has a
  bridge over it, or is shallow enough to wade. That is why a freshly built world behaves and a RELOADED one
  does not: the decision lived only in the runtime collision array, which is not one of the columns a saved
  map has (`groundData`, `heightData`, `assetsData`, `connectors`, `entities`, `quests`), so reloading rebuilt
  what is solid from the assets alone, and the water tile declared no collision box at all.

  Measured on his saved map `97829bd2`: 2,706 assets, 387 carrying collision boxes and every one of them a
  tree part, 31 water cells with none. So a reload came back with a river you could stroll across.

  Put the box on the tile and the fact survives the round trip, for a hand-painted lake as much as a generated
  one. The cells the generator deliberately opens (a bridge deck, a ford, ice) carry a per-instance empty box
  list, which `declaredBoxes` already prefers over the tile's, so they stay walkable.

  ## What counts as "ANY real water zone"

  Real water is the open-water family: the 216 autotile pieces plus `water`, `water_deep`, `water_shallow`,
  `water_bend`, the `water_f*` frames, `deep-water`, `shallow-water`, `koi_pond` and `oasis`.

  Three groups are deliberately NOT real water, each for a reason already written down:

  - `water_still` is the FILM a ford, a pool and a swamp puddle lay over ground that stays ground. WATER.md:
    *"A ford is walkable because it is a ford"*. Blocking it would seal every crossing on the map. It keeps
    its height of 0 too, which is the flat puddle he signed off on.
  - `water_c` and `water_jet` are the FOUNTAIN's basin and jets, object pieces rather than terrain (WATER.md
    §the height column). They already block, they stand a block tall, and a jet is water going UP, so the
    sinking rule is not about them. Left exactly as they are.
  - `frozen_water` and `ice_water` are the winter surface you walk ON.

  ## The height

  0.4, the lower of the two he offered. A water zone is cut one block below its bank (`levelTheWater`), so a
  0.4 surface sits 0.6 under the bank and the cut shows along the whole channel, which is the terrain edge he
  is after. A body too small to be a zone sits at its floor's own level, so there the surface now stands 0.4
  proud of the bank rather than flush with it.
  """
  require Logger

  alias Nebulith.Repo

  # Everything that reads as a body of water you could fall into. Stated as a pattern plus a list, the same
  # split the catalog itself has: 216 generated autotile pieces, and the named terrain tiles.
  @real_water_pattern "^water_(smooth|lined)_"
  @real_water_labels ~w(water water_deep water_shallow water_bend water_f1 water_f2 water_f3 deep-water shallow-water koi_pond oasis)
  # The film, the fountain and the ice. See the moduledoc for why each one is left alone.
  @not_real_water ~w(water_still water_c water_jet frozen_water ice_water)

  @full_cell ~s([{"x": 0, "y": 0, "w": 1, "h": 1}])

  def run do
    solid = solid_water()
    raised = raise_the_surface()
    sunk = everything_sinks()
    Logger.info(
      "[data_migrate] you cannot walk into water: #{solid} blocked, #{raised} raised to 0.4, #{sunk} set to stackAt 0"
    )

    :ok
  end

  # A full-cell box, the same shape `rock` and the fountain basin carry.
  defp solid_water do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
           SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('collision', $1::text::jsonb)
         WHERE (label ~ $2 OR label = ANY($3))
           AND NOT (label = ANY($4))
           AND COALESCE(settings->'collision', 'null'::jsonb) <> $1::text::jsonb
        """,
        [@full_cell, @real_water_pattern, @real_water_labels, @not_real_water]
      )

    rows
  end

  defp raise_the_surface do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles SET height = 0.4
         WHERE (label ~ $1 OR label = ANY($2))
           AND NOT (label = ANY($3))
           AND height IS DISTINCT FROM 0.4
        """,
        [@real_water_pattern, @real_water_labels, @not_real_water]
      )

    rows
  end

  # "all water", so this one reaches the film too: a puddle you drop something into swallows it the same way.
  # Only the fountain's basin and jets are held back, since a jet is water leaving the ground, not holding it.
  defp everything_sinks do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!(
        """
        UPDATE tiles
           SET settings = COALESCE(settings, '{}'::jsonb) || '{"stackAt": 0}'::jsonb
         WHERE label ~ 'water|oasis|koi_pond'
           AND NOT (label = ANY($1))
           AND COALESCE(settings->'stackAt', 'null'::jsonb) <> '0'::jsonb
        """,
        [~w(water_c water_jet)]
      )

    rows
  end
end

defmodule Nebulith.E2E.Phase04CollisionsTest do
  @moduledoc """
  PHASE 4: a reloaded map stops you where the built one did.

  Collisions looked right on a freshly generated world and were gone after a reload, which is the
  worst shape a defect can take: the thing works when you build it, so the bug only ever appears to
  somebody who came back to their own map. You should not be able to walk into any real water.

  The map is a canvas, so the assertion is not on the DOM. `window.__collisionAudit` reports each
  cell's ground and whether the grid blocks it, which is the thing the hero actually walks into.

  ## THIS GATE FAILS, AND IT IS SUPPOSED TO

  The spec writes phase 4 down as `collision_boxes`, with the gate "an authored blocked cell survives
  a reload", and says of it: **it cannot today**. So this is the gate for a phase that has not been
  built, written before the work rather than after it, which is the only order in which a gate proves
  anything.

  What it currently reports, on a freshly generated city:

  * A brick wall is WALKABLE until the map is reloaded. You can walk through a building you just built.
  * A tree's canopy BLOCKS until the map is reloaded, and then stops.

  Both are the same defect from opposite sides: what a cell occupies is decided twice, once by the
  generator in memory and once by the loader from the rows, and the two do not agree. That is what
  phase 4 is for.

  Run it with `bin/e2e --include awaiting_phase`.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase4
  # A gate for a phase the spec has not reached. Left out of the default run, never weakened.
  @moduletag :awaiting_phase

  alias Nebulith.E2E.GeneratePanel

  setup :a_signed_in_editor

  test "a reloaded map stops you where the built one did", %{session: session, map: map} do
    # A river, chosen on purpose, because the preset on its own builds a dry map and then the whole
    # scenario asserts about water that was never there.
    session =
      GeneratePanel.build_world(session, "city", "Woodland city", [
        "Winds through (easy to cross)"
      ])

    built = audit(session)

    # Three guards that say out loud when a run proved nothing, rather than passing on an empty world.
    assert built.total > 0, "no world was built, so this run proves nothing"

    assert built.water > 0,
           "the built map has no water, so it proves nothing about walking into water"

    assert built.water_blocked > 0,
           "no water cell is solid on the map as built, you can walk straight into the river"

    back = session |> Editor.save_and_reopen(map.id) |> audit()

    assert back.total > 0, "the map did not load back"

    assert back.water == built.water,
           "the reloaded map is not the same map.\n  built:    #{describe(built)}\n  reloaded: #{describe(back)}"

    assert back.water_blocked == built.water_blocked,
           "what the water lets you do changed across the save.\n" <>
             "  built:    #{describe(built)}\n  reloaded: #{describe(back)}\n" <>
             "  cells that changed:\n#{changed(built, back)}"

    assert back.solid == built.solid,
           "the set of solid cells changed across the save: " <>
             "#{MapSet.size(MapSet.difference(built.solid, back.solid))} lost, " <>
             "#{MapSet.size(MapSet.difference(back.solid, built.solid))} gained"
  end

  defp describe(a),
    do: "#{a.total} cells, #{a.blocked} solid, #{a.water} water, #{a.water_blocked} of it solid"

  # NAME THE CELLS, and say what is standing on them. "twelve cells changed" sends you looking at the
  # whole river; "twelve cells that all carry a bridge deck" is the answer.
  defp changed(built, back) do
    opened = MapSet.difference(built.solid, back.solid)
    closed = MapSet.difference(back.solid, built.solid)

    Enum.map_join(
      Enum.take(MapSet.to_list(opened), 6) ++ Enum.take(MapSet.to_list(closed), 6),
      "\n",
      fn key ->
        side =
          if MapSet.member?(opened, key),
            do: "was solid, now walkable",
            else: "was walkable, now solid"

        "    #{key}  #{side}  ground=#{built.ground[key] || "?"}  on it: #{built.on[key] || "nothing"}"
      end
    )
  end

  defp audit(session) do
    raw =
      Browser.js(session, """
      (() => {
        const cells = window.__collisionAudit ? window.__collisionAudit() : []
        const water = cells.filter(c => /water|oasis|koi_pond/.test(c.ground || ''))
        return {
          total: cells.length,
          blocked: cells.filter(c => c.blocked).length,
          water: water.length,
          waterBlocked: water.filter(c => c.blocked).length,
          solid: cells.filter(c => c.blocked).map(c => c.col + ',' + c.row),
          ground: Object.fromEntries(cells.map(c => [c.col + ',' + c.row, c.ground || '?'])),
          on: Object.fromEntries(cells.map(c => [
            c.col + ',' + c.row,
            (window.__nebulithGrid?.assets ?? [])
              .filter(a => a.col === c.col && a.row === c.row)
              .map(a => a.label ?? a.tileKey ?? a.type).join('+') || 'nothing',
          ])),
        }
      })()
      """) || %{}

    %{
      total: raw["total"] || 0,
      blocked: raw["blocked"] || 0,
      water: raw["water"] || 0,
      water_blocked: raw["waterBlocked"] || 0,
      solid: MapSet.new(raw["solid"] || []),
      ground: raw["ground"] || %{},
      on: raw["on"] || %{}
    }
  end
end

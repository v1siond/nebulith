defmodule Nebulith.E2E.Phase04CollisionsTest do
  @moduledoc """
  PHASE 4: a reloaded map stops you where the built one did.

  Collisions looked right on a freshly generated world and were gone after a reload, which is the
  worst shape a defect can take: the thing works when you build it, so the bug only ever appears to
  somebody who came back to their own map. You should not be able to walk into any real water.

  The map is a canvas, so the assertion is not on the DOM. `window.__collisionAudit` reports each
  cell's ground and whether the grid blocks it, which is the thing the hero actually walks into.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase4

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
           "the river became walkable across the save.\n  built:    #{describe(built)}\n  reloaded: #{describe(back)}"

    assert back.solid == built.solid,
           "the set of solid cells changed across the save: " <>
             "#{MapSet.size(MapSet.difference(built.solid, back.solid))} lost, " <>
             "#{MapSet.size(MapSet.difference(back.solid, built.solid))} gained"
  end

  defp describe(a),
    do: "#{a.total} cells, #{a.blocked} solid, #{a.water} water, #{a.water_blocked} of it solid"

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
        }
      })()
      """) || %{}

    %{
      total: raw["total"] || 0,
      blocked: raw["blocked"] || 0,
      water: raw["water"] || 0,
      water_blocked: raw["waterBlocked"] || 0,
      solid: MapSet.new(raw["solid"] || [])
    }
  end
end

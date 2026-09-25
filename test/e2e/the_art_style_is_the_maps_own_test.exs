defmodule Nebulith.E2E.TheArtStyleIsTheMapsOwnTest do
  @moduledoc """
  THE ART STYLE IS A COLUMN ON THE MAP, not a fake tile hidden off the edge of it.

  `docs/SPEC.md` phase 1 REWIRE, in full:

      the art style stops being a marker asset hidden at cell (-1, -1) and becomes
      `games.default_tileset_id` with a per-map override

  quoting him: *"I like the versatility of having one art style per map, but I do want to be able to set
  the default at the game table level instead of hardcoding ascii."*

  ## Measured before the fix

  `gridCodec.ts` had `styleToAssets/1`, which returned a `GridAsset` placed at column -1, row -1 with
  `type: "nebulith:style"` and the style id in its `label`. `templates.tsx` wrote it into `assetsData` on
  every save and read it back on load. The style was a tile pretending to be a setting.

  Meanwhile `maps.tileset_id` existed, was served by `MapController.summary/1`, and was written by
  nothing; `games.default_tileset_id` existed and was READ by nothing, which is section 6 invariant 7:
  *"A column with no reader is not harmless: it is a knob a person turns that does nothing."*

  ## What this asserts

  Through the real control, as a person uses it: open the art style popover, pick the other style, save.
  Then three things, and the first two fail before the fix:

    1. The map's OWN row carries the choice.
    2. No `nebulith:style` marker is written into the saved assets.
    3. Reopening the map still shows the style that was picked, because moving where a fact lives must
       not lose it.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1
  @moduletag timeout: 600_000

  alias Nebulith.Catalog
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Editor
  alias Nebulith.Repo

  # THE STYLE MARKER'S OWN TYPE, from `gridCodec.ts`. Named here so the assertion fails loudly if the
  # marker comes back under the same name rather than silently passing.
  @marker_type "nebulith:style"

  setup context do
    context
    |> Elixir.Map.put(:map, %{cols: 20, rows: 20})
    |> a_signed_in_editor()
  end

  test "picking an art style writes it to the map, not to a tile at (-1,-1)", %{
    session: session,
    map: map
  } do
    other = other_style(session)

    pick_art_style(session, other)
    Editor.save(session, map.id)

    # 1 · THE MAP'S OWN ROW. `maps.tileset_id` is served already; before the fix nothing ever wrote it.
    wanted = Enum.find(Catalog.list_tilesets(), &(&1.key == other))
    assert wanted, "the catalog serves no #{other} tileset, so this scenario proves nothing"

    row = Repo.get_by(Nebulith.World.Map, template_id: map.id)

    assert row, "no map row exists for this template, so the style has nowhere of its own to live"

    assert row.tileset_id == wanted.id,
           "picked #{other} and saved, but the map row says tileset_id=#{inspect(row.tileset_id)} " <>
             "instead of #{wanted.id}. The choice went somewhere else."

    # 2 · AND NOT AS A TILE. A setting stored as a placement at (-1,-1) is a tile pretending to be data.
    saved = Repo.get!(Nebulith.Catalog.Template, map.id)
    markers = for a <- saved.assetsData || [], a["type"] == @marker_type, do: a

    assert markers == [],
           "the art style is still being saved as a marker asset: #{inspect(markers)}"

    # 3 · AND IT SURVIVES A RELOAD, because moving a fact must not lose it.
    session = Editor.open(session, map.id)

    Browser.wait_for_js(
      session,
      "window.__nebulithGrid != null",
      "the map to come back"
    )

    assert Browser.js(session, "window.__activeArtStyle()") == other,
           "reopened the map and the art style was not the one that was picked"
  end

  # THE STYLE THAT IS NOT ACTIVE, asked of the page rather than written down, so this scenario keeps
  # working the day a third art style is served.
  defp other_style(session) do
    Browser.wait_for_js(
      session,
      "(window.__artStyles?.() ?? []).length > 1",
      "the art styles to load"
    )

    session
    |> Browser.js("window.__artStyles().filter(id => id !== window.__activeArtStyle())")
    |> hd()
  end

  # THROUGH THE CONTROL A PERSON USES: open the popover, press the card for that style.
  defp pick_art_style(session, style_id) do
    {:ok, _} =
      PlaywrightEx.Frame.click(session.frame_id,
        selector: ~s|button[aria-label="Art style"], button.stcbtn, .stc > button|,
        timeout: 20_000
      )

    {:ok, _} =
      PlaywrightEx.Frame.click(session.frame_id,
        selector:
          ~s|[role="dialog"][aria-label="Art style"] button.pcard >> nth=#{index_of(session, style_id)}|,
        timeout: 20_000
      )

    Browser.wait_for_js(
      session,
      "window.__activeArtStyle() === #{Jason.encode!(style_id)}",
      "the editor to switch to #{style_id}"
    )
  end

  defp index_of(session, style_id) do
    session
    |> Browser.js("(window.__artStyles?.() ?? []).indexOf(#{Jason.encode!(style_id)})")
    |> max(0)
  end
end

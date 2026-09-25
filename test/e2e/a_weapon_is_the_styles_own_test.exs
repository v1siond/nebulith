defmodule Nebulith.E2E.AWeaponIsTheStylesOwnTest do
  @moduledoc """
  THE HERO'S WEAPON IS DRAWN IN THE STYLE THAT IS ON, and it changes when the style changes.

  `docs/SPEC.md` law 4: only the pictures differ between styles. `Nebulith.OneEngineManyStylesTest` proves
  no line in the engine picks art by comparing a style's name, which is the half a browser cannot see
  because only two styles exist to look at. This is the half a browser can: switch the style on the real
  page and watch the hand follow.

  ## What was measured before

  Four places read `activeStyleId !== 'ascii'` or handed a function the literal `'emoji'`. The hand, the
  pose, the pose card and the shot's muzzle. Every one of them meant "ascii, or else emoji", so a third
  art style would have drawn emoji weapons while calling itself something else, and the muzzle a shot left
  from was measured against a weapon the hero was not holding.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase2

  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Editor
  alias Nebulith.E2E.World

  setup do
    World.seed_catalog()
    %{user: Account.an_admin(), map: World.scratch_map()}
  end

  test "the hand holds the active style's weapon, and follows a style change", %{
    conn: conn,
    user: user,
    map: map
  } do
    session =
      conn
      |> Account.sign_in(user)
      |> Editor.open(map.id)
      |> Browser.wait_for_js("!!window.__artStyles", "the styles to load")

    styles = Browser.js(session, "window.__artStyles()")

    assert length(styles) > 1,
           "only #{length(styles)} style is loaded, so a style change cannot be watched"

    # A BLANK MAP STARTS THE HERO BARE HANDED, and a bare hand correctly draws nothing, so the question is
    # asked of a weapon rather than of an empty fist. It goes through the same call the hand makes, on the
    # real page, with the real catalogs loaded. Equipping through the inventory is the inventory's own
    # scenario, not this one.
    held = for style <- styles, do: {style, art_under(session, style)}

    drawn = for {_style, art} <- held, do: art

    assert Enum.all?(drawn, &(&1 != "")),
           "a style drew no weapon in the hero's hand at all: #{inspect(held)}"

    assert length(Enum.uniq(drawn)) == length(drawn),
           "two styles drew the SAME weapon art, so the hand is not the style's own: #{inspect(held)}"
  end

  # SWITCH, THEN READ WHAT THE HAND HOLDS. Through the page's own picker, because a scenario that sets the
  # style by calling into the engine is testing a path nobody uses.
  defp art_under(session, style) do
    Browser.js(session, "window.__setArtStyle && window.__setArtStyle(#{Jason.encode!(style)})")

    Browser.wait_value(
      session,
      "(window.__activeArtStyle() === #{Jason.encode!(style)}) ? (window.__weaponArt?.('sword') ?? '') : null"
    )
  end
end

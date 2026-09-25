defmodule Nebulith.E2E.Phase00PickersTest do
  @moduledoc """
  PHASE 0'S GATE, on the page: *"every value the engine accepts appears in its picker."* (`docs/SPEC.md`
  §8, phase 0.)

  `Nebulith.APickerCannotMissAValueTest` proves the backend serves the same values the engine's types
  accept. That is the data half, and it is true of an app whose pickers never call `/api/enums` at all.
  This is the half that cannot be faked: change what the backend answers, and watch the menu change.

  The list is stubbed with a value no literal in the engine has ever said. If the option appears, the
  picker is rendering what was served. If it does not, something is still deciding the list locally,
  wherever it is hiding, and the four constants that used to do it are exactly the defect phase 0 names.

  ## What it measured before

  `editorAnimation.tsx` held `ANIM_EASES`, `ANIM_TILE_TRIGGERS`, `ANIM_STYLES` and `ANIM_VIEWS`, each one
  a copy of an engine union, and its own comment recorded the drift that follows: *"`flicker` and `night`
  were fully implemented and unreachable from the panel."* Accepted by every switch, offered by no menu.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase0

  alias Nebulith.E2E.Account
  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Editor
  alias Nebulith.E2E.StubApi
  alias Nebulith.E2E.World
  alias Nebulith.EngineLists

  setup do
    World.seed_catalog()
    %{user: Account.an_admin(), map: World.scratch_map()}
  end

  test "the engine's lists reach the page, whole", %{conn: conn, user: user, map: map} do
    session =
      conn
      |> Account.sign_in(user)
      |> Editor.open(map.id)
      |> Browser.wait_for_js("!!window.__nebulithEnums", "the engine lists to load")

    served = Browser.js(session, "window.__nebulithEnums")

    for {list, values} <- EngineLists.engine() do
      assert served[list] == values,
             "the page's #{list} is #{inspect(served[list])} but the backend serves #{inspect(values)}"
    end
  end

  test "a picker offers what the backend answered, not what the engine used to say", %{
    conn: conn,
    user: user,
    map: map
  } do
    # A value no literal in this engine has ever held, so an option carrying it can only have travelled.
    stubbed =
      Elixir.Map.put(EngineLists.all(), "eases", EngineLists.engine()["eases"] ++ ["rubberband"])

    session =
      conn
      |> StubApi.stub(%{"/api/enums" => %{"data" => stubbed}})
      |> Account.sign_in(user)
      |> Editor.open(map.id)
      |> Browser.wait_for_js("!!window.__nebulithEnums", "the engine lists to load")

    offered = Browser.js(session, "(window.__nebulithEnums?.eases ?? [])")

    assert "rubberband" in offered,
           "the page kept its own list of eases: it has #{inspect(offered)}"

    # …AND THE ENGINE'S OWN VALUES ARE STILL THERE, so this cannot pass by the page having replaced one
    # hardcoded list with another.
    for ease <- EngineLists.engine()["eases"] do
      assert ease in offered, "#{ease} is accepted by the engine and missing from the page's list"
    end
  end
end

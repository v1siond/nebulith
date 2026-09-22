defmodule Nebulith.E2E.Phase03ServedValuesTest do
  @moduledoc """
  PHASE 3, GATE 2: the backend decides values and the frontend renders them.

  The source check for this lives in `mix test` and reads the writers for literals. It is a good gate
  and it cannot prove the one thing that matters: that what reaches the screen came from the database.
  A file can be free of `?? 1` and still ignore the served number.

  So this changes what the backend answers and watches the engine follow it. The schema is stubbed
  with a different default, the page is loaded, and the engine is asked what it thinks the default is.
  If it says the stubbed number, the value travelled. If it says the old one, a literal is still
  deciding, wherever it is hiding.

  ## The stub is built from the app's own code

  `MapController.schema_payload/0` serialises from `World.CellTile` itself, so the stub is the real
  payload with one field moved. Typing the JSON out by hand would make it a second copy of the schema:
  the moment a column is added, this scenario would be testing an app that no longer exists while
  staying green.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase3

  setup do
    World.seed_catalog()
    map = World.scratch_map()
    %{user: Account.an_admin(), map: map}
  end

  describe "gate 2: a served value is the value" do
    test "the engine takes its defaults from what the backend answered, not from its own literals",
         %{conn: conn, user: user, map: map} do
      # The real payload, with one number moved somewhere no literal in the engine would ever say.
      served = NebulithWeb.MapController.schema_payload()
      stubbed = put_in(served, ["defaults", "opacity"], "0.37")

      session =
        conn
        |> StubApi.stub(%{"/api/maps/schema" => %{"data" => stubbed}})
        |> Account.sign_in(user)
        |> Editor.open(map.id)
        |> Browser.wait_for_js("!!window.__nebulithTileSchema", "the engine to load the schema")

      StubApi.assert_served(session, "/api/maps/schema")

      assert Browser.js(session, "window.__nebulithTileSchema.defaults.opacity") == "0.37",
             "the engine did not take the served default for opacity, so something else decides it"
    end

    test "a setting the backend leaves out stops the map rather than being invented",
         %{conn: conn, user: user, map: map} do
      # The same payload with `opacity` REMOVED from the defaults. What the engine must NOT do is carry
      # on with a number of its own, because that number reaches the screen and looks like somebody
      # meant it. What it does instead is refuse: the canvas never comes up at all.
      served = NebulithWeb.MapController.schema_payload()
      stubbed = update_in(served["defaults"], &Elixir.Map.delete(&1, "opacity"))

      session =
        conn
        |> StubApi.stub(%{"/api/maps/schema" => %{"data" => stubbed}})
        |> Account.sign_in(user)
        |> visit("/templates?id=#{map.id}")

      Process.sleep(8_000)

      refute Browser.true?(session, "!!document.querySelector('canvas.nebcanvas')"),
             "the map drew without a served default for opacity, so a literal supplied one"

      refute Browser.true?(session, "'opacity' in (window.__nebulithTileSchema?.defaults ?? {})"),
             "the engine invented a default for a setting the backend did not send"
    end
  end
end

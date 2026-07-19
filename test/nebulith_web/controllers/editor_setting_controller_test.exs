defmodule NebulithWeb.EditorSettingControllerTest do
  @moduledoc "Round-trips the editor-settings key→value store: GET the whole map, PUT one key (upsert)."
  use NebulithWeb.ConnCase

  @geo %{"x" => 120, "y" => 80, "w" => 340, "h" => 440}

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "index" do
    test "starts empty (no settings saved yet)", %{conn: conn} do
      conn = get(conn, ~p"/api/editor_settings")
      assert json_response(conn, 200)["editorSettings"] == %{}
    end
  end

  describe "update (upsert) + round-trip" do
    test "PUT a key stores the geometry and GET returns it under that key", %{conn: conn} do
      conn = put(conn, ~p"/api/editor_settings/settings", value: @geo)
      assert %{"key" => "settings", "value" => value} = json_response(conn, 200)
      assert value == @geo

      conn = get(conn, ~p"/api/editor_settings")
      assert json_response(conn, 200)["editorSettings"] == %{"settings" => @geo}
    end

    test "PUT the same key twice UPDATES in place (upsert, no duplicate row)", %{conn: conn} do
      conn = put(conn, ~p"/api/editor_settings/animation", value: @geo)
      assert json_response(conn, 200)["value"] == @geo

      moved = %{"x" => 9, "y" => 9, "w" => 500, "h" => 600}
      conn = put(conn, ~p"/api/editor_settings/animation", value: moved)
      assert json_response(conn, 200)["value"] == moved

      conn = get(conn, ~p"/api/editor_settings")
      # exactly one key, holding the LATEST geometry
      assert json_response(conn, 200)["editorSettings"] == %{"animation" => moved}
    end

    test "distinct keys coexist in the store", %{conn: conn} do
      conn = put(conn, ~p"/api/editor_settings/settings", value: @geo)
      trig = %{"x" => 1, "y" => 2, "w" => 3, "h" => 4}
      conn = put(conn, ~p"/api/editor_settings/triggers", value: trig)

      conn = get(conn, ~p"/api/editor_settings")
      assert json_response(conn, 200)["editorSettings"] == %{"settings" => @geo, "triggers" => trig}
    end
  end
end

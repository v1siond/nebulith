defmodule NebulithWeb.TemplateControllerTest do
  @moduledoc """
  `/api/templates` — a saved map's ROUND TRIP.

  Written for a defect that had no test to catch it. It was not: the editor had sent `slabBlocks` with every save
  since
  `75f9685`, `Template` declared no such field, and `cast/3` drops what the schema does not declare —
  silently, with a 200 back, so a saved map always reloaded one block deep.

  Every field the editor SENDS has to come back, so this asserts the shape rather than one column.
  """
  use NebulithWeb.ConnCase

  setup %{conn: conn}, do: {:ok, conn: put_req_header(conn, "accept", "application/json")}

  defp payload(over \\ %{}) do
    Map.merge(
      %{
        "id" => "t-#{System.unique_integer([:positive])}",
        "name" => "a saved map",
        "cols" => 44,
        "rows" => 28,
        "cellSize" => 16,
        "slabBlocks" => 6,
        "groundData" => [["grass"]],
        "heightData" => [[1]],
        "assetsData" => []
      },
      over
    )
  end

  describe "create then read back" do
    test "every number that describes the map's shape survives the round trip", %{conn: conn} do
      body = payload()
      created = json_response(post(conn, ~p"/api/templates", body), 201)
      assert created["slabBlocks"] == 6

      read = json_response(get(conn, ~p"/api/templates/#{body["id"]}"), 200)
      assert read["cols"] == 44
      assert read["rows"] == 28
      assert read["cellSize"] == 16
      assert read["slabBlocks"] == 6
    end

    test "a map that states no thickness comes back one block deep, not nil", %{conn: conn} do
      body = payload() |> Map.delete("slabBlocks")
      json_response(post(conn, ~p"/api/templates", body), 201)

      assert json_response(get(conn, ~p"/api/templates/#{body["id"]}"), 200)["slabBlocks"] == 1
    end

    test "a FLAT map keeps its zero — it is a real value, not a missing one", %{conn: conn} do
      body = payload(%{"slabBlocks" => 0})
      json_response(post(conn, ~p"/api/templates", body), 201)

      assert json_response(get(conn, ~p"/api/templates/#{body["id"]}"), 200)["slabBlocks"] == 0
    end
  end

  describe "update" do
    test "changing the thickness persists it", %{conn: conn} do
      body = payload()
      json_response(post(conn, ~p"/api/templates", body), 201)

      json_response(put(conn, ~p"/api/templates/#{body["id"]}", %{"slabBlocks" => 9}), 200)
      assert json_response(get(conn, ~p"/api/templates/#{body["id"]}"), 200)["slabBlocks"] == 9
    end
  end

  describe "a map that is not there" do
    test "reads as 404 rather than a 500 or an empty object", %{conn: conn} do
      assert conn |> get(~p"/api/templates/does-not-exist") |> response(404)
    end
  end
end

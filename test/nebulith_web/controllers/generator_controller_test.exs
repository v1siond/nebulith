defmodule NebulithWeb.GeneratorControllerTest do
  @moduledoc "GET /api/generators — the whole map-generator catalog the editor loads at mount."
  use NebulithWeb.ConnCase

  alias Nebulith.Catalog.GeneratorSource

  setup %{conn: conn}, do: {:ok, conn: put_req_header(conn, "accept", "application/json")}

  test "returns an empty catalog before anything is seeded", %{conn: conn} do
    assert json_response(get(conn, ~p"/api/generators"), 200) == %{"data" => []}
  end

  describe "with the catalog seeded" do
    setup do
      GeneratorSource.seed()
      :ok
    end

    test "serves every category in menu order, each with its generators", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]

      assert Enum.map(data, & &1["key"]) == ~w(forest town city cave temple)
      forest = hd(data)
      assert forest["name"] == "Forest"
      assert Enum.map(forest["generators"], & &1["key"]) == ~w(forest_woodland forest_meadow forest_meadow_river)
      assert Enum.map(forest["generators"], & &1["layout"]) == ["woodland", "meadow", "meadow_river"]
    end

    test "a generator's whole config rides through the JSON untouched", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      town = Enum.find(data, &(&1["key"] == "town")) |> Map.fetch!("generators") |> hd()

      assert town["config"]["grid"]["cols"] == %{"min" => 30, "max" => 45}
      assert town["config"]["settlement"]["buildingCap"] == 18
      assert town["config"]["units"]["townsfolk"] == 8
      assert town["config"]["buildings"]["materials"] == ["wall_brick", "wall_wood", "wall_stone"]
      assert town["zones"] == ~w(spring summer autumn winter desert)
    end

    test "the response carries no database bookkeeping — just what the editor needs", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      category = hd(data)
      generator = hd(category["generators"])

      assert Map.keys(category) |> Enum.sort() == ~w(description generators key name position)
      assert Map.keys(generator) |> Enum.sort() == ~w(config description key layout name position zones)
    end
  end
end

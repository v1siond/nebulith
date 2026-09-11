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
      assert Enum.map(forest["generators"], & &1["key"]) == ~w(forest_woodland forest_jungle forest_meadow)
      assert Enum.map(forest["generators"], & &1["layout"]) == ["woodland", "jungle", "meadow"]
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
      assert Map.keys(generator) |> Enum.sort() == ~w(children config description key layout name options position variant zones)
    end

    test "a forest's options ride over the wire whole, dependency and all", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      woodland = hd(data) |> Map.fetch!("generators") |> hd()

      # The editor draws these toggles straight from here and greys the crossing out until the river is on.
      # It never hardcodes the pair, so the shape is the contract — keys, labels, defaults and `requires`.
      # THE WAYS COME FIRST, since 2026-09-11: his *"we should always have paths firsts"*. Their own shape is
      # pinned in `generator_source_test`; here it matters that they ride over the wire, and in what order.
      assert Enum.map(woodland["options"], & &1["key"]) == ~w(exits pathways river crossing bridge)

      assert Enum.drop(woodland["options"], 2) == [
               %{
                 "key" => "river",
                 "label" => "River",
                 "type" => "choice",
                 "default" => "none",
                 "choices" => [
                   %{"key" => "none", "label" => "No river"},
                   %{"key" => "random", "label" => "Random"},
                   %{"key" => "through", "label" => "Winds through (easy to cross)"},
                   %{"key" => "divides", "label" => "Divides the map in two"},
                   %{"key" => "around", "label" => "Around the edge"}
                 ]
               },
               %{
                 "key" => "crossing",
                 "label" => "A crossing joined to the paths",
                 "type" => "toggle",
                 "default" => false,
                 "requires" => "river"
               },
               %{
                 "key" => "bridge",
                 "label" => "Kind of crossing",
                 "type" => "choice",
                 "default" => "random",
                 "requires" => "river",
                 "choices" => [
                   %{"key" => "random", "label" => "Random"},
                   %{"key" => "dirt", "label" => "Dirt path"},
                   %{"key" => "wood", "label" => "Wooden bridge"},
                   %{"key" => "planks", "label" => "Plank walkway"},
                   %{"key" => "stone", "label" => "Stone bridge"}
                 ]
               }
             ]
    end

    test "subtypes ride nested, each with its merged config ready to run", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      woodland = hd(data) |> Map.fetch!("generators") |> hd()
      mountain = Enum.find(woodland["children"], &(&1["key"] == "forest_woodland_mountain"))

      assert mountain["config"]["nature"]["canopy"] == 0.28
      assert mountain["config"]["grid"] == woodland["config"]["grid"]
      assert mountain["children"] == []
    end

    test "a generator with nothing to switch on serves an empty list, not null", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      town = Enum.find(data, &(&1["key"] == "town")) |> Map.fetch!("generators") |> hd()

      # `null` would make the frontend guard every map over it. The column is NOT NULL defaulting to `[]`.
      # A cave is no longer the example: since 2026-09-11 it says how many exits and pathways it has.
      assert town["options"] == []
    end

    test "a cave says how many EXITS and PATHWAYS it has", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      cave = Enum.find(data, &(&1["key"] == "cave")) |> Map.fetch!("generators") |> hd()

      # His cave: *"1 exit and 3 pathways to simulate entrance ... until I reach a part where is just 1 exit no
      # pathway, which is the end of the cave"*. Two numbers, and they reach the editor from here.
      assert Enum.map(cave["options"], & &1["key"]) == ~w(exits pathways)
      assert Enum.all?(cave["options"], &(&1["default"] == "random"))
    end
  end
end

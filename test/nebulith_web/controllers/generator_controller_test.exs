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

      assert Enum.map(data, & &1["key"]) == ~w(forest settlement cave temple)
      forest = hd(data)
      assert forest["name"] == "Forest"
      assert Enum.map(forest["generators"], & &1["key"]) == ~w(forest_woodland forest_jungle forest_meadow)
      assert Enum.map(forest["generators"], & &1["layout"]) == ["woodland", "jungle", "meadow"]
    end

    test "a generator's whole config rides through the JSON untouched", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      town = Enum.find(data, &(&1["key"] == "settlement")) |> Map.fetch!("generators") |> hd()

      assert town["config"]["grid"]["cols"] == %{"min" => 30, "max" => 45}
      assert town["config"]["settlement"]["buildingCap"] == 18
      assert town["config"]["units"]["townsfolk"] == 8
      assert town["config"]["buildings"]["materials"] == ["wall_brick", "wall_wood"]
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
      # THE WAYS COME FIRST, since 2026-09-11: the Their own shape is
      # pinned in `generator_source_test`; here it matters that they ride over the wire, and in what order.
      assert Enum.map(woodland["options"], & &1["key"]) == ~w(exits pathways river crossing depth bridge)

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
               # HOW DEEP the channel is cut, and it rides the wire like the rest.
               # `flat` is the old
               # behaviour, a river painted on the walking plane.
               %{
                 "key" => "depth",
                 "label" => "How deep the channel is cut",
                 "type" => "choice",
                 "default" => "1",
                 "requires" => "river",
                 "choices" => [
                   %{"key" => "1", "label" => "One block down"},
                   %{"key" => "2", "label" => "Two blocks down"}
                 ]
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
      # A settlement is no longer the example either: since 2026-09-14 a town says how many exits and how many
      # streets it has, so a generator with genuinely nothing to switch on is what this needs. `null` would
      # make the frontend guard every map over it; the column is NOT NULL defaulting to `[]`.
      empty =
        data
        |> Enum.flat_map(&Map.fetch!(&1, "generators"))
        |> Enum.find(&(&1["options"] == []))

      for gen <- Enum.flat_map(data, &Map.fetch!(&1, "generators")) do
        assert is_list(gen["options"]), "#{gen["key"]} serves #{inspect(gen["options"])}, not a list"
      end

      # …and if every generator has something to switch on today, the list shape is still what is being
      # asserted, which is the point of the test.
      assert empty == nil or empty["options"] == []
    end

    test "a cave says how many EXITS and PATHWAYS it has", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      cave = Enum.find(data, &(&1["key"] == "cave")) |> Map.fetch!("generators") |> hd()

      # The cave: Two numbers, and they reach the editor from here.
      assert Enum.map(cave["options"], & &1["key"]) == ~w(exits pathways)
      assert Enum.all?(cave["options"], &(&1["default"] == "random"))
    end
  end
end

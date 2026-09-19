defmodule NebulithWeb.GeneratorControllerTest do
  @moduledoc "GET /api/generators: the whole map-generator catalog the editor loads at mount."
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

      assert Enum.map(data, & &1["key"]) == ~w(wilderness village town city cave temple)
      wilderness = hd(data)
      assert wilderness["name"] == "Wilderness"

      # The TYPE is the environment, and the same nine run in the three settlement categories too.
      assert Enum.map(wilderness["generators"], & &1["key"]) ==
               ~w(forest_woodland forest_jungle forest_meadow forest_swamp forest_mountain forest_beach
                  forest_ruins forest_desert forest_volcanic)

      # `layout` is the BUILDER the engine runs, not the row's identity: a swamp and a beach are both built
      # by the jungle builder wearing their own palette, species and regions.
      assert Enum.map(wilderness["generators"], & &1["layout"]) ==
               ~w(woodland jungle meadow jungle woodland jungle jungle jungle woodland)
    end

    test "a generator's whole config rides through the JSON untouched", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      town = Enum.find(data, &(&1["key"] == "town")) |> Map.fetch!("generators") |> hd()

      assert town["config"]["grid"]["cols"] == %{"min" => 30, "max" => 45}
      assert town["config"]["settlement"]["buildingCap"] == 18
      assert town["config"]["units"]["townsfolk"] == 8
      assert town["config"]["buildings"]["materials"] == ["wall_brick", "wall_wood"]
      assert town["zones"] == ~w(spring summer autumn winter desert)
    end

    test "the response carries no database bookkeeping, just what the editor needs", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      category = hd(data)
      generator = hd(category["generators"])

      assert Map.keys(category) |> Enum.sort() == ~w(description generators key name position)
      assert Map.keys(generator) |> Enum.sort() == ~w(children config description key layout name options position variant zones)
    end

    test "a forest's options ride over the wire whole, dependency and all", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      woodland = hd(data) |> Map.fetch!("generators") |> hd()

      # The editor draws these straight from here and greys each one out until the river it needs is on. It
      # never hardcodes them, so the shape is the contract: keys, labels, defaults and `requires`. The ways
      # come first. Their own shape is pinned in `generator_source_test`; here it matters that they ride over
      # the wire, and in what order.
      #
      # `crossing` was a toggle in this list and is gone: "A crossing joined to the paths" said nothing about
      # what it decided. A river that cuts a path always gets a crossing now, so there was nothing left for it
      # to decide. `bridge` stays, because WHICH crossing is a real choice.
      # No `depth`: there is no channel to cut, so the option that said how deep is gone (ABodyOfWaterIsLevel).
      assert Enum.map(woodland["options"], & &1["key"]) == ~w(exits pathways region river bridge)

      assert Enum.drop(woodland["options"], 3) == [
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
                 "key" => "bridge",
                 "label" => "Kind of crossing",
                 "type" => "choice",
                 "default" => "random",
                 "requires" => "river",
                 "choices" => [
                   %{"key" => "random", "label" => "Random"},
                   # NO BRIDGE is a choice rather than an omission: it used to happen only when the geometry
                   # failed to place one, which is not the same as being able to ask for it.
                   %{"key" => "none", "label" => "No bridge"},
                   # A DIRT PATH IS NOT A BUILT CROSSING. It names no composition, and that absence is what
                   # makes it a ford: the river shallow enough to walk through rather than a structure over it.
                   %{"key" => "dirt", "label" => "Dirt path"},
                   %{"key" => "wood", "label" => "Wooden bridge"},
                   # "Plank walkway" sat here between the wooden bridge and the stone one and named nothing
                   # anybody could picture. Removed on request, along with its crossing entry and its five
                   # compositions, which were byte-identical to the wooden ones anyway.
                   %{"key" => "stone", "label" => "Stone bridge"}
                 ]
               }
             ]
    end

    test "an environment rides as a TYPE of its own, ready to run, with nothing nested under it", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      wilderness = hd(data) |> Map.fetch!("generators")
      woodland = hd(wilderness)
      mountain = Enum.find(wilderness, &(&1["key"] == "forest_mountain"))

      # A mountain forest used to be a subtype of the woodland, inheriting most of what it was. It is a type
      # now, so what it is arrives whole: its own canopy, its own regions, and the grid every wild map shares.
      assert mountain["config"]["nature"]["canopy"] == 0.28
      assert mountain["config"]["grid"] == woodland["config"]["grid"]
      assert Enum.map(mountain["config"]["subZones"], & &1["key"]) == ~w(edge deep glade thicket lakeside)
      assert mountain["children"] == []
      assert woodland["children"] == []
    end

    test "a city's neighbourhoods ride over the wire with their architecture", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/generators"), 200)["data"]
      city = Enum.find(data, &(&1["key"] == "city")) |> Map.fetch!("generators") |> hd()

      zones = city["config"]["subZones"]
      assert Enum.map(zones, & &1["key"]) == ~w(upper middle lower)

      # The editor draws the difference between rich and poor from HERE: the material, the roof tile and the
      # colours, per neighbourhood, never derived at render.
      for zone <- zones do
        assert zone["buildings"]["materials"] != []
        assert is_binary(zone["buildings"]["roof"])
      end
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

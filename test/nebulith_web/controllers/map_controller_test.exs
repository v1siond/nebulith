defmodule NebulithWeb.MapControllerTest do
  @moduledoc """
  THE ROUND TRIP, THROUGH HTTP.

  The context round-tripping in Elixir is not the same claim as a map surviving a real request. JSON
  has no decimals and no atoms, so this is where a number quietly becomes a float and a setting quietly
  becomes a string. What goes out has to come back, through the encoder, unchanged.
  """
  use NebulithWeb.ConnCase

  setup :log_in_api_user

  defp create_map(conn, grid \\ %{"cols" => 4, "rows" => 4}) do
    conn
    |> post(~p"/api/maps", %{
      "map" => %{"name" => "HTTP #{System.unique_integer([:positive])}"},
      "grid" => grid
    })
    |> json_response(201)
    |> get_in(["data", "id"])
  end

  describe "the schema endpoint" do
    test "serves the field list off the schema, not a list typed beside it", %{conn: conn} do
      data = conn |> get(~p"/api/maps/schema") |> json_response(200) |> Elixir.Map.get("data")

      assert length(data["fields"]) == 52, "53 columns less the id the caller never sets"
      assert "stack_at" in data["fields"]
      assert "thickness_lu" in data["fields"]
      assert "water_heading" in data["fields"]
      refute "zoom" in data["fields"]
      refute "walkable" in data["fields"]
    end

    test "serves every default, so the engine has no reason to hold one", %{conn: conn} do
      defaults =
        conn |> get(~p"/api/maps/schema") |> json_response(200) |> get_in(["data", "defaults"])

      assert defaults["stack_at"] == 1
      assert defaults["width"] == "1.0"
      assert defaults["display"] == "all_faces"
      assert defaults["shape"] == "square"
      assert defaults["act_as_tile"] == false
    end

    test "serves the values each enum column admits", %{conn: conn} do
      vocab =
        conn
        |> get(~p"/api/maps/schema")
        |> json_response(200)
        |> get_in(["data", "vocabularies"])

      assert vocab["shape"] == ~w(square circle cone), "cone, because a conifer is not round"
      assert vocab["display"] == ~w(all_faces single)
      assert vocab["water_heading"] == ~w(n e s w)
    end
  end

  describe "a map over HTTP" do
    test "comes back exactly as it was sent", %{conn: conn} do
      id = create_map(conn)

      sent = %{
        "cells" => [
          %{
            "col" => 2,
            "row" => 1,
            "ground_height" => -3,
            "surface" => "ramp_e",
            "submerge" => "0.65",
            "tiles" => [
              %{
                "width" => "1.5",
                "height" => "4.25",
                "thickness_lu" => "0.2",
                "span_forward" => 3,
                "rotation" => "270.0",
                "stack_at" => 0,
                "display" => "single",
                "shape" => "cone",
                "color" => "#123456",
                "opacity" => "0.5",
                "water_heading" => "n",
                "act_as_tile" => true
              }
            ]
          }
        ]
      }

      saved =
        conn
        |> recycle()
        |> put(~p"/api/maps/#{id}", sent)
        |> json_response(200)
        |> Elixir.Map.get("data")

      loaded =
        conn
        |> recycle()
        |> get(~p"/api/maps/#{id}")
        |> json_response(200)
        |> Elixir.Map.get("data")

      assert saved == loaded

      [cell] = loaded["cells"]
      assert cell["ground_height"] == -3
      assert cell["surface"] == "ramp_e"
      assert cell["submerge"] == "0.65"

      [tile] = cell["tiles"]

      for {key, value} <- hd(sent["cells"])["tiles"] |> hd() do
        assert tile[key] == value,
               "#{key}: sent #{inspect(value)}, got back #{inspect(tile[key])}"
      end
    end

    test "a decimal survives JSON, which is where a number usually becomes a float", %{conn: conn} do
      id = create_map(conn)

      conn
      |> recycle()
      |> put(~p"/api/maps/#{id}", %{
        "cells" => [%{"col" => 0, "row" => 0, "tiles" => [%{"height" => "0.1"}]}]
      })
      |> json_response(200)

      loaded =
        conn
        |> recycle()
        |> get(~p"/api/maps/#{id}")
        |> json_response(200)
        |> Elixir.Map.get("data")

      [%{"tiles" => [tile]}] = loaded["cells"]

      assert tile["height"] == "0.1",
             "0.1 is not representable as a float and must not travel as one"
    end

    test "the grid's own numbers survive a save", %{conn: conn} do
      id =
        create_map(conn, %{
          "cols" => 7,
          "rows" => 9,
          "cell_size" => 32,
          "iso_scale" => "3.125",
          "slab_blocks" => 4
        })

      loaded =
        conn
        |> recycle()
        |> get(~p"/api/maps/#{id}")
        |> json_response(200)
        |> Elixir.Map.get("data")

      assert loaded["grid"]["cols"] == 7
      assert loaded["grid"]["cell_size"] == 32
      assert loaded["grid"]["iso_scale"] == "3.125"
      assert loaded["grid"]["slab_blocks"] == 4
    end

    test "a value outside its vocabulary is refused rather than stored", %{conn: conn} do
      id = create_map(conn)

      answer =
        conn
        |> recycle()
        |> put(~p"/api/maps/#{id}", %{
          "cells" => [%{"col" => 0, "row" => 0, "surface" => "ramp_up_and_left", "tiles" => []}]
        })

      assert answer.status in [422, 500], "an unknown surface must not be written"

      loaded =
        conn
        |> recycle()
        |> get(~p"/api/maps/#{id}")
        |> json_response(200)
        |> Elixir.Map.get("data")

      refute Enum.any?(loaded["cells"], &(&1["surface"] == "ramp_up_and_left"))
    end

    test "a map that is not there is a 404, not a crash", %{conn: conn} do
      assert conn |> get(~p"/api/maps/#{Ecto.UUID.generate()}") |> json_response(404)
    end
  end

  describe "the door" do
    test "maps are behind the api gate like everything else" do
      conn = build_conn()

      assert conn |> get(~p"/api/maps") |> json_response(401)
      assert conn |> recycle() |> get(~p"/api/maps/schema") |> json_response(401)
    end
  end
end

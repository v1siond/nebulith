defmodule NebulithWeb.UiControllerTest do
  @moduledoc """
  `GET /api/ui` — the action catalog and the UI profile in force.

  Shaped by the answers Alexander gave the UI spec on 2026-09-06: one profile per game plus a seeded
  default, author-controlled player limits, unlimited bars with conditional swapping, and a Desktop AND a
  Mobile layout in the same profile.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Catalog.UiSource

  setup %{conn: conn}, do: {:ok, conn: put_req_header(conn, "accept", "application/json")}

  test "serves an empty catalog and no profile before anything is seeded", %{conn: conn} do
    data = json_response(get(conn, ~p"/api/ui"), 200)["data"]
    assert data["actions"] == []
    assert data["profile"] == nil
  end

  describe "seeded" do
    setup do
      UiSource.seed()
      :ok
    end

    test "names every action the engine can bind, with the key it ships on", %{conn: conn} do
      actions = json_response(get(conn, ~p"/api/ui"), 200)["data"]["actions"]
      keys = Enum.map(actions, & &1["key"])

      assert "move_up" in keys
      assert "attack_primary" in keys
      assert "power_1" in keys
      move = Enum.find(actions, &(&1["key"] == "move_up"))
      assert move["category"] == "movement"
      assert move["defaultChord"] =~ "W"
    end

    test "a game with no profile of its own gets the DEFAULT", %{conn: conn} do
      profile = json_response(get(conn, ~p"/api/ui?game=#{Ecto.UUID.generate()}"), 200)["data"]["profile"]
      assert profile["key"] == "default"
    end

    test "the default carries a binding for every action", %{conn: conn} do
      data = json_response(get(conn, ~p"/api/ui"), 200)["data"]

      bound = MapSet.new(data["profile"]["bindings"], & &1["actionKey"])
      catalog = MapSet.new(data["actions"], & &1["key"])
      assert MapSet.equal?(bound, catalog)
    end

    test "carries BOTH form layouts in one profile, not one scaled down", %{conn: conn} do
      elements = json_response(get(conn, ~p"/api/ui"), 200)["data"]["profile"]["elements"]

      forms = elements |> Enum.map(& &1["form"]) |> Enum.uniq() |> Enum.sort()
      assert forms == ["Desktop", "Mobile"]
      # A placement is the anchor+offset model, not absolute pixels.
      vitals = Enum.find(elements, &(&1["elementKey"] == "vitals" and &1["form"] == "Desktop"))
      assert vitals["placement"]["a"] == "BL"
    end

    test "states what a PLAYER may change, because the author owns that limit", %{conn: conn} do
      may = json_response(get(conn, ~p"/api/ui"), 200)["data"]["profile"]["playerMay"]

      assert may["keys"] == true
      assert may["layout"] == false
    end

    test "a bar with no condition is ALWAYS up, and nil says so rather than a magic value", %{conn: conn} do
      [bar] = json_response(get(conn, ~p"/api/ui"), 200)["data"]["profile"]["bars"]

      assert bar["condition"] == nil
      assert bar["rows"] == 1 and bar["cols"] == 4
      assert length(bar["slots"]) == 4
      assert Enum.map(bar["slots"], & &1["refKey"]) == ~w(power_1 power_2 power_3 power_4)
    end

    test "re-seeding is idempotent — no duplicate bindings, elements or bars", %{conn: conn} do
      before = json_response(get(conn, ~p"/api/ui"), 200)["data"]["profile"]
      UiSource.seed()
      again = json_response(get(conn, ~p"/api/ui"), 200)["data"]["profile"]

      assert length(before["bindings"]) == length(again["bindings"])
      assert length(before["elements"]) == length(again["elements"])
      assert length(before["bars"]) == length(again["bars"])
    end
  end
end

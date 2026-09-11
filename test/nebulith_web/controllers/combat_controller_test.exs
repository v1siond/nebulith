defmodule NebulithWeb.CombatControllerTest do
  @moduledoc """
  `GET /api/combat` — the creature roster and the fight's coefficients.

  These were nine stat blocks and a handful of "tunable coefficients" in the frontend
  (`game/archetypes.ts`, `game/combat.ts`, `game/entities.ts`). Alexander, 2026-09-10: *"anything that
  is DATA should be moved to the backend, the frontend just processes the data algorithmically"*.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Catalog.CombatSource

  setup %{conn: conn}, do: {:ok, conn: put_req_header(conn, "accept", "application/json")}

  test "serves nothing before anything is seeded, rather than inventing a roster", %{conn: conn} do
    data = json_response(get(conn, ~p"/api/combat"), 200)["data"]
    assert data["archetypes"] == []
    assert data["rules"] == %{}
  end

  describe "seeded" do
    setup do
      CombatSource.seed()
      :ok
    end

    test "serves every archetype in menu order", %{conn: conn} do
      archetypes = json_response(get(conn, ~p"/api/combat"), 200)["data"]["archetypes"]

      assert Enum.map(archetypes, & &1["key"]) ==
               ~w(grunt brute skirmisher archer mage raider flyer crawler sentinel)
    end

    test "an archetype carries the whole stat block, pace and reach", %{conn: conn} do
      brute =
        json_response(get(conn, ~p"/api/combat"), 200)["data"]["archetypes"]
        |> Enum.find(&(&1["key"] == "brute"))

      assert brute["name"] == "Brute"
      assert brute["stats"] == %{"strength" => 12, "intelligence" => 0, "defense" => 6, "maxHp" => 72, "dodge" => 0}
      assert brute["moveDelayMs"] == 1700
      assert brute["reachCells"] == 1
    end

    test "an attack PATTERN rides through verbatim, so the combat tick reshapes nothing", %{conn: conn} do
      raider =
        json_response(get(conn, ~p"/api/combat"), 200)["data"]["archetypes"]
        |> Enum.find(&(&1["key"] == "raider"))

      assert raider["attack"]["mode"] == "sequential"
      assert [hack, snipe] = raider["attack"]["attacks"]
      assert hack["name"] == "Hack"
      assert hack["mode"] == "melee"
      assert hack["damage"] == 6
      assert snipe["mode"] == "ranged"
      assert snipe["reachCells"] == 6
    end

    test "serves the coefficients the damage maths multiplies by", %{conn: conn} do
      combat = json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"]["combat"]

      assert combat["regularMultiplier"] == 1
      assert combat["specialMultiplier"] == 1.75
      assert combat["specialResourceCost"] == 20
      assert combat["minDamage"] == 1
      assert combat["specialResource"]["physical"] == %{"key" => "rage", "failure" => "insufficient-rage"}
    end

    test "serves the default stat lines and the respawn delay", %{conn: conn} do
      stats = json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"]["stats"]

      assert stats["player"]["maxHp"] == 100
      assert stats["enemy"]["maxHp"] == 30
      assert stats["npc"]["maxHp"] == 10
      assert stats["respawnMs"] == 5000
    end

    test "re-seeding is idempotent — no duplicates, and the rows keep their ids", %{conn: conn} do
      before = json_response(get(conn, ~p"/api/combat"), 200)["data"]["archetypes"]
      CombatSource.seed()
      again = json_response(get(conn, ~p"/api/combat"), 200)["data"]["archetypes"]

      assert length(before) == 9
      assert before == again
    end
  end
end

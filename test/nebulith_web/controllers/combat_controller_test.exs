defmodule NebulithWeb.CombatControllerTest do
  @moduledoc """
  `GET /api/combat`, the creature roster and the fight's coefficients.

  These were nine stat blocks and a handful of "tunable coefficients" in the frontend
  (`game/archetypes.ts`, `game/combat.ts`, `game/entities.ts`).
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Catalog.CombatSource

  setup %{conn: conn}, do: {:ok, conn: put_req_header(conn, "accept", "application/json")}

  test "serves nothing before anything is seeded, rather than inventing rules", %{conn: conn} do
    assert json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"] == %{}
  end

  describe "seeded" do
    setup do
      CombatSource.seed()
      :ok
    end

    test "serves no creature roster, a creature's numbers ride on its own tile", %{conn: conn} do
      # `enemy_archetypes` is gone; `TileSource.seed_unit_combat/0` puts the stat block on the tile.
      data = json_response(get(conn, ~p"/api/combat"), 200)["data"]
      refute Map.has_key?(data, "archetypes")
    end

    test "serves the coefficients the damage maths multiplies by", %{conn: conn} do
      combat = json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"]["combat"]

      assert combat["regularMultiplier"] == 1
      assert combat["specialMultiplier"] == 1.75
      assert combat["specialResourceCost"] == 20
      assert combat["minDamage"] == 1

      assert combat["specialResource"]["physical"] == %{
               "key" => "rage",
               "failure" => "insufficient-rage"
             }
    end

    test "serves the default stat lines and the respawn delay", %{conn: conn} do
      stats = json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"]["stats"]

      assert stats["player"]["maxHp"] == 100
      assert stats["enemy"]["maxHp"] == 30
      assert stats["npc"]["maxHp"] == 10
      assert stats["respawnMs"] == 5000
    end

    test "re-seeding is idempotent, the rules come back the same", %{conn: conn} do
      before = json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"]
      CombatSource.seed()
      assert json_response(get(conn, ~p"/api/combat"), 200)["data"]["rules"] == before
    end
  end
end

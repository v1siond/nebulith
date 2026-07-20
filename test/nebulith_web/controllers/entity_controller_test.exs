defmodule NebulithWeb.EntityControllerTest do
  use NebulithWeb.ConnCase

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "index" do
    test "serves the entity → baked-tile resolution map", %{conn: conn} do
      conn = get(conn, ~p"/api/entities")
      data = json_response(conn, 200)["data"]

      # the baked entity slug set + its bake source glyphs
      assert data["dir"] == "/tiles/emoji/baked/entities"
      assert data["tiles"]["goblin"] == "👺"
      assert data["tiles"]["robot"] == "🤖"

      # enemy type → slug (a bandit draws the ninja tile, orc/ogre share the ogre tile)
      assert data["enemyTypeSlug"]["bandit"] == "ninja"
      assert data["enemyTypeSlug"]["orc"] == "ogre"
      assert data["enemyTypeSlug"]["goblin"] == "goblin"

      # person variant → figure slug
      assert data["variantSlug"]["male"] == "man"
      assert data["variantSlug"]["old"] == "elder"
      assert data["variantSlug"]["robot"] == "robot"
    end

    test "every mapped slug is a member of the baked tile set", %{conn: conn} do
      conn = get(conn, ~p"/api/entities")
      data = json_response(conn, 200)["data"]
      baked = MapSet.new(Map.keys(data["tiles"]))

      for {_type, slug} <- data["enemyTypeSlug"] do
        assert MapSet.member?(baked, slug), "enemy slug #{slug} has no baked tile"
      end

      for {_variant, slug} <- data["variantSlug"] do
        assert MapSet.member?(baked, slug), "variant slug #{slug} has no baked tile"
      end
    end
  end
end

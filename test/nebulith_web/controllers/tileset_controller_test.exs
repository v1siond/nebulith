defmodule NebulithWeb.TilesetControllerTest do
  use NebulithWeb.ConnCase
  # /api is closed, so these all have to be somebody first. See docs/AUTH.md §5.
  setup :log_in_api_user

  import Nebulith.CatalogFixtures
  alias Nebulith.Catalog.Tileset

  @create_attrs %{
    name: "some name",
    key: "some key"
  }
  @update_attrs %{
    name: "some updated name",
    key: "some updated key"
  }
  @invalid_attrs %{name: nil, key: nil}

  setup %{conn: conn} do
    {:ok, conn: put_req_header(conn, "accept", "application/json")}
  end

  describe "index" do
    test "lists all tilesets", %{conn: conn} do
      conn = get(conn, ~p"/api/tilesets")
      assert json_response(conn, 200)["data"] == []
    end
  end

  describe "create tileset" do
    test "renders tileset when data is valid", %{conn: conn} do
      conn = post(conn, ~p"/api/tilesets", tileset: @create_attrs)
      assert %{"id" => id} = json_response(conn, 201)["data"]

      conn = get(conn, ~p"/api/tilesets/#{id}")

      assert %{
               "id" => ^id,
               "key" => "some key",
               "name" => "some name"
             } = json_response(conn, 200)["data"]
    end

    test "renders errors when data is invalid", %{conn: conn} do
      conn = post(conn, ~p"/api/tilesets", tileset: @invalid_attrs)
      assert json_response(conn, 422)["errors"] != %{}
    end
  end

  describe "update tileset" do
    setup [:create_tileset]

    test "renders tileset when data is valid", %{conn: conn, tileset: %Tileset{id: id} = tileset} do
      conn = put(conn, ~p"/api/tilesets/#{tileset}", tileset: @update_attrs)
      assert %{"id" => ^id} = json_response(conn, 200)["data"]

      conn = get(conn, ~p"/api/tilesets/#{id}")

      assert %{
               "id" => ^id,
               "key" => "some updated key",
               "name" => "some updated name"
             } = json_response(conn, 200)["data"]
    end

    test "renders errors when data is invalid", %{conn: conn, tileset: tileset} do
      conn = put(conn, ~p"/api/tilesets/#{tileset}", tileset: @invalid_attrs)
      assert json_response(conn, 422)["errors"] != %{}
    end
  end

  describe "delete tileset" do
    setup [:create_tileset]

    test "deletes chosen tileset", %{conn: conn, tileset: tileset} do
      conn = delete(conn, ~p"/api/tilesets/#{tileset}")
      assert response(conn, 204)

      assert_error_sent 404, fn ->
        get(conn, ~p"/api/tilesets/#{tileset}")
      end
    end
  end

  describe "index serves tiles + compositions" do
    test "each tileset carries its tiles (with image_url) + compositions", %{conn: conn} do
      {:ok, ts} = Nebulith.Catalog.create_tileset(%{key: "ascii", name: "ASCII"})

      {:ok, _} =
        Nebulith.Catalog.upsert_tile(%{
          tileset_id: ts.id,
          label: "trunk",
          image_url: "/tiles/ascii/trunk.png",
          blocking: true,
          height: 1,
          settings: %{"colors" => %{"spring" => "#7a5a3a"}}
        })

      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: "tree_small", footprint_w: 5, footprint_h: 3},
          [%{dx: 0, dy: 0, level: 0, label: "trunk", walkable: false}]
        )

      conn = get(conn, ~p"/api/tilesets")
      [t] = json_response(conn, 200)["data"]
      assert t["key"] == "ascii"
      # NO BLOB. A tileset is a name and a set of pictures, so there is nothing else on the wire.
      refute Map.has_key?(t, "data")
      assert t["tiles"]["trunk"]["image_url"] == "/tiles/ascii/trunk.png"
      assert t["tiles"]["trunk"]["settings"]["colors"]["spring"] == "#7a5a3a"
      assert t["compositions"]["tree_small"]["footprint"] == %{"w" => 5, "h" => 3}
      assert [%{"label" => "trunk"}] = t["compositions"]["tree_small"]["cells"]
      # every cell carries its draw-priority `zIndex` (camelCase), 0 here since the cell set none.
      assert [%{"zIndex" => 0}] = t["compositions"]["tree_small"]["cells"]
    end

    test "a composition's category is served (its sidebar bucket, exactly like a tile's)", %{
      conn: conn
    } do
      # a tileset must exist so the index returns a `data` entry to hang the (style-agnostic) compositions on.
      {:ok, _ts} = Nebulith.Catalog.create_tileset(%{key: "ascii", name: "ASCII"})

      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: "house_4", footprint_w: 4, footprint_h: 4, category: "buildings"},
          [%{dx: 0, dy: 0, level: 0, label: "door", walkable: true}]
        )

      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: "loose", footprint_w: 1, footprint_h: 1},
          [%{dx: 0, dy: 0, level: 0, label: "post", walkable: false}]
        )

      conn = get(conn, ~p"/api/tilesets")
      [t] = json_response(conn, 200)["data"]

      # the authored bucket rides through so the palette groups the composition like a tile (no frontend derivation)
      assert t["compositions"]["house_4"]["category"] == "buildings"

      # a category-less row serves nil, no crash, no invented bucket (it just isn't browseable in the palette)
      assert t["compositions"]["loose"]["category"] == nil
    end

    test "a cell's z_index is served as `zIndex` (draw priority) in the API", %{conn: conn} do
      # a tileset must exist so the index returns a `data` entry to hang the (style-agnostic) compositions on.
      {:ok, _ts} = Nebulith.Catalog.create_tileset(%{key: "ascii", name: "ASCII"})

      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: "prio", footprint_w: 1, footprint_h: 1},
          [
            %{dx: 0, dy: 0, level: 0, label: "water_c", walkable: false, z_index: 10},
            %{dx: 0, dy: 0, level: 0, label: "fountain_b", walkable: false}
          ]
        )

      conn = get(conn, ~p"/api/tilesets")
      [t] = json_response(conn, 200)["data"]
      by_label = Map.new(t["compositions"]["prio"]["cells"], &{&1["label"], &1["zIndex"]})
      assert by_label["water_c"] == 10
      assert by_label["fountain_b"] == 0
    end
  end

  defp create_tileset(_) do
    tileset = tileset_fixture()

    %{tileset: tileset}
  end
end

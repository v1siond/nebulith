defmodule Nebulith.CatalogTilesTest do
  use Nebulith.DataCase
  alias Nebulith.Catalog

  setup do
    {:ok, ts} = Catalog.create_tileset(%{key: "ascii", name: "ASCII", data: %{}})
    %{tileset: ts}
  end

  test "upsert_tile/1 + list_tiles_for/1 round-trips a tile", %{tileset: ts} do
    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ts.id,
        label: "leaf_center",
        color_role: "canopy",
        image_url: "/tiles/ascii/leaf_center.png",
        blocking: false,
        height: 1
      })

    [tile] = Catalog.list_tiles_for("ascii")
    assert tile.label == "leaf_center"
    assert tile.image_url == "/tiles/ascii/leaf_center.png"
  end

  test "upsert_tile/1 is idempotent on (tileset,label)", %{tileset: ts} do
    {:ok, _} = Catalog.upsert_tile(%{tileset_id: ts.id, label: "trunk", color_role: "trunk"})

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ts.id,
        label: "trunk",
        color_role: "trunk",
        image_url: "/tiles/ascii/trunk.png"
      })

    assert [%{image_url: "/tiles/ascii/trunk.png"}] = Catalog.list_tiles_for("ascii")
  end

  test "upsert_composition_with_cells/2 stores footprint + cells" do
    {:ok, _comp} =
      Catalog.upsert_composition_with_cells(
        %{name: "tree_small", footprint_w: 5, footprint_h: 3},
        [%{dx: 0, dy: 0, level: 0, label: "trunk_base", walkable: false}]
      )

    # BY NAME, NOT BY BEING THE ONLY ROW. This matched the whole table against a one-element list, so it
    # passed only while nothing else had ever seeded a composition, and it started failing the day a
    # migration seeded the cave entrances. What it is testing is that THIS composition round-tripped.
    loaded = Enum.find(Catalog.list_compositions(), &(&1.name == "tree_small"))
    assert loaded, "the composition just written is not in the catalog"
    assert {loaded.footprint_w, loaded.footprint_h} == {5, 3}
    assert [%{label: "trunk_base"}] = loaded.cells
  end
end

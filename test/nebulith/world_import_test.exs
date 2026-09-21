defmodule Nebulith.WorldImportTest do
  @moduledoc """
  THE MAPS SOMEBODY ALREADY AUTHORED SURVIVE THE MOVE.

  Phase 3 replaces three JSON blobs with rows. A replacement that leaves the existing maps behind in a
  column nothing reads is not a replacement, so this drives the importer over a template shaped exactly
  like the ones in the database and checks each translation the plan calls for.
  """
  use Nebulith.DataCase

  alias Nebulith.{Repo, World}
  alias Nebulith.World.Import

  setup do
    tileset =
      Repo.insert!(%Nebulith.Catalog.Tileset{
        key: "t#{System.unique_integer([:positive])}",
        name: "T",
        position: 1
      })

    tiles =
      Elixir.Map.new(~w(meadow water_smooth_river_c oak_canopy), fn label ->
        tile =
          Repo.insert!(%Nebulith.Catalog.Tile{tileset_id: tileset.id, label: label, title: label})

        {label, tile.id}
      end)

    %{tiles: tiles}
  end

  defp insert_template(attrs) do
    id = "tpl-#{System.unique_integer([:positive])}"
    now = NaiveDateTime.utc_now() |> NaiveDateTime.truncate(:second)

    row =
      Elixir.Map.merge(
        %{
          id: id,
          name: "Imported #{id}",
          description: "from a blob",
          category: "custom",
          cols: 3,
          rows: 2,
          cellSize: 20,
          isoScale: 2.25,
          slabBlocks: 2,
          spawnCol: 1,
          spawnRow: 1,
          groundData: [],
          heightData: [],
          assetsData: [],
          isPublic: false,
          tags: [],
          connectors: [],
          entities: [],
          quests: [],
          createdAt: now,
          updatedAt: now
        },
        attrs
      )

    Repo.insert_all("Template", [row])
    id
  end

  describe "the map itself" do
    test "keeps the grid numbers the blob was carrying" do
      id = insert_template(%{groundData: [["meadow"]], heightData: [[0]]})

      {:ok, map} = Import.import_template(id)
      {:ok, loaded} = World.load_map(map.id)

      assert loaded["grid"]["cols"] == 3
      assert loaded["grid"]["rows"] == 2
      assert loaded["grid"]["cell_size"] == 20
      assert loaded["grid"]["iso_scale"] == "2.25"
      assert loaded["grid"]["slab_blocks"] == 2
      assert loaded["grid"]["spawn_col"] == 1
    end

    test "running it twice rewrites the map rather than making a second one" do
      id = insert_template(%{groundData: [["meadow"]], heightData: [[0]]})

      {:ok, first} = Import.import_template(id)
      {:ok, second} = Import.import_template(id)

      assert first.id == second.id
      assert length(World.list_maps()) == 1
    end
  end

  describe "the ground" do
    test "becomes a cell per square, with its height and its own texture", %{tiles: tiles} do
      id =
        insert_template(%{
          groundData: [["meadow", "water_smooth_river_c", nil], ["meadow", nil, nil]],
          heightData: [[0, -1, 0], [2, 0, 0]]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, loaded} = World.load_map(map.id)

      by_coord = Elixir.Map.new(loaded["cells"], &{{&1["col"], &1["row"]}, &1})

      assert by_coord[{0, 0}]["texture_tile_id"] == tiles["meadow"]
      assert by_coord[{1, 0}]["texture_tile_id"] == tiles["water_smooth_river_c"]
      assert by_coord[{1, 0}]["ground_height"] == -1, "a dug-out cell is negative, not clamped"
      assert by_coord[{0, 1}]["ground_height"] == 2

      refute by_coord[{2, 0}], "a square nobody said anything about should not get a row"
    end
  end

  describe "the translations the plan calls for" do
    test "zoom is folded into the axes rather than dropped" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{
              "col" => 0,
              "row" => 0,
              "type" => "tree",
              "scale" => 2,
              "scaleX" => 1.5,
              "height" => 3
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [tile]}]}} = World.load_map(map.id)

      assert tile["width"] == "3.0", "1.5 wide at zoom 2 is 3 wide"
      assert tile["height"] == "6.0", "3 tall at zoom 2 is 6 tall"
      refute Elixir.Map.has_key?(tile, "zoom")
    end

    test "the old depth fields become counts of whole cells" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{
              "col" => 0,
              "row" => 0,
              "type" => "roof",
              "depth" => 4,
              "depthBack" => 1,
              "depthPerp" => 2,
              "depthDir" => "left-up"
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [tile]}]}} = World.load_map(map.id)

      assert tile["span_forward"] == 4
      assert tile["span_back"] == 2, "1 EXTRA cell back is 2 cells counted"
      assert tile["span_perp"] == 3
      assert tile["span_perp_back"] == 1, "nothing said means the anchor and no more"
      assert tile["span_axis"] == "left-up"
    end

    test "a uniform squash becomes all four thickness reaches, and a named reach wins" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{"col" => 0, "row" => 0, "type" => "door", "scaleZ" => 0.3},
            %{
              "col" => 0,
              "row" => 0,
              "type" => "trunk",
              "heightLevel" => 1,
              "scaleZ" => 0.5,
              "thickness" => %{"left-up" => 0.1}
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [door, trunk]}]}} = World.load_map(map.id)

      assert Enum.all?(
               ~w(thickness_lu thickness_ru thickness_ld thickness_rd),
               &(door[&1] == "0.3")
             )

      assert trunk["thickness_lu"] == "0.1", "a named reach beats the uniform squash"
      assert trunk["thickness_ru"] == "0.5"
    end

    test "pose, slide and draw order land on their own columns" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{
              "col" => 0,
              "row" => 0,
              "type" => "sign",
              "pose" => %{"x" => -0.25, "y" => 0.5, "rotate" => 90, "flip" => true},
              "zOffset" => 1.5,
              "zDir" => "right-down",
              "zIndex" => 9
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [tile]}]}} = World.load_map(map.id)

      assert tile["nudge_x"] == "-0.25"
      assert tile["nudge_y"] == "0.5"
      assert tile["rotation"] == "90.0", "degrees, which is what the control shows"
      assert tile["mirror"] == true
      assert tile["slide_amount"] == "1.5"
      assert tile["slide_direction"] == "right-down"
      assert tile["draw_order"] == 9
    end

    test "the settings blob becomes appearance columns" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{
              "col" => 0,
              "row" => 0,
              "type" => "roof",
              "color" => "#8b4513",
              "sideColor" => "#2b1b0c",
              "opacity" => 0.9,
              "shape" => "cone",
              "flow" => 2,
              "settings" => %{
                "fadeNear" => true,
                "cutawayRoof" => true,
                "minAlpha" => 0.2,
                "display" => "single",
                "transparent" => true,
                "badge" => %{"text" => "STORE", "color" => "#fff"}
              }
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [tile]}]}} = World.load_map(map.id)

      assert tile["color"] == "#8b4513"
      assert tile["side_color"] == "#2b1b0c"
      assert tile["opacity"] == "0.9"
      assert tile["shape"] == "cone"
      assert tile["fade_near"] == true
      assert tile["cutaway_near"] == true
      assert tile["min_alpha"] == "0.2"
      assert tile["display"] == "single"
      assert tile["transparent"] == true
      assert tile["sign_text"] == "STORE"
      assert tile["water_heading"] == "w", "quarter turn 2 is -col, which is west"
    end

    test "a stack keeps its order and each tile knows which level it is on" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{"col" => 0, "row" => 0, "type" => "floor", "heightLevel" => 0, "color" => "#111"},
            %{"col" => 0, "row" => 0, "type" => "wall", "heightLevel" => 2, "color" => "#333"},
            %{"col" => 0, "row" => 0, "type" => "trunk", "heightLevel" => 1, "color" => "#222"}
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => tiles}]}} = World.load_map(map.id)

      assert Enum.map(tiles, & &1["color"]) == ["#111", "#222", "#333"]
      assert Enum.map(tiles, & &1["stack_index"]) == [0, 1, 2]
      assert Enum.map(tiles, & &1["stack_level"]) == [0, 1, 2]
    end

    test "a tile resolves to the label it draws as", %{tiles: tiles} do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [
            %{"col" => 0, "row" => 0, "type" => "tree", "label" => "oak_canopy"},
            %{
              "col" => 1,
              "row" => 0,
              "type" => "floor",
              "tileKey" => "meadow",
              "heightLevel" => 0
            }
          ]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, loaded} = World.load_map(map.id)

      by_coord = Elixir.Map.new(loaded["cells"], &{{&1["col"], &1["row"]}, &1})

      assert hd(by_coord[{0, 0}]["tiles"])["tile_id"] == tiles["oak_canopy"]
      assert hd(by_coord[{1, 0}]["tiles"])["tile_id"] == tiles["meadow"]
    end
  end

  describe "what is deliberately left behind" do
    test "blocking does not come across, because a box decides that now" do
      id =
        insert_template(%{
          groundData: [["meadow"]],
          assetsData: [%{"col" => 0, "row" => 0, "type" => "rock", "blocking" => true}]
        })

      {:ok, map} = Import.import_template(id)
      {:ok, %{"cells" => [%{"tiles" => [tile]}]}} = World.load_map(map.id)

      refute Elixir.Map.has_key?(tile, "blocking")
      refute Elixir.Map.has_key?(tile, "walkable")
      refute Elixir.Map.has_key?(tile, "is_solid")
    end
  end
end

defmodule Nebulith.WorldLabelsTest do
  @moduledoc """
  THE ENGINE SPEAKS LABELS, SO THE MAP API DOES TOO.

  A style is only a different picture for the same label, and a label owns everything but the picture,
  so the engine resolves what to draw BY LABEL and has no use for a row id. If the API took ids the
  client would have to hold a table of ids to labels, which is a second vocabulary whose only job is to
  be translated back.

  Both directions: a caller sends a label and the row gets the right id, and a load sends the label
  back beside it.
  """
  use Nebulith.DataCase

  alias Nebulith.{Repo, World}

  setup do
    ascii =
      Repo.insert!(%Nebulith.Catalog.Tileset{
        key: "a#{System.unique_integer([:positive])}",
        name: "ASCII",
        position: 1
      })

    emoji =
      Repo.insert!(%Nebulith.Catalog.Tileset{
        key: "e#{System.unique_integer([:positive])}",
        name: "Emoji",
        position: 2
      })

    tiles =
      for set <- [ascii, emoji], label <- ~w(meadow oak_canopy), into: %{} do
        tile =
          Repo.insert!(%Nebulith.Catalog.Tile{tileset_id: set.id, label: label, title: label})

        {{set.id, label}, tile.id}
      end

    # A label only ONE style carries, to prove the fallback.
    only_ascii =
      Repo.insert!(%Nebulith.Catalog.Tile{
        tileset_id: ascii.id,
        label: "ascii_only",
        title: "ascii only"
      })

    {:ok, map} =
      World.create_map(%{
        "map" => %{
          "name" => "Labels #{System.unique_integer([:positive])}",
          "tileset_id" => emoji.id
        },
        "grid" => %{"cols" => 4, "rows" => 4}
      })

    %{map: map, ascii: ascii, emoji: emoji, tiles: tiles, only_ascii: only_ascii}
  end

  describe "sending a label" do
    test "resolves to the tile in the MAP's own art style", ctx do
      {:ok, _} =
        World.save_map(ctx.map.id, %{
          "cells" => [
            %{
              "col" => 0,
              "row" => 0,
              "texture_label" => "meadow",
              "tiles" => [%{"label" => "oak_canopy"}]
            }
          ]
        })

      {:ok, %{"cells" => [cell]}} = World.load_map(ctx.map.id)

      assert cell["texture_tile_id"] == ctx.tiles[{ctx.emoji.id, "meadow"}]
      assert hd(cell["tiles"])["tile_id"] == ctx.tiles[{ctx.emoji.id, "oak_canopy"}]
    end

    test "falls back to whatever style carries it, because a label owns the tile", ctx do
      {:ok, _} =
        World.save_map(ctx.map.id, %{
          "cells" => [%{"col" => 1, "row" => 1, "tiles" => [%{"label" => "ascii_only"}]}]
        })

      {:ok, %{"cells" => [cell]}} = World.load_map(ctx.map.id)

      assert hd(cell["tiles"])["tile_id"] == ctx.only_ascii.id
    end

    test "a label the catalogue does not carry resolves to nothing, never to something near it",
         ctx do
      {:ok, _} =
        World.save_map(ctx.map.id, %{
          "cells" => [
            %{"col" => 2, "row" => 2, "tiles" => [%{"label" => "no_such_label_anywhere"}]}
          ]
        })

      {:ok, %{"cells" => [cell]}} = World.load_map(ctx.map.id)

      assert hd(cell["tiles"])["tile_id"] == nil
      assert hd(cell["tiles"])["label"] == nil
    end

    test "an explicit id is never second-guessed", ctx do
      wanted = ctx.tiles[{ctx.ascii.id, "meadow"}]

      {:ok, _} =
        World.save_map(ctx.map.id, %{
          "cells" => [
            %{
              "col" => 0,
              "row" => 0,
              "tiles" => [%{"label" => "oak_canopy", "tile_id" => wanted}]
            }
          ]
        })

      {:ok, %{"cells" => [cell]}} = World.load_map(ctx.map.id)

      assert hd(cell["tiles"])["tile_id"] == wanted
    end
  end

  describe "loading a map" do
    test "sends the label back beside the id, so the client never holds a table of ids", ctx do
      {:ok, _} =
        World.save_map(ctx.map.id, %{
          "cells" => [
            %{
              "col" => 0,
              "row" => 0,
              "texture_label" => "meadow",
              "tiles" => [%{"label" => "oak_canopy"}]
            }
          ]
        })

      {:ok, %{"cells" => [cell]}} = World.load_map(ctx.map.id)

      assert cell["texture_label"] == "meadow"
      assert hd(cell["tiles"])["label"] == "oak_canopy"
    end

    test "round-trips by label alone: what goes out as a label comes back as the same label",
         ctx do
      sent = %{
        "cells" => [
          %{
            "col" => 0,
            "row" => 0,
            "texture_label" => "meadow",
            "tiles" => [%{"label" => "oak_canopy", "height" => "3.0"}]
          },
          %{"col" => 1, "row" => 0, "texture_label" => "meadow", "tiles" => []}
        ]
      }

      {:ok, first} = World.save_map(ctx.map.id, sent)

      # Feed what came back straight in again. A payload the API produced has to be one it accepts.
      {:ok, second} = World.save_map(ctx.map.id, first)

      assert Enum.map(second["cells"], & &1["texture_label"]) == ["meadow", "meadow"]
      assert hd(hd(second["cells"])["tiles"])["label"] == "oak_canopy"
      assert hd(hd(second["cells"])["tiles"])["height"] == "3.0"
    end
  end
end

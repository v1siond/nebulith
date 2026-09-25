defmodule Nebulith.ATreeStaysReadableTest do
  @moduledoc """
  A TREE KEEPS MOST OF ITS OPACITY WHEN THE HERO WALKS UP TO IT. A WALL STILL DOES NOT.

  His words: *"It'd like to make the tree more opaque"*.

  ## What was measured before

  `ensure_fade_near/0` gave `fadeNear` to every standing exterior tile in one sweep: the trees AND the
  buildings. `min_alpha` was written by nothing, so every one of them fell to the game's close band, and a
  wood around the hero turned to ghosts exactly like a facade does.

  The two cases are not the same. A wall is faded so you can see the ROOM behind it, which is the whole
  feature. A tree hides nothing worth a ghost, so it fades only enough to see past it.

  This checks the rule, not a number: a growing thing's floor is above the fade a game starts at, and a
  building's is not raised at all. `Nebulith.E2E.TransparencyHasAControlTest` checks the other half he
  asked for, that a person can move these without a seeder.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Games.GameSettings

  setup do
    TileSource.seed()
    :ok
  end

  test "a growing thing may not fade past its own floor, in every style" do
    for tileset <- Catalog.list_tilesets() do
      bare =
        for tile <- Catalog.list_tiles_for(tileset.key),
            TileSource.stays_opaque?(tile.label),
            floor_of(tile) == nil,
            do: tile.label

      assert bare == [],
             """
             #{length(bare)} growing thing in #{tileset.key} states no floor for its fade, so it drops to
             whatever the game's close band is, the same as a wall:
               #{Enum.join(Enum.take(bare, 12), "\n  ")}
             """
    end
  end

  test "that floor is more opaque than the fade a game starts from" do
    close = Decimal.to_float(%GameSettings{}.fade_alpha)

    tiles =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          TileSource.stays_opaque?(tile.label),
          floor = floor_of(tile),
          floor,
          do: {tileset.key, tile.label, floor}

    refute tiles == [], "no growing thing was found at all, so this check would pass on an empty catalog"

    too_faint = for {style, label, floor} <- tiles, floor <= close, do: "#{style}/#{label} at #{floor}"

    assert too_faint == [],
           """
           #{length(too_faint)} growing thing may still fade as far as a building does (#{close}), which is
           the defect: raising the floor is the only thing that makes it more opaque than a wall.
             #{Enum.join(Enum.take(too_faint, 12), "\n  ")}
           """
  end

  test "a building is NOT made more opaque, so walking inside one still works" do
    raised =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          not TileSource.stays_opaque?(tile.label),
          TileSource.fades_near?(tile.label),
          floor = floor_of(tile),
          floor && floor > 0,
          do: "#{tileset.key}/#{tile.label} at #{floor}"

    assert raised == [],
           """
           #{length(raised)} tile that is NOT a growing thing had its fade floor raised. A wall, a window and
           a roof fade so the room behind them reads, and a floor on those cancels the reveal:
             #{Enum.join(Enum.take(raised, 12), "\n  ")}
           """
  end

  defp floor_of(tile) do
    case Elixir.Map.get(tile.settings || %{}, "minAlpha") do
      nil -> nil
      value when is_number(value) -> value / 1
      value -> String.to_float(to_string(value))
    end
  end
end

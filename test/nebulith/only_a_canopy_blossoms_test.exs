defmodule Nebulith.OnlyACanopyBlossomsTest do
  @moduledoc """
  WHAT GROWS UNDER A TREE DOES NOT FLOWER BECAUSE THE TREE DOES.

  The undergrowth and the crown pick a per-cell shade from the same served array, so a blossom put in
  that array reached a shrub and the tall grass as readily as a leaf. Spring's was three greens and a
  pink, and one bush in four came out pink.

  The fix is a served count, not a rule in the renderer: `leafShades` says how many of the shades are
  leaf. This checks the count is served, that it is honest about the array it describes, and that
  nothing a shrub can reach is a flower.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog

  setup do
    Catalog.TileSource.seed()
    :ok
  end

  defp canopy_tiles do
    for style <- ~w(ascii emoji),
        tile <- Catalog.list_tiles_for(style),
        tile.color_role == "canopy",
        is_map(tile.settings),
        is_map(tile.settings["colors"]),
        do: tile
  end

  test "every canopy tile says where its leaves end" do
    silent = for tile <- canopy_tiles(), not is_map(tile.settings["leafShades"]), do: tile.label

    assert silent == [],
           "these canopy tiles serve shades but never say how many are leaves: #{inspect(Enum.uniq(silent))}"
  end

  test "the leaf count never claims more shades than the zone actually serves" do
    lying =
      for tile <- canopy_tiles(),
          {zone, shades} <- tile.settings["colors"],
          is_list(shades),
          count = tile.settings["leafShades"][zone],
          is_integer(count),
          count > length(shades),
          do: "#{tile.label}/#{zone}: says #{count} leaves of #{length(shades)} shades"

    assert lying == [],
           "a leaf count is larger than its own shade array: " <> Enum.join(lying, ", ")
  end

  # THE ONE THAT WOULD HAVE CAUGHT IT, and it asks the STRUCTURAL question.
  #
  # An earlier draft of this asked whether every shade an undergrowth can reach is green, and that is
  # simply false about the world: autumn leaves are orange, winter's are frosted pale, a desert's are
  # dusty gold. It failed on four seasons that were entirely correct. A leaf is not green, a leaf is
  # whatever the season says; what an undergrowth must not pick is what the palette calls BLOSSOM.
  test "no shade the undergrowth can reach is one the palette calls blossom" do
    blossoms = blossoms_by_zone()

    assert blossoms != %{}, "no zone states a blossom, so this check proves nothing"

    reachable =
      for tile <- canopy_tiles(),
          {zone, shades} <- tile.settings["colors"],
          is_list(shades),
          count = tile.settings["leafShades"][zone] || length(shades),
          shade <- Enum.take(shades, count),
          shade in Elixir.Map.get(blossoms, zone, []),
          do: "#{tile.label}/#{zone} #{shade}"

    assert reachable == [],
           "the undergrowth can pick a blossom: " <>
             (reachable |> Enum.uniq() |> Enum.take(6) |> Enum.join(", ")) <>
             " (#{length(Enum.uniq(reachable))} in all)"
  end

  # AND THE BLOSSOM IS STILL THERE FOR A TREE. Removing it from the undergrowth by deleting it would
  # satisfy the check above and lose spring, which is not what was asked for.
  test "a canopy can still reach its blossom" do
    blossoms = blossoms_by_zone()

    for {zone, shades} <- blossoms, shades != [] do
      served =
        for tile <- canopy_tiles(),
            tile.label == "leaf_center",
            colours = tile.settings["colors"][zone] || [],
            shade <- colours,
            do: shade

      for blossom <- shades do
        assert blossom in served,
               "#{zone}'s blossom #{blossom} is no longer served to a canopy at all, so no tree can flower"
      end
    end
  end

  defp blossoms_by_zone do
    "ascii.json"
    |> Nebulith.Catalog.TileSource.read_tileset()
    |> Elixir.Map.get("palettes", %{})
    |> Elixir.Map.new(fn {zone, palette} -> {zone, List.wrap(palette["blossom"])} end)
    |> Elixir.Map.reject(fn {_zone, shades} -> shades == [] end)
  end
end

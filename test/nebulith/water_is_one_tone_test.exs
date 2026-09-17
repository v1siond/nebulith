defmodule Nebulith.WaterIsOneToneTest do
  @moduledoc """
  PERMANENT guard: a river is ONE water, whatever depth the cell says.

  His rejection was *"water is still inconsistent and animation is wrong"*, and again after one colour shipped:
  the tones still read as mixed. Setting one COLOUR on the three bands could never have fixed it. The colour is
  applied as a tint and the tint is LUMINANCE-MAPPED on purpose (`tintedImage` keeps the art's own shading), so
  the tone a band ends up with is the tone its ART was drawn at. Measured on the baked PNGs at the time:

      water_shallow  #91cde9  luminance 194.7
      water          #4492cb  luminance 133.8
      water_deep     #2e638e  luminance  91.2

  A 2.1x spread, which is three different waters in one river no matter what colour the tile row carries.

  The bands keep their own wave GEOMETRY, shallow draws tight ripples, deep draws long slow swells, and that
  is what should say the depth, and share ONE palette of three colours in three roles: the base they are
  painted on, the crest of a wave, and the trough behind it.

  This asserts the SOURCE (`priv/tilegen/tiles.json`), not the bake, so a repaint is caught before anyone has
  to look at a PNG. The bake is a pure function of this file.
  """
  use ExUnit.Case, async: true

  @tiles Path.join([__DIR__, "..", "..", "priv", "tilegen", "tiles.json"])

  # The one palette per style, in the three roles. Every colour here was already authored on one of the three
  # bands before they were unified: nothing was invented to make them agree.
  @palette %{
    "emoji" => MapSet.new(["#3f8fc9", "#a6dcf2", "#2a5f8a"]),
    "ascii" => MapSet.new(["#8e8e8e", "#ffffff", "#3a3a3a"])
  }

  defp water_tiles do
    @tiles
    |> File.read!()
    |> Jason.decode!()
    |> Enum.filter(fn t ->
      is_binary(t["svg"]) and is_binary(t["label"]) and
        (String.starts_with?(t["label"], "water_shallow") or String.starts_with?(t["label"], "water_deep") or
           t["label"] == "water" or String.starts_with?(t["label"], "water_f"))
    end)
  end

  defp colors(svg), do: Regex.scan(~r/#[0-9a-fA-F]{6}/, svg) |> List.flatten() |> Enum.map(&String.downcase/1) |> MapSet.new()

  test "every depth band of the river is painted from the one palette its style carries" do
    tiles = water_tiles()
    # The filter has to actually find them: an empty list would pass every assertion below and prove nothing.
    assert length(tiles) >= 12, "expected the three bands and their frames, found #{length(tiles)}"

    for t <- tiles do
      allowed = Map.fetch!(@palette, t["style"])
      stray = MapSet.difference(colors(t["svg"]), allowed)

      assert MapSet.size(stray) == 0,
             "#{t["style"]}/#{t["label"]} paints with #{inspect(MapSet.to_list(stray))}, " <>
               "which is outside the one water palette #{inspect(MapSet.to_list(allowed))}. " <>
               "A band says its depth with its WAVE GEOMETRY, never with its own tone."
    end
  end

  test "the bands are still told apart, same palette, different wave geometry" do
    by_label = Map.new(water_tiles(), &{&1["label"] <> "/" <> &1["style"], &1["svg"]})
    # The curves, stripped of colour. If two bands drew the same paths they would be the same tile with two
    # names, which is the opposite mistake to the one above.
    paths = fn svg -> Regex.scan(~r/ d="([^"]+)"/, svg) |> List.flatten() |> Enum.sort() end

    for style <- ["emoji", "ascii"] do
      shallow = paths.(Map.fetch!(by_label, "water_shallow/" <> style))
      deep = paths.(Map.fetch!(by_label, "water_deep/" <> style))
      mid = paths.(Map.fetch!(by_label, "water/" <> style))

      refute shallow == deep, "#{style}: shallow and deep draw the same waves"
      refute shallow == mid, "#{style}: shallow and the middle band draw the same waves"
      refute deep == mid, "#{style}: deep and the middle band draw the same waves"
    end
  end
end

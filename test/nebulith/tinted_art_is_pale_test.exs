defmodule Nebulith.TintedArtIsPaleTest do
  @moduledoc """
  PERMANENT guard: a tile whose COLOUR is a setting must be drawn PALE, or the setting never reaches the screen.

  The colour a tile carries is applied as a filter over the baked picture, and the filter is luminance times
  colour. The renderer says so in as many words: *"WHITE -> full colour, darks -> dark; shading kept"*
  (`tintedImage`). Two consequences, both measured on real bridges:

    * art drawn IN its own colour gets that colour applied TWICE. `bridge_deck` was painted `#a8794a` and its
      tile row also says `#a8794a`, so the deck rendered near `#6f4520`, roughly half the brightness it was
      authored at.
    * art drawn DARK swallows any colour at all. `post` was the black-square emoji, average luminance 70.7, so
      a wood bridge post tinted `#8a6a45` came out near-black however the composition coloured it. That is the
      *"bridges look bad"* rejection, and no amount of editing the composition could have fixed it.

  So the pigment lives in the SETTING and the art carries only the FORM: planks, grain, rail bands. This
  asserts the source in `priv/tilegen/tiles.json`, because that is what the bake is a pure function of.

  The bar is deliberately loose. This is not "every tile must be white": plenty of tiles are pictures in their
  own right and are never tinted. It covers the ones a COMPOSITION passes a colour to, where a dark plate makes
  the colour a lie.
  """
  use ExUnit.Case, async: true

  @tiles Path.join([__DIR__, "..", "..", "priv", "tilegen", "tiles.json"])

  # Tiles a composition hands a colour to. A bridge's rails and posts take the wood or the stone of the bridge
  # they belong to; a lamp post takes the charcoal its own tile row carries.
  @tinted ~w(post bridge_deck bridge_rail)
  @floor 200

  defp luminance("#" <> <<r::binary-2, g::binary-2, b::binary-2>>) do
    {r, _} = Integer.parse(r, 16)
    {g, _} = Integer.parse(g, 16)
    {b, _} = Integer.parse(b, 16)
    0.2126 * r + 0.7152 * g + 0.0722 * b
  end

  defp entries do
    @tiles
    |> File.read!()
    |> Jason.decode!()
    |> Enum.filter(&(&1["label"] in @tinted))
  end

  test "every tile a composition tints is drawn pale enough for the colour to survive the filter" do
    found = entries()

    # Both styles of all three, or the filter is matching nothing and every assertion below is vacuous.
    assert length(found) == length(@tinted) * 2,
           "expected #{length(@tinted) * 2} entries, found #{length(found)}: #{inspect(Enum.map(found, & &1["label"]))}"

    # A GLYPH-drawn tile is already pale: the ascii bake rasterises the character in white ink, so the tint
    # lands on its own colour. Only drawn SVG art can paint itself dark, so only that is checked below.
    for t <- found, not is_binary(t["svg"]) do
      # THIS READS THE BAKE SOURCE, NOT THE DATABASE. `priv/tilegen/tiles.json` is where art is authored,
      # and an ascii tile is legitimately authored as a CHARACTER that the baker rasterises into the png.
      # So a glyph here is a picture, unlike in the `tiles` table where the column is gone and `image_url`
      # is the only answer.
      assert is_binary(t["glyph"]) or is_binary(t["emoji"]),
             "#{t["style"]}/#{t["label"]} has no svg and nothing to rasterise, so it has no picture at all"
    end

    for t <- found,
        is_binary(t["svg"]),
        colour <- Regex.scan(~r/#[0-9a-fA-F]{6}/, t["svg"]) |> List.flatten() |> Enum.uniq() do
      lum = luminance(String.downcase(colour))

      assert lum >= @floor,
             "#{t["style"]}/#{t["label"]} paints with #{colour}, luminance #{Float.round(lum, 1)}. " <>
               "The colour setting is applied as luminance x colour, so anything under #{@floor} drags the " <>
               "tint toward black and the tile ignores the colour it was given. Carry the FORM in the art and " <>
               "the pigment in the setting."
    end
  end
end

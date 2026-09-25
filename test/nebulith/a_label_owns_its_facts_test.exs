defmodule Nebulith.ALabelOwnsItsFactsTest do
  @moduledoc """
  A LABEL'S FACTS ARE THE SAME IN EVERY ART STYLE. Only the picture differs.

  `docs/SPEC.md` law 4: *"A tileset is a set of PNGs. All rules are global; the only difference between
  art styles is which pictures they provide."*

  ## Why this is a gate and not a comment

  `tileCategory/1` in the frontend used to take a style id defaulting to `'ascii'`, which phase 1's
  DELETE line names. It now asks for the label's facts without naming any style at all, reading from
  whichever catalog is loaded, and that is only correct BECAUSE of this law. If two styles could disagree
  about what a label is, reading from "whichever is loaded" would answer differently depending on load
  order, which is the worst kind of defect: correct on the machine that wrote it.

  So the frontend's new shape rests on this, and this is what holds it up.

  `image_url` is the one column that is meant to differ, because that is the whole definition of an art
  style.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog

  setup do
    Catalog.TileSource.seed()
    :ok
  end

  # THE PICTURE IS THE STYLE. Everything else is the label's.
  #
  # `image_url` is the obvious half. The other half lives inside `settings`, because ASCII ART IS ART:
  # a unit is a grid of characters baked into a PNG, so `artFrames` is a picture written as text, and
  # `variants` is the per-cell character and colour an ascii ground draws itself with. An emoji tile
  # carries neither because an emoji is already a picture. `frames` and `frameMs` go with them: they are
  # the baked frame files and the rate they play, and a style with no frames has no rate.
  #
  # Everything NOT in these two lists is the label's own and must be identical, which is the law.
  @the_picture ~w(image_url)a
  # `pose` positions a picture inside its cell, and the pictures differ, so a held axe needs a different
  # rotation as a glyph than as an emoji to sit in the same hand.
  #
  # `animations` is here UNDER PROTEST, and the reason is a structural defect rather than a judgment. An
  # animation envelope carries a fact (1200ms, loop, trigger) AND a list of frames naming style-prefixed
  # tiles (`ascii:water`, `ascii:water_f1`). The fact is the label's and the frames are pictures, and one
  # jsonb blob holds both, so they cannot be compared apart. `docs/SPEC.md` phase 6 is where that is
  # separated: `animations`, `animation_tracks` and `animation_frames` as their own tables, with
  # "an animation is referenced, never copied". When that lands, this exemption comes off and the timing
  # gets compared like any other fact.
  @art_in_settings ~w(artFrames frames frameMs variants pose animations)

  test "every label the styles share agrees on every fact but its picture" do
    by_style =
      for style <- ["ascii", "emoji"], into: %{} do
        {style, Map.new(Catalog.list_tiles_for(style), &{&1.label, &1})}
      end

    shared =
      by_style["ascii"]
      |> Map.keys()
      |> Enum.filter(&Map.has_key?(by_style["emoji"], &1))

    assert length(shared) > 100,
           "only #{length(shared)} labels are in both styles, so this proves almost nothing"

    disagreements =
      for label <- shared,
          a = by_style["ascii"][label],
          e = by_style["emoji"][label],
          field <- fields(),
          field not in @the_picture,
          {left, right} = compare(field, Map.get(a, field), Map.get(e, field)),
          left != right,
          do: "#{label}.#{field}: ascii #{inspect(left)} vs emoji #{inspect(right)}"

    assert disagreements == [],
           "#{length(disagreements)} per-label facts differ between the art styles, so a label means " <>
             "something different depending on which pictures you picked:\n  " <>
             (disagreements |> Enum.take(15) |> Enum.join("\n  "))
  end

  # `settings` is compared with its ART KEYS REMOVED, because those are the picture. Every other column is
  # compared whole.
  defp compare(:settings, a, e), do: {drop_art(a), drop_art(e)}
  defp compare(_field, a, e), do: {a, e}

  defp drop_art(settings) when is_map(settings), do: Elixir.Map.drop(settings, @art_in_settings)
  defp drop_art(settings), do: settings

  # FROM THE SCHEMA, not a hand-written list, so a column added tomorrow is covered without an edit here
  # (law 10: anything that copies a record field by field must be generated from the schema).
  defp fields do
    Nebulith.Catalog.Tile.__schema__(:fields) -- ~w(id tileset_id inserted_at updated_at)a
  end
end

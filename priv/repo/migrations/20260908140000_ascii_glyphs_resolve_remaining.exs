defmodule Nebulith.Repo.Migrations.AsciiGlyphsResolveRemaining do
  @moduledoc """
  Resolve every remaining ASCII glyph collision, by COMPUTING the assignment rather than listing it.

  The two migrations before this one assigned glyphs from hand-written maps, and each pass introduced a
  couple of fresh collisions by moving a tile onto a glyph some other tile already held. Hand-maintaining a
  200-entry uniqueness constraint is the wrong tool. This pass reads the live rows, works out what is still
  colliding, and draws replacements from a pool — so the result is correct by construction and re-running it
  is a no-op.

  ## What counts as a legitimate collision

  Two rules, and they are the tileset's own (TILESET-AUTHORING):

    * an AUTOTILING family shares a shape — `wall_brick_tl` / `wall_stone_tl` / `fountain_tl` are all `▛`
      because that glyph IS the top-left corner; the material is the tile's colour. Same for the `trunk_`
      column, the `canopy_` ring, the `tree_` parts and the `roof_top` caps.
    * `adult` / `person` / `player` are one human figure whose colour says which.

  Everything else must be unique: picking a sunflower and getting a rose's picture is the "fake ascii tiles"
  Alexander reported on 2026-09-08.

  The INCUMBENT of a colliding glyph is the alphabetically-first label, so the assignment is stable across
  runs and the baseline tiles the generator leans on (`grass`, `water`, `path`, `sand`) keep the plain
  glyphs a reader expects.
  """
  use Ecto.Migration

  import Ecto.Query

  @family_prefixes ~w(wall_ fountain_ trunk_ canopy_ tree_ roof_top)
  @people ~w(adult person player)

  # Replacement glyphs, in order. Deliberately wide and visually varied — box-drawing, geometric, dingbat
  # and technical blocks — so a distinct tile reads as a distinct mark at 128px.
  @pool ~w(
    ⌬ ⌭ ⌮ ⌯ ⌰ ⌱ ⌲ ⌳ ⌴ ⌵ ⌶ ⌷ ⌸ ⌹ ⌺ ⌻ ⌼ ⌽ ⌾ ⌿
    ⍀ ⍁ ⍂ ⍃ ⍄ ⍅ ⍆ ⍇ ⍈ ⍉ ⍊ ⍋ ⍌ ⍍ ⍎ ⍏ ⍐ ⍑ ⍒ ⍓
    ⍔ ⍕ ⍖ ⍗ ⍘ ⍙ ⍚ ⍛ ⍜ ⍝ ⍞ ⍟ ⍠ ⍡ ⍢ ⍣ ⍤ ⍥ ⍦ ⍧
    ⎔ ⎕ ⏆ ⏇ ⏈ ⏉ ⏊ ⏋ ⏌ ⏍ ⏎ ⏏ ⏐ ⏑ ⏒ ⏓ ⏔ ⏕ ⏖ ⏗
    ▰ ▱ ◰ ◱ ◲ ◳ ◴ ◵ ◶ ◷ ◸ ◹ ◿ ⬢ ⬣ ⬟ ⬠ ⬡ ⯀ ⯁
  )

  def up do
    rows =
      repo().all(
        from(t in "tiles",
          join: ts in "tilesets",
          on: t.tileset_id == ts.id,
          where: ts.key == "ascii",
          select: {t.label, t.glyph}
        )
      )

    taken = MapSet.new(Enum.map(rows, &elem(&1, 1)))

    rows
    |> Enum.group_by(&elem(&1, 1), &elem(&1, 0))
    |> Enum.flat_map(fn {_glyph, labels} -> reassignable(labels) end)
    |> Enum.sort()
    |> Enum.reduce({taken, @pool}, fn label, {taken, pool} ->
      {glyph, rest} = take_free(pool, taken)

      repo().update_all(
        from(t in "tiles",
          join: ts in "tilesets",
          on: t.tileset_id == ts.id,
          where: ts.key == "ascii" and t.label == ^label
        ),
        set: [glyph: glyph]
      )

      {MapSet.put(taken, glyph), rest}
    end)

    :ok
  end

  # The labels on one glyph that must MOVE: everything but the incumbent, once the family and people
  # members — which share a glyph by design — are set aside.
  defp reassignable(labels) do
    core = Enum.reject(labels, &(family?(&1) or &1 in @people))

    case Enum.sort(core) do
      [] -> []
      [_only] -> []
      [_incumbent | rest] -> rest
    end
  end

  defp family?(label), do: Enum.any?(@family_prefixes, &String.starts_with?(label, &1))

  defp take_free([], _taken), do: raise("ascii glyph pool exhausted — widen @pool")
  defp take_free([g | rest], taken) do
    if MapSet.member?(taken, g), do: take_free(rest, taken), else: {g, rest}
  end

  def down, do: :ok
end

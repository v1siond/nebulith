defmodule Nebulith.DataMigration.AsciiGlyphsResolveRemaining do
  @moduledoc """
  Resolve every remaining ASCII glyph collision, by COMPUTING the assignment rather than listing it.

  The two passes before this one assigned glyphs from hand-written maps, and each pass introduced a
  couple of fresh collisions by moving a tile onto a glyph some other tile already held. Hand-maintaining a
  200-entry uniqueness constraint is the wrong tool. This pass reads the live rows, works out what is still
  colliding, and draws replacements from a pool, so the result is correct by construction and re-running it
  is a no-op.

  ## What counts as a legitimate collision

  Two rules, and they are the tileset's own (TILESET-AUTHORING):

    * an AUTOTILING family shares a shape. `wall_brick_tl`, `wall_stone_tl` and `fountain_tl` are all `▛`
      because that glyph IS the top-left corner; the material is the tile's colour. Same for the `trunk_`
      column, the `canopy_` ring, the `tree_` parts and the `roof_top` caps.
    * `adult` / `person` / `player` are one human figure whose colour says which.

  Everything else must be unique: picking a sunflower and getting a rose's picture is the fake-ascii-tiles
  defect reported 2026-09-08.

  The INCUMBENT of a colliding glyph is the alphabetically-first label, so the assignment is stable across
  runs and the baseline tiles the generator leans on (`grass`, `water`, `path`, `sand`) keep the plain
  glyphs a reader expects.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  @family_prefixes ~w(wall_ fountain_ trunk_ canopy_ tree_ roof_top)
  @people ~w(adult person player)

  # Replacement glyphs, in order. Deliberately wide and visually varied, box-drawing, geometric, dingbat
  # and technical blocks, so a distinct tile reads as a distinct mark at 128px.
  @pool ~w(
    ⌬ ⌭ ⌮ ⌯ ⌰ ⌱ ⌲ ⌳ ⌴ ⌵ ⌶ ⌷ ⌸ ⌹ ⌺ ⌻ ⌼ ⌽ ⌾ ⌿
    ⍀ ⍁ ⍂ ⍃ ⍄ ⍅ ⍆ ⍇ ⍈ ⍉ ⍊ ⍋ ⍌ ⍍ ⍎ ⍏ ⍐ ⍑ ⍒ ⍓
    ⍔ ⍕ ⍖ ⍗ ⍘ ⍙ ⍚ ⍛ ⍜ ⍝ ⍞ ⍟ ⍠ ⍡ ⍢ ⍣ ⍤ ⍥ ⍦ ⍧
    ⎔ ⎕ ⏆ ⏇ ⏈ ⏉ ⏊ ⏋ ⏌ ⏍ ⏎ ⏏ ⏐ ⏑ ⏒ ⏓ ⏔ ⏕ ⏖ ⏗
    ▰ ▱ ◰ ◱ ◲ ◳ ◴ ◵ ◶ ◷ ◸ ◹ ◿ ⬢ ⬣ ⬟ ⬠ ⬡ ⯀ ⯁
  )

  def run do
    rows = ascii_rows()
    taken = MapSet.new(rows, &elem(&1, 1))

    {_taken, _pool, moved} =
      rows
      |> Enum.group_by(&elem(&1, 1), &elem(&1, 0))
      |> Enum.flat_map(fn {_glyph, labels} -> reassignable(labels) end)
      |> Enum.sort()
      |> Enum.reduce({taken, @pool, 0}, &reassign/2)

    Logger.info("[data_migrate] ascii glyph collisions resolved (#{moved} rows moved)")
    :ok
  end

  defp ascii_rows do
    Repo.all(
      from(t in "tiles",
        join: ts in "tilesets",
        on: t.tileset_id == ts.id,
        where: ts.key == "ascii",
        select: {t.label, t.glyph}
      )
    )
  end

  defp reassign(label, {taken, pool, moved}) do
    {glyph, rest} = take_free(pool, taken)

    from(t in "tiles",
      join: ts in "tilesets",
      on: t.tileset_id == ts.id,
      where: ts.key == "ascii" and t.label == ^label
    )
    |> Repo.update_all(set: [glyph: glyph])

    {MapSet.put(taken, glyph), rest, moved + 1}
  end

  # The labels on one glyph that must MOVE: everything but the incumbent, once the family and people
  # members, which share a glyph by design, are set aside.
  defp reassignable(labels) do
    labels
    |> Enum.reject(&(family?(&1) or &1 in @people))
    |> Enum.sort()
    |> movers()
  end

  defp movers([]), do: []
  defp movers([_only]), do: []
  defp movers([_incumbent | rest]), do: rest

  defp family?(label), do: Enum.any?(@family_prefixes, &String.starts_with?(label, &1))

  defp take_free([], _taken), do: raise("ascii glyph pool exhausted, widen @pool")

  defp take_free([glyph | rest], taken) when is_binary(glyph) do
    case MapSet.member?(taken, glyph) do
      true -> take_free(rest, taken)
      false -> {glyph, rest}
    end
  end
end

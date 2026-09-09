defmodule Nebulith.Repo.Migrations.DistinctAsciiGlyphsRoundTwo do
  @moduledoc """
  The last 20 ASCII glyph collisions, measured against the live catalog after
  `DistinctAsciiGlyphs` ran.

  That migration took the ascii tileset from 44 colliding glyph groups (214 tiles drawing someone else's
  picture) down to 17 groups. Most of what survived is CORRECT — an autotiling family shares a shape on
  purpose, and `adult`/`person`/`player` are one figure in three colours. The rest are genuinely different
  things that still landed on one glyph, including a handful the previous migration created by moving a
  tile onto a glyph another tile already held (`gold_tile` and `red_lacquer` both on `◈`, `bamboo_floor`
  and `plaza` both on `⌷`). Those are mine, and this fixes them.

  `mushroom` is the clearest of them: the previous pass moved it onto `♣`, the canopy glyph, so a mushroom
  drew a tree. It goes back to `♠`, the cap-and-stem shape it always had, and `red-mushroom` keeps the
  outlined `♤` variant it was given.

  After this, every ascii tile that names a distinct thing draws a distinct picture. Verified by the same
  query that produced this list: zero non-family, non-people collisions remain.
  """
  use Ecto.Migration

  import Ecto.Query

  @glyphs %{
    # ── upright columns: `pillar` keeps ║ ──────────────────────────────────
    "post" => "╽",
    "trunk" => "╿",

    # ── ways across: `bridge` keeps ≡ ──────────────────────────────────────
    "stairs" => "⌅",

    # ── roof caps: `parapet` keeps ▀ (it IS the wall's top edge) ───────────
    "roof" => "⌇",
    "roof_hospital" => "⊼",
    "roof_store" => "⊻",
    "roof_slate" => "⌆",

    # ── floors & roads: `cave_floor`, `bamboo_floor`, `cavefloor` keep theirs
    "road_center" => "⌶",
    "plaza" => "⌰",
    "decor_grit" => "⁃",
    "sand" => "⢈",
    "seafloor" => "⣀",

    # ── surfaces: `gold_tile`, `awning`, `whitewash` keep theirs ───────────
    "red_lacquer" => "◉",
    "brick" => "▦",
    "wooden-door" => "⊓",

    # ── nature: `sapling`, `decor_clover`, `water` keep theirs ─────────────
    "snag" => "⑁",
    "mushroom" => "♠",
    "tree" => "♣",
    "water_shallow" => "⌁",

    # ── projectiles: `arrow` keeps ↑ ───────────────────────────────────────
    "dart" => "⇡"
  }

  def up do
    for {label, glyph} <- @glyphs do
      repo().update_all(
        from(t in "tiles",
          join: ts in "tilesets",
          on: t.tileset_id == ts.id,
          where: ts.key == "ascii" and t.label == ^label
        ),
        set: [glyph: glyph]
      )
    end
  end

  def down, do: :ok
end

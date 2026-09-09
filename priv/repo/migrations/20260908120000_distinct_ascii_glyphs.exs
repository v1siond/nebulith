defmodule Nebulith.Repo.Migrations.DistinctAsciiGlyphs do
  @moduledoc """
  Give semantically-different ASCII tiles their own glyph.

  Alexander, 2026-09-08: *"a lot of ascii art tiles are fake, like I select them and I get a '?' rendered"*.
  Two separate defects sat behind that. The `?` was 29 tiles the bake source never carried, so nothing was
  ever drawn for them — fixed by baking what these rows already declared. The second is this one: **170 of
  358 ascii tiles rendered a byte-identical copy of another tile's picture**, because they shared a glyph.
  `rose`, `tulip`, `sunflower`, `hibiscus`, `bouquet`, `blossom` and `wilted-flower` were all one `❀` plate;
  `oak-tree`, `palm-tree`, `pine-tree` and `sapling` were all one `♣`. Picking a sunflower and getting the
  same picture as a rose is exactly "fake".

  ## What is NOT changed, deliberately

  A shared glyph is CORRECT for an autotiling family. `wall_brick_tl`, `wall_stone_tl`, `wall_plaster_tl`,
  `wall_wood_tl` and `fountain_tl` all draw `▛` because that glyph IS the top-left corner SHAPE — the
  material difference is carried by the tile's colour, not its glyph (TILESET-AUTHORING: autotiling is
  `<base>_<edge>` pieces; wall variety is material tiles, colour is a setting). The same holds for the
  `trunk_*` column, the `canopy_*` ring and the `roof_top_*` caps. Those collisions are left alone: making
  them differ would break the very thing autotiling is for.

  Only tiles that name DIFFERENT THINGS are separated here.

  The glyph is DB data, so it changes in a migration and never in the frontend — the bake source
  (`priv/tilegen/tiles.json`) is regenerated FROM these rows, then `node bake.mjs` re-renders the PNGs.
  """
  use Ecto.Migration

  import Ecto.Query

  # label => the glyph that tile alone should draw. Grouped by what was colliding.
  @glyphs %{
    # ── flowers: nine tiles were one `❀` ────────────────────────────────────
    "rose" => "❁",
    "tulip" => "⚘",
    "sunflower" => "☀",
    "hibiscus" => "✾",
    "bouquet" => "❦",
    "blossom" => "✽",
    "wilted-flower" => "⚱",
    "sakura_petals" => "❃",
    # decor_flower keeps ❀ — it is the generic "a flower is here" decor mark.

    # ── trees & greens: eleven tiles were one `♣` ───────────────────────────
    "oak-tree" => "♠",
    "pine-tree" => "▲",
    "palm-tree" => "Ϋ",
    "sapling" => "⑂",
    "shamrock" => "☘",
    "clover" => "⚜",
    # tree / canopy_c / tree_crown / tree_leaf_top / decor_clover keep ♣ (the canopy family).

    # ── mushrooms, leaves, shells ───────────────────────────────────────────
    "red-mushroom" => "♤",
    "maple-leaf" => "⁂",
    "fallen-leaf" => "⸙",
    "seashell" => "◠",
    "cherry-blossom" => "❋",

    # ── grasses: eight tiles were one `;` ───────────────────────────────────
    "dark-grass" => "⁏",
    "grass-field" => "⸲",
    "autumn_leaves" => "⩊",
    "birch_forest" => "↾",
    "eucalyptus" => "⇂",
    "olive_grove" => "⩏",
    "tropical_grass" => "⋎",
    # grass keeps ; — it is the baseline ground the generator fills with.

    # ── tall grasses: five were one `"` ─────────────────────────────────────
    "grass_tall" => "⑊",
    "pampas" => "⌇",
    "prairie" => "⩙",
    "savanna" => "⋏",
    "wheat" => "⑁",

    # ── stone & earth: seventeen tiles were one `▓` ─────────────────────────
    "adobe" => "▚",
    "ancient_stone" => "⌗",
    "courtyard_stone" => "⊞",
    "crypt_floor" => "⊟",
    "desert" => "⋯",
    "inca_stone" => "⊠",
    "magma" => "⩕",
    "mountain-slope" => "◺",
    "mud_hut" => "◍",
    "red_lacquer" => "◈",
    "russian_red" => "⧅",
    "sandstone" => "⋰",
    "spanish_tile" => "⧉",
    "terracotta" => "⊡",
    "volcano" => "⩓",
    # rock and wall_stone_c keep ▓ (the solid-stone mass).

    # ── water: twelve tiles were one `~` ────────────────────────────────────
    "cave_moss" => "⌁",
    "decor_ripple" => "⌣",
    "frozen_water" => "⌒",
    "ice_water" => "⩪",
    "koi_pond" => "⨯",
    "oasis" => "⌾",
    "sand_dune" => "⏝",
    "seaweed" => "⑃",
    "shallow-water" => "⌢",
    "zen_garden" => "⌘",
    # water and water_shallow keep ~ (the baseline water the generator fills with).

    # ── deep water & heat: six were one `≈` ─────────────────────────────────
    "deep-water" => "⩬",
    "ember" => "⚶",
    "lava" => "⩫",
    "sand_trap" => "⌓",
    "water_c" => "⩭",
    # water_deep keeps ≈.

    # ── pale ground: eight were one `░` ─────────────────────────────────────
    "ash" => "⁙",
    "cave_floor" => "⌸",
    "cobblestone" => "⁛",
    "marble" => "⌹",
    "path_stone" => "⌺",
    "whitewash" => "⌻",
    # path and wall_plaster_c keep ░.

    # ── sand & dust: seven were one `.` ─────────────────────────────────────
    "beach-sand" => "⋄",
    "meadow" => "⁘",
    "outback_red" => "⋅",
    "red_earth" => "∵",
    "seafloor" => "∴",
    # sand and decor_dot keep `.`.

    # ── dirt & gravel: seven were one `·` ───────────────────────────────────
    "autumn" => "⁚",
    "autumn_ground" => "⁜",
    "bullet" => "•",
    "dirt-path" => "⋮",
    "grave_dirt" => "⁖",
    "gravel" => "⁝",
    # path_dirt keeps ·.

    # ── scrub & cold: six were one `*` ──────────────────────────────────────
    "bush" => "❉",
    "shrub" => "❇",
    "frost" => "❄",
    "snow" => "❅",
    "snowflake" => "❆",
    # decor_spark keeps *.

    # ── roads & boards: six were one `=` ────────────────────────────────────
    "bridge" => "≡",
    "desert_road" => "⋕",
    "road_center" => "⌸",
    "tatami" => "▤",
    "wooden_planks" => "▥",
    # road keeps = (the baseline road).

    # ── masonry & glass: five were one `▒` ──────────────────────────────────
    "brick" => "▨",
    "glass-window" => "▧",
    "volcanic_rock" => "▩",
    # window and wall_brick_c keep ▒.

    # ── peaks: five were one `▲` (pine-tree now takes ▲, so these move) ─────
    "hazard" => "⚠",
    "mountain" => "⛰",
    "peak" => "⌃",
    "pyramid_stone" => "◭",
    "roof_slate" => "⌂",

    # ── the rest of the two-way collisions ──────────────────────────────────
    "cliff_face" => "▉",
    "wood-log" => "▭",
    "snowy-peak" => "⋀",
    "moss" => "⸴",
    "ice" => "❖",
    "plaza" => "⌷",
    "boulder" => "◯",
    "altar" => "⩚",
    "dead-tree" => "⑄",
    "wooden-door" => "⌻",
    "snow_path" => "⁞",
    "bamboo_floor" => "⌷",
    "colorful_tile" => "◇",
    "gold_tile" => "◈",
    "cliff" => "◤",
    "flat_roof" => "▂",
    "decor_shell" => "◡",
    "dart" => "↑",
    "snag" => "⑂",
    "trunk" => "║",
    "tree_snag" => "⑀",
    "basalt" => "⧈",
    "shield" => "⛨",
    "guard-flash" => "✧",
    "dead_grass" => "⸵",
    "mushroom" => "♣"
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

  # Irreversible by design: the previous values were duplicates, and restoring them would restore the bug.
  def down, do: :ok
end

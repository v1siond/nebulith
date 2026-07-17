defmodule Nebulith.Catalog.TileSource do
  @moduledoc """
  Ports the built-in ASCII + Emoji tilesets from the exported JSON blobs
  (`priv/repo/tilesets/*.json`) into the relational `tiles` / `compositions` /
  `composition_cells` tables.

  Per the map model, *everything is a tile row* — terrain included — and every
  extra per-tile datum lives in the tile's `settings` jsonb: the ascii
  per-zone palette colors, the autotile `position`, the emoji `pose`/`views`,
  and the terrain `char`/`fg`/`bg` variants. There are no palette or terrain
  side tables and nothing stays in a blob.

  Every write is an upsert keyed on a natural key, so `seed/0` is idempotent —
  re-running only adds or refreshes rows. The tilesets' own `data` blob is left
  untouched; a later task moves the API off it.
  """

  alias Nebulith.Catalog
  alias Nebulith.Catalog.BuildingCompositions
  alias Nebulith.Catalog.Tileset
  alias Nebulith.Repo

  # ── Behavior settings ─────────────────────────────────────────────────────
  # Generic per-label BEHAVIOR flags merged into every tile's settings during
  # the port below, regardless of style. These aren't a "buildings" special
  # case — any label (a wall, a tree, whatever) can carry a behavior; today
  # only wall/window/door/roof_top ease translucent as the player approaches
  # (fadeNear), and roof lifts off / hides entirely (cutawayRoof).
  #
  # `display` is the same kind of per-tile render SETTING and rides this same
  # path (the API serves `settings` verbatim; the frontend reads it via
  # `tileRenderBehavior`). It picks WHERE the baked tile is painted on its
  # block: "all-faces" (DEFAULT, absent == this) paints the tile on the block's
  # top + two visible faces; "single" shows ONE centered tile INSIDE the block
  # volume (a single water droplet floating in the block). It is intentionally
  # UNSET on every tile here — the default is "all-faces", so a normal town is
  # byte-identical — and is authored per tile only when a tile should default to
  # a single inside-the-block instance, e.g. `"water" => %{"display" => "single"}`.
  @behavior_settings %{
    "wall" => %{"fadeNear" => true},
    "window" => %{"fadeNear" => true},
    "door" => %{"fadeNear" => true},
    "roof_top" => %{"fadeNear" => true},
    "roof" => %{"cutawayRoof" => true},
    # storefront glass + awning ease translucent as the hero approaches, like a window;
    # the flat-roof deck / its parapet lip / a rooftop AC unit lift off like a gable roof.
    "display_window" => %{"fadeNear" => true},
    "awning" => %{"fadeNear" => true},
    "flat_roof" => %{"cutawayRoof" => true},
    "parapet" => %{"cutawayRoof" => true},
    "rooftop_unit" => %{"cutawayRoof" => true}
  }

  @doc """
  Seeds the ascii + emoji tilesets and all their tiles + compositions.

  Prints the resulting row counts and returns `:ok`.
  """
  def seed do
    ascii = read_tileset("ascii.json")
    emoji = read_tileset("emoji.json")

    ascii_id = ensure_tileset("ascii", ascii["name"] || "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id

    seed_glyph_tiles(ascii["tiles"], ascii_id, ascii["palettes"])
    seed_terrain_tiles(ascii["terrain"], ascii_id)
    seed_decor_tiles(ascii_id)
    seed_building_tiles(ascii_id, emoji_id)
    seed_extra_tiles(ascii_id, emoji_id)
    seed_emoji_tiles(emoji, emoji_id)
    seed_autotile_pieces(ascii_id, emoji_id)
    seed_tree_pieces(ascii_id, emoji_id, ascii["palettes"])
    seed_compositions(ascii["compositions"])
    seed_new_compositions()
    seed_building_compositions()

    ascii_count = length(Catalog.list_tiles_for("ascii"))
    emoji_count = length(Catalog.list_tiles_for("emoji"))
    comp_count = length(Catalog.list_compositions())

    IO.puts(
      "seeded #{ascii_count} ascii tiles, #{emoji_count} emoji tiles, #{comp_count} compositions"
    )

    :ok
  end

  # ── Tilesets ──────────────────────────────────────────────────────────────
  # Reuse the existing row if present (leaving its `data` blob untouched);
  # create a bare key/name row when absent.

  defp ensure_tileset(key, name) do
    case Repo.get_by(Tileset, key: key) do
      %Tileset{} = tileset -> tileset
      nil -> create_tileset!(key, name)
    end
  end

  defp create_tileset!(key, name) do
    {:ok, tileset} = Catalog.create_tileset(%{key: key, name: name})
    tileset
  end

  # ── Ascii glyph tiles ─────────────────────────────────────────────────────

  defp seed_glyph_tiles(tiles, tileset_id, palettes) do
    for {label, tile} <- tiles do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: tile["glyph"],
          color_role: tile["colorRole"],
          blocking: not (tile["walkable"] || false),
          height: 1,
          category: tile["category"],
          title: tile["title"],
          image_url: "/tiles/ascii/#{label}.png",
          settings:
            %{
              "position" => tile["position"],
              "colors" => per_zone_colors(tile["colorRole"], palettes)
            }
            |> maybe_put("pose", tile["pose"])
            |> merge_behavior(label)
        })
    end
  end

  # ── Ascii terrain / ground tiles ──────────────────────────────────────────
  # Ground is walkable (blocking false) and flat (height 0). Its glyph is the
  # first `char` variant; the full char/fg/bg arrays live in settings.

  defp seed_terrain_tiles(terrain, tileset_id) do
    for {label, %{"char" => char, "fg" => fg, "bg" => bg}} <- terrain do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: List.first(char),
          color_role: nil,
          blocking: false,
          height: 0,
          category: "terrain",
          image_url: "/tiles/ascii/#{label}.png",
          settings:
            %{"variants" => %{"char" => char, "fg" => fg, "bg" => bg}}
            |> merge_behavior(label)
        })
    end
  end

  # ── Ascii ground-decor tiles ──────────────────────────────────────────────
  # Non-blocking floor detail (grass blades, blossoms, pebbles, embers…) scattered
  # across walkable cells so a stage reads dense, not blank. Each is JUST A TILE:
  # its glyph is the decor char and its colour is a per-tile `settings.colors`
  # setting keyed by zone — the presence of a zone key means the decor belongs to
  # that zone. Its baked ascii PNG (`/tiles/ascii/<label>.png`) is a tintable white
  # mask the ascii renderer recolours per zone — no tile falls back to a raw glyph
  # (MAP-MODEL §8 / TILE-BACKEND-MIGRATION §5).

  @doc """
  Seeds ONLY the ascii ground-decor tiles into the ascii tileset.

  Safe + idempotent (upsert by label) — touches nothing else (roads/terrain/glyph
  rows are left untouched), so it can run on the shared dev DB without a full reseed.
  """
  def seed_decor do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    seed_decor_tiles(ascii_id)
    IO.puts("seeded #{length(decor_tiles())} ascii decor tiles")
    :ok
  end

  defp seed_decor_tiles(tileset_id) do
    for %{label: label, glyph: glyph, colors: colors} <- decor_tiles() do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: glyph,
          color_role: nil,
          blocking: false,
          height: 0,
          category: "decor",
          image_url: "/tiles/ascii/#{label}.png",
          settings: %{"colors" => colors}
        })
    end
  end

  # The canonical decor set — one tile per unique glyph, its colour keyed by the
  # zones that use it (ported faithfully from the frontend GROUND_DECOR data).
  defp decor_tiles do
    [
      %{label: "decor_blossom", glyph: "✿", colors: %{"spring" => "#c4b061"}},
      %{label: "decor_flower", glyph: "❀", colors: %{"spring" => "#c79bb4"}},
      %{label: "decor_clover", glyph: "♣", colors: %{"summer" => "#2a722a"}},
      %{
        label: "decor_pebbles",
        glyph: "∴",
        colors: %{
          "autumn" => "#9c6a2c",
          "winter" => "#c8d6e2",
          "desert" => "#b89a58",
          "lava" => "#56382e"
        }
      },
      %{label: "decor_dot", glyph: ".", colors: %{"autumn" => "#a06a2c"}},
      %{label: "decor_spark", glyph: "*", colors: %{"winter" => "#ccdbe7", "lava" => "#e6661f"}},
      %{label: "decor_grit", glyph: ":", colors: %{"desert" => "#bba360"}},
      %{label: "decor_shell", glyph: "°", colors: %{"beach" => "#cfe6ee"}},
      %{label: "decor_ripple", glyph: "~", colors: %{"beach" => "#bfe0ec"}}
    ]
  end

  # ── Type-specific building tiles ──────────────────────────────────────────
  # Restore the per-building-TYPE identity colours lost when buildings became generic compositions:
  # a store's blue roof, a hospital's green roof + white walls, and per-house roof/wall variety are
  # now DISTINCT tiles — each carries its colour in `settings.colors`, referenced by the building
  # compositions (@type_tiles). NOT a shared tile recoloured by a variant index ("the tile itself is
  # a variant, we need tiles for everything"). Colours are ZONE-INDEPENDENT (the same across every
  # zone), matching the old fixed BUILDING_PALETTES — a store roof reads blue in every season. Each
  # reuses the base building PNG (a white tint-target the ascii renderer recolours) + glyph, so only
  # the colour differs, and inherits the base label's fade/cutaway behavior.

  @all_zones ~w(spring summer autumn winter desert beach lava)

  # base glyph per building part (ported from ascii.json's roof/roof_top/wall tiles).
  @base_glyph %{"roof" => "▀", "roof_top" => "▔", "wall" => "█"}

  @doc """
  Seeds ONLY the type-specific building tiles into the ascii tileset.

  Safe + idempotent (upsert by label) — touches nothing else, so it can run on the shared dev DB
  without a full reseed.
  """
  def seed_building_tiles do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_building_tiles(ascii_id, emoji_id)
    IO.puts("seeded #{length(building_tiles())} type-specific building tiles")
    :ok
  end

  defp seed_building_tiles(ascii_id, emoji_id) do
    for %{label: label, base: base, color: color} = tile <- building_tiles() do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ascii_id,
          label: label,
          glyph: @base_glyph[base],
          color_role: nil,
          blocking: base != "roof_top",
          height: 1,
          category: "buildings",
          image_url: "/tiles/ascii/#{base}.png",
          settings:
            %{"colors" => Map.new(@all_zones, &{&1, color})}
            |> merge_behavior(base)
        })

      # The emoji twin renders its BAKED PNG (baked from `emoji` by priv/tilegen) — hospital green 🟩, store
      # blue 🟦 — never the raw glyph, so it's OS-independent. Pairs with the frontend classifier routing
      # these labels per-label (artStyle.ts PIECE_LABEL).
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: emoji_id,
          label: label,
          emoji: tile.emoji,
          color_role: nil,
          blocking: base != "roof_top",
          height: 1,
          category: "buildings",
          image_url: "/tiles/emoji/#{label}.png",
          settings: %{"color" => color} |> merge_behavior(base)
        })
    end
  end

  # The type tiles: {label, base part it reskins, its recovered zone-independent colour}. Only the roof
  # IDENTITIES that survive the material rollout remain — a store's blue apex-sign badge and a hospital's
  # green roof. Walls are now MATERIAL tiles (wall_brick/wood/stone/plaster), and houses take a plain red
  # gable (or slate for the stone house), so the old per-house wall/roof reskins + wall_store/wall_hospital
  # are retired (see @type_tiles).
  defp building_tiles do
    [
      # FIXED store/hospital roof colours PER THE DOCS (building-material-rollout-spec + handoff: "blue store /
      # green hospital"): a store's blue roof-sign, a hospital's green roof-sign. Stores/hospitals never
      # randomize their material.
      %{label: "roof_store", base: "roof", color: "#235a96", emoji: "🟦"},
      %{label: "roof_top_store", base: "roof_top", color: "#235a96", emoji: "🟦"},
      %{label: "roof_hospital", base: "roof", color: "#2f7e50", emoji: "🟩"},
      %{label: "roof_top_hospital", base: "roof_top", color: "#2f7e50", emoji: "🟩"}
    ]
  end

  # ── Extra map tiles (storefront / flat-roof parts) ────────────────────────
  # New per-part tiles the realistic sample compositions need: a store's display-window + striped
  # awning, and the flat-roof deck + parapet lip + rooftop AC unit. Each is JUST A TILE — its own glyph
  # + a ZONE-INDEPENDENT colour in settings.colors (the same across every season, like the type-specific
  # building tiles) + its blocking/behavior. These aren't remapped per building TYPE; the compositions
  # reference them by label directly. (The fountain's rim/water/jet moved to the autotile PIECE set.)
  @doc """
  Seeds ONLY the extra storefront/flat-roof part tiles into the ascii tileset.

  Safe + idempotent (upsert by label) — touches nothing else, so it can run on the shared dev DB
  without a full reseed.
  """
  def seed_extra do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_extra_tiles(ascii_id, emoji_id)
    IO.puts("seeded #{length(extra_tiles())} extra map tiles")
    :ok
  end

  defp seed_extra_tiles(ascii_id, emoji_id) do
    for %{label: label, glyph: glyph, color: color, blocking: blocking, category: category} = tile <-
          extra_tiles() do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ascii_id,
          label: label,
          glyph: glyph,
          color_role: nil,
          blocking: blocking,
          height: 1,
          category: category,
          image_url: "/tiles/ascii/#{label}.png",
          settings:
            %{"colors" => Map.new(@all_zones, &{&1, color})}
            |> merge_behavior(label)
        })

      # Storefront glass / awning / rooftop unit carry their OWN part-emoji so emoji mode shows them
      # (a rooftop unit would otherwise fall to the coarse red 🟥 roof — it starts with "roof"). flat_roof
      # + parapet have no emoji: no clean grey square exists, and their 'ground' route already draws the
      # tile's grey. Only seed an emoji twin when the part defines one.
      if emoji = tile[:emoji] do
        {:ok, _} =
          Catalog.upsert_tile(%{
            tileset_id: emoji_id,
            label: label,
            emoji: emoji,
            color_role: nil,
            blocking: blocking,
            height: 1,
            category: category,
            image_url: "/tiles/emoji/#{label}.png",
            settings: %{"color" => color} |> merge_behavior(label)
          })
      end
    end
  end

  # {label, glyph, colour, blocking, sidebar category}. Colour is zone-independent (one tone every
  # season). Storefront/roof parts read as buildings.
  defp extra_tiles do
    [
      %{label: "display_window", glyph: "▦", color: "#86bcd6", blocking: true, category: "buildings", emoji: "🪟"},
      %{label: "awning", glyph: "▨", color: "#b64a34", blocking: true, category: "buildings", emoji: "🟧"},
      %{label: "flat_roof", glyph: "▬", color: "#8b9098", blocking: false, category: "buildings"},
      %{label: "parapet", glyph: "▀", color: "#70757c", blocking: true, category: "buildings"},
      %{label: "rooftop_unit", glyph: "▪", color: "#616870", blocking: true, category: "buildings", emoji: "⬛"}
    ]
  end

  # ── Autotile PIECE tiles (fountain rim + wall materials + slate roof) ──────
  # The autotile-pieces PATTERN sample (TILESET-AUTHORING §2-3): a composition is NOT one fill tile — for
  # each cell it places the RIGHT piece by neighbour (center `_c`, edges `_t/_b/_l/_r`, corners
  # `_tl/_tr/_bl/_br`), per the `<base>_<edge>` naming in TILE-VOCABULARY-CONTRACT §2.1. Each piece is a
  # real DB tile carrying BOTH an ascii `glyph` AND an `emoji` (part-emojis that COMBINE — 🪨 stone / 🧱 brick
  # / 🟫 wood / ⬜ plaster wall, ⬜ fountain rim, 🟦 water, 💧 jet, ⬛ slate roof — never a whole-object ⛲) + its
  # colour in `settings.colors`. Authored ONCE and seeded into BOTH tilesets, and BAKED in both: the ascii row
  # points at its tintable white-mask PNG (`/tiles/ascii/<label>.png`), the emoji row at its emoji PNG — no piece
  # falls back to a raw glyph on a font-less machine (MAP-MODEL §8 / TILE-BACKEND-MIGRATION §5). "Variety
  # of material = a different tile" (`wall_stone` vs `wall_brick` vs `wall_wood` vs `wall_plaster`); "variety
  # of colour = the tile's `settings.colors`".
  @doc """
  Seeds ONLY the autotile piece tiles (fountain rim/water/jets + wall materials + slate roof) into BOTH the
  ascii and emoji tilesets. Safe + idempotent (upsert by [tileset_id, label]) — touches nothing else.
  """
  def seed_pieces do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_autotile_pieces(ascii_id, emoji_id)
    IO.puts("seeded #{length(autotile_piece_tiles())} autotile piece tiles (ascii + emoji)")
    :ok
  end

  defp seed_autotile_pieces(ascii_id, emoji_id) do
    for piece <- autotile_piece_tiles() do
      # A piece inherits its BASE part's behavior: wall_* materials fade near the hero (fadeNear), a slate
      # roof body cuts away (roof), its apex cap fades (roof_top); the fountain pieces carry none — the
      # same generic settings-driven render path as every other tile.
      behavior_base = piece_behavior_base(piece.label)
      colors = Map.new(@all_zones, &{&1, piece.color})

      common = %{
        label: piece.label,
        color_role: nil,
        blocking: piece.blocking,
        height: 1,
        category: piece[:category]
      }

      # Both styles draw a BAKED PNG, never a raw glyph: the ascii row bakes the block-border glyph as a
      # tintable white mask (priv/tilegen/bake.mjs) that the ascii renderer recolours per zone, so no piece
      # falls back to a glyph on a font-less machine (MAP-MODEL §8 / TILE-BACKEND-MIGRATION §5).
      {:ok, _} =
        common
        |> Map.merge(%{
          tileset_id: ascii_id,
          glyph: piece.glyph,
          title: piece[:title],
          image_url: "/tiles/ascii/#{piece.label}.png",
          settings: %{"colors" => colors} |> merge_behavior(behavior_base)
        })
        |> Catalog.upsert_tile()

      {:ok, _} =
        common
        |> Map.merge(%{
          tileset_id: emoji_id,
          emoji: piece.emoji,
          title: piece[:title],
          # The emoji tile draws its BAKED PNG (baked from `emoji` by priv/tilegen/bake.mjs), never the raw
          # glyph — so it renders identically on every OS (no ?? on machines whose font lacks 🪨/⬛/…).
          image_url: "/tiles/emoji/#{piece.label}.png",
          settings: %{"color" => piece.color} |> merge_behavior(behavior_base)
        })
        |> Catalog.upsert_tile()
    end
  end

  # Each piece: {label, ascii glyph, emoji, colour, blocking, sidebar category?, title?}. The rim/wall
  # EDGE + CORNER glyphs are the block-drawing border set (▛▜▙▟ corners, ▀▄▌▐ edges) so ascii reads as a
  # framed border; the emoji parts are the material's own part-emoji (🪨 stone, 🧱 brick, 🟫 wood, ⬜ plaster
  # + fountain rim, 🟦 water, 💧 jet, ⬛ slate). The rim/edge pieces carry NO category (render-only, never in
  # the sidebar — MAP-MODEL §8); the browseable material anchors (`water_c`, `water_jet`, `wall_*_c`,
  # `roof_slate`) carry a category + title. "Variety of material = a DIFFERENT tile" (`wall_stone` vs
  # `wall_brick` vs `wall_wood` vs `wall_plaster`); colour is ZONE-INDEPENDENT and lives in `settings.colors`.
  defp autotile_piece_tiles do
    rim = "#cbc4b0"
    water = "#2f7fc9"
    jet = "#dff0ff"
    stone = "#8f8b82"
    brick = "#9e4b3b"
    wood = "#8a5a2b"
    plaster = "#f0f0ea"
    slate = "#4a4f57"

    fountain =
      [
        %{label: "water_c", glyph: "≈", emoji: "🟦", color: water, category: "nature", title: "Fountain Water"},
        %{label: "water_jet", glyph: "|", emoji: "💧", color: jet, category: "nature", title: "Water Jet"}
      ] ++ rim_or_wall_pieces("fountain", "", rim)

    # The wall MATERIALS — one autotile set per material (center anchor + 8 edge/corner pieces). Stone forces
    # a DISTINCT emoji block (🪨) so a stone wall reads apart from the ⬜ fountain rim (spec style call #3).
    walls =
      material_pieces("wall_stone", "▓", "🪨", stone, "Stone Wall") ++
        material_pieces("wall_brick", "▒", "🧱", brick, "Brick Wall") ++
        material_pieces("wall_wood", "▤", "🟫", wood, "Wood Wall") ++
        material_pieces("wall_plaster", "░", "⬜", plaster, "Plaster Wall")

    # A grey SLATE gable roof for stone/masonry buildings — a dark ⬛ block distinct from the red 🟥 gable.
    # `roof_slate` is the browseable roof body (cutawayRoof); `roof_top_slate` its walkable apex cap (fadeNear).
    roofs = [
      %{label: "roof_slate", glyph: "▲", emoji: "⬛", color: slate, category: "buildings", title: "Slate Roof", blocking: true},
      %{label: "roof_top_slate", glyph: "◣", emoji: "⬛", color: slate, category: nil, blocking: false}
    ]

    Enum.map(fountain ++ walls ++ roofs, fn t -> Map.put_new(t, :blocking, true) end)
  end

  # One wall MATERIAL's autotile set: the browseable center `_c` anchor (its own glyph + part-emoji + title)
  # plus its 8 render-only edge/corner pieces. Every material mirrors `wall_stone` — a DIFFERENT tile per
  # material, its colour in `settings.colors`.
  defp material_pieces(base, center_glyph, part_emoji, color, title) do
    [%{label: "#{base}_c", glyph: center_glyph, emoji: part_emoji, color: color, category: "buildings", title: title}] ++
      rim_or_wall_pieces(base, part_emoji, color)
  end

  # The 8 EDGE + CORNER pieces for a `<base>` (fountain rim / a wall material), sharing the block-border glyph
  # set. `emoji` is the single part-emoji for every edge/corner; when "" (fountain rim) it defaults to ⬜. The
  # center `_c` piece is authored separately (its glyph/emoji differ per base).
  defp rim_or_wall_pieces(base, emoji, color) do
    part = if emoji == "", do: "⬜", else: emoji

    for {suffix, glyph} <- [
          {"t", "▀"},
          {"b", "▄"},
          {"l", "▌"},
          {"r", "▐"},
          {"tl", "▛"},
          {"tr", "▜"},
          {"bl", "▙"},
          {"br", "▟"}
        ] do
      %{label: "#{base}_#{suffix}", glyph: glyph, emoji: part, color: color, category: nil}
    end
  end

  # A piece's BEHAVIOR base — the label whose fade/cutaway flags it inherits (@behavior_settings). Wall
  # materials fade near the hero (wall); a slate roof body cuts away (roof), its apex cap fades (roof_top);
  # fountain/water pieces map to themselves (no behavior).
  defp piece_behavior_base(label) do
    cond do
      String.starts_with?(label, "wall") -> "wall"
      String.starts_with?(label, "roof_top") -> "roof_top"
      String.starts_with?(label, "roof") -> "roof"
      true -> label
    end
  end

  # ── Living-tree pieces (3-segment trunk + 9-slice leaf canopy) ────────────
  # The upgraded living `tree` (#23): a 3-segment TRUNK (bottom/mid/top) + a 9-SLICE leaf CANOPY autotiled
  # like the fountain rim (center `_c`, edges `_t/_b/_l/_r`, corners `_tl/_tr/_bl/_br` — TILESET-AUTHORING §3).
  # Every piece is a REAL BAKED tile in BOTH styles (never a raw glyph → no ?? on a machine missing the font):
  # ascii draws a woody ║ trunk + a rounded ♣/♧/╭╮╰╯ leaf crown, emoji a 🟫 trunk block + 🍃 leaf (never a whole
  # 🌲 — §4). Trunk colour = the per-zone `trunk` tone; canopy colour = the per-zone `canopy` SHADE ARRAY, so a
  # per-tree `variant` picks a tone (tonal variety by SETTING, not a tile per shade). Render-only pieces (no
  # sidebar category — MAP-MODEL §8); the browseable unit is the `tree` composition itself.
  @doc """
  Seeds ONLY the living-tree pieces (3-segment trunk + 9-slice leaf canopy) into BOTH tilesets.

  Safe + idempotent (upsert by [tileset_id, label]) — touches nothing else, so it runs on the shared dev DB
  without a full reseed. Resolves each piece's per-zone trunk tone / canopy shade array from ascii.json's
  palettes.
  """
  def seed_tree_pieces do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    palettes = read_tileset("ascii.json")["palettes"]
    seed_tree_pieces(ascii_id, emoji_id, palettes)
    IO.puts("seeded #{length(tree_piece_tiles())} living-tree pieces (ascii + emoji)")
    :ok
  end

  defp seed_tree_pieces(ascii_id, emoji_id, palettes) do
    for piece <- tree_piece_tiles() do
      common = %{
        label: piece.label,
        color_role: piece.role,
        blocking: piece.blocking,
        height: 1,
        category: nil
      }

      # ASCII keeps the per-zone `colors` map (canopy = the shade ARRAY) so the composition stamp picks a
      # per-tree tonal `variant` at draw time (resolveTileColor). EMOJI carries a single `color` — the one
      # tint emojiStyleMap surfaces as each tile's backing fill (tilesetLoader reads settings.color), matching
      # every other Elixir-authored emoji tile (no per-zone tonal variety in the emoji set, like today's leaf).
      {:ok, _} =
        common
        |> Map.merge(%{
          tileset_id: ascii_id,
          glyph: piece.glyph,
          image_url: "/tiles/ascii/#{piece.label}.png",
          settings: %{"colors" => per_zone_colors(piece.role, palettes)}
        })
        |> Catalog.upsert_tile()

      {:ok, _} =
        common
        |> Map.merge(%{
          tileset_id: emoji_id,
          emoji: piece.emoji,
          image_url: "/tiles/emoji/#{piece.label}.png",
          settings: %{"color" => piece.emoji_color}
        })
        |> Catalog.upsert_tile()
    end
  end

  # Each tree piece: {label, ascii glyph, emoji, colour ROLE (per-zone palette path), blocking, emoji_color}. The
  # trunk is a woody ║ / 🟫 column (blocks); the canopy is a rounded leaf crown — dense ♣ centre, ♧ leafy edges,
  # ╭╮╰╯ rounded corners in ascii / 🍃 in emoji (walkable overhead). ASCII colour is a per-zone SETTING (trunk →
  # one woody tone, canopy → the 4-shade array so a per-tree variant picks a tone); `emoji_color` is the single
  # emoji backing tint (the canonical trunk brown / leaf green from emoji.json). Baked by priv/tilegen (both).
  defp tree_piece_tiles do
    trunk =
      for label <- ~w(trunk_bottom trunk_mid trunk_top),
        do: %{label: label, glyph: "║", emoji: "🟫", role: "trunk", blocking: true, emoji_color: "#7a5a3a"}

    canopy_glyphs = %{
      "canopy_tl" => "╭",
      "canopy_t" => "♧",
      "canopy_tr" => "╮",
      "canopy_l" => "♧",
      "canopy_c" => "♣",
      "canopy_r" => "♧",
      "canopy_bl" => "╰",
      "canopy_b" => "♧",
      "canopy_br" => "╯"
    }

    canopy =
      for {label, glyph} <- canopy_glyphs,
        do: %{label: label, glyph: glyph, emoji: "🍃", role: "canopy", blocking: false, emoji_color: "#5fae4f"}

    trunk ++ canopy
  end

  # ── Emoji tiles ───────────────────────────────────────────────────────────

  defp seed_emoji_tiles(emoji, tileset_id) do
    for {label, t} <- emoji do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          emoji: t["char"],
          color_role: nil,
          blocking: false,
          height: t["height"] || 0,
          category: t["category"],
          title: t["title"],
          image_url: t["image"] || "/tiles/emoji/#{label}.png",
          settings:
            %{"color" => t["color"]}
            |> maybe_put("pose", t["pose"])
            |> maybe_put("views", t["views"])
            |> merge_behavior(label)
        })
    end
  end

  # ── Compositions ──────────────────────────────────────────────────────────

  defp seed_compositions(compositions) do
    for {name, %{"footprint" => footprint, "cells" => cells}} <- compositions do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: footprint["w"], footprint_h: footprint["h"]},
          Enum.map(cells, &cell_attrs/1)
        )
    end
  end

  defp cell_attrs(cell) do
    %{
      dx: cell["dx"],
      dy: cell["dy"],
      level: cell["level"],
      label: cell["label"],
      walkable: cell["walkable"] || false
    }
  end

  # ── Elixir-authored compositions ─────────────────────────────────────────
  # The living tree (3-segment trunk + 9-slice leaf canopy) + trunkless bush. Unlike tree_small/
  # tree_dead (which stay JSON-sourced, untouched), these are authored directly here per the
  # tile-backend-migration doc's stated direction ("an Elixir data module holds the canonical
  # composition definitions"). The tree's pieces (trunk_bottom/mid/top + canopy_* 9-slice) are baked
  # in BOTH styles by seed_tree_pieces; the bush reuses the existing leaf_* tiles.

  @doc """
  Reseeds ONLY the code-authored compositions — the tree/bush/fountain (seed_new_compositions) and
  the house/store/office/… buildings (seed_building_compositions) — plus the extra part tiles they
  reference. Safe on the shared dev DB: it upserts by natural key and NEVER touches the emoji tiles
  (so editor-tuned poses survive) or the ascii glyph/terrain rows.
  """
  def seed_sample do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    palettes = read_tileset("ascii.json")["palettes"]
    seed_building_tiles(ascii_id, emoji_id)
    seed_extra_tiles(ascii_id, emoji_id)
    seed_autotile_pieces(ascii_id, emoji_id)
    seed_tree_pieces(ascii_id, emoji_id, palettes)
    seed_tree_leaves(emoji_id)
    seed_new_compositions()
    seed_building_compositions()
    IO.puts("reseeded sample tiles + compositions")
    :ok
  end

  # Seed the two emoji leaf tiles (🍃) the tree/bush use, each pointing at its BAKED PNG so the render draws a
  # tintable image (not a raw char that can't take the per-tree canopy tint, and shows ?? on a font-less
  # machine). SURGICAL: upserts just these two emoji rows from emoji.json — never a full emoji reseed (which
  # would clobber editor-tuned poses). `leaf_center` is the tree's whole (2×) canopy; both are baked by
  # priv/tilegen (tiles.json → bake.mjs). image_url MUST be non-nil (MAP-MODEL §8 / TILE-BACKEND-MIGRATION §5).
  defp seed_tree_leaves(emoji_id) do
    emoji = read_tileset("emoji.json")

    for label <- ["leaf_center", "leaf_top"], t = emoji[label] do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: emoji_id,
          label: label,
          emoji: t["char"],
          color_role: nil,
          blocking: false,
          height: t["height"] || 0,
          category: t["category"],
          title: t["title"],
          image_url: "/tiles/emoji/#{label}.png",
          settings: %{"color" => t["color"]}
        })
    end
  end

  defp seed_new_compositions do
    for {name, %{footprint_w: w, footprint_h: h, cells: cells}} <- compositions() do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: w, footprint_h: h},
          cells
        )
    end
  end

  # ── Building compositions ─────────────────────────────────────────────────
  # A pre-built building (house/store/hospital/…) is a composition TEMPLATE stamped
  # as per-cell tiles, the SAME path trees use — not a procedural unit (MAP-MODEL §5,
  # TILE-BACKEND-MIGRATION §4). The baked set (footprint + stacked wall/window/door/
  # roof/roof_top cells) lives in Nebulith.Catalog.BuildingCompositions; here we upsert
  # each idempotently, exactly like seed_new_compositions.

  defp seed_building_compositions do
    for {name, %{footprint_w: w, footprint_h: h, cells: cells} = comp} <-
          BuildingCompositions.all() do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: w, footprint_h: h, title: Map.get(comp, :title)},
          cells
        )
    end
  end

  defp compositions do
    %{
      # The living tree — just 3 STACKED cells in one column (Alexander: "make them just 3 stacked cells …
      # that'll reduce trees from 12 tiles to just 3"): a 2-segment brown TRUNK (trunk_bottom L0 / trunk_mid
      # L1, both blocking) topped by ONE leaf cell (leaf_center L2) drawn at scale 2.0 — a 2×2 crown ("zoom
      # the top tile 2"). The 2× is DATA on the cell (composition_cells.scale); the render reads it as its
      # uniform zoom. The leaf's colour is its own per-zone canopy SHADE setting, so a per-tree variant tints
      # it green / pink / brown (leaf_center carries the canopy shade array). Only the trunk cell blocks; the
      # leaf is walkable overhead. Replaces the retired 12-cell trunk+9-slice-canopy tree.
      "tree" => %{
        footprint_w: 1,
        footprint_h: 1,
        cells: [
          %{dx: 0, dy: 0, level: 0, label: "trunk_bottom", walkable: false},
          %{dx: 0, dy: 0, level: 1, label: "trunk_mid", walkable: false},
          %{dx: 0, dy: 0, level: 2, label: "leaf_center", walkable: true, scale: 2.0}
        ]
      },
      "bush" => %{
        footprint_w: 3,
        footprint_h: 1,
        cells: [
          %{dx: -1, dy: 0, level: 0, label: "leaf_left", walkable: true},
          %{dx: 0, dy: 0, level: 0, label: "leaf_center", walkable: true},
          %{dx: 1, dy: 0, level: 0, label: "leaf_right", walkable: true},
          %{dx: 0, dy: 0, level: 1, label: "leaf_top", walkable: true}
        ]
      },
      # The town-square fountain — a COMPOSITION assembled from AUTOTILE PIECES (TILESET-AUTHORING §3), not
      # one fill: a 5×4 basin whose interior is `water_c`, whose rim is the RIGHT edge/corner piece per cell
      # (`fountain_tl/tr/bl/br` corners + `fountain_t/b/l/r` sides), with a few `water_jet` rising 1–2 blocks
      # on the interior water. Every cell blocks (you stroll the paved ring around it); the generator stamps
      # it centred on the plaza (stampComposition).
      "fountain" => %{footprint_w: 5, footprint_h: 4, cells: fountain_cells()}
    }
  end

  # The fountain WATER's draw-PRIORITY (CSS z-index style). The water (basin surface + jets) carries a high
  # `z_index` so it renders IN FRONT of whatever sits behind it in the iso/2D depth sort — a wall/building
  # block behind the fountain that gets extra height or z-width no longer draws OVER the water (Images
  # #34/#36). 10 is comfortably above the default 0 every wall/rim/other tile carries (CSS semantics: a higher
  # z-index wins globally), leaving headroom for future intermediate layers. The RIM stays 0 — it's the basin's
  # own edge and sorts positionally with the water. Pure DATA on the cell; NOT a render special-case.
  @water_z_index 10

  # 5×4 fountain from pieces: the perimeter is the correct rim EDGE/CORNER piece, the interior is `water_c`,
  # and jets rise from a few interior points (a tall centre jet + two lower side jets). Pure data.
  defp fountain_cells do
    w = 5
    h = 4

    rim =
      for dy <- 0..(h - 1), dx <- 0..(w - 1), edge_cell?(dx, dy, w, h),
        do: %{dx: dx, dy: dy, level: 0, label: edge_piece("fountain", dx, dy, w, h), walkable: false}

    water =
      for dy <- 1..(h - 2), dx <- 1..(w - 2),
        do: %{dx: dx, dy: dy, level: 0, label: "water_c", walkable: false, z_index: @water_z_index}

    jets = [
      %{dx: 2, dy: 1, level: 1, label: "water_jet", walkable: false, z_index: @water_z_index},
      %{dx: 2, dy: 1, level: 2, label: "water_jet", walkable: false, z_index: @water_z_index},
      %{dx: 1, dy: 2, level: 1, label: "water_jet", walkable: false, z_index: @water_z_index},
      %{dx: 3, dy: 2, level: 1, label: "water_jet", walkable: false, z_index: @water_z_index}
    ]

    rim ++ water ++ jets
  end

  # True for a perimeter cell of a `w`×`h` rectangle (where the rim/edge pieces go).
  defp edge_cell?(dx, dy, w, h), do: dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1

  # The `<base>_<edge>` autotile piece for a perimeter cell: corners where two sides face out, edges where
  # one does. Used by the fountain rim (a rectangle in the footprint plane); the stone building's front
  # face uses the same 9-piece scheme, authored in Nebulith.Catalog.BuildingCompositions.
  defp edge_piece(base, dx, dy, w, h) do
    left = dx == 0
    right = dx == w - 1
    top = dy == 0
    bottom = dy == h - 1

    cond do
      top and left -> "#{base}_tl"
      top and right -> "#{base}_tr"
      bottom and left -> "#{base}_bl"
      bottom and right -> "#{base}_br"
      top -> "#{base}_t"
      bottom -> "#{base}_b"
      left -> "#{base}_l"
      true -> "#{base}_r"
    end
  end

  # ── Palette resolution ────────────────────────────────────────────────────
  # A tile's `colorRole` is a (possibly dotted) path into each zone's palette:
  # "trunk", "canopy" (an array of shades), "building.wall", "feature.peak", …
  # We resolve it against every zone, so the tile carries its own per-zone
  # colors. Roles with no palette entry (e.g. "weapon") and role-less tiles
  # resolve to an empty map.

  defp per_zone_colors(nil, _palettes), do: %{}

  defp per_zone_colors(role, palettes) do
    path = String.split(role, ".")

    for {zone, zone_palette} <- palettes,
        value = get_in(zone_palette, path),
        not is_nil(value),
        into: %{},
        do: {zone, value}
  end

  # ── Helpers ───────────────────────────────────────────────────────────────

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp merge_behavior(settings, label) do
    Map.merge(settings, Map.get(@behavior_settings, label, %{}))
  end

  defp read_tileset(file) do
    :nebulith
    |> Application.app_dir("priv/repo/tilesets")
    |> Path.join(file)
    |> File.read!()
    |> Jason.decode!()
  end
end

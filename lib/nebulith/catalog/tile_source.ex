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
  # `seed_frame_rows/4` reads a base row with `Repo.get_by(Tile, ...)`. Without this alias `Tile` is the atom
  # `Elixir.Tile`, which does not exist, and Elixir does NOT warn, because the module is passed as a VALUE,
  # never called or expanded as a struct. So it compiled clean and raised UndefinedFunctionError the moment the
  # seed ran, which is exactly what it did: the whole water-look seed aborted and wrote nothing.
  alias Nebulith.Catalog.Tile
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
    # A DOOR stays opaque and obvious while the wall around it fades — it is the thing you are looking FOR
    # . `minAlpha` is the floor the reveal may never take a tile below.
    # `scaleZ` is THICKNESS — a door is a thin panel in the wall, not a full cube. Distinct from the editor's
    # "z-width" (`depth`), which counts CELLS spanned and is
    # always >= 1 because a tile occupies its own cell.
    #
    # `thicknessDir` is WHICH WAY it is thin, as a WORLD axis. Without it the shrink happened along a
    # screen axis, so a door read as thin from one side of the house and solid from the other (
    # Image #3: "it's only applied viewing to MY front, not the front of the house"). `left-down` is +row =
    # the FRONT face a building is authored with (`building_compositions.ex`: `front = dy == h - 1`), and the
    # stamp ROTATES it by the building's rotation, so every door is thin toward ITS OWN house's front.
    "door" => %{"fadeNear" => true, "minAlpha" => 0.9, "scaleZ" => 0.3, "thicknessDir" => "left-down"},
    # The ridge apex is ROOF, so it lifts off with the rest of it. It used to carry `fadeNear` (it was the
    # "walkable apex cap"), which left a hero standing under a PEAK column — the door columns of every gable
    # house — under no cutaway tile at all, so the roof stayed solid over their head (
    # "I'm inside but I can't see inside, the roof is not transparent").
    "roof_top" => %{"cutawayRoof" => true},
    "roof" => %{"cutawayRoof" => true},
    # storefront glass + awning ease translucent as the hero approaches, like a window;
    # the flat-roof deck / its parapet lip / a rooftop AC unit lift off like a gable roof.
    "display_window" => %{"fadeNear" => true},
    "awning" => %{"fadeNear" => true},
    "flat_roof" => %{"cutawayRoof" => true},
    "parapet" => %{"cutawayRoof" => true},
    "rooftop_unit" => %{"cutawayRoof" => true},
    # FLOWERS render as a single centered BILLBOARD in a transparent block (a standing bloom, not a cube) —
    # EVERYWHERE: scattered AND inside compositions. Set on the flower TILE so it's global, not
    # per-composition. Every flower reuses `decor_flower`'s art, so they all take the same behavior.
    "decor_flower" => %{"display" => "single", "transparent" => true},
    "blossom" => %{"display" => "single", "transparent" => true},
    "bouquet" => %{"display" => "single", "transparent" => true},
    "hibiscus" => %{"display" => "single", "transparent" => true},
    "rose" => %{"display" => "single", "transparent" => true},
    "sunflower" => %{"display" => "single", "transparent" => true},
    "tulip" => %{"display" => "single", "transparent" => true},
    "wilted-flower" => %{"display" => "single", "transparent" => true}
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
    seed_growth_tiles(ascii_id, emoji_id)
    seed_building_tiles(ascii_id, emoji_id)
    seed_extra_tiles(ascii_id, emoji_id)
    seed_prop_tiles(ascii_id, emoji_id)
    seed_emoji_tiles(emoji, emoji_id)
    seed_meadow_tiles(ascii_id, emoji_id)
    seed_floor_tiles(ascii_id, emoji_id)
    seed_water_color()
    seed_water_surface()
    seed_water_current()
    seed_autotile_pieces(ascii_id, emoji_id)
    seed_tree_pieces(ascii_id, emoji_id, ascii["palettes"])
    seed_parity_tiles(ascii_id, emoji_id)
    # AFTER every seeder that OWNS a label, because `seed_water_look/0` copies a FRAME ROW from a base tile and
    # a base that does not exist yet seeds nothing. `decor_ripple` is exactly that case: ascii gets it from
    # `seed_decor_tiles/1` near the top, its emoji twin arrives from a later list, and running this at its old
    # place (straight after `seed_water_color/0`) created `decor_ripple_f1`/`_f2` in ascii ONLY, a catalog of
    # 373 ascii against 371 emoji rows, caught by the two 1:1-vocabulary tests rather than by the seeder.
    #
    # It also has to stay AHEAD of the normalizers below, so the frame rows it writes get their per-label facts
    # and colours agreed like every other row. This spot is the only one that satisfies both.
    seed_water_look()
    seed_compositions(ascii["compositions"])
    seed_new_compositions()
    seed_building_compositions()
    # PER-TILE height DATA: each asset tile keeps its OWN height (ground/flat = 0, standing ≥ 1), read uniformly
    # with no per-category code branch. seed_emoji_tiles already writes the raw per-tile height; this re-applies it
    # pose-safely so a fresh full seed agrees with seed_sample.
    reconcile_tile_heights()
    # …and the OTHER half of that sentence: the ground is flat. See flatten_ground_heights/0.
    flatten_ground_heights()
    # …and then make every OTHER style agree, because height is DATA and the same label is the same shape in
    # every style. This used to live in seeds.exs, which meant `seed()` on its own left 32 of 358 shared
    # labels disagreeing (ascii 0.0 vs emoji 1.0) — a caller had to remember a second call for the DB to be
    # correct. An invariant that depends on being remembered is not an invariant.
    normalize_tile_heights()
    # Seven seeders write glyphs and none can see the others' choices. The curated file says what each ascii
    # tile should look like; the algorithm then catches anything it does not cover yet. Without this pair,
    # two tiles share a glyph and therefore share a picture — the "fake tiles" report.
    apply_curated_glyphs()
    # The UNIT FIGURES — a unit is a GRID of characters, not one character (see `apply_unit_art/0`).
    apply_unit_art()
    ensure_distinct_glyphs()
    ensure_fade_near()
    ensure_ground_plants()
    # LAST of the tile-fact rules, because it DERIVES from `blocking` and every rule above may still be
    # changing it (ensure_ground_plants clears it on 38 rows).
    ensure_collisions()
    # …and every PER-LABEL fact agrees across styles. A label owns its name, bucket, height and collision;
    # only the picture is the style's. Without this the same `grass` was "Grass" in one style and nameless
    # in the other — two engines' worth of drift in the data.
    normalize_label_facts()
    # …including a label's COLOURS, which was the column nobody had got to. See normalize_label_colors/0.
    normalize_label_colors()
    point_tiles_at_own_image()
    # What each `units` tile IS — person / enemy / animal / fx. The editor reads this instead of
    # classifying 36 backend-owned slugs itself (§3.14b #11), and the Characters library sub-groups by it.
    seed_unit_roles()

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

  # How the style picker SHOWS each style. A tileset row is an art style, so its icon and order are catalog data, not
  # something the frontend declares.
  # ASCII is position 1 — it is the editor's default and the engine's baseline.
  @style_presentation %{
    "ascii" => %{icon: "⌨", position: 1},
    "emoji" => %{icon: "😀", position: 2}
  }

  defp ensure_tileset(key, name) do
    case Repo.get_by(Tileset, key: key) do
      %Tileset{} = tileset -> ensure_presentation(tileset)
      nil -> create_tileset!(key, name)
    end
  end

  defp create_tileset!(key, name) do
    look = Map.get(@style_presentation, key, %{icon: nil, position: 99})
    {:ok, tileset} = Catalog.create_tileset(%{key: key, name: name, icon: look.icon, position: look.position})
    tileset
  end

  # A tileset seeded before the style columns existed has no icon; fill it so the picker never shows a
  # blank affordance on an upgraded DB.
  defp ensure_presentation(%Tileset{icon: icon} = tileset) when icon in [nil, ""] do
    case Map.get(@style_presentation, tileset.key) do
      nil -> tileset
      look ->
        {:ok, updated} = Catalog.update_tileset(tileset, %{icon: look.icon, position: look.position})
        updated
    end
  end

  defp ensure_presentation(tileset), do: tileset

  # ── Ascii glyph tiles ─────────────────────────────────────────────────────
  # HEIGHT is the tile's OWN authored DATA (MAP-MODEL §4), read the same way in every style: a STANDING glyph
  # (wall, tree, crate…) carries no `height` and defaults to a whole block; a FLOOR glyph authors `0` so it
  # lands flat like the terrain rows, and the flat-minimal data migration gives it its real slab height. The
  # old hardcoded `height: 1` made every ascii.json `tiles` entry a block — which is how `path` (the entrance's
  # doorstep) ended up a 1-block kerb in ascii while the same label was a flat slab in emoji.

  defp seed_glyph_tiles(tiles, tileset_id, palettes) do
    for {label, tile} <- tiles do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: tile["glyph"],
          color_role: tile["colorRole"],
          blocking: not (tile["walkable"] || false),
          height: Map.get(tile, "height", 1),
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
  # Ground is walkable (blocking false) and a height-1 BLOCK. Its glyph is the first `char` variant; the full
  # char/fg/bg arrays live in settings.

  defp seed_terrain_tiles(terrain, tileset_id) do
    for {label, %{"char" => char, "fg" => fg, "bg" => bg} = t} <- terrain do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: List.first(char),
          color_role: nil,
          blocking: false,
          # Height 1 (raised block) so content marked act_as_tile stacks ON TOP of the ground, not sunk inside it.
          height: 1,
          # Ground defaults to `terrain`; a paved way (`roads`) or a constructed interior floor (`floors`)
          # carries its finer sidebar bucket in ascii.json (data-driven). All three stay WALKABLE ground —
          # the frontend still resolves them as ground tiles (buildAsciiTerrain reads terrain/roads/floors).
          category: t["category"] || "terrain",
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
          # building_tiles are all roof pieces (store/hospital roof + apex cap) → the finer `roofs` bucket.
          category: "roofs",
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
          category: "roofs",
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
  # season). The storefront glass reads as `windows`; the awning + flat-roof deck/parapet/rooftop unit read as `roofs`.
  defp extra_tiles do
    [
      %{
        label: "display_window",
        glyph: "▦",
        color: "#86bcd6",
        blocking: true,
        category: "windows",
        emoji: "🪟"
      },
      %{
        label: "awning",
        glyph: "▨",
        color: "#b64a34",
        blocking: true,
        # storefront canopy — grouped with roofs (flagged for review).
        category: "roofs",
        emoji: "🟧"
      },
      %{label: "flat_roof", glyph: "▬", color: "#8b9098", blocking: false, category: "roofs"},
      %{label: "parapet", glyph: "▀", color: "#70757c", blocking: true, category: "roofs"},
      %{
        label: "rooftop_unit",
        glyph: "▪",
        color: "#616870",
        blocking: true,
        category: "roofs",
        emoji: "⬛"
      }
    ]
  end

  # ── Light-post + cross-style parity tiles ─────────────────────────────────
  # A light post is a COMPOSITION — a `post` base at level 0 + the `lamp` on top at level 1 (see the
  # `lamp_post` composition below) — authored ONCE and used by BOTH styles, so ascii and emoji stamp the
  # IDENTICAL structure and only the ART differs (MAP-MODEL §5, the model's core rule). The `lamp` tile
  # already exists in both styles; this seeds the missing `post` base in BOTH (a dark metal pole glyph in
  # ascii, a dark post block in emoji), BAKED in both (priv/tilegen), so no piece falls back to a raw glyph or
  # a single lamp emoji (Images #43/#44).
  #
  # It ALSO closes a cross-style parity gap the audit found: the generic `roof_top` apex cap had an ascii tile
  # but NO emoji twin, so a plain house's ridge cap fell back to the coarse red roof kind in emoji. Seeding an
  # emoji `roof_top` = 🟥 (matching the emoji roof body) makes that cap paint its OWN per-cell tile in emoji,
  # exactly like ascii — same structure, only the art differs.
  @doc """
  Seeds the light-post `post` base (ascii + emoji) and the emoji `roof_top` parity twin.

  Safe + idempotent (upsert by [tileset_id, label]) — touches nothing else, so it runs on the shared dev DB
  without a full reseed.
  """
  def seed_prop_tiles do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_prop_tiles(ascii_id, emoji_id)
    IO.puts("seeded light-post base + roof_top parity twin (ascii + emoji)")
    :ok
  end

  # The light-post BASE colour (dark iron) — zone-independent, like the other structural piece tiles.
  @post_color "#43474d"

  defp seed_prop_tiles(ascii_id, emoji_id) do
    # `post` — the light-post base pole. Blocks (you can't walk through the pole). Baked in BOTH styles.
    # Render-only piece (no sidebar category — the browseable unit is the `lamp_post` composition); the ascii
    # glyph is a heavy vertical bar, the emoji a dark post block. Its colour is a per-tile setting.
    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ascii_id,
        label: "post",
        glyph: "║",
        color_role: nil,
        blocking: true,
        height: 1,
        category: nil,
        image_url: "/tiles/ascii/post.png",
        settings: %{"colors" => Map.new(@all_zones, &{&1, @post_color})}
      })

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: emoji_id,
        label: "post",
        emoji: "⬛",
        color_role: nil,
        blocking: true,
        height: 1,
        category: nil,
        image_url: "/tiles/emoji/post.png",
        settings: %{"color" => @post_color}
      })

    # Parity twin: the emoji generic `roof_top` apex cap (🟥, matching the emoji roof body #c8443c). Walkable
    # cap that lifts off with the roof near the hero (inherits roof_top's cutawayRoof). ascii `roof_top` already exists
    # (ascii.json); this only adds the missing emoji row so both styles paint the cap's OWN tile.
    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: emoji_id,
        label: "roof_top",
        emoji: "🟥",
        color_role: nil,
        blocking: false,
        height: 1,
        category: "roofs",
        image_url: "/tiles/emoji/roof_top.png",
        settings: %{"color" => "#c8443c"} |> merge_behavior("roof_top")
      })
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
  # + fountain rim, 🟦 water, 💧 jet, ⬛ slate). A wall material's WHOLE autotile set — center `_c` AND its
  # edge/corner pieces — carries the `walls` category (the slate roof carries `roofs`), so the pieces the
  # building compositions place (`wall_stone_bl`, `roof_top`, …) show in their sidebar bucket; only the fountain rim stays
  # category-less (its browseable unit is the `fountain`/`well` composition — MAP-MODEL §8). "Variety of
  # material = a DIFFERENT tile" (`wall_stone` vs `wall_brick` vs `wall_wood` vs `wall_plaster`); colour is
  # ZONE-INDEPENDENT and lives in `settings.colors`.
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
        %{
          label: "water_c",
          glyph: "≈",
          emoji: "🟦",
          color: water,
          category: "nature",
          title: "Fountain Water"
        },
        %{
          label: "water_jet",
          glyph: "|",
          emoji: "💧",
          color: jet,
          category: "nature",
          title: "Water Jet"
        }
      ] ++ rim_or_wall_pieces("fountain", "", rim, nil)

    # The wall MATERIALS — one autotile set per material (center anchor + 8 edge/corner pieces). Stone forces
    # a DISTINCT emoji block (🪨) so a stone wall reads apart from the ⬜ fountain rim (spec style call #3).
    walls =
      material_pieces("wall_stone", "▓", "🪨", stone, "Stone Wall") ++
        material_pieces("wall_brick", "▒", "🧱", brick, "Brick Wall") ++
        material_pieces("wall_wood", "▤", "🟫", wood, "Wood Wall") ++
        material_pieces("wall_plaster", "░", "⬜", plaster, "Plaster Wall")

    # A grey SLATE gable roof for stone/masonry buildings — a dark ⬛ block distinct from the red 🟥 gable.
    # `roof_slate` is the browseable roof body (cutawayRoof); `roof_top_slate` its ridge apex cap (also cutawayRoof).
    roofs = [
      %{
        label: "roof_slate",
        glyph: "▲",
        emoji: "⬛",
        color: slate,
        category: "roofs",
        title: "Slate Roof",
        blocking: true
      },
      %{
        label: "roof_top_slate",
        glyph: "◣",
        emoji: "⬛",
        color: slate,
        category: "roofs",
        blocking: false
      }
    ]

    Enum.map(fountain ++ walls ++ roofs, fn t -> Map.put_new(t, :blocking, true) end)
  end

  # One wall MATERIAL's autotile set: the browseable center `_c` anchor (its own glyph + part-emoji + title)
  # plus its 8 render-only edge/corner pieces. Every material mirrors `wall_stone` — a DIFFERENT tile per
  # material, its colour in `settings.colors`.
  defp material_pieces(base, center_glyph, part_emoji, color, title) do
    [
      %{
        label: "#{base}_c",
        glyph: center_glyph,
        emoji: part_emoji,
        color: color,
        category: "walls",
        title: title
      }
    ] ++
      rim_or_wall_pieces(base, part_emoji, color, "walls")
  end

  # The 8 EDGE + CORNER pieces for a `<base>` (fountain rim / a wall material), sharing the block-border glyph
  # set. `emoji` is the single part-emoji for every edge/corner; when "" (fountain rim) it defaults to ⬜. The
  # center `_c` piece is authored separately (its glyph/emoji differ per base). `category` is the base's sidebar
  # bucket — a wall material passes "walls" so its edge/corner pieces browse with `<mat>_c`; the fountain
  # rim passes nil (render-only, its browseable unit is the `fountain`/`well` composition — MAP-MODEL §8).
  defp rim_or_wall_pieces(base, emoji, color, category) do
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
      %{label: "#{base}_#{suffix}", glyph: glyph, emoji: part, color: color, category: category}
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
          do: %{
            label: label,
            glyph: "║",
            emoji: "🟫",
            role: "trunk",
            blocking: true,
            emoji_color: "#7a5a3a"
          }

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
          do: %{
            label: label,
            glyph: glyph,
            emoji: "🍃",
            role: "canopy",
            blocking: false,
            emoji_color: "#5fae4f"
          }

    trunk ++ canopy
  end

  # ── Cross-style vocabulary parity (1:1 label set) ─────────────────────────
  # THE full-parity pass: every tile LABEL exists in BOTH
  # styles so a map painted or generated in one style never renders `?` in the other. Only the ART differs —
  # the SAME label carries the SAME height/category/blocking (MAP-MODEL §4). We author each gap label's twin
  # by FOLLOWING the existing patterns, never inventing art:
  #   * an emoji-only GROUND/road (`desert`, `cobblestone`, …) → an ascii ground tile matching the existing
  #     ascii terrain style (char/fg/bg authored in ascii.json's `terrain`, @parity_ground_labels);
  #   * an emoji-only flat-decor / standing-nature / structural piece (`rose`, `oak-tree`, `brick`, …) →
  #     an ascii tile REUSING an existing ascii glyph + its baked mask PNG (`decor_flower`/`tree`/
  #     `wall_brick_c` …), tinted by the emoji tile's own colour — the same "reuse the base PNG, colour is a
  #     setting" path the type-specific building tiles use (@ascii_reuse_twins);
  #   * an ascii-only tile (a ground, a tree autotile piece, a roof deck, the peak) → an emoji twin: a
  #     coloured SQUARE picked by the ascii tile's own hue for grounds/decor, the tree part-emoji (🟫 trunk /
  #     🍃 leaf) for tree pieces, 🗻 for the peak — the existing emoji-ground / tree-piece conventions, never
  #     a whole-object emoji (@emoji_twins).
  # BEHAVIOR (height/category/blocking) is COPIED FROM the twin's existing row at seed time, so the two
  # styles can never disagree; only the art columns are authored here. The genuinely-atomic emoji-only labels
  # with NO ascii pattern (per-creature units, single-tile buildings, a few props/effects) are LEFT
  # emoji-only and tracked as pending art direction in Nebulith.TilesetParityTest — never guessed here.

  # The emoji-only GROUND labels given an ascii twin — authored as char/fg/bg in ascii.json's `terrain`
  # (their natural home; seed_terrain_tiles reads them on a full seed). Named here so the surgical parity
  # pass (and the data migration) upsert exactly these onto a LIVE DB.
  @parity_ground_labels ~w(
    grass-field dark-grass shallow-water deep-water beach-sand desert mountain-slope snowy-peak snowflake volcano ember autumn cobblestone dirt-path gravel
  )

  # {label, ascii glyph, reused baked mask PNG} — an emoji-only label whose ascii twin REUSES an existing
  # glyph + PNG, tinted by the emoji tile's colour. Behaviour + colour come from the label's emoji row.
  @ascii_reuse_twins [
    %{label: "blossom", glyph: "❀", reuse: "decor_flower"},
    %{label: "bouquet", glyph: "❀", reuse: "decor_flower"},
    %{label: "cherry-blossom", glyph: "✿", reuse: "decor_blossom"},
    %{label: "clover", glyph: "♣", reuse: "decor_clover"},
    %{label: "fallen-leaf", glyph: "♧", reuse: "canopy_t"},
    %{label: "hibiscus", glyph: "❀", reuse: "decor_flower"},
    %{label: "maple-leaf", glyph: "♧", reuse: "canopy_t"},
    %{label: "rose", glyph: "❀", reuse: "decor_flower"},
    %{label: "seashell", glyph: "°", reuse: "decor_shell"},
    %{label: "shamrock", glyph: "♣", reuse: "decor_clover"},
    %{label: "sunflower", glyph: "❀", reuse: "decor_flower"},
    %{label: "tulip", glyph: "❀", reuse: "decor_flower"},
    %{label: "wheat", glyph: "\"", reuse: "grass_tall"},
    %{label: "wilted-flower", glyph: "❀", reuse: "decor_flower"},
    %{label: "boulder", glyph: "O", reuse: "rock"},
    %{label: "dead-tree", glyph: "Ψ", reuse: "tree_snag"},
    %{label: "oak-tree", glyph: "♣", reuse: "tree"},
    %{label: "pine-tree", glyph: "♣", reuse: "tree"},
    %{label: "palm-tree", glyph: "♣", reuse: "tree"},
    %{label: "sapling", glyph: "♣", reuse: "tree"},
    %{label: "shrub", glyph: "*", reuse: "bush"},
    %{label: "red-mushroom", glyph: "♠", reuse: "mushroom"},
    %{label: "brick", glyph: "▒", reuse: "wall_brick_c"},
    %{label: "glass-window", glyph: "▒", reuse: "window"},
    %{label: "wooden-door", glyph: "╫", reuse: "door"},
  ]

  # {label, part-emoji, baked PNG, backing colour} — an ascii-only label whose emoji twin is a coloured
  # square by the tile's own hue (grounds/decor), 🟫/🍃 (tree pieces), 🗻 (peak) or grey ⬜ (flat roof).
  # Behaviour comes from the label's ascii row at seed time.
  # {label, ascii glyph} — an emoji-only label given its OWN ascii art. Unlike @ascii_reuse_twins (which
  # re-skins another tile's baked mask), each of these is BAKED FROM ITS OWN GLYPH into
  # `/tiles/ascii/<label>.png` (authored in priv/tilegen/tiles.json, rendered by priv/tilegen/bake.mjs).
  #
  # The vocabulary is the ROGUELIKE convention, which is the existing pattern for ascii art of things that
  # have no tile-shape to copy: creatures are letters (lowercase = small, uppercase = large/dangerous), people
  # are `@` and role marks, buildings are the classic `⌂` or a shop letter, and the combat/locomotion
  # effects are directional marks rather than objects. Every glyph is covered by the bake font (DejaVu Sans
  # Mono) and the bake is verified to produce real ink — no blanks, no tofu boxes.
  #
  # BEHAVIOUR + COLOUR still come from the label's own emoji row, so the two styles can never disagree on
  # height/category/blocking — only the ART differs. This is what closes the vocabulary gap completely: after
  # this there is NO emoji label without an ascii tile.
  @ascii_own_art_twins [
    %{label: "person", glyph: "@"},
    %{label: "adult", glyph: "@"},
    %{label: "man", glyph: "♂"},
    %{label: "woman", glyph: "♀"},
    %{label: "boy", glyph: "ъ"},
    %{label: "girl", glyph: "ф"},
    %{label: "child", glyph: "ç"},
    %{label: "elder", glyph: "ê"},
    %{label: "old-man", glyph: "ô"},
    %{label: "old-woman", glyph: "ö"},
    %{label: "prince", glyph: "Þ"},
    %{label: "princess", glyph: "þ"},
    %{label: "guard", glyph: "Ħ"},
    %{label: "police-officer", glyph: "Ρ"},
    %{label: "construction-worker", glyph: "Ĥ"},
    %{label: "ninja", glyph: "Ň"},
    %{label: "mage", glyph: "Ϻ"},
    %{label: "wizard", glyph: "Ŵ"},
    %{label: "witch", glyph: "Ŷ"},
    %{label: "elf", glyph: "ë"},
    %{label: "guardian", glyph: "Ǥ"},
    %{label: "boss", glyph: "Ω"},
    %{label: "robot", glyph: "¤"},
    %{label: "bat", glyph: "v"},
    %{label: "bear", glyph: "B"},
    %{label: "bird", glyph: "ь"},
    %{label: "boar", glyph: "p"},
    %{label: "butterfly", glyph: "ψ"},
    %{label: "cat", glyph: "f"},
    %{label: "chicken", glyph: "ķ"},
    %{label: "cow", glyph: "C"},
    %{label: "deer", glyph: "Y"},
    %{label: "dog", glyph: "d"},
    %{label: "dove", glyph: "ν"},
    %{label: "dragon", glyph: "D"},
    %{label: "duck", glyph: "u"},
    %{label: "fox", glyph: "F"},
    %{label: "frog", glyph: "j"},
    %{label: "goat", glyph: "ģ"},
    %{label: "grey-wolf", glyph: "W"},
    %{label: "hedgehog", glyph: "ĥ"},
    %{label: "honeybee", glyph: "ў"},
    %{label: "horse", glyph: "H"},
    %{label: "ladybug", glyph: "ŏ"},
    %{label: "owl", glyph: "Ö"},
    %{label: "pig", glyph: "P"},
    %{label: "rabbit", glyph: "ř"},
    %{label: "sheep", glyph: "S"},
    %{label: "snail", glyph: "ę"},
    %{label: "spider", glyph: "ж"},
    %{label: "squirrel", glyph: "ŝ"},
    %{label: "turtle", glyph: "ť"},
    %{label: "wolf", glyph: "w"},
    %{label: "alien", glyph: "Ä"},
    %{label: "grey-alien", glyph: "ä"},
    %{label: "ghost", glyph: "§"},
    %{label: "goblin", glyph: "g"},
    %{label: "ogre", glyph: "Ǫ"},
    %{label: "troll", glyph: "Ť"},
    %{label: "skeleton", glyph: "Ž"},
    %{label: "zombie", glyph: "z"},
    %{label: "vampire", glyph: "Ѵ"},
    %{label: "skull", glyph: "ѫ"},
    %{label: "pumpkin", glyph: "ϴ"},
    %{label: "arrow", glyph: "↑"},
    %{label: "bolt", glyph: "¦"},
    %{label: "bullet", glyph: "·"},
    %{label: "dart", glyph: "‡"},
    %{label: "cleave", glyph: "⁄"},
    %{label: "fire-slash", glyph: "∕"},
    %{label: "ice-slash", glyph: "∖"},
    %{label: "piercing-shot", glyph: "→"},
    %{label: "lightning", glyph: "Ƶ"},
    %{label: "nova", glyph: "✳"},
    %{label: "heal-glow", glyph: "±"},
    %{label: "guard-flash", glyph: "◊"},
    %{label: "fist", glyph: "ø"},
    %{label: "run", glyph: "»"},
    %{label: "walk", glyph: "›"},
    %{label: "house", glyph: "⌂"},
    %{label: "houses", glyph: "⌂⌂"},
    %{label: "house-garden", glyph: "⌂,"},
    %{label: "derelict-house", glyph: "⌐"},
    %{label: "bank", glyph: "Β"},
    %{label: "castle", glyph: "Ķ"},
    %{label: "japanese-castle", glyph: "Ĵ"},
    %{label: "church", glyph: "†"},
    %{label: "mosque", glyph: "Ϛ"},
    %{label: "hospital", glyph: "╬"},
    %{label: "hotel", glyph: "Ĭ"},
    %{label: "school", glyph: "Ŝ"},
    %{label: "factory", glyph: "Ƒ"},
    %{label: "stadium", glyph: "Ŭ"},
    %{label: "office-building", glyph: "Ē"},
    %{label: "department-store", glyph: "Ð"},
    %{label: "convenience-store", glyph: "Ĉ"},
    %{label: "classical-building", glyph: "Π"},
    %{label: "tower", glyph: "Ŧ"},
    %{label: "tent", glyph: "Λ"},
    %{label: "torii-gate", glyph: "π"},
    %{label: "fountain", glyph: "Ѱ"},
    %{label: "well", glyph: "Θ"},
    %{label: "connector", glyph: "╋"},
    %{label: "cactus", glyph: "ǂ"},
    %{label: "potted-plant", glyph: "ϙ"},
    %{label: "wood-log", glyph: "▬"}
  ]

  @emoji_twins [
    %{label: "adobe", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8a078"},
    %{label: "ancient_stone", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#8c8264"},
    %{label: "ash", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#96604a"},
    %{label: "autumn_ground", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#b07a46"},
    %{label: "autumn_leaves", emoji: "🟧", image_url: "/tiles/emoji/sq_orange.png", color: "#d2782d"},
    %{label: "bamboo_floor", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#b4c864"},
    %{label: "basalt", emoji: "⬛", image_url: "/tiles/emoji/sq_black.png", color: "#6e3a30"},
    %{label: "birch_forest", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#b4c8a0"},
    %{label: "bridge", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#bb8844"},
    %{label: "cave_floor", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#82786e"},
    %{label: "cave_moss", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#508c46"},
    %{label: "cliff", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ffd43a"},
    %{label: "cliff_face", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#8b6914"},
    %{label: "colorful_tile", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ffc832"},
    %{label: "courtyard_stone", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#dcd2be"},
    %{label: "crypt_floor", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#645f5a"},
    %{label: "dead_grass", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#8c825a"},
    %{label: "decor_blossom", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c4b061"},
    %{label: "decor_clover", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#5aaf5a"},
    %{label: "decor_dot", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#a06a2c"},
    %{label: "decor_flower", emoji: "🟪", image_url: "/tiles/emoji/sq_purple.png", color: "#c79bb4"},
    %{label: "decor_grit", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#bba360"},
    %{label: "decor_pebbles", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#b0894e"},
    %{label: "decor_ripple", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#8fc7e0"},
    %{label: "decor_shell", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#cfe6ee"},
    %{label: "decor_spark", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#ccdbe7"},
    %{label: "desert_road", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8aa78"},
    %{label: "eucalyptus", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#78a082"},
    %{label: "flat_roof", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#8b9098"},
    %{label: "frost", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#d2ebff"},
    %{label: "frozen_water", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#a0d2fa"},
    %{label: "gold_tile", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ffdc64"},
    %{label: "grass_tall", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#78ac3c"},
    %{label: "grave_dirt", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#645541"},
    %{label: "hieroglyph_floor", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ffd264"},
    %{label: "ice_cracked", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#b4e6ff"},
    %{label: "ice_water", emoji: "🟦", image_url: "/tiles/emoji/sq_blue.png", color: "#78c8ff"},
    %{label: "inca_stone", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#a09682"},
    %{label: "koi_pond", emoji: "🟦", image_url: "/tiles/emoji/sq_blue.png", color: "#64b4c8"},
    %{label: "magma", emoji: "🟧", image_url: "/tiles/emoji/sq_orange.png", color: "#ff961e"},
    %{label: "marble", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#faf8f5"},
    %{label: "mud_hut", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#a0825a"},
    %{label: "oasis", emoji: "🟦", image_url: "/tiles/emoji/sq_blue.png", color: "#32b4c8"},
    %{label: "obsidian", emoji: "⬛", image_url: "/tiles/emoji/sq_black.png", color: "#503c50"},
    %{label: "olive_grove", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#507832"},
    %{label: "outback_red", emoji: "🟧", image_url: "/tiles/emoji/sq_orange.png", color: "#dc783c"},
    %{label: "pampas", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#b4c896"},
    %{label: "parapet", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#8b9098"},
    %{label: "path_dirt", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#aa9977"},
    %{label: "path_stone", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ccbbaa"},
    %{label: "peak", emoji: "🗻", image_url: "/tiles/emoji/baked/mountain.png", color: "#8d8d97"},
    %{label: "prairie", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8be82"},
    %{label: "pyramid_stone", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#e6c896"},
    %{label: "red_earth", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#b4643c"},
    %{label: "red_lacquer", emoji: "🟥", image_url: "/tiles/emoji/sq_red.png", color: "#dc3c32"},
    %{label: "road_center", emoji: "⬛", image_url: "/tiles/emoji/sq_black.png", color: "#9698a0"},
    %{label: "road_edge", emoji: "⬛", image_url: "/tiles/emoji/sq_black.png", color: "#60626a"},
    %{label: "rune_floor", emoji: "🟦", image_url: "/tiles/emoji/sq_blue.png", color: "#64c8ff"},
    %{label: "russian_red", emoji: "🟥", image_url: "/tiles/emoji/sq_red.png", color: "#b43228"},
    %{label: "sakura_petals", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#ffc8dc"},
    %{label: "sand_dune", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#ffe6aa"},
    %{label: "sand_trap", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8a860"},
    %{label: "sandstone", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#e6be82"},
    %{label: "savanna", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8b464"},
    %{label: "seafloor", emoji: "🟦", image_url: "/tiles/emoji/sq_blue.png", color: "#6496b4"},
    %{label: "seaweed", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#3cb478"},
    %{label: "snow_deep", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#ffffff"},
    %{label: "snow_path", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#d2dceb"},
    %{label: "spanish_tile", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#ffc896"},
    %{label: "stairs", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#998866"},
    %{label: "tatami", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#c8be96"},
    %{label: "temple_floor", emoji: "🟨", image_url: "/tiles/emoji/sq_yellow.png", color: "#cec09e"},
    %{label: "terracotta", emoji: "🟧", image_url: "/tiles/emoji/sq_orange.png", color: "#dc8c64"},
    %{label: "tree_bottom", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_bottom_left", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_bottom_right", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_crown", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_edge_left", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_edge_right", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_interior", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_leaf", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_leaf_top", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_snag", emoji: "🟫", image_url: "/tiles/emoji/trunk.png", color: "#7a5a3a"},
    %{label: "tree_stem", emoji: "🟫", image_url: "/tiles/emoji/trunk.png", color: "#7a5a3a"},
    %{label: "tree_stem_bottom", emoji: "🟫", image_url: "/tiles/emoji/trunk.png", color: "#7a5a3a"},
    %{label: "tree_top", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_top_left", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tree_top_right", emoji: "🍃", image_url: "/tiles/emoji/leaf_center.png", color: "#5fae4f"},
    %{label: "tropical_grass", emoji: "🟩", image_url: "/tiles/emoji/sq_green.png", color: "#32c850"},
    %{label: "volcanic_rock", emoji: "⬛", image_url: "/tiles/emoji/sq_black.png", color: "#644632"},
    # THE BANDS HAVE THEIR OWN ART NOW. Both pointed at `sq_blue.png`, a flat rounded square, so a river came
    # out as three flat tones with no texture in any band: and Authored as drawn art in `tiles.json` (the new
    # `svg` shape) and baked per style, so shallow reads busy and bright and deep reads calm and dark.
    %{label: "water_deep", emoji: "🟦", image_url: "/tiles/emoji/water_deep.png", color: @water_color},
    %{label: "water_shallow", emoji: "🟦", image_url: "/tiles/emoji/water_shallow.png", color: @water_color},
    %{label: "whitewash", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#fffffa"},
    %{label: "wooden_planks", emoji: "🟫", image_url: "/tiles/emoji/sq_brown.png", color: "#aa8250"},
    %{label: "zen_garden", emoji: "⬜", image_url: "/tiles/emoji/sq_white.png", color: "#dcd7c8"},
  ]

  @doc """
  Surgically upserts the cross-style parity twins onto a LIVE DB (ascii + emoji). Idempotent (upsert by
  [tileset_id, label]) and pose-safe — it only INSERTS the gap labels (brand-new rows) and copies each
  twin's behaviour from its existing row; it never touches the hand-tuned rows a full reseed would
  clobber. Called by seed/0 (fresh DB) and by the AsciiEmojiVocabularyParity data migration (live DB).
  """
  def seed_parity do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_parity_tiles(ascii_id, emoji_id)
    :ok
  end

  defp seed_parity_tiles(ascii_id, emoji_id) do
    emoji_src = source_tiles("emoji")
    ascii_src = source_tiles("ascii")
    seed_parity_grounds(ascii_id, emoji_src)
    seed_ascii_reuse_twins(ascii_id, emoji_src)
    seed_ascii_own_art_twins(ascii_id, emoji_src)
    seed_emoji_square_twins(emoji_id, ascii_src)
  end

  # A snapshot of one style's rows keyed by label — the source we COPY behaviour (+ emoji colour) from,
  # so a twin can never disagree with the tile it mirrors.
  defp source_tiles(key), do: Map.new(Catalog.list_tiles_for(key), &{&1.label, &1})

  # The 15 emoji-only grounds get their ascii twin from ascii.json's `terrain` (char/fg/bg), upserted
  # through the SAME path every other ascii ground uses. seed_terrain_tiles seeds them at height 0 (the raw
  # ground default); we then SNAP each to its emoji twin's CURRENT height so the two styles agree in every
  # context — 0 vs 0 on a fresh seed, and 0.1 vs 0.1 on a live DB where the emoji ground is already
  # flat-migrated (FlatTilesMinimalHeight runs before this pass, so a brand-new ascii ground would otherwise
  # linger at 0 while its emoji twin sits at 0.1). Copying, not hardcoding, keeps parity either way.
  defp seed_parity_grounds(ascii_id, emoji_src) do
    terrain = read_tileset("ascii.json")["terrain"]
    seed_terrain_tiles(Map.take(terrain, @parity_ground_labels), ascii_id)

    for label <- @parity_ground_labels, twin = emoji_src[label] do
      Catalog.set_tile_height(ascii_id, label, twin.height)
    end
  end

  # Author the ascii twin of each reuse label: the reused glyph + baked mask PNG, tinted by the emoji tile's
  # colour (zone-independent), with height/category/blocking COPIED from the emoji row.
  # Each label gets its OWN baked ascii PNG (/tiles/ascii/<label>.png, from priv/tilegen). Behaviour and colour
  # are copied from the label's emoji row so the styles stay in lockstep; only the art differs. Skips any label
  # whose emoji row is absent, so it can never invent a tile out of nothing.
  defp seed_ascii_own_art_twins(ascii_id, emoji_src) do
    for %{label: label, glyph: glyph} <- @ascii_own_art_twins, src = emoji_src[label] do
      color = get_in(src.settings, ["color"]) || "#cccccc"

      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ascii_id,
          label: label,
          glyph: glyph,
          color_role: nil,
          blocking: src.blocking,
          height: src.height,
          category: src.category,
          image_url: "/tiles/ascii/#{label}.png",
          settings: %{"colors" => Map.new(@all_zones, &{&1, color})} |> merge_behavior(label)
        })
    end
  end

  defp seed_ascii_reuse_twins(ascii_id, emoji_src) do
    for %{label: label, glyph: glyph, reuse: png} <- @ascii_reuse_twins, src = emoji_src[label] do
      color = get_in(src.settings, ["color"]) || "#cccccc"

      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ascii_id,
          label: label,
          glyph: glyph,
          color_role: nil,
          blocking: src.blocking,
          height: src.height,
          category: src.category,
          image_url: "/tiles/ascii/#{png}.png",
          settings:
            %{"colors" => Map.new(@all_zones, &{&1, color})} |> merge_behavior(label)
        })
    end
  end

  # Author the emoji twin of each ascii-only label: the part-emoji + baked PNG + backing colour, with
  # height/category/blocking COPIED from the ascii row.
  defp seed_emoji_square_twins(emoji_id, ascii_src) do
    for %{label: label, emoji: emoji, image_url: img, color: color} <- @emoji_twins, src = ascii_src[label] do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: emoji_id,
          label: label,
          emoji: emoji,
          color_role: nil,
          blocking: src.blocking,
          height: src.height,
          category: src.category,
          image_url: img,
          settings: %{"color" => color} |> merge_behavior(label)
        })
    end
  end

  # A reuse twin inherits its base part's fade behavior: a brick material fades near the hero (wall), a
  # glass window fades (window), a wooden door fades (door); a nature/decor label maps to itself (no behavior).
  defp reuse_behavior_base("brick"), do: "wall"
  defp reuse_behavior_base("glass-window"), do: "window"
  defp reuse_behavior_base("wooden-door"), do: "door"
  defp reuse_behavior_base(label), do: label

  # ── Emoji tiles ───────────────────────────────────────────────────────────

  # The meadow floor's yellowish-green — a smooth flat colour (matches the meadow reference #14), NOT the busy
  # tiled clover of `grass`. One constant so the emoji tile's colour and the ascii terrain bg (which actually
  # TINTS the flat baked square, see below) never drift.
  @meadow_color "#a4ac48"

  @doc """
  Upserts the FLAT-COLOUR `meadow` ground tile in BOTH styles — a smooth yellowish-green floor, the clean
  base for a meadow layout instead of `grass`'s busy tiled clover.

  The frontend sources a floor's IMAGE and its COLOUR from different places, so both rows matter:
    * EMOJI image resolves by ground KIND (`groundKind` → `EMOJI_TILESET[kind].image`, tinted by the
      floor colour). `meadow` is its OWN kind (see artStyle.ts groundKind), pointing at a FLAT solid baked
      square — so a meadow floor draws as one clean tinted colour, NOT the clover texture of `grass`.
    * The floor COLOUR is style-independent: `groundTileColor` reads the ASCII terrain tile's
      `settings.variants.bg` BY SLUG (buildAsciiTerrain). Without the ascii `meadow` twin the floor falls
      back to the grass colour. Its `bg` carries @meadow_color, which then tints the flat emoji square.

  BOTH styles are IMAGE-BACKED (MAP-MODEL §8 — never `image_url: nil` + a raw glyph): the ascii twin points
  at `/tiles/ascii/meadow.png` (baked from its `.` glyph via priv/tilegen). It was the LAST ascii tile with
  no baked image, and `meadow` is the default floor of spring/summer plus the flood floor of every forest
  layout — so under ASCII a whole town drew ~1200 glyph plates instead of one cached image block, which is
  why ASCII rendered far slower than emoji on the same map.

  Idempotent upsert by [tileset_id, label] — safe on the shared dev DB. Called by seed/0, runnable standalone.
  """
  def seed_meadow do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_meadow_tiles(ascii_id, emoji_id)
    IO.puts("seeded meadow flat-colour ground tile (ascii + emoji)")
    :ok
  end

  @doc """
  WHAT GROWS ON THE FLOOR: walkable long grass, and a thicket you cannot push through.

  The jungle's undergrowth pass was drawing the same
  little clover a meadow uses and then blocking the cell, so what you saw was walkable and what you hit was a
  wall. A thicket that stops you has to LOOK like a thicket, which is what `thicket` is for.

  And: That is `tall_grass`, walkable, height 0 like `grass`.

  Heights and shapes are taken from the rows they stand beside rather than invented: `grass` is height 0.0, and
  `bush` is height 1.0 with `fadeNear`, so the thicket fades as you approach it the way a bush does.
  """
  def seed_growth do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_growth_tiles(ascii_id, emoji_id)
    IO.puts("seeded tall_grass (walkable) + thicket (blocking), ascii + emoji")
    :ok
  end

  # Long grass you walk INTO, and a thicket you walk AROUND. One list, both styles, so the two never drift.
  @growth_tiles [
    %{
      label: "tall_grass",
      title: "Long grass",
      glyph: "⁑",
      emoji: "🌾",
      category: "terrain",
      blocking: false,
      height: 0.0,
      settings: %{"color" => "#3f8f38"}
    },
    %{
      label: "thicket",
      title: "Thicket",
      glyph: "☙",
      emoji: "🌿",
      category: "nature",
      blocking: true,
      height: 1.0,
      settings: %{"color" => "#2f6b2a", "fadeNear" => true, "display" => "single", "transparent" => true}
    }
  ]

  defp seed_growth_tiles(ascii_id, emoji_id) do
    for t <- @growth_tiles do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: emoji_id,
          label: t.label,
          emoji: t.emoji,
          color_role: nil,
          blocking: t.blocking,
          height: t.height,
          category: t.category,
          title: t.title,
          image_url: "/tiles/emoji/baked/#{t.label}.png",
          settings: t.settings
        })

      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: ascii_id,
          label: t.label,
          glyph: t.glyph,
          color_role: nil,
          blocking: t.blocking,
          height: t.height,
          category: t.category,
          title: t.title,
          image_url: "/tiles/ascii/#{t.label}.png",
          settings: t.settings
        })
    end
  end

  @doc """
  Upserts the FLAT `floor` ground tile in BOTH styles: the meadow's flat floor, for every other template.

  A cave, a temple, a
  town plaza or a snowy wood lays this tile and writes the material's colour on it as per-cell STATE, which
  leaves the textured tiles (cave floor, moss, stone) for ornaments.

  Built exactly like `meadow`: the ascii picture is a sparse white glyph (`⸪`, baked by priv/tilegen) that the
  cell's colour tints, and the emoji picture is the same flat white square. Its own label because a cave floor
  is not a meadow, and the label is what names it in the editor.

  Height 0.0, level with the live terrain it stands in for. Idempotent upsert by [tileset_id, label]. Called by
  seed/0 and by the migration that adds it to an existing DB, runnable standalone.

  This doc was STRANDED above `seed_growth` (two `@doc` blocks back to back, the second winning and the first
  warning "redefining @doc attribute"), so it documented nothing and the compiler said so on every build. It
  belongs here, on the function it describes. The warning predates this session: HEAD carries it too.
  """
  def seed_floor do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id
    seed_floor_tiles(ascii_id, emoji_id)
    IO.puts("seeded the flat floor tile (ascii + emoji)")
    :ok
  end

  # What a hand-painted floor wears before anyone colours it. A generated one always carries its own.
  # ONE EARTH FAMILY, EVERYWHERE.
  # with and the Image #65.
  #
  # This was a neutral grey (#8c8a82). It is the base tone of the FLAT floor tile, and every template that lays
  # `floor` writes its own per-cell colour over the top, so this value is only ever seen where nobody repaints:
  # a fresh grid and a blank stage. Those are exactly the two surfaces it was looking at.
  #
  # `makeFloorAsset` then derives the map BODY from it (`groundSideColor` darkens the surface), so one earth
  # tone here gives the default grid its dirt colour AND the body under it, with no new tile and no new plumbing.
  #
  # The hex is a PROPOSAL, not a derivation: it said "dirt color", not which one. Mid-brown, between the
  # existing `mud_hut` (120,90,60) and `autumn_ground` (74,50,30).
  @floor_color "#7a5c3e"

  defp seed_floor_tiles(ascii_id, emoji_id) do
    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: emoji_id,
        label: "floor",
        emoji: "⬜",
        color_role: nil,
        blocking: false,
        height: 0.0,
        category: "terrain",
        title: "Floor",
        image_url: "/tiles/emoji/baked/floor.png",
        settings: %{"color" => @floor_color}
      })

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ascii_id,
        label: "floor",
        glyph: "⸪",
        color_role: nil,
        blocking: false,
        height: 0.0,
        category: "terrain",
        title: "Floor",
        image_url: "/tiles/ascii/floor.png",
        settings: %{
          "variants" => %{
            "char" => ["⸪", "⸪"],
            "fg" => [@floor_color, @floor_color],
            "bg" => [@floor_color, @floor_color]
          }
        }
      })
  end

  # The color-only RIVER blue — a flat water floor the meadow_river layout tints per-cell (sampled from #17).
  @water_color "#4f93b3"

  defp seed_meadow_tiles(ascii_id, emoji_id) do
    # HEIGHT 1.0: the meadow floor is a RAISED colour block with visible side faces — ornaments STACK on top of it. It
    # stays a
    # flat solid baked square TINTED by the per-cell floor colour (the season gradient / earth / cobble the
    # generator writes as STATE).
    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: emoji_id,
        label: "meadow",
        emoji: "🟩",
        color_role: nil,
        blocking: false,
        height: 1.0,
        category: "terrain",
        title: "Meadow",
        image_url: "/tiles/emoji/baked/meadow.png",
        settings: %{"color" => @meadow_color} |> merge_behavior("meadow")
      })

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ascii_id,
        label: "meadow",
        glyph: ".",
        color_role: nil,
        blocking: false,
        height: 1.0,
        category: "terrain",
        title: "Meadow",
        image_url: "/tiles/ascii/meadow.png",
        settings: %{
          "variants" => %{
            "char" => [".", ","],
            "fg" => ["#c8e08a", "#bcd67e"],
            "bg" => [@meadow_color, @meadow_color]
          }
        }
      })
  end

  @doc """
  Upserts the color-only WATER ground tile in BOTH styles — a flat blue floor built the SAME way as `meadow`
  (a flat baked square TINTED by the per-cell floor colour), so the meadow_river layout paints its river +
  lake with COLOUR instead of a tiled 🌊 texture. Height 1.0 so the water reads as a raised block like the land it
  sits beside.

  The emoji image is the same flat white square `/tiles/emoji/baked/water.png` (overwritten to a flat square
  in the tile pipeline) that the floor colour tints; the ascii twin carries @water_color as its terrain `bg`
  so `groundTileColor("water")` resolves the river blue for any non-generator paint / a reloaded save. The
  ascii twin is IMAGE-BACKED too (`/tiles/ascii/water.png`, baked from its `~` glyph) — MAP-MODEL §8 forbids
  `image_url: nil` + a raw glyph, and an image-less tile misses the renderer's cube-sprite cache entirely.
  Idempotent upsert by [tileset_id, label]. Runnable standalone.

  ## Why the height is 0.5 and not 1.0

  It was 1.0, and the doc here used to justify that as "a raised block like the land it sits beside". That was
  the bug. The iso render lifts one ELEVATION level by `cellSize * isoScale * 0.4` but draws one BLOCK of tile
  height as `cellSize * isoScale * 0.639` (`tileW * ISO_BLOCK_H_FRAC`). They are different units. So a channel
  cut one level down (−0.4) carrying a height-1.0 surface (+0.639) put the water 0.239 ABOVE the walking floor:
  the river stood proud of its own bank, which is what his screenshot shows.

  The surface sits below the rim only while `0.639 * height < 0.4`, i.e. height < 0.626. 0.5 rises 0.32 and
  leaves the water 0.08 below the bank, keeping a visible side face, which his Image #52 needs, since the rule
  there is and a height-0 tile has no bottom to colour.

  This is the ONE place the number lives: `@height_authority` is emoji, so `normalize_tile_heights/0` copies
  the emoji row's height onto ascii, and a single value keeps both styles honest.
  """
  @doc """
  ONE WATER SURFACE, and a PUDDLE that is not part of it.

  Two things were wrong and both were data.

  `seed_water_color/0` gave `water` a height of 0.5 with the arithmetic written out: one elevation level drops
  0.4 and one block of tile height rises 0.639, so 1.0 in a one-deep channel floats the water above its own
  bank. The two BAND labels never got that treatment and sat at 1.0, so a river's shallow edge and its deep
  middle both stood proud of the channel they are in. Same surface, same height.

  And a pool laid `water_shallow`, the river's own wadeable edge, so a puddle and a river wore one label. The
  frontend even asserted in a comment that the label was height 0.0, which the database has never agreed with.
  `water_still` is the puddle: flush with the floor at height 0, and no frames, because standing water has no
  current. It is COPIED from the shallow row per tileset, so its art is whatever that style really has rather
  than a path invented here.
  """
  def seed_water_surface do
    for tileset <- Catalog.list_tilesets() do
      # THE BANDS ARE LEFT ALONE. I dropped them from 1.0 to 0.5 reasoning "one channel surface" from the
      # comment above, and and It was right. It was tidying dressed up as a fix, and it is reverted.

      case Repo.get_by(Tile, tileset_id: tileset.id, label: "water_shallow") do
        nil ->
          :ok

        shallow ->
          {:ok, _} =
            Catalog.upsert_tile(%{
              tileset_id: tileset.id,
              label: "water_still",
              title: "Still water",
              glyph: "⌷",
              emoji: shallow.emoji,
              # ITS OWN PICTURE. This copied the shallow band's, which is drawn as wave paths:
              # 2026-09-13, Authored in
              # `tiles.json` as a flat sheet with a soft sheen and no directional stroke anywhere, and baked.
              image_url: "/tiles/#{tileset.key}/water_still.png",
              color_role: shallow.color_role,
              blocking: false,
              # A FILM, NOT A FLOOR. A puddle is so it is a thin sheet the generator
              # STACKS on the ground rather than a ground tile that replaces it. Height 0 made it a ground
              # replacement sitting a whole block below `meadow` (1.0), which is why it fell in:
              height: 0.05,
              # NOT `terrain`. It stopped being ground the moment it became a film the generator stacks ON the
              # ground, and the category is what a thing IS. It also keeps the flat-ground contract honest:
              # `emojiTileHeight` requires every terrain tile to be 0 blocks so it occludes nothing in the
              # depth sort, and a 0.05 film listed as terrain would be one more quiet exception to it.
              category: "props",
              # NO `frames`, NO `animations`: a puddle does not flow. The colour is the shallow band's own, so
              # a still pool reads as water rather than as a new blue nobody chose.
              # `animations: []` is a STATEMENT, not an omission. The frontend collapses every water-ish
              # label to the kind `water` so the bands can share one picture and one set of frames, and that
              # collapse would hand a puddle the river's current. An EMPTY list says "this tile has none",
              # which is a different thing from saying nothing and inheriting.
              settings: %{
                "color" => (shallow.settings || %{})["color"],
                # NO CURRENT, BUT YOU CAN SEE THROUGH IT.
                # The list stays a STATEMENT rather than an omission (the frontend collapses every water-ish
                # label to `water` so the bands can share one picture, and that collapse would hand a puddle
                # the river's current). It now carries exactly one entry, and it is not a current: a constant
                # opacity, expressed the only way a tile's opacity is actually read, as a settings track with
                # `from` equal to `to`. A plain `settings.opacity` would be consumed by nothing.
                "animations" => [water_translucence("puddle_translucence", 0.72)],
                # Nothing stands ON a puddle: whatever is in the cell sits at the floor, with the film over it.
                # This is his "stacking set at bottom face", and it is what lets a flower stand IN the water
                # rather than on a shelf of it.
                "stackAt" => 0,
                # WHAT IT OCCUPIES: nothing. You wade a puddle, which is the whole point of it being a film.
                "collision" => []
              }
            })
      end
    end

    IO.puts("water bands share one surface height; water_still authored flush and frameless")
    :ok
  end

  def seed_water_color do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: emoji_id,
        label: "water",
        emoji: "🟦",
        color_role: nil,
        blocking: false,
        # A SURFACE, not a block. See the moduledoc above: one elevation level drops 0.4 and one block of tile
        # height rises 0.639, so 1.0 in a 1-deep channel floated the water 0.239 above its own bank.
        height: 0.5,
        category: "terrain",
        title: "Water",
        # Its OWN picture, drawn art baked from `tiles.json`. This used to write `/tiles/emoji/baked/water.png`
        # on every seed, which was an 854 byte BLANK: tintedImage multiplies the sprite by the tint, so a white
        # picture rendered as a flat block of colour. It also fought `point_tiles_at_own_image/0`, which repoints
        # a tile at its own image and was overwritten again by the next seed.
        image_url: "/tiles/emoji/water.png",
        settings: %{"color" => @water_color} |> merge_behavior("water")
      })

    {:ok, _} =
      Catalog.upsert_tile(%{
        tileset_id: ascii_id,
        label: "water",
        glyph: "~",
        color_role: nil,
        blocking: false,
        # Kept equal to the emoji row on purpose: height is a fact about the LABEL, not the picture, and
        # `normalize_tile_heights/0` would overwrite a disagreement here from the emoji authority anyway.
        height: 0.5,
        category: "terrain",
        title: "Water",
        image_url: "/tiles/ascii/water.png",
        settings: %{
          "variants" => %{
            "char" => ["~", "≈"],
            "fg" => ["#bfe4f5", "#a9d6ee"],
            "bg" => [@water_color, @water_color]
          }
        }
      })

    IO.puts("seeded color-only water ground tile (ascii + emoji)")
    :ok
  end

  @doc """
  THE WATER LOOK: frame pictures for the three bands, and a foam SHORELINE family.

  Two halves, both data:

    * ANIMATION. Each band carries `frames` (`<label>.png`, `_f1`, `_f2`) and `frameMs`, the same shape the 67
      animated unit tiles already use, built by `frame_images/4` so a frame with no baked picture is dropped
      rather than served as a broken path. The frontend plays it through `spriteFrame`, the playback that used
      to be stubbed.
    * BORDER. `shore_*`, the 8 edge and corner pieces, named the way `canopy_*` and `wall_stone_*` already are.
      NOT `water_*`: `water_c` is the fountain's water and colliding with it would silently repoint a live
      tile. There is no `_c` piece because the centre of water is the water tile itself.

  Height 0 and non-blocking: a shore piece is a flat overlay on the LAND side of the bank, and what blocks is
  decided by collision, never by a picture.
  """
  @water_frame_ms 1200
  # ONLY `water`. This was `~w(water water_shallow water_deep)`, which baked and seeded frame pictures for all
  # three bands, and a generated floor never draws two of them. A floor resolves its art through `groundKind`,
  # which collapses every water label to the kind `water`, so `water_shallow`/`water_deep` rows supply the
  # LABEL and the walkability and nothing visual at all. Animating them was art nobody could ever see.
  @water_bands ~w(water)
  # THE SPLASH a unit leaves standing in floor-level water. It rides the same frame rails as the bands: the
  # renderer derives it from where a unit IS, so nothing about it is stamped into a saved map.
  @water_effects ~w(decor_ripple)

  def seed_water_look do
    static = Path.join(:code.priv_dir(:nebulith), "static")
    ascii_id = ensure_tileset("ascii", "ASCII").id
    emoji_id = ensure_tileset("emoji", "Emoji").id

    seed_shore_pieces(ascii_id, emoji_id)

    framed =
      for {key, tileset_id} <- [{"ascii", ascii_id}, {"emoji", emoji_id}], label <- @water_bands ++ @water_effects do
        # FOUR frames, not three. The wave art has a 32px period in a 128px tile, and each frame shifts it by
        # 8px, so four frames advance the pattern exactly ONE period and the loop closes on itself. With three
        # frames the loop jumped back a third of a period every cycle, which is the flicker it reported:
        # (2026-09-12).
        frames = frame_images(key, label, [nil, nil, nil, nil], static)
        # Only when there is more than one picture to swap between: a single frame is a still, and writing one
        # would claim an animation that cannot play.
        if length(frames) > 1 do
          # EVERY FRAME IS A TILE. `frames` carries picture PATHS, but the animation's `tileId` is resolved by
          # looking the LABEL up in that style's catalog, so a frame label with no row resolves to nothing and
          # the loop silently plays its base picture forever. Seeding the rows is what makes the animation real.
          seed_frame_rows(tileset_id, key, label, length(frames))
          # The frame LABELS, in the same order as the pictures: frame 0 is the label itself, then _f1, _f2.
          labels = Enum.map(0..(length(frames) - 1), fn 0 -> label; i -> "#{label}_f#{i}" end)
          Catalog.put_tile_setting(tileset_id, label, "frames", frames)
          Catalog.put_tile_setting(tileset_id, label, "frameMs", @water_frame_ms)
          # TWO envelopes, because the engine resolves the two kinds through different paths and one cannot
          # carry the other: the SPRITE loop swaps the frame pictures (the current), while the SETTINGS track
          # holds the surface translucent. `resolveAssetAnimation` returns null when only a sprite is in scope
          # (its own comment says so), so the opacity has to be its own settings-kind animation.
          Catalog.put_tile_setting(tileset_id, label, "animations", [
            water_ripple(key, labels),
            water_translucence()
          ])
          {key, label, length(frames)}
        end
      end
      |> Enum.reject(&is_nil/1)

    IO.puts("water look: #{length(framed)} animated water tile(s), 8 shore pieces per style")
    :ok
  end

  # One row per FRAME picture, copied from the base tile so the two styles agree on everything but the picture
  # (the `normalize_label_facts` rule). A frame tile is never placed by hand: it exists so a `tileId` resolves.
  #
  # IT RAISES when the base row is missing, and that is the point. This used to carry a `base != nil` guard in
  # the comprehension, which turned a missing row into SILENCE: `decor_ripple` exists in ascii from
  # `seed_decor_tiles` but its emoji twin is seeded by a different list, so on a fresh seed the emoji base was
  # absent here and only ascii got `_f1`/`_f2`. The catalog came out with 373 ascii and 371 emoji rows, and the
  # two 1:1-vocabulary tests are what noticed, not this code. A frame set has to be symmetric across styles or
  # it is a bug, so the failure belongs at the seam that creates it.
  defp seed_frame_rows(tileset_id, style, base_label, count) do
    base =
      Repo.get_by(Tile, tileset_id: tileset_id, label: base_label) ||
        raise "seed_frame_rows: no `#{base_label}` row in #{style} to copy frames from. " <>
                "Every style must own the label BEFORE its frames are seeded, or the vocabularies diverge."

    for i <- 1..(count - 1) do
      label = "#{base_label}_f#{i}"

      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: base.glyph,
          emoji: base.emoji,
          color_role: base.color_role,
          blocking: base.blocking,
          height: base.height,
          category: base.category,
          title: "#{base.title || base_label} frame #{i}",
          image_url: "/tiles/#{style}/#{label}.png",
          settings: Map.take(base.settings || %{}, ["color", "colors"])
        })
    end
  end

  # WATER IS NOT SOLID. with the two reference images.
  #
  # Authored as a SETTINGS animation carrying a FLAT `opacity` track rather than as a new tile setting, because
  # that is the one alpha the renderer already applies unconditionally: every view multiplies by
  # `resolveAssetAnimation(...).opacity`. A plain `settings.opacity` would be read by NOTHING. The only reader
  # of a tile's render behaviour is `tileRenderBehavior`, which forwards fadeNear/cutawayRoof/minAlpha/display/
  # collision and nothing else, and the draw consults those solely while a hero is nearby. Checked before
  # writing this, because seeding a setting no reader consumes is exactly the mistake that made the first pass
  # at this animation play nothing at all.
  #
  # `from` equals `to` on purpose: a CONSTANT, not a fade. The interpolator returns the same value at every t.
  #
  # 0.8 is a starting point for his :3000 verdict, not a derived number. It asked for "semi transparent" and
  # did not say how much, so this is the one value here that is a proposal rather than a measurement.
  defp water_translucence(id \\ "water_translucence", opacity \\ 0.8) do
    %{
      "id" => id,
      "name" => "translucence",
      "kind" => "settings",
      "durationMs" => @water_frame_ms,
      "loop" => true,
      "priority" => 0,
      "trigger" => %{"on" => "load"},
      "tracks" => [%{"setting" => "opacity", "from" => opacity, "to" => opacity}]
    }
  end

  # The ambient loop itself, as the engine's own sprite envelope: a tile carries its animation as DATA, so the
  # renderer plays what the backend authored instead of a hardcoded cycle.
  # The frame rows the four-heading experiment created, deleted by `seed_water_current/0`. Named so the delete
  # reads as a statement about the vocabulary rather than a string literal in a loop.
  @transposed_water ~w(water_y water_y_f1 water_y_f2 water_y_f3)

  @bridge_tiles [
    {"bridge_deck", "Bridge deck", "#a8794a"},
    {"bridge_rail", "Bridge rail", "#8a6a45"}
  ]

  @doc """
  THE BRIDGE'S OWN TWO TILES, solid to the edge.

  Neither the colour nor the height was the cause. `post.png` and
  `sq_brown.png` (which `wooden_planks` uses) are ROUNDED SQUARES with a transparent margin, 31% of the tile,
  so every block extruded from them shows its own dark interior through the gap. That is the open crate, and
  it would happen to anything built from those tiles, not just a bridge.

  `bridge_deck` and `bridge_rail` are authored FULL BLEED, measured at 0% transparent, so a block made of
  them is a solid body. Colour stays a per-cell setting, which is what lets one pair of tiles serve the
  wooden, plank and stone crossings instead of three pairs of pictures.
  """
  def seed_bridge_tiles do
    for tileset <- Catalog.list_tilesets(), {label, title, color} <- @bridge_tiles do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset.id,
          label: label,
          title: title,
          glyph: "=",
          emoji: "🟫",
          color_role: nil,
          blocking: false,
          height: 1.0,
          category: "props",
          image_url: "/tiles/#{tileset.key}/#{label}.png",
          settings: %{"color" => color, "collision" => []}
        })
    end

    IO.puts("bridge deck and rail seeded, solid to the edge")
    :ok
  end

  @doc """
  ONE CURRENT, turned per cell by the renderer, so a river flows the way it actually runs.

  He is right, and this function is where I got it wrong. My first answer to was to BAKE the direction in: a
  second frame set (`water_y*`)
  transposed from the first, plus both played in reverse, so four frame sets and four animations, and a cell
  chose one by id. That is eight PNGs and four animations to express a rotation.

  A rotation is free. A floor face is painted by mapping the unit texture square onto it with two basis
  vectors (`ctx.transform(eA, eB)`), so turning the picture a quarter turn is permuting those two vectors:
  `turnFaceTexture` on the frontend, driven by the cell's own `flow`. So the catalog carries what it always
  carried, ONE water loop over `water`/`water_f1..f3`, and the eight transposed rows are deleted here.
  """
  def seed_water_current do
    for tileset <- Catalog.list_tilesets() do
      # The transposed set is gone: a heading is a texture turn at draw time, not a picture. Deleting rather
      # than leaving them is what keeps the two styles 1:1 and the editor's library free of dead art.
      Catalog.delete_tiles_by_label(tileset.id, @transposed_water)

      if Repo.get_by(Tile, tileset_id: tileset.id, label: "water") do
        current = water_current(tileset.key, ["water", "water_f1", "water_f2", "water_f3"])
        Catalog.put_tile_setting(tileset.id, "water", "animations", [current, water_translucence()])
      end
    end

    IO.puts("one water current seeded; the per-heading frame sets are deleted")
    :ok
  end

  # The ambient loop. The renderer turns it per cell; there is nothing directional in the DATA.
  defp water_current(style, labels) do
    %{
      "id" => "water_flow",
      "name" => "current",
      "kind" => "sprite",
      "durationMs" => @water_frame_ms,
      "loop" => true,
      "trigger" => %{"on" => "load"},
      "frames" => Enum.map(labels, fn label -> %{"tileId" => "#{style}:#{label}"} end)
    }
  end

  defp water_ripple(style, labels) do
    %{
      "id" => "water_ripple",
      "name" => "ripple",
      "kind" => "sprite",
      "durationMs" => @water_frame_ms,
      "loop" => true,
      "trigger" => %{"on" => "load"},
      # STYLE-QUALIFIED LABELS, not paths. `settings.frames` carries picture PATHS (the shape the 67 animated
      # unit tiles use), but a sprite frame's `tileId` is resolved by `visualForTileId`, which splits on ":"
      # and looks the label up in that style's catalog. Handing it a path would resolve to nothing and the
      # ripple would never play, which is exactly the kind of served-and-ignored data this codebase keeps
      # finding.
      "frames" => Enum.map(labels, fn label -> %{"tileId" => "#{style}:#{label}"} end)
    }
  end

  # A BANK IS EARTH, NOT SNOW. on maps with 231 to 450 of these hugging every water
  # edge: They
  # were not flowers. They were the shore pieces, authored `#eaf8ff`, a near-white, and read at map scale as a
  # line of white blobs along every river and pool.
  #
  # A generator that serves a `bank` colour overrides this per template (tan woodland, peat jungle, pale sand
  # island). This is what a shore wears when none is served, and it is the woodland's own tan rather than a
  # new invention.
  @shore_color "#c1a877"

  defp seed_shore_pieces(ascii_id, emoji_id) do
    for %{label: label} = piece <- rim_or_wall_pieces("shore", "░", @shore_color, "terrain"),
        {tileset_id, style} <- [{ascii_id, "ascii"}, {emoji_id, "emoji"}] do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: piece.glyph,
          emoji: piece.emoji,
          color_role: nil,
          blocking: false,
          height: 0.0,
          category: "terrain",
          title: shore_title(label),
          image_url: "/tiles/#{style}/#{label}.png",
          settings: %{"color" => piece.color}
        })
    end
  end

  defp shore_title(label) do
    "Shore " <> (label |> String.replace_prefix("shore_", "") |> String.upcase())
  end

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
    for {name, %{"footprint" => footprint, "cells" => cells} = comp} <- compositions do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{
            name: name,
            footprint_w: footprint["w"],
            footprint_h: footprint["h"],
            category: comp["category"]
          },
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
    seed_prop_tiles(ascii_id, emoji_id)
    seed_autotile_pieces(ascii_id, emoji_id)
    seed_tree_pieces(ascii_id, emoji_id, palettes)
    seed_tree_leaves(emoji_id, palettes)
    seed_new_compositions()
    seed_building_compositions()
    reconcile_tile_heights()
    # …and the OTHER half of that sentence: the ground is flat. See flatten_ground_heights/0.
    flatten_ground_heights()
    reconcile_tile_categories()
    IO.puts("reseeded sample tiles + compositions")
    :ok
  end

  @doc """
  Makes a tile's HEIGHT agree across EVERY art style.

  There is ONE engine and N art styles; a style is a set of baked images and nothing else. Height is not
  art — the same `door` is the same shape whichever images you are looking at — so it belongs to the LABEL,
  not to a style's row. The render already assumes exactly that (`iso.ts assetBlockRise` reads whichever
  tileset happens to be loaded, "heights are style-identical", MAP-MODEL §4).

  The DATA disagreed for 32 of 358 shared labels, because the seeders default in opposite directions when a
  tile authors no height of its own:

      glyph tiles   height: Map.get(tile, "height", 1)   # unauthored -> a BLOCK
      catalog tiles height: t["height"] || 0             # unauthored -> FLAT

  It never showed in the render (`resolveTileHeight` ignores the art tile's height) but it changed what the
  BRUSH seeds: the same map differed by which palette built it.

  Style-agnostic by construction — it walks EVERY tileset in the DB, so a third art style is normalised the
  day it is seeded with no edit here. `@height_authority` names the ONE catalog that authors heights
  today; that is a single documented constant, not a rule spread through the code.

  Walks the height column only (`set_tile_height`), so editor-tuned poses in `settings` survive — a full
  upsert would `replace_all` them. Idempotent.
  """
  # The catalog whose rows carry the authored per-label height. A style is only ever an image set, so this
  # is a DATA-ownership statement, not a claim that this style is special to the engine.
  @height_authority "emoji"

  def normalize_tile_heights do
    canonical =
      Catalog.list_tiles_for(@height_authority)
      |> Map.new(&{&1.label, &1.height})

    changed =
      for tileset <- Catalog.list_tilesets(),
          tileset.key != @height_authority,
          tile <- Catalog.list_tiles_for(tileset.key),
          Map.has_key?(canonical, tile.label),
          canonical[tile.label] != tile.height do
        Catalog.set_tile_height(tileset.id, tile.label, canonical[tile.label])
        {tileset.key, tile.label}
      end

    IO.puts("normalized #{length(changed)} tile heights across #{length(Catalog.list_tilesets())} styles (height is not art)")
    :ok
  end

  # Prefixes whose members are pieces of ONE autotiled thing, so sharing a shape is the point.
  @glyph_family_prefixes ~w(wall_ fountain_ trunk_ canopy_ tree_ roof_top)
  # One figure, distinguished by colour rather than by shape.
  @glyph_shared_labels ~w(adult person player)

  # Replacement glyphs, in order — box-drawing, geometric and technical blocks, so a distinct tile reads as
  # a distinct mark at 128px. Only ever consulted for a tile that lost a contest, so the pool is small.
  @glyph_pool ~w(
    ⌬ ⌭ ⌮ ⌯ ⌰ ⌱ ⌲ ⌳ ⌴ ⌵ ⌶ ⌷ ⌸ ⌹ ⌺ ⌻ ⌼ ⌽ ⌾ ⌿
    ⍀ ⍁ ⍂ ⍃ ⍄ ⍅ ⍆ ⍇ ⍈ ⍉ ⍊ ⍋ ⍌ ⍍ ⍎ ⍏ ⍐ ⍑ ⍒ ⍓
    ⍔ ⍕ ⍖ ⍗ ⍘ ⍙ ⍚ ⍛ ⍜ ⍝ ⍞ ⍟ ⍠ ⍡ ⍢ ⍣ ⍤ ⍥ ⍦ ⍧
    ⍨ ⍩ ⍪ ⍫ ⍬ ⍭ ⍮ ⍯ ⍰ ⍱ ⍲ ⍳ ⍴ ⍵ ⍶ ⍷ ⍸ ⍹ ⍺ ⎊
    ⎔ ⎕ ⏆ ⏇ ⏈ ⏉ ⏊ ⏋ ⏌ ⏍ ⏎ ⏏ ⏐ ⏑ ⏒ ⏓ ⏔ ⏕ ⏖ ⏗
    ▰ ▱ ◰ ◱ ◲ ◳ ◴ ◵ ◶ ◷ ◸ ◹ ◿ ⬢ ⬣ ⬟ ⬠ ⬡ ⯀ ⯁
    ⯂ ⯃ ⯄ ⯅ ⯆ ⯇ ⯈ ⯊ ⯋ ⯌ ⯍ ⯎ ⯏ ⯐ ⯑ ⧄ ⧆ ⧇ ⧊ ⧋
  )


  @doc """
  Applies the CURATED ascii glyphs (`priv/repo/tilesets/ascii_glyphs.json`) — the file that decides what each
  ascii tile looks like.

  An ascii tile's picture is rasterised from its glyph, so this is the ascii art. It lives as DATA rather
  than inside the seven seeders that write glyphs, because none of those can see the others' choices — which
  is exactly how `rose`, `tulip`, `sunflower` and `hibiscus` ended up sharing one `❀` plate. Curating them
  in one file makes the whole set reviewable at a glance and keeps the art out of the code.

  Runs after every seeder and before `ensure_distinct_glyphs/0`, which is the safety net for any label this
  file has not been updated for yet. Walks the glyph column only, so editor-tuned poses survive. Idempotent.
  """
  def apply_curated_glyphs do
    path = Path.join(:code.priv_dir(:nebulith), "repo/tilesets/ascii_glyphs.json")

    with true <- File.exists?(path),
         {:ok, body} <- File.read(path),
         {:ok, %{"glyphs" => glyphs}} <- Jason.decode(body) do
      tileset = Enum.find(Catalog.list_tilesets(), &(&1.key == "ascii"))
      apply_glyphs(tileset, glyphs)
    else
      _ -> IO.puts("no curated ascii glyphs to apply")
    end
  end

  defp apply_glyphs(nil, _glyphs), do: :ok

  defp apply_glyphs(tileset, glyphs) do
    applied =
      for tile <- Catalog.list_tiles_for(tileset.key),
          want = glyphs[tile.label],
          want != nil and want != tile.glyph do
        Catalog.set_tile_glyph(tileset.id, tile.label, want)
        tile.label
      end

    IO.puts("applied #{length(applied)} curated ascii glyphs")
    :ok
  end

  @doc """
  Makes every PER-LABEL fact agree across styles — the "one engine, N art styles" rule, enforced.

  So a LABEL owns everything except the picture. `grass` is called "Grass", is `terrain`, is walkable and is
  a flat slab — in every style, because those are facts about grass, not about which pictures you are
  looking at. Only `image_url` (and the glyph/emoji the picture is baked FROM) may differ.

  It had drifted, because nothing enforced it: **154 labels had a different title per style** (`grass` was
  "Grass" in emoji and NOTHING in ascii), and `coral`/`crystal`/`rock` were `terrain` in one and `nature` in
  the other. Height and blocking were already reconciled by `normalize_tile_heights/0`; this closes the
  remaining two columns and, with them, §3.5's "120 raw-slug labels in the picker".

  Where NO style authored a title, one is derived from the label (`wall_brick_c` → "Wall Brick C") so the
  picker never shows a raw slug. That is a display name computed from data the row already carries — an
  authored title always wins.
  """
  def normalize_label_facts do
    tilesets = Catalog.list_tilesets()
    by_label = tiles_by_label(tilesets)

    changed =
      Enum.flat_map(by_label, fn {label, tiles} ->
        agree_on_label(label, tiles, tilesets)
      end)

    IO.puts("agreed #{length(changed)} per-label facts across styles (a label owns everything but the picture)")
    :ok
  end

  @doc """
  Makes a label's per-zone COLOURS agree across styles, the next column in the same rule.

  `normalize_tile_heights/0` reconciled height and blocking; `normalize_label_facts/0` did title and category
  and its own doc says it "closes the remaining two columns". It did not: COLOUR is a per-label fact too, and
  a label owns everything except the picture.

  Measured on the live catalog before writing this: 240 ascii rows carry `settings.colors` and TWO emoji rows
  do (`leaf_center`, `leaf_top`), whose values are already IDENTICAL to their ascii twins. So copying across
  is the established precedent, not a new palette: nothing here invents a colour.

  Why it matters beyond tidiness: the frontend
  reads every composition cell's colour and every floor colour through `styleCatalog('ascii')`, pinned, because
  switching those reads to the ACTIVE style today would drop 359 emoji rows onto an invented grey. This is the
  half that has to land before that pin can come out.

  Conservative on purpose: a style that ALREADY authored its own colours keeps them. This only fills a blank,
  so a deliberate per-style colour can never be overwritten by the other style's.
  """
  def normalize_label_colors do
    tilesets = Catalog.list_tilesets()
    by_label = tiles_by_label(tilesets)

    written =
      Enum.flat_map(by_label, fn {label, tiles} ->
        case canonical_colors(tiles) do
          nil -> []
          colors -> fill_blank_colors(tilesets, tiles, label, colors)
        end
      end)

    plain = Enum.flat_map(by_label, fn {label, tiles} -> fill_blank_color(tilesets, tiles, label) end)

    IO.puts("agreed #{length(written)} per-label colour maps and #{length(plain)} plain colours across styles")
    :ok
  end

  # THE PLAIN `color` KEY, agreed the same way as the per-zone map above.
  #
  # The woodland's
  # trail was invisible and this was the last link in the chain. `path` carries `#9c7b4d` in emoji and NOTHING
  # in ascii, and the generator resolves a ground colour through the ASCII catalog, so `groundTileColor("path")`
  # fell through to the season's grass. The trail was painted the exact colour of the field it crossed.
  #
  # The rule above only ever agreed the per-zone `colors` MAP, so a label whose colour is the single `color`
  # key was skipped by it entirely. Same principle, same guard: copied only INTO a style that states none, and
  # never invented where no style has one.
  defp fill_blank_color(tilesets, tiles, label) do
    tiles
    |> Enum.find_value(fn tile -> (tile.settings || %{})["color"] end)
    |> paint_blank_colors(tilesets, tiles, label)
  end

  # No style states a colour for this label: nothing to agree, and a colour is never invented here.
  defp paint_blank_colors(canonical, _tilesets, _tiles, _label) when not is_binary(canonical), do: []

  defp paint_blank_colors(canonical, tilesets, tiles, label) do
    for tileset <- tilesets,
        tile = Enum.find(tiles, &(&1.tileset_id == tileset.id)),
        tile != nil,
        is_nil((tile.settings || %{})["color"]) do
      Catalog.put_tile_setting(tileset.id, label, "color", canonical)
      label
    end
  end

  # The label's per-zone colour map, from whichever style authored one. Nil when no style did, in which case
  # nothing is written: a colour is never invented here, and a tile with no colour renders from its own art.
  defp canonical_colors(tiles) do
    Enum.find_value(tiles, fn tile ->
      case (tile.settings || %{})["colors"] do
        colors when is_map(colors) and map_size(colors) > 0 -> colors
        _ -> nil
      end
    end)
  end

  # Written with map/filter rather than a comprehension, for the reason `agree_on_label/3` states: a binding
  # in a `for` clause is a FILTER, so a nil quietly drops the row instead of being handled.
  defp fill_blank_colors(tilesets, tiles, label, colors) do
    tilesets
    |> Enum.map(fn tileset -> {tileset, Enum.find(tiles, &(&1.tileset_id == tileset.id))} end)
    |> Enum.filter(fn {_tileset, tile} -> tile != nil and blank_colors?(tile) end)
    |> Enum.map(fn {tileset, _tile} ->
      Catalog.put_tile_setting(tileset.id, label, "colors", colors)
      {tileset.key, label}
    end)
  end

  defp blank_colors?(tile) do
    case (tile.settings || %{})["colors"] do
      colors when is_map(colors) and map_size(colors) > 0 -> false
      _ -> true
    end
  end

  defp tiles_by_label(tilesets) do
    for tileset <- tilesets, tile <- Catalog.list_tiles_for(tileset.key), reduce: %{} do
      acc -> Map.update(acc, tile.label, [tile], &[tile | &1])
    end
  end

  # Write the label's canonical title + category onto every style's row for it.
  #
  # Deliberately NOT a comprehension: `category = canonical_category(tiles)` as a comprehension generator is
  # a FILTER, so a label whose category is nil is silently dropped — which is exactly what happened, and 53
  # tiles (`trunk_top`, `canopy_r`, the fountain pieces…) never got their title as a result.
  defp agree_on_label(label, tiles, tilesets) do
    title = canonical_title(label, tiles)
    category = canonical_category(tiles)

    tilesets
    |> Enum.map(fn tileset -> {tileset, Enum.find(tiles, &(&1.tileset_id == tileset.id))} end)
    |> Enum.filter(fn {_tileset, tile} -> tile && (tile.title != title or tile.category != category) end)
    |> Enum.map(fn {tileset, _tile} ->
      Catalog.set_tile_label_facts(tileset.id, label, title, category)
      {tileset.key, label}
    end)
  end

  # The name a label goes by. An authored title wins (whichever style carries one); otherwise the label is
  # humanised, so the picker shows "Trunk Top" rather than `trunk_top` (§3.5).
  defp canonical_title(label, tiles) do
    case Enum.find_value(tiles, fn t -> if t.title not in [nil, ""], do: t.title end) do
      nil -> humanise(label)
      title -> title
    end
  end

  # The bucket a label sits in. The most common answer wins, so a single drifted row cannot flip the label.
  # `nil` when no style authored one — a category is not invented here.
  defp canonical_category(tiles) do
    tiles
    |> Enum.map(& &1.category)
    |> Enum.reject(&(&1 in [nil, ""]))
    |> Enum.frequencies()
    |> Enum.max_by(fn {_category, count} -> count end, fn -> {nil, 0} end)
    |> elem(0)
  end

  @doc """
  Gives every `units` tile its ROLE — what the thing IS: a person, a monster, an animal, or a combat effect.

  §3.14b #11: the frontend was classifying 36 backend-owned slugs itself, in two hardcoded Sets
  (`NON_ENTITY_UNIT`, `PERSON_SLUGS`), to decide what a `units` tile places as. That is data about the
  catalog living outside the catalog. It is also what §4.5's Characters library needs in order to sub-group
  its 79 creatures at all (§3.6: "79 creatures in a 256px dropdown, no grouping").

  ## Where each role comes from

  `enemy` is DERIVED, not listed: `EntitySource.enemy_type_slug` is already the authoritative enemy-type
  list, so a monster is a monster because the entity resolution says so. That settles the genuinely
  ambiguous ones from data rather than taste — `bat`, `spider` and `wolf` are hostiles in this game, and
  nothing here had to decide that.

  `fx` is the projectiles and the ability animations: they live in `units` because they are baked figures,
  but they are effects, so placing one must drop a decoration rather than spawn a creature.

  `person` is listed, because "is this a walking character" is not derivable from anything the catalog
  already holds. Everything left over is an `animal`.
  """
  # Combat effects that sit in `units` — projectiles + the ability animations. Not placeable creatures.
  @fx_units ~w(
    arrow bullet dart
    fire-slash ice-slash cleave bolt piercing-shot nova lightning heal-glow guard-flash
  )

  # Walking characters. The one role that has to be named: nothing else in the catalog implies it.
  @person_units ~w(
    npc person player adult boy girl child man woman old-man old-woman elder
    guard mage wizard witch elf ninja prince princess police-officer construction-worker
    robot grey-alien alien
  )

  # Hostiles the enemy-type list does not name, but that are plainly monsters rather than animals.
  @extra_enemy_units ~w(enemy boss skull pumpkin grey-wolf)

  def seed_unit_roles do
    enemies =
      Nebulith.Catalog.EntitySource.resolution().enemy_type_slug
      |> Map.keys()
      |> Enum.concat(@extra_enemy_units)
      |> MapSet.new()

    written =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          tile.category == "units" do
        Catalog.put_tile_setting(tileset.id, tile.label, "unitRole", role_for(tile.label, enemies))
        tile.label
      end

    IO.puts("gave #{length(written)} unit tiles their role (person / enemy / animal / fx)")
    :ok
  end

  @doc """
  Gives a creature tile its COMBAT settings — the stat block it fights with.

  He is right, and the evidence was in the mapping: nine
  archetypes existed for eight creatures, one each, with a frontend `Record` translating between the two
  vocabularies. A second vocabulary whose only job is to be translated back is not a concept.

  So a creature's numbers live on the creature, next to the role, the height and the collision it already
  carries. `enemy_archetypes` is dropped, and `ARCHETYPE_BY_ENEMY_TYPE` goes with it.

  Written to EVERY style's row, like `height` and `unitRole` before it: these are facts about the LABEL,
  and a style only changes the picture.
  """
  # Every number is the one the archetype table shipped with, so folding it changes no fight. Keyed by the
  # TILE the creature draws as (`EntitySource.enemy_type_slug`): a bandit is the ninja tile, a wraith the
  # ghost tile, so that is where a bandit's and a wraith's numbers belong.
  @unit_combat %{
    "goblin" => %{
      "stats" => %{"strength" => 6, "intelligence" => 0, "defense" => 3, "maxHp" => 34, "dodge" => 5},
      "moveDelayMs" => 1000, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 4, "cooldownMs" => 1000, "animation" => "cleave", "name" => "Strike"}]}
    },
    "skeleton" => %{
      "stats" => %{"strength" => 12, "intelligence" => 0, "defense" => 6, "maxHp" => 72, "dodge" => 0},
      "moveDelayMs" => 1700, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 18, "cooldownMs" => 6000, "animation" => "fire-slash", "name" => "Fire Slash"}]}
    },
    "wolf" => %{
      "stats" => %{"strength" => 5, "intelligence" => 0, "defense" => 1, "maxHp" => 20, "dodge" => 18},
      "moveDelayMs" => 550, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 2, "cooldownMs" => 450, "animation" => "cleave", "name" => "Quick Slash"}]}
    },
    "ninja" => %{
      "stats" => %{"strength" => 4, "intelligence" => 0, "defense" => 1, "maxHp" => 22, "dodge" => 10},
      "moveDelayMs" => 900, "reachCells" => 6,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "ranged", "damage" => 6, "cooldownMs" => 1500, "animation" => "bolt", "name" => "Bolt", "reachCells" => 6}]}
    },
    "ghost" => %{
      "stats" => %{"strength" => 3, "intelligence" => 10, "defense" => 1, "maxHp" => 18, "dodge" => 6},
      "moveDelayMs" => 950, "reachCells" => 7,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "ranged", "damage" => 12, "cooldownMs" => 1900, "animation" => "nova", "name" => "Arcane Bolt", "reachCells" => 7}]}
    },
    "bat" => %{
      "stats" => %{"strength" => 4, "intelligence" => 0, "defense" => 0, "maxHp" => 16, "dodge" => 24},
      "moveDelayMs" => 560, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 2, "cooldownMs" => 500, "animation" => "cleave", "name" => "Bite"}]}
    },
    "spider" => %{
      "stats" => %{"strength" => 6, "intelligence" => 0, "defense" => 2, "maxHp" => 30, "dodge" => 12},
      "moveDelayMs" => 720, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 4, "cooldownMs" => 900, "animation" => "cleave", "name" => "Venom Bite"}]}
    },
    "guardian" => %{
      "stats" => %{"strength" => 14, "intelligence" => 0, "defense" => 9, "maxHp" => 96, "dodge" => 0},
      "moveDelayMs" => 1700, "reachCells" => 1,
      "attack" => %{"mode" => "sequential", "attacks" => [
        %{"mode" => "melee", "damage" => 20, "cooldownMs" => 2200, "animation" => "cleave", "name" => "Crush"}]}
    }
  }

  def seed_unit_combat do
    written =
      for tileset <- Catalog.list_tilesets(),
          {label, combat} <- @unit_combat do
        Catalog.put_tile_setting(tileset.id, label, "combat", combat)
        label
      end

    IO.puts("gave #{length(written)} creature tiles their combat settings")
    :ok
  end

  defp role_for(label, enemies) do
    cond do
      label in @fx_units -> "fx"
      label in @person_units -> "person"
      MapSet.member?(enemies, label) -> "enemy"
      true -> "animal"
    end
  end

  defp humanise(label) do
    label
    |> String.replace(~r/[_-]+/, " ")
    |> String.split(" ", trim: true)
    |> Enum.map_join(" ", &String.capitalize/1)
  end

  @doc """
  Points every tile at its OWN picture, when one has been baked for it.

  the model: A tile's picture is its
  label's file in its style's directory. **29 ascii tiles pointed at ANOTHER tile's png** — `rose`,
  `sunflower` and `blossom` all at `decor_flower.png`, `pine-tree` and `palm-tree` at `tree.png` — so they
  drew a duplicate even after being given their own glyph and their own baked file. That is the same "fake
  tile" defect the `?` was, one layer down: a picture that is not this tile's.

  Only claims a file that EXISTS. Sharing one picture on purpose stays untouched: 95 emoji tiles point at
  `sq_brown.png` and tint it per-tile, which is the "colour is a setting" model working, not drift.
  """
  def point_tiles_at_own_image do
    static = Path.join(:code.priv_dir(:nebulith), "static")

    repointed =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          own = "/tiles/#{tileset.key}/#{tile.label}.png",
          tile.image_url != own,
          File.exists?(Path.join(static, own)) do
        Catalog.set_tile_image(tileset.id, tile.label, own)
        {tileset.key, tile.label}
      end

    IO.puts("pointed #{length(repointed)} tiles at their own picture (a tile draws ITSELF, not a neighbour)")
    :ok
  end


  @doc """
  Applies the ASCII UNIT ART (`priv/repo/tilesets/ascii_unit_art.json`) — the FIGURES units draw as.

    > human like units should look like the user player, animals, and other units are also composition of
    > ascii characters grouped to create a given element … a dog is not a single character, is a set of
    > characters combined to form a dog, that was then converted to png to be a tile, and we'd have
    > variations to be able to specify movement animations, just like the player character.
    >
    > we applied bad logic, you tried the ascii art the same as emoji, which they are at a fundamental
    > level, in the sense both are just art style, but that doesn't mean the tiles are generated in the
    > same way.

  That is the distinction this seeder carries. The ENGINE is one: every style draws baked image tiles, every
  style animates them, every tile has the same settings. What differs is how a style's picture is AUTHORED —
  emoji places one pictograph, ascii composes a grid of characters:

      "  O"        "/\_/\"
      " /|\"       "( o.o )"
      " / \"       " (>w<)"
      villager      dog

  So the art is `rows`, not a glyph, and the baker composes them (`priv/tilegen/atlas.html`, the `art` path).
  Treating a unit like a terrain slab — one distinct character each — is what lost the figures: `man` became
  `♂`, `dog` became `d`.

  Three things land on the tile, all of them DATA the frontend only reads:

    * `settings.artFrames` — the CHARACTER ROWS of every frame, `[[rows], [rows]]`. Named for what it is, so
      it is never confused with the baker's per-cell `art` (one frame's rows). This is what the catalog and
      the pre-load state draw before a single picture has decoded.
    * `settings.frames` — the ORDERED frame pictures, `[<label>.png, <label>_f1.png]`. A frame is a picture,
      not a second tile row: giving each frame its own label would put `Dog F1` in the units library and
      break the one-label-per-thing invariant every style shares. Emoji lists the one picture it has; ascii
      lists its two. Same field, same engine, different number of frames — which IS "all art styles do
      tileset animation".
    * `settings.frameMs` — the loop length. Frame 1 is authored at the SAME row count and width as frame 0,
      so the footprint never jitters as it cycles.

  Idempotent, and settings-key-surgical (`put_tile_setting/4`), so editor-tuned poses survive.
  """
  # Slow enough to read as breathing/padding rather than a strobe, and the same for every unit so a crowd
  # does not shimmer out of phase.
  @unit_frame_ms 900

  def apply_unit_art do
    path = Path.join(:code.priv_dir(:nebulith), "repo/tilesets/ascii_unit_art.json")

    with true <- File.exists?(path),
         {:ok, body} <- File.read(path),
         {:ok, art} <- Jason.decode(body) do
      apply_unit_art(Enum.find(Catalog.list_tilesets(), &(&1.key == "ascii")), art)
    else
      _ -> IO.puts("no ascii unit art to apply")
    end
  end

  defp apply_unit_art(nil, _art), do: :ok

  defp apply_unit_art(tileset, art) do
    static = Path.join(:code.priv_dir(:nebulith), "static")
    served = Map.new(Catalog.list_tiles_for(tileset.key), &{&1.label, &1})

    written =
      for {label, %{"frames" => [_ | _] = frames}} <- art, Map.has_key?(served, label) do
        Catalog.put_tile_setting(tileset.id, label, "artFrames", frames)
        Catalog.put_tile_setting(tileset.id, label, "frames", frame_images(tileset.key, label, frames, static))
        Catalog.put_tile_setting(tileset.id, label, "frameMs", @unit_frame_ms)
        label
      end

    IO.puts("gave #{length(written)} ascii units their composed FIGURE (a unit is a grid of characters)")
    :ok
  end

  # The baked picture per frame, in order — frame 0 is the label's own file, frame N is `<label>_fN`.
  # Only files that EXIST are listed: an unbaked frame must shorten the cycle, never point the renderer at a
  # missing image (the no-fallback law — a missing picture is what drew the `?` in the first place).
  defp frame_images(style, label, frames, static) do
    frames
    |> Enum.with_index()
    |> Enum.map(fn {_rows, i} -> if i == 0, do: "/tiles/#{style}/#{label}.png", else: "/tiles/#{style}/#{label}_f#{i}.png" end)
    |> Enum.filter(&File.exists?(Path.join(static, &1)))
  end

  # ── Fade near the hero ─────────────────────────────────────────────────────
  # A building's walls, windows and doors already fade (@behavior_settings). These are the
  # trees and the other standing things outside. NAMED, not derived from height: a flower is as tall as a castle
  # in this data, and a key or a hazard marker must stay solid, it is the thing you are walking toward.
  @fade_near_prefixes ~w(trunk leaf_ canopy_ tree_)
  @fade_near ~w(tree oak-tree palm-tree pine-tree dead-tree cherry-blossom sapling snag bush shrub cactus
                boulder rock crate bank castle church classical-building convenience-store department-store
                derelict-house factory hospital hotel house house-garden houses japanese-castle mosque
                office-building school stadium tent tower torii-gate fountain well pillar water_c water_jet
                lamp torch)

  # GROUND PLANTS: they STAND UP, and they hold nothing up.
  #
  # and
  #
  # It is right that it was already nearly there. A cell stacks by each tile's own HEIGHT (`cellStackTop`),
  # and `flower`, `clover`, `wheat` and `bush` are all authored a full block tall so they draw as standing
  # billboards. That same block was being counted as a SURFACE, so a tree or a hero landing on a flowered cell
  # was lifted one level onto it. Height is how tall it DRAWS; it should not decide what can stand on it.
  #
  # `stackAt` is that split, and it is the own description: 1 is the top face (the default, and what every
  # tile did before), 0 is the bottom face. A plant you walk through gets 0, so whatever follows lands at its
  # feet while the picture still stands at full height.
  #
  # AND YOU WALK THROUGH THEM.
  #
  # It is right, and the reason it survived three sessions is that the fix was looked for in the GENERATOR
  # every time. It was never there. `makePlant` reads the tile and writes `blocking: !tile.walkable`, so a
  # plant blocks because its CATALOG ROW says it blocks, and `thicket` was the one plant row in the whole
  # catalog with `blocking: true` (measured against live: every other nature tile is already false). It is
  # also the understory of the `closed` and `understory` formations, which is exactly the swamp jungle he
  # was standing in. One boolean, on one row, in the backend where walkability belongs.
  #
  # So the rule writes BOTH facts about a ground plant: it stands at your feet (`stackAt: 0`) and you pass
  # through it (`blocking: false`). They are the same statement said twice, and keeping them in one list is
  # what stops the next plant from arriving with one of the two missing.
  @ground_plants ~w(blossom bouquet clover flower hibiscus mushroom red-mushroom rose shamrock sunflower
                    tulip wilted-flower wheat bush shrub fallen-leaf maple-leaf thicket tall_grass)

  # WHAT A TILE OCCUPIES, as the only statement about whether you can walk through it.
  #
  # It is right about where this ends up and it is worth writing down why it had not happened yet: the boxes
  # system was built (`collisionBoxes.ts`, 2026-09-11) but NO ROW HAS EVER CARRIED ONE. Measured against live
  # before this: 0 of 375 tiles have `settings.collision`, 72 have `blocking: true`. So the finer truth has
  # been running entirely off the coarse flag it was meant to replace, and `boxesForAsset` opens with
  # `if (!asset.blocking) return []`. Two switches for one fact, and the one that owns the fact is empty.
  #
  # This fills it, from the flag, so the world behaves IDENTICALLY the moment it lands: a tile that blocks
  # occupies its whole cell, a tile that does not occupies nothing. From here the box list is the only thing
  # anyone reads, a tile can be given a real shape instead of a square, and the flag has nothing left to say.
  @whole_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

  @doc """
  Writes `settings.collision` on EVERY tile, in every tileset, derived from the `blocking` column.

  Pose-safe (`Catalog.put_tile_setting/4`), and written to walk-through rows too: an empty list SAYS "nothing
  solid here", where an absent key only says nobody got round to it. The distinction is the whole point of
  moving the fact into the data.
  """
  def ensure_collisions do
    {solid, clear} =
      for tileset <- Catalog.list_tilesets(), tile <- Catalog.list_tiles_for(tileset.key), reduce: {0, 0} do
        {solid, clear} ->
          boxes = if tile.blocking, do: @whole_cell, else: []
          Catalog.put_tile_setting(tileset.id, tile.label, "collision", boxes)
          if tile.blocking, do: {solid + 1, clear}, else: {solid, clear + 1}
      end

    IO.puts("#{solid} tiles occupy their cell, #{clear} occupy nothing")
    :ok
  end

  @doc "Does this label stand at ground level, so nothing stacks on top of it? The rule `ensure_ground_plants/0` writes."
  def ground_plant?(label), do: label in @ground_plants

  @doc """
  Gives every ground plant `stackAt: 0` AND `blocking: false`, in every tileset, writing ONLY those two
  facts (`Catalog.put_tile_setting/4`, `Catalog.set_tile_blocking/3`) so poses and sizes tuned in the
  editor survive.

  Runs alongside `ensure_fade_near/0` for the same reason: these labels are written by several passes and
  this has to land after all of them.
  """
  def ensure_ground_plants do
    written =
      for tileset <- Catalog.list_tilesets(), tile <- Catalog.list_tiles_for(tileset.key), ground_plant?(tile.label) do
        Catalog.put_tile_setting(tileset.id, tile.label, "stackAt", 0)
        Catalog.set_tile_blocking(tileset.id, tile.label, false)
        tile.label
      end

    IO.puts("#{length(written)} ground plants stack at their base and let you walk through them")
    :ok
  end

  @doc "Does this label fade as the hero comes close? The rule `ensure_fade_near/0` writes."
  def fades_near?(label), do: label in @fade_near or String.starts_with?(label, @fade_near_prefixes)

  @doc """
  Gives every tree part and standing exterior tile `fadeNear`, in every tileset, writing ONLY that key
  (`Catalog.put_tile_setting/4`), so poses and sizes tuned in the editor survive.

  Runs last in `seed/0`, like `ensure_distinct_glyphs/0`, because the tiles it covers are written by several
  seeders (tree pieces, props, nature) and none of them sees the others. Also run by the migration that adds it
  to an existing DB. Idempotent.
  """
  def ensure_fade_near do
    written =
      for tileset <- Catalog.list_tilesets(), tile <- Catalog.list_tiles_for(tileset.key), fades_near?(tile.label) do
        Catalog.put_tile_setting(tileset.id, tile.label, "fadeNear", true)
        tile.label
      end

    IO.puts("#{length(written)} tree and exterior tiles fade as the hero comes close")
    :ok
  end

  @doc """
  Gives every tile that names a DISTINCT thing its own glyph, in every style that uses glyphs.

  An ascii tile's picture is rasterised FROM its glyph, so two tiles on one glyph are two tiles with one
  picture. — measured at 170 of 358 ascii tiles
  drawing a byte-identical copy of another tile's art, because `rose`/`tulip`/`sunflower`/`hibiscus` were all
  `❀` and `oak-tree`/`palm-tree`/`pine-tree` were all `♣`.

  This runs as the last step of `seed/0` rather than as a list of glyphs somewhere, because the glyphs are
  written by SEVEN different seeders (glyph tiles, terrain, decor, buildings, extras, props, parity) and no
  single one of them can see what the others chose. An invariant that spans all of them has to be enforced
  after all of them. It is also why the earlier hand-written migrations kept introducing fresh collisions:
  uniqueness across ~350 rows is a job for a computer.

  ## The two legitimate ways to share a glyph

    * an AUTOTILING family — `wall_brick_tl`, `wall_stone_tl` and `fountain_tl` all draw `▛` because that
      glyph IS the top-left corner SHAPE; the material is the tile's COLOUR (TILESET-AUTHORING). Same for
      the `trunk_` column, the `canopy_` ring, the `tree_` parts and the `roof_top` caps;
    * `adult` / `person` / `player` — one human figure, three colours.

  The INCUMBENT of a contested glyph is the alphabetically-first label, so the assignment is stable across
  runs (idempotent) and the baseline tiles the generator leans on — `grass`, `water`, `path`, `sand` — keep
  the plain glyphs a reader expects. Walks the glyph column only, so editor-tuned poses survive.
  """
  def ensure_distinct_glyphs do
    changed =
      for tileset <- Catalog.list_tilesets(), reduce: [] do
        acc -> acc ++ distinct_glyphs_for(tileset)
      end

    IO.puts("gave #{length(changed)} tiles their own glyph (a shared glyph is a shared picture)")
    :ok
  end

  defp distinct_glyphs_for(tileset) do
    tiles = Enum.filter(Catalog.list_tiles_for(tileset.key), &(&1.glyph not in [nil, ""]))
    taken = MapSet.new(tiles, & &1.glyph)

    tiles
    |> Enum.group_by(& &1.glyph, & &1.label)
    |> Enum.flat_map(fn {_glyph, labels} -> contested(labels) end)
    |> Enum.sort()
    |> Enum.reduce({taken, @glyph_pool, []}, fn label, {taken, pool, done} ->
      {glyph, rest} = take_free_glyph(pool, taken)
      Catalog.set_tile_glyph(tileset.id, label, glyph)
      {MapSet.put(taken, glyph), rest, [label | done]}
    end)
    |> elem(2)
  end

  # The labels on one glyph that must MOVE: everything but the incumbent, once the members that share a
  # glyph BY DESIGN are set aside.
  defp contested(labels) do
    case labels
         |> Enum.reject(&(glyph_family?(&1) or &1 in @glyph_shared_labels))
         |> Enum.sort() do
      [] -> []
      [_only] -> []
      [_incumbent | rest] -> rest
    end
  end

  defp glyph_family?(label), do: Enum.any?(@glyph_family_prefixes, &String.starts_with?(label, &1))

  defp take_free_glyph([], _taken), do: raise("glyph pool exhausted — widen @glyph_pool")

  defp take_free_glyph([g | rest], taken) do
    if MapSet.member?(taken, g), do: take_free_glyph(rest, taken), else: {g, rest}
  end

  @doc """
  Reconciles the `height` COLUMN of every paintable emoji ASSET tile (the standing categories —
  walls/windows/doors/roofs/props + nature; `buildings` kept for pre-split DBs) to the tile's OWN height
  from emoji.json — the per-tile DATA, read uniformly.

  The user's model (MAP-MODEL / EDITOR-INTERACTION-SPEC): height is per-tile DATA read through ONE uniform path,
  with NO type/category/art-style code branch. A tile carries its own height and every consumer reads it the
  same way — the mechanism is identical for every tile, only the DATA differs:

    * a GROUND/FLAT tile (terrain, flower, fallen leaf, floor decor, facade piece) has height 0/min → it shows
      on the floor face only in iso and is WALKABLE;
    * a STANDING tile (tree, rock, mushroom, cactus, crate, lamp, building, prop) has height ≥ 1 → an extruded
      block that BLOCKS movement.

  `t["height"] || 0` writes exactly the tile's authored height: a tile with no explicit height in emoji.json is
  a ground/flat tile (0). This is NOT a category rule — the same line runs for every asset tile; it just reads a
  different value per tile (collision then DERIVES from that height on the client, no per-type list). Touches
  ONLY the height column (set_tile_height), so editor-tuned poses in `settings` survive (a full
  `seed_emoji_tiles` would `replace_all` them — which is why `seed_sample` never calls it). Terrain is the floor
  primitive (painted onto the ground, height 0 by definition) and is intentionally left untouched. Idempotent.
  """
  # THE GROUND IS FLAT, and until now nothing enforced it.
  #
  # It is right that I never looked. When I did, through Playwright, the bridge was a
  # row of open-topped cubes, and the reason was one number.
  #
  # `reconcile_tile_heights/0` below says in its own docstring "ground = 0, standing >= 1" and only ever did
  # the second half: it walks `buildings walls windows doors roofs props nature` and forces `max(1.0, …)`.
  # Nothing walked terrain/floors/roads. So `wooden_planks` (category `floors`) and `bridge` (category
  # `roads`) sat at height 1.0 in the live database and every deck cell extruded into a block. A bridge is a
  # deck; a deck made of cubes is a row of crates.
  #
  # It stayed hidden because the test fixture carries them at 0, so `emojiTileHeight`'s flat-ground assertion
  # was green against a payload that had drifted from live. That is the fixture trap, twice in one day.
  #
  # THE WATER SURFACES ARE THE ONE EXCEPTION, and a deliberate one: which is negative height compared to walking floor
  # / then inside that we put water with X height it can be < 1"*. They keep what they are authored with.
  @non_flat_ground ~w(water water_f1 water_f2 water_f3 water_shallow water_deep)

  @doc """
  Flattens EVERY terrain / floor / road tile to height 0, in every tileset, except the water surfaces.

  The other half of the sentence `reconcile_tile_heights/0` has always claimed. Pose-safe
  (`Catalog.set_tile_height/3`), so editor-tuned settings survive.
  """
  def flatten_ground_heights do
    flattened =
      for tileset <- Catalog.list_tilesets(),
          tile <- Catalog.list_tiles_for(tileset.key),
          tile.category in ~w(terrain floors roads),
          tile.label not in @non_flat_ground,
          (tile.height || 0) != 0,
          reduce: [] do
        acc ->
          Catalog.set_tile_height(tileset.id, tile.label, 0.0)
          [tile.label | acc]
      end

    IO.puts("flattened #{length(flattened)} ground tiles: #{Enum.join(Enum.uniq(flattened), ", ")}")
    :ok
  end

  def reconcile_tile_heights do
    emoji_id = ensure_tileset("emoji", "Emoji").id
    emoji = read_tileset("emoji.json")

    updated =
      for {label, t} <- emoji, t["category"] in ~w(buildings walls windows doors roofs props nature), reduce: 0 do
        acc ->
          {n, _} = Catalog.set_tile_height(emoji_id, label, max(1.0, t["height"] || 1))
          acc + n
      end

    IO.puts("reconciled #{updated} emoji asset-tile heights from per-tile DATA (ground = 0, standing ≥ 1)")
    :ok
  end

  @doc """
  Reconciles the `category` COLUMN of every emoji tile from emoji.json (the source of truth for a tile's
  bucket).

  emoji.json owns which sidebar bucket a tile lives in (terrain/buildings/units/nature). When a tile is
  recategorized there — e.g. the animals (bear/wolf/fox/…) that are enemies/units, NOT nature — the DB must
  follow, or the sidebar + the top-nav Unit flow keep reading the stale bucket. A full `seed_emoji_tiles`
  would land the category but `replace_all` the editor-tuned poses in `settings`, so this walks the category
  column alone (the SAME pose-safe path `reconcile_tile_heights` uses). Idempotent.
  """
  def reconcile_tile_categories do
    emoji_id = ensure_tileset("emoji", "Emoji").id
    emoji = read_tileset("emoji.json")

    updated =
      for {label, t} <- emoji, is_binary(t["category"]), reduce: 0 do
        acc ->
          {n, _} = Catalog.set_tile_category(emoji_id, label, t["category"])
          acc + n
      end

    IO.puts("reconciled #{updated} emoji tile categories")
    :ok
  end

  # Seed the two emoji leaf tiles (🍃) the tree/bush use, each pointing at its BAKED PNG so the render draws a
  # tintable image (not a raw char that can't take the per-tree canopy tint, and shows ?? on a font-less
  # machine). SURGICAL: upserts just these two emoji rows from emoji.json — never a full emoji reseed (which
  # would clobber editor-tuned poses). `leaf_center` is the tree's whole (2×) canopy; both are baked by
  # priv/tilegen (tiles.json → bake.mjs). image_url MUST be non-nil (MAP-MODEL §8 / TILE-BACKEND-MIGRATION §5).
  defp seed_tree_leaves(emoji_id, palettes) do
    emoji = read_tileset("emoji.json")
    # The canopy SHADE array per zone (green…pink for spring) — the SAME data ascii's leaf carries, so an emoji
    # tree's per-tree `variant` picks a tone (green vs pink) exactly like ascii. `color` stays for the emoji
    # sidebar/backing fill; `colors` drives the composition's variant tint.
    canopy_colors = per_zone_colors("canopy", palettes)

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
          settings: %{"color" => t["color"], "colors" => canopy_colors}
        })
    end
  end

  @doc """
  Upsert ONLY the compositions (trees, fountains, buildings), by name.

  The full `seed/0` also rewrites tile rows, and the runtime tileset carries poses tuned by hand in the editor
  that a reseed would clobber. Adding a tree shape must not cost those, so this path touches compositions and
  nothing else.
  """
  def seed_compositions do
    seed_new_compositions()
    seed_building_compositions()
    :ok
  end

  # The rail colours. A WOODEN bridge's rail is the darker wood under its own deck (`wooden_planks` is
  # #aa8250), and a STONE bridge's is the pillar tile's own stone. Both are the family's material said once,
  # not a new palette: the shared `post` tile stays charcoal for the lamp post that actually wants it.
  @wood_rail "#8a6a45"
  @stone_rail "#b9b2a3"

  @deck_rows [1, 2]
  @deck_thickness 0.09
  @rail_height 0.55
  @rail_thickness 0.3
  # The BEARERS: the beams in the channel the walkway rests on, one block BELOW it. Thicker than a rail (they
  # are carrying something) and tall enough to reach from the water up to the deck.
  @bearer_height 0.9
  @bearer_thickness 0.45
  # The POSTS at the four corners, standing proud of the rail line so the crossing has ends you can see.
  @post_height 1.05
  @post_thickness 0.28

  defp seed_new_compositions do
    for {name, %{footprint_w: w, footprint_h: h, cells: cells} = comp} <- compositions() do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: w, footprint_h: h, category: Map.get(comp, :category)},
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
          %{
            name: name,
            footprint_w: w,
            footprint_h: h,
            title: Map.get(comp, :title),
            category: Map.get(comp, :category)
          },
          cells
        )
    end
  end

  # Build a 2-tile TREE composition from the user's editor settings — one thin tall TRUNK cell + one bigger
  # LEAF cell on top. `trunk_h`/`leaf_h` are Height (scaleY), `trunk_zoom`/`leaf_zoom` are Zoom (the per-cell
  # `scale` column), `trunk_w` is Width (scaleX, only emitted when ≠ 1 so a default trunk stays byte-clean),
  # `shape` (nil | "circle") gives the canopy a round form. The leaf's LEVEL is derived from the trunk's
  # rendered height (scaleY × zoom, in block units — one level = one block) so the canopy sits ON the trunk
  # top for any height, never floating or buried. DIMENSION-SANITY GUARD: the trunk's effective width AND its zoom
  # must be strictly SMALLER than the
  # leaves' — a violating variant RAISES at build time, so no unbelievable tree can ship.
  defp tree_comp(opts) do
    trunk_w = Map.get(opts, :trunk_w, 1.0)
    leaf_w = Map.get(opts, :leaf_w, 1.0)
    assert_tree_dimensions!(trunk_w, leaf_w, opts)
    leaf_level = round(opts.trunk_h * opts.trunk_zoom)

    %{
      footprint_w: 1,
      footprint_h: 1,
      # A tree is natural cover → the `nature` bucket (the SAME category vocabulary tiles use, MAP-MODEL §8).
      category: "nature",
      cells: [
        %{dx: 0, dy: 0, level: 0, label: "trunk_mid", walkable: false, scale: opts.trunk_zoom, settings: trunk_settings(opts.trunk_h, trunk_w)},
        leaf_cell(leaf_level, opts.leaf_h, opts.leaf_zoom, Map.get(opts, :shape), true)
      ]
    }
  end

  # A BUSH is the trunkless tree variant — a SINGLE
  # leaf cell sitting on the ground (level 0), blocking (a ground-level shrub obstructs, unlike a tree's
  # walkable overhead canopy). One tile — the leanest asset in the set.
  defp bush_comp(opts) do
    # A bush is natural cover too → the `nature` bucket, exactly like the trees it is a trunkless variant of.
    %{footprint_w: 1, footprint_h: 1, category: "nature", cells: [leaf_cell(0, opts.leaf_h, opts.leaf_zoom, Map.get(opts, :shape), false)]}
  end

  defp leaf_cell(level, leaf_h, leaf_zoom, shape, walkable) do
    # The canopy defaults to a SQUARE crown (a leaf cube); a ROUND crown is OPT-IN via `shape: "circle"`
    # ("tree_round"/"bush_round"), so "tree" and "tree round" render DIFFERENTLY. An explicit shape always wins (a future conifer can pass a cone).
    settings = %{"scaleY" => leaf_h}
    settings = if shape, do: Map.put(settings, "shape", shape), else: settings
    %{dx: 0, dy: 0, level: level, label: "leaf_center", walkable: walkable, scale: leaf_zoom, settings: settings}
  end

  # Width (scaleX) rides the settings jsonb like Height (scaleY); a default-width trunk omits it so the cell
  # serialises exactly as an unsized one.
  defp trunk_settings(trunk_h, 1.0), do: %{"scaleY" => trunk_h}
  defp trunk_settings(trunk_h, trunk_w), do: %{"scaleY" => trunk_h, "scaleX" => trunk_w}

  defp assert_tree_dimensions!(trunk_w, leaf_w, opts) do
    trunk_eff_w = trunk_w * opts.trunk_zoom
    leaf_eff_w = leaf_w * opts.leaf_zoom

    unless opts.trunk_zoom < opts.leaf_zoom and trunk_eff_w < leaf_eff_w do
      raise ArgumentError,
            "tree #{inspect(opts)} violates dimension sanity: the trunk must be thinner AND less zoomed than " <>
              "the leaves (trunk_eff_w=#{trunk_eff_w} vs leaf_eff_w=#{leaf_eff_w}, trunk_zoom=#{opts.trunk_zoom} vs leaf_zoom=#{opts.leaf_zoom})"
    end

    :ok
  end

  defp compositions do
    %{
      # A tree is EXACTLY TWO tiles — ONE thin tall TRUNK + ONE bigger LEAF cube on top (the tuned
      # reference: "the ones in my example use just two tiles, one for trunk another for leafs"). Same technique
      # as the lamp post: the trunk is a single `trunk_mid` cell drawn as a thin tall pole (Height `scaleY` +
      # Zoom `scale`, Width `scaleX` when a variant wants it skinnier/thicker); the leaf is a single `leaf_center`
      # cell zoomed UP into a fat cube and lifted onto the trunk top. Colour is a per-tree SETTING (variant picks
      # a canopy shade — green…pink — from leaf_center's per-zone array, in BOTH styles). Every variant is built
      # by `tree_comp/1`, which DERIVES the leaf's level from the trunk height (canopy sits on the trunk, never
      # floats) and ENFORCES the dimension-sanity rule — the trunk must be thinner + less zoomed than the leaves or
      # the build raises. The user's
      # hand-tuned green tree (trunk H3.15/zoom0.6, leaf H2/zoom1.35) is the CENTER; the variants spread a
      # believable range: tall/small trunks, skinny/thick trunks, ROUND canopies (shape: circle), and trunkless
      # BUSHES (leaf only). Down from 3 cells to 2 (bush: 1) — the optimization the ticket asked for.
      "tree" => tree_comp(%{trunk_h: 3.15, trunk_zoom: 0.6, trunk_w: 1.0, leaf_h: 2.0, leaf_zoom: 1.35, shape: "circle"}),
      "tree_tall" => tree_comp(%{trunk_h: 4.4, trunk_zoom: 0.6, trunk_w: 0.85, leaf_h: 2.0, leaf_zoom: 1.35, shape: "circle"}),
      "tree_stub" => tree_comp(%{trunk_h: 1.7, trunk_zoom: 0.6, trunk_w: 1.2, leaf_h: 1.0, leaf_zoom: 1.35, shape: "circle"}),
      "tree_round" =>
        tree_comp(%{trunk_h: 3.15, trunk_zoom: 0.6, trunk_w: 1.0, leaf_h: 2.0, leaf_zoom: 1.35, shape: "circle"}),
      # SIZE variants: tree_small = a genuinely SMALL tree (short trunk + small canopy, was a
      # confusing legacy 5×3), tree_big = a LARGE tree (tall trunk + broad canopy). Both respect the trunk<leaf
      # dimension guard. Canopy WIDTH (leaf_zoom) is the main size read: 0.95 small vs 1.35 default vs 1.9 big.
      "tree_small" => tree_comp(%{trunk_h: 1.9, trunk_zoom: 0.5, trunk_w: 1.0, leaf_h: 1.2, leaf_zoom: 0.95, shape: "circle"}),
      "tree_big" => tree_comp(%{trunk_h: 4.2, trunk_zoom: 0.7, trunk_w: 1.0, leaf_h: 2.8, leaf_zoom: 1.9, shape: "circle"}),
      "bush" => bush_comp(%{leaf_h: 1.2, leaf_zoom: 1.35}),
      "bush_round" => bush_comp(%{leaf_h: 1.2, leaf_zoom: 1.35, shape: "circle"}),
      # MORE SPECIES, FROM THE SAME BASE. Every one below is `tree_comp/1` with different proportions, so each still
      # passes the trunk-thinner-than-leaves guard and stamps through the same two-tile path. Only `square` and
      # `circle` crowns are drawable today, so the silhouette comes from the proportions, not a new shape.
      #
      # STILL SQUARE, and on purpose. a canopy that is a CUBE reads wrong, so every
      # round-crowned species above now says so. A conifer and a cypress are NOT round, they are cones, and
      # `circle` would be just as wrong the other way. The renderer draws `square` and `circle` and nothing
      # else, so these two keep the box until a cone exists. Filed rather than fudged.
      # conifer: a tall narrow crown on a thin trunk (reference image #12, the hillside conifers)
      "tree_conifer" => tree_comp(%{trunk_h: 3.8, trunk_zoom: 0.45, trunk_w: 0.8, leaf_h: 3.4, leaf_zoom: 0.9}),
      # column: a long straight bare trunk with the crown held high (image #11's beech stand, #15's giants)
      "tree_column" => tree_comp(%{trunk_h: 5.0, trunk_zoom: 0.5, trunk_w: 0.8, leaf_h: 2.2, leaf_zoom: 1.2, shape: "circle"}),
      # broadleaf: short trunk under a wide, low, round crown
      "tree_broadleaf" =>
        tree_comp(%{trunk_h: 2.4, trunk_zoom: 0.55, trunk_w: 1.1, leaf_h: 1.7, leaf_zoom: 1.75, shape: "circle"}),
      # gnarled: a squat trunk under a flat spreading crown — the lone pasture tree of image #10
      "tree_gnarled" =>
        tree_comp(%{trunk_h: 2.0, trunk_zoom: 0.6, trunk_w: 1.15, leaf_h: 1.3, leaf_zoom: 1.85, shape: "circle"}),
      # giant: the jungle emergent, taller and broader than anything around it
      "tree_giant" =>
        tree_comp(%{trunk_h: 5.8, trunk_zoom: 0.75, trunk_w: 1.1, leaf_h: 2.8, leaf_zoom: 2.1, shape: "circle"}),
      # cypress: a thick buttressed trunk and a modest crown — the trees standing in the water of image #13
      "tree_cypress" => tree_comp(%{trunk_h: 3.4, trunk_zoom: 0.8, trunk_w: 1.3, leaf_h: 1.8, leaf_zoom: 1.3}),
      # palm: a tall skinny trunk with a small round top, for coastal and island ground
      "tree_palm" =>
        tree_comp(%{trunk_h: 4.6, trunk_zoom: 0.4, trunk_w: 0.7, leaf_h: 1.0, leaf_zoom: 1.15, shape: "circle"}),
      # sapling: new growth, the smallest tree there is
      "tree_sapling" => tree_comp(%{trunk_h: 1.2, trunk_zoom: 0.35, trunk_w: 0.8, leaf_h: 0.9, leaf_zoom: 0.7, shape: "circle"}),
      # THE TROPICS. and, when I called it
      # blocked on art:
      #
      # It is right and I was wrong. A species here is proportions, not a new picture: the file says so itself
      # a few lines up, So these three are the
      # same two-tile `tree_comp` every other species is.
      #
      # coconut: taller and leaner than the palm, its small crown held right at the top
      "tree_coconut" => tree_comp(%{trunk_h: 5.4, trunk_zoom: 0.38, trunk_w: 0.65, leaf_h: 1.1, leaf_zoom: 1.3, shape: "circle"}),
      # banana: a short fat pseudo-stem under enormous low leaves, wider than it is tall
      "tree_banana" => tree_comp(%{trunk_h: 1.6, trunk_zoom: 0.5, trunk_w: 0.9, leaf_h: 1.6, leaf_zoom: 1.95, shape: "circle"}),
      # mangrove: the for a coast, a thick braced base under a broad low crown
      "tree_mangrove" => tree_comp(%{trunk_h: 2.2, trunk_zoom: 0.7, trunk_w: 1.25, leaf_h: 1.5, leaf_zoom: 1.8, shape: "circle"}),
      # TWO water variants of the town-square basin, both COMPOSITIONS assembled from AUTOTILE PIECES
      # (TILESET-AUTHORING §3), not one fill: a rim of the RIGHT edge/corner piece per cell (`fountain_tl/tr/
      # bl/br` corners + `fountain_t/b/l/r` sides) around a `water_c` (blue water) interior. Every cell blocks
      # (you stroll the paved ring around it); the generator stamps one centred on the plaza (stampComposition).
      #
      # `well` — the SMALL variant:
      #   a 5×3 basin whose interior is a 1×3 LINE of 3 `water_c` cells, ALL 3 animated (desynced height-grow).
      # `fountain` — the LARGE variant: a 5×5 basin whose interior
      # is a 3×3 GRID of 9 `water_c` cells; only the CENTER ROW of 3 animates, the other 6 are STATIC blue water.
      # A basin is a standalone ornament → the `props` bucket (same category vocabulary as tiles, MAP-MODEL §8).
      # BRIDGES ARE COMPOSITIONS, like a tree or a building. in capitals after asking
      # twice: with a
      # wooden arch (#59), a steel truss (#60) and a sheet of ten variations (#61).
      #
      # What a crossing was until now: ONE FLAT TILE laid per cell. Measured in the running app, a wood crossing
      # came out as 87 cells of flat `rgba(120,90,50,0.95)` floor, which is the whole of
      # and of: a big colour patch, no structure.
      #
      # A bridge is a DECK you walk on with RAILS either side, so it reads as built from any angle. Three spans
      # each (3 / 5 / 7 cells), the same way `house_3`/`house_4`/`house_5` are the one composer called at fixed
      # sizes: the generator picks the span that fits its channel. Every tile here already exists, so none of
      # this needs new art. The steel truss of #60 does, and it is not attempted here.
      # Spans 3 to 7. The EVEN ones exist because a span has to match the river, not round up past it:
      # when we only have to connect a small river?? we just need something like 4 cells long x whatever the river
      # size"*, and With only odd spans authored, a 4-wide river needed 4 plus a landing each side and rounded
      # straight up to 7, which is the size it rejected.
      "bridge_wood_3" => %{footprint_w: 3, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 3, @wood_rail)},
      "bridge_wood_4" => %{footprint_w: 4, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 4, @wood_rail)},
      "bridge_wood_5" => %{footprint_w: 5, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 5, @wood_rail)},
      "bridge_wood_6" => %{footprint_w: 6, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 6, @wood_rail)},
      "bridge_wood_7" => %{footprint_w: 7, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 7, @wood_rail)},
      "bridge_stone_3" => %{footprint_w: 3, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 3, @stone_rail)},
      "bridge_stone_4" => %{footprint_w: 4, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 4, @stone_rail)},
      "bridge_stone_5" => %{footprint_w: 5, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 5, @stone_rail)},
      "bridge_stone_6" => %{footprint_w: 6, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 6, @stone_rail)},
      "bridge_stone_7" => %{footprint_w: 7, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 7, @stone_rail)},
      "bridge_plank_3" => %{footprint_w: 3, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 3, @wood_rail)},
      "bridge_plank_4" => %{footprint_w: 4, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 4, @wood_rail)},
      "bridge_plank_5" => %{footprint_w: 5, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 5, @wood_rail)},
      "bridge_plank_6" => %{footprint_w: 6, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 6, @wood_rail)},
      "bridge_plank_7" => %{footprint_w: 7, footprint_h: 4, category: "props", cells: bridge_cells("bridge_deck", "bridge_rail", 7, @wood_rail)},
      "well" => %{footprint_w: 5, footprint_h: 3, category: "props", cells: well_cells()},
      "fountain" => %{footprint_w: 5, footprint_h: 5, category: "props", cells: fountain_cells()},
      # LIGHT POSTS — a composition, NOT a single lamp tile. ONE 1×1 column of TWO cells, each shaped by its OWN tuned
      # settings so it reads like a
      # REAL post:
      #   • POST (level 0, blocks) — ONE cell drawn as a tall, THIN pole: Height `scaleY` 7 at Zoom `scale` 0.3.
      #   • BULB (level 1, walkable overhead) — a SINGLE-display billboard (one centered bulb), Zoom `scale` 0.6,
      #     lifted by `pose.dy` -1.8 so it sits ON TOP of the tall post, carrying the night `light` glow POOL.
      # TWO variants share this whole structure (lamp_post_composition/1) — the bulb ALWAYS carries the
      # night-LIT appearance change;
      # only the FAILING variant adds a flicker on top:
      #   • `lamp_post`         → the DEFAULT (MAJORITY of lamps): the bulb LIGHTS UP at night — a STEADY warm
      #     glow via ONE `night`-triggered `color` animation (day = the plain unlit bulb, night = lit), NO flicker.
      #   • `lamp_post_failing` → a FAILING bulb (MINORITY, ~18%): the SAME night-lit glow PLUS the irregular
      #     `lamp_flicker_anim` (a stepped, erratic opacity dip — a dying bulb, NOT a smooth pulse). Its ground
      #     pool dims in SYNC with the flicker (the frontend folds the bulb's live opacity into the pool
      # intensity — see LIGHTING.md, ).
      # The browseable palette shows ONE "Lamp post" (category "props"); the FAILING variant is a generator-only
      # flavour (~18% of stamped lamps), so it carries NO category → it renders on the map but is NOT a duplicate
      # palette entry.
      "lamp_post" => lamp_post_composition([bulb_night_lit_anim()], "props"),
      "lamp_post_failing" => lamp_post_composition([bulb_night_lit_anim(), lamp_flicker_anim()], nil)
    }
  end

  # A light-post composition (post base + bulb on top), shared by the steady + failing variants. `bulb_animations`
  # is the bulb cell's `night`-triggered animation list: BOTH variants pass `[bulb_night_lit_anim()]` (the steady
  # night glow — the default lamp), and the failing variant appends `lamp_flicker_anim()` (the irregular dip) on
  # top. `nil` → no animation (kept for callers that want a plain bulb). Everything else — structure, the tuned
  # post/bulb settings, the `light` glow pool — is IDENTICAL, so a failing lamp is a lit lamp whose bulb flickers.
  # The STRUCTURE is style-agnostic (only the baked `post`/`lamp` ART differs per style).
  defp lamp_post_composition(bulb_animations, category) do
    # `light` is a real, controllable SETTING: the bulb
    # casts a warm ground GLOW POOL at night, sized by `distance` (cells), strengthened/tinted by `intensity`/
    # `color`. `color` is a SATURATED warm gold (#ffc24d) so the pool reads as a real LIT lamp, not a pale wash
    # ; it matches the frontend LAMP_GLOW default.
    bulb =
      %{
        dx: 0,
        dy: 0,
        level: 1,
        label: "lamp",
        walkable: true,
        # The bulb reads as a real lamp head — ONE centered billboard at Zoom `scale` 0.6,
        # lifted onto the post top by `pose.dy` -1.8. NO dark base tint: it shows the `lamp` tile's own art (the
        # pale bulb of #43); the night-lit `color` animation last-wins-tints it warm gold at night.
        scale: 0.6,
        settings: %{
          "display" => "single",
          "pose" => %{"dy" => -1.8},
          "light" => %{"intensity" => 1.0, "distance" => 3.2, "color" => "#ffc24d", "on" => true}
        }
      }

    # A steady bulb carries NO animation key at all; only the failing variant attaches the flicker.
    bulb = if bulb_animations, do: Map.put(bulb, :animations, bulb_animations), else: bulb

    %{
      footprint_w: 1,
      footprint_h: 1,
      # Category is passed in: "props" for the browseable default lamp, nil for the generator-only failing variant.
      category: category,
      cells: [
        %{dx: 0, dy: 0, level: 0, label: "post", walkable: false, scale: 0.3, settings: %{"scaleY" => 7.0}},
        bulb
      ]
    }
  end

  # DRAW-PRIORITY (`z_index`, CSS style) is a per-cell CAPABILITY, not a default. `composition_cells.z_index`
  # (served as `zIndex`) lets a cell draw LATER (on top / in front), overriding the positional depth sort in
  # every view (iso `isoDepthCompare`, 2D, top), and is authored as DATA on the cell via the editor's Z-Index
  # control. It's kept for the upcoming COMPOSITION-OPTIMIZATION work (e.g. a basin rim occluding the water it
  # contains — see ANIMATION-SYSTEM.md → "z-index draw priority (a capability for composition optimization)").
  # But NOTHING carries a non-zero z_index by DEFAULT right now: every cell keeps the column default 0 and
  # sorts positionally.

  # The fountain/well WATER's DEFAULT ANIMATION — the height-GROW yoyo, now DESYNCED per column so the
  # water does NOT pulse in unison. EXACTLY 3 water columns animate in every variant — all 3 in
  # the small `well`, the CENTER ROW of 3 in the large `fountain`. Each of the 3 carries the
  # SAME 1→4 sine-yoyo grow but with a DISTINCT durationMs + startDelayMs, so their yoyo PERIODS differ (no two
  # ever share a phase) and they surge out of sync:
  #
  #   column 0 → dur 1000ms, delay   0ms   (period 2·1000+400 = 2400ms)
  #   column 1 → dur 1400ms, delay 800ms   (period 2·1400+400 = 3200ms)
  #   column 2 → dur 1800ms, delay 400ms   (period 2·1800+400 = 4000ms)
  #
  # Distinct durations → distinct periods → the columns drift permanently out of phase; the distinct delays add
  # an immediate visual offset at t=0. Each "grow" leg: height (scaleY) 1→4 blocks over `durationMs`, then the
  # yoyo auto-reverses 4→1 over another `durationMs`, then the 400ms loopDelay tail RESTS at the base (1 block)
  # before the next surge; sine ease-in-out. `height` maps to scaleY → the column grows UP in place (no
  # levitation, no opacity fade). ONE track / ONE setting (height) → no winner-takes-all conflict. loopDelay
  # (400) + the 1→4 sine yoyo are shared; only duration+delay desync. The exact `Animation` envelope the
  # frontend reads (camelCase, served verbatim; stampRun copies it onto the placed asset's `animations`).
  @water_grow_durations {1000, 1400, 1800}
  @water_grow_delays {0, 800, 400}

  # The height-grow animation for animated water COLUMN `i` (0..2) — the shared 1→4 sine yoyo with column `i`'s
  # DISTINCT duration + start delay (the desync spread above). Returned as a one-element list (the cell's
  # `animations`).
  defp water_grow_anim(i) do
    [
      %{
        "id" => "fountain_water_grow",
        "name" => "grow",
        "kind" => "settings",
        "durationMs" => elem(@water_grow_durations, i),
        "startDelayMs" => elem(@water_grow_delays, i),
        "loopDelayMs" => 400,
        "loop" => true,
        "yoyo" => true,
        "ease" => "sine",
        "priority" => 1,
        "trigger" => %{"on" => "load"},
        "tracks" => [
          %{"setting" => "height", "from" => 1, "to" => 4}
        ]
      }
    ]
  end

  # The lamp bulb's DEFAULT night-LIT appearance change. BOTH lamp variants carry this — it's the normal lamp
  # behaviour: at night the
  # bulb visibly LIGHTS UP, STEADY (not flickering); in day it's the plain unlit bulb. Settings-driven, NOT a
  # render special-case — ONE `night`-triggered `color` animation that HOLDS a warm glow (`from` == `to`, so it's
  # a constant value, not a tween). The render bridge (resolveAssetAnimation) gates `night` triggers to night
  # mode, so in DAY the animation is dropped → the bulb shows its base (unlit) art, and at NIGHT the `color`
  # last-wins-tints the bulb art warm (luminance-mapped) → a lit, glowing bulb. `#ffd257` = a SATURATED warm
  # gold so the lit bulb POPS as clearly "on",
  # not the pale wash the earlier `#ffe9a0` gave. Pure DATA — tune the colour/trigger on the cell, no render
  # special-casing.
  defp bulb_night_lit_anim do
    %{
      "id" => "lamp_night_lit",
      "name" => "lit at night",
      "kind" => "settings",
      "durationMs" => 1000,
      "loop" => true,
      "yoyo" => false,
      "ease" => "linear",
      "priority" => 0,
      "trigger" => %{"on" => "night"},
      "tracks" => [
        %{"setting" => "color", "from" => "#ffd257", "to" => "#ffd257"}
      ]
    }
  end

  # The FAILING lamp bulb's ADDITIONAL animation — a single irregular OPACITY flicker. ONLY the `lamp_post_failing`
  # variant carries this
  # (on TOP of the shared night-lit glow); the default `lamp_post` bulb is STEADY-lit at night, no flicker. It
  # runs through the EXISTING animation engine (the SAME cell-default path the fountain water uses):
  #   • ONE opacity track 1 → 0.12 with `ease: "flicker"` — the frontend's irregular, STEPPED failing-bulb
  #     envelope (`tileAnimation.flickerEase`), NOT a smooth sine yoyo: mostly ON with brief, erratic dips of
  #     varying depth + occasional full-off blinks at irregular times. `loop: true`, `yoyo: false` (the flicker
  #     ease supplies the erratic shape; a yoyo would just smooth it back out). `opacity` and the night-lit
  #     `color` are DIFFERENT settings, so the two animations compose — the failing bulb is lit AND flickering.
  # `night`-triggered: the
  # render bridge (resolveAssetAnimation) gates it to night mode, so the bulb rests static in day and flickers at
  # night. The ground light POOL follows it — the frontend folds this bulb's live opacity into the pool intensity
  # so the pool dims on the SAME beat.
  # Pure DATA — tune the timing/depth/trigger on the cell, no render special-casing.
  defp lamp_flicker_anim do
    %{
      "id" => "lamp_flicker",
      "name" => "failing bulb",
      "kind" => "settings",
      "durationMs" => 2600,
      "loopDelayMs" => 0,
      "loop" => true,
      "yoyo" => false,
      "ease" => "flicker",
      "priority" => 1,
      "trigger" => %{"on" => "night"},
      "tracks" => [
        %{"setting" => "opacity", "from" => 1, "to" => 0.12}
      ]
    }
  end

  # ── Fountain / well basins (autotile rim + water_c interior) ──────────────
  # Both variants: the perimeter is the correct rim EDGE/CORNER piece (`basin_rim`), the interior is `water_c`
  # (blue water) drawn a bit bigger (scale 1.15) — no `water_jet` drops. EXACTLY 3 water columns animate (the
  # desynced height-grow, `water_grow_anim`); the rim never animates. Pure data.

  # The SMALL well: a 5×3 basin with a 1×3 LINE of 3 water cells (dy 1, dx 1..3), ALL animated (desynced by
  # column index dx-1 = 0..2).
  # ONE bridge, at a given span: a walkable DECK down the middle with a RAIL either side.
  #
  # `dy 1` is the deck, `dy 0` and `dy 2` the rails, so the footprint is span x 3 and you cross along +dx.
  #
  # THE DECK IS FLAT, AND IT HAS TO SAY SO PER CELL. The deck tile (`wooden_planks`) is height 0 in
  # the catalog and it made no difference, because `compositionCellRender` assigns `height: 1` to EVERY
  # composition cell on purpose ("a tile is pure ART — it does NOT carry height"). So each plank extruded into
  # a cube and the bridge came out a row of open crates. `scaleY` is the per-cell mechanism that already
  # exists for exactly this (the lamp post is one cell drawn seven tall), so the deck states its own thinness.
  #
  # THE RAILS ARE ONE TILE EACH, NOT ONE PER CELL. with the doors as the model. A rail is a single cell given `depth:
  # span` along
  # the crossing axis, which is the same directional-depth a roof deck uses: two tiles for two rails at any
  # span, instead of `2 x span` cubes. `scaleZ` keeps it a thin panel on the deck's edge rather than a wall,
  # and `scaleY` keeps it hand height rather than a full block.
  #
  # A WOODEN BRIDGE HAS WOODEN RAILS. `post` is shared with the lamp post and is authored charcoal (#43474d),
  # which is right for a lamp and wrong here, so the CELL states its colour (the per-cell `settings.color` the
  # stamp already honours) rather than the shared tile being repainted for one caller.
  defp bridge_cells(deck_label, rail_label, span, rail_color) do
    last_row = List.last(@deck_rows) + 1

    # A BRIDGE IS BUILT IN LAYERS, like everything else here. Four of them, bottom to top:
    #
    #   level -1  BEARERS   the beams down in the channel that hold the thing up
    #   level  0  WALKWAY   the planks, two rows so two can pass
    #   level  0  RAILS     a thin panel down each side
    #   level  0  POSTS     uprights at the four corners, standing above the rail line
    #
    # It used to be one flat layer of planks with a rail beside it, which reads as a plank laid on the ground
    # rather than as a structure spanning a river.

    # LAYER -1 — THE BEARERS. One per walking row, spanning the crossing through z-width, a block below the
    # deck so they sit IN the channel. No collision: nothing walks at that level, and the ground course is the
    # only one that may write to the 2D collision map.
    bearers =
      for dy <- @deck_rows do
        %{dx: 0, dy: dy, level: -1, label: rail_label, walkable: true,
          settings: %{
            "scaleY" => @bearer_height,
            "scaleZ" => @bearer_thickness,
            # WHICH WAY IT IS THIN. Without a direction, `scaleZ` stays the old screen-axis squash, which
            # thins along no world axis at all and leaves a z-width beam reading as displaced from the deck
            # it belongs to. Naming the side it hugs makes it a world-axis panel, the same as a door.
            "thicknessDir" => "left-down",
            "depth" => span,
            "depthDir" => "right-down",
            "color" => rail_color
          }}
      end

    # LAYER 0 — THE WALKWAY. Two rows, so two can pass, and each row is ONE tile that z-widths the whole
    # crossing. It used to be `span` separate planks per row, which is 2×span tiles for a surface that is one
    # flat run: *"you can use less tiles to make the sides too, with z-width"*. A span-7 bridge goes from 18
    # tiles to 10, and the deck draws as one solid top with no column seams down the middle of the walkway.
    deck =
      for dy <- @deck_rows do
        %{dx: 0, dy: dy, level: 0, label: deck_label, walkable: true,
          settings: %{"scaleY" => @deck_thickness, "depth" => span, "depthDir" => "right-down"}}
      end

    # LAYER 0 — THE RAILS. One cell per side spanning the crossing through z-width, thinned to a DOOR's
    # thickness: `scaleZ` 0.3 is what the `door` tile carries, so a rail is the same kind of panel a door is
    # rather than a wall of its own invention. The collision is that size too: a rail blocks the strip it
    # occupies, not its whole cell.
    rails =
      for {dy, hug} <- [{0, "right-up"}, {last_row, "left-down"}] do
        %{dx: 0, dy: dy, level: 0, label: rail_label, walkable: false,
          settings: %{
            "scaleY" => @rail_height,
            "scaleZ" => @rail_thickness,
            # Each rail hugs the OUTER edge of its own row, so the pair frames the walkway instead of sitting
            # in the middle of it. `scaleZ` alone has no world direction, so it squashed on the screen axis
            # and the rail read as floating beside the deck rather than running along its edge.
            "thicknessDir" => hug,
            "depth" => span,
            "depthDir" => "right-down",
            "color" => rail_color,
            "collision" => [%{"x" => 0.0, "y" => 0.35, "w" => 1.0, "h" => @rail_thickness}]
          }}
      end

    # LAYER 0 — THE POSTS. Taller than the rail and thin on both ground axes, so each end of the crossing has
    # an upright rather than the railing simply stopping.
    #
    # Thin by REACH, not by scale. `scaleX`/`scaleZ` squash the drawn diamond on the SCREEN axes, so a post
    # keeps its shape only while the camera is at its default corner and shears the moment the map is turned:
    # *"you're using width instead of z-width to control the sides and structure, hence why it looks bad"*.
    # A reach is a WORLD axis, the same thing a door states, so the post stays a post at all four facings.
    posts =
      for dx <- [0, span - 1], dy <- [0, last_row] do
        %{dx: dx, dy: dy, level: 0, label: "post", walkable: false,
          settings: %{
            "scaleY" => @post_height,
            "thickness" => post_reach(@post_thickness),
            "color" => rail_color
          }}
      end

    bearers ++ deck ++ rails ++ posts
  end

  # A block CENTRED in its cell and `width` of it across, on BOTH ground axes — the four reaches that say so.
  # A reach is measured from the cell's far boundary, so the pair on one axis has to sum past 1 to leave the
  # block any body at all: centring `width` means each side reaches (1 + width) / 2.
  defp post_reach(width) do
    reach = (1 + width) / 2
    %{"left-up" => reach, "right-down" => reach, "right-up" => reach, "left-down" => reach}
  end

  defp well_cells do
    w = 5
    h = 3
    basin_rim(w, h) ++ for dx <- 1..(w - 2), do: water_cell(dx, 1, dx - 1)
  end

  # The LARGE fountain: a 5×5 basin with a 3×3 GRID of 9 water cells (dx,dy 1..3). Only the CENTER ROW (dy 2)
  # animates (desynced by column index dx-1 = 0..2); the other 6 cells are STATIC blue water.
  defp fountain_cells do
    w = 5
    h = 5

    water =
      for dy <- 1..(h - 2), dx <- 1..(w - 2) do
        if dy == 2, do: water_cell(dx, dy, dx - 1), else: static_water_cell(dx, dy)
      end

    basin_rim(w, h) ++ water
  end

  # The rim EDGE/CORNER pieces around a w×h basin — the `fountain_*` autotile border, reused by both variants.
  # The rim keeps the default draw priority (z_index 0), sorting positionally like every other cell.
  defp basin_rim(w, h) do
    for dy <- 0..(h - 1),
        dx <- 0..(w - 1),
        edge_cell?(dx, dy, w, h),
        do: %{
          dx: dx,
          dy: dy,
          level: 0,
          label: edge_piece("fountain", dx, dy, w, h),
          walkable: false
        }
  end

  # An ANIMATED interior water cell (blue `water_c`, scale 1.15) carrying animated column `i`'s desynced
  # height-grow. Draw priority stays at the default 0 (sorts positionally).
  defp water_cell(dx, dy, i) do
    %{
      dx: dx,
      dy: dy,
      level: 0,
      label: "water_c",
      walkable: false,
      scale: 1.15,
      animations: water_grow_anim(i)
    }
  end

  # A STATIC interior water cell — same blue `water_c` look (scale 1.15) but NO animation (the 6 non-centre
  # cells of the large fountain). Its height stays 1 block. Draw priority stays at the default 0.
  defp static_water_cell(dx, dy) do
    %{
      dx: dx,
      dy: dy,
      level: 0,
      label: "water_c",
      walkable: false,
      scale: 1.15
    }
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

  # A label that REUSES another's behaviour (wooden-door → door) must do so in EVERY style. Resolving the
  # reuse HERE rather than at each call site is what fixes the emoji `wooden-door`, which was seeded through a
  # path that passed the raw label and so rendered as a full cube while the ascii twin was a thin panel —
  # the same tile, two behaviours.
  defp merge_behavior(settings, label) do
    Map.merge(settings, Map.get(@behavior_settings, reuse_behavior_base(label), %{}))
  end

  defp read_tileset(file) do
    :nebulith
    |> Application.app_dir("priv/repo/tilesets")
    |> Path.join(file)
    |> File.read!()
    |> Jason.decode!()
  end
  # ── ENTRANCES: an exit that looks like a way somewhere else ──────────────────────────────────────────────
  #
  # *"we need a better visual indicator that 'going through this pathway goes to somewhere else', like a
  # whuite or dark light right in the exit cells"*, with a reference picture of a mossy cave mouth and the
  # list *"a forest entrance, a cave entrance, a town/city entrance, a park entrance"*.
  #
  # The reference reads as four parts, and every entrance below is built from the same four:
  #
  #     UPRIGHT   SPAN   UPRIGHT
  #        |       ===      |
  #        |      MOUTH     |          the darkest thing in the picture, and where your eye goes
  #       feet    floor    feet
  #
  # Three cells wide because that is the gate width, so an entrance covers its gate and nothing else. The
  # MIDDLE CELL STAYS WALKABLE: it is the way out. The uprights block, which is what makes it a doorway rather
  # than a decoration.
  #
  # Every piece is a real catalogue tile. Nothing is drawn for this. An earlier attempt at these was reverted
  # for being invented rather than modelled, which is the mistake the reference picture exists to stop.
  defp entrance_cells({left_upright, right_upright}, span, floor, foot_left, foot_right, opts) do
    mouth = Keyword.get(opts, :mouth, "#0d0d12")

    [
      # THE UPRIGHTS, on the border row. They block: a doorway you cannot brush past the side of. The two
      # DIFFER where the place is grown rather than built, which is what stops a wood's opening reading as
      # something somebody put there. A town's are a matched pair for the same reason, in reverse.
      #
      # NO COLOUR IS SET HERE. A boulder is already the colour a boulder is, a pillar the colour a pillar is,
      # and that colour is a setting on the tile you can change. Recolouring them from this function would be
      # inventing a palette in code and taking the setting away from the thing that owns it: an object is a
      # construction of tiles, and each tile brings its own.
      #
      # DRAWN AS THE THING, NOT AS A BOX. Every tile defaults to a CUBE SHELL with its picture on the faces,
      # which is why the first attempt came out as a stack of coloured bricks: *"what the hell is that ugly
      # tetris piece"*. `display: single` + `transparent` drops the shell and draws the piece itself, which is
      # how every prop in this engine that reads as an object is set up.
      %{dx: 0, dy: 0, level: 0, label: left_upright, walkable: false,
        settings: %{"display" => "single", "transparent" => true}},
      %{dx: 2, dy: 0, level: 0, label: right_upright, walkable: false,
        settings: %{"display" => "single", "transparent" => true}},
      # THE MOUTH: a dark patch on the GROUND under the arch, not a dark block standing in it.
      #
      # It was a block. A composition cell carries its tile's own height, so a floor label stamped as a cell
      # came out a full cube tall and painted near-black: a black box in the gateway, which is what the first
      # render showed. `scaleY` flattens it to a stain on the floor, the same way the bridge deck is a plank
      # rather than a brick, and then the darkness reads as the opening it is meant to be.
      #
      # The colour is the one this function sets, and it is the feature itself: *"a whuite or dark light right
      # in the exit cells"*. It sits in the cell's settings like every other per-cell setting, so it is
      # editable on the object.
      %{
        dx: 1,
        dy: 0,
        level: 0,
        label: floor,
        walkable: true,
        settings: %{
          "color" => mouth,
          "scaleY" => 0.06,
          "light" => %{"intensity" => 0.85, "distance" => 2.4, "color" => mouth, "on" => true}
        }
      },
      # THE SPAN: an arch ACROSS all three cells, so it springs from one upright and lands on the other.
      #
      # It was one piece at level 1 over the middle cell, which hung in the air touching nothing. Z-width is
      # how this engine makes one tile cover several cells, and three cells at level 1 is exactly the arch the
      # reference shows: it rests on both uprights and bridges the mouth between them.
      %{
        dx: 0,
        dy: 0,
        level: 1,
        label: span,
        walkable: true,
        settings: %{
          "depth" => 3,
          "depthDir" => "right-down",
          "scaleY" => 0.55,
          "display" => "single",
          "transparent" => true
        }
      },
      # THE FEET, one step inside, crowding the uprights so the thing looks grown rather than placed.
      %{dx: 0, dy: 1, level: 0, label: foot_left, walkable: true, scale: 0.7, settings: %{"display" => "single", "transparent" => true}},
      %{dx: 2, dy: 1, level: 0, label: foot_right, walkable: true, scale: 0.7, settings: %{"display" => "single", "transparent" => true}}
    ]
  end

  @doc """
  The four entrances he named, as compositions.

  Each carries a `category` so it shows up in the objects palette and can be dropped anywhere, which is the
  workflow he described: *"any time we add a new functionality it just becomes a new object we can just place
  and play with"*.
  """
  @doc """
  THE APPROVED ENTRANCES, built the way the objects he likes are built.

  NAMED FOR WHAT THEY ARE: *"we need to rename them to temple entrance, cave entrance cube cave entrance
  rounded ... in short, always name in relation to the object itself"* (2026-09-14). `forest_entrance` was the
  old name and it named a PLACE rather than an object, which is why it ended up holding a cave.

  THE METHOD, measured off `lamp_post`, `tree_round`, `house_4`, `well` and `fountain`:

    * PROPORTION does the work, not the display mode. A cell's drawn height in levels is `scale * scaleY`, so
      the next piece stacks at that level, not at the one you meant. No `display: single`, no `transparent`:
      of 824 composition cells, the only ones carrying those were the entrances that got rejected.
    * `depth` SPANS. `house_4`'s roof is one cell reaching four. The temple's lintel and the cave's overhang
      are the same trick.
    * `shape: circle` makes a MASS. The tree canopy was the only user; rock lumps as circles merge into one
      organic outcrop instead of reading as a stack of boxes. That one setting is the whole difference between
      `cave_entrance_cube` and `cave_entrance_rounded`, which is why they share a builder.

  AND THE ISOMETRIC FACT THAT DECIDED THE LAYOUT: screen depth is `col + row`, so cells in the same ROW sit at
  different depths and a row-shaped face is drawn over by its own near end. A façade that reads flat toward the
  camera lies on a constant `col + row`. The cave's mouth sits in the middle of that diagonal with the mass
  BEHIND it; before that it was at depth 3 while the mound's near corner was at depth 6, and the cave was drawn
  in front of its own opening.
  """
  def seed_approved_entrances do
    for {name, comp} <- %{
          "temple_entrance" => %{w: 3, h: 2, cells: temple_entrance_cells()},
          "cave_entrance_cube" => %{w: 5, h: 5, cells: cave_entrance_cells(false)},
          "cave_entrance_rounded" => %{w: 5, h: 5, cells: cave_entrance_cells(true)}
        } do
      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: comp.w, footprint_h: comp.h, category: "props"},
          comp.cells
        )
    end

    :ok
  end

  # A BUILT gateway: two piers of real mass, a lintel that oversails them, a dark opening between, foliage over
  # the top and stones at the feet. Post, lintel, post, which is exactly what a cave must NOT be.
  defp temple_entrance_cells do
    pier = fn dx -> %{dx: dx, dy: 0, level: 0, label: "wall_stone_c", walkable: false, scale: 1.0,
                      settings: %{"scaleY" => 3.0}} end

    [
      pier.(0),
      pier.(2),
      # The opening. Dark, and WALKABLE because it is the way through.
      %{dx: 1, dy: 0, level: 0, label: "wall_stone_c", walkable: true, scale: 1.0,
        settings: %{"scaleY" => 2.35, "color" => "#12100e"}},
      # The lintel: ONE cell reaching across all three, and wider than the piers so it reads as a cap.
      %{dx: 0, dy: 0, level: 3, label: "wall_stone_c", walkable: false, scale: 1.12,
        settings: %{"scaleY" => 0.62, "depth" => 3, "depthDir" => "right-down"}},
      %{dx: 0, dy: 0, level: 4, label: "leaf_center", walkable: false, scale: 0.95,
        settings: %{"scaleY" => 0.95, "shape" => "circle"}},
      %{dx: 1, dy: 0, level: 4, label: "leaf_center", walkable: false, scale: 0.7,
        settings: %{"scaleY" => 0.8, "shape" => "circle"}},
      %{dx: 2, dy: 0, level: 4, label: "leaf_center", walkable: false, scale: 0.8,
        settings: %{"scaleY" => 0.95, "shape" => "circle"}},
      %{dx: 0, dy: 1, level: 0, label: "rock", walkable: false, scale: 0.5, settings: %{"scaleY" => 0.8}},
      %{dx: 2, dy: 1, level: 0, label: "rock", walkable: false, scale: 0.4, settings: %{"scaleY" => 0.7}},
      %{dx: 1, dy: 1, level: 0, label: "path_dirt", walkable: true, scale: 1.0, settings: %{"scaleY" => 0.08}}
    ]
  end

  # The cave FACE lies on this anti-diagonal (dx + dy). Everything with a smaller sum is the mass behind it;
  # anything larger would be drawn in front of the mouth, so only low scatter goes there.
  @cave_face 4
  @cave_mouth {2, 2}

  # ONE layout, two objects. `rounded` is the only difference: it turns every rock block into a `circle`, and
  # the lumps then merge into a continuous outcrop instead of reading as stacked boxes.
  defp cave_entrance_cells(rounded) do
    rock = fn dx, dy, scale, h ->
      settings = if rounded, do: %{"scaleY" => h, "shape" => "circle"}, else: %{"scaleY" => h}
      %{dx: dx, dy: dy, level: 0, label: "wall_stone_c", walkable: false, scale: scale, settings: settings}
    end

    {mouth_dx, mouth_dy} = @cave_mouth

    # THE MASS, sloping down toward the viewer over four diagonals.
    bulk =
      for {d, {scale, h}} <- %{0 => {0.75, 1.0}, 1 => {1.0, 1.9}, 2 => {1.15, 2.6}, 3 => {1.15, 2.4}},
          dx <- 0..4,
          dy = d - dx,
          dy >= 0 and dy <= 4,
          do: rock.(dx, dy, scale, h)

    # THE FACE, flanking the mouth. The two beside it stand tallest so the opening reads as cut INTO rock.
    face =
      for dx <- 0..4,
          dy = @cave_face - dx,
          dy >= 0 and dy <= 4,
          {dx, dy} != @cave_mouth do
        near? = abs(dx - mouth_dx) == 1
        rock.(dx, dy, if(near?, do: 1.1, else: 0.85), if(near?, do: 1.9, else: 1.2))
      end

    lip_settings =
      %{"scaleY" => 0.7, "depth" => 3, "depthDir" => "right-up"}
      |> then(&if rounded, do: Map.put(&1, "shape", "circle"), else: &1)

    bulk ++
      face ++
      [
        # THE MOUTH: full cell width, tall, dark, walkable. It is the object's whole point.
        %{dx: mouth_dx, dy: mouth_dy, level: 0, label: "wall_stone_c", walkable: true, scale: 1.0,
          settings: %{"scaleY" => 2.3, "color" => "#141109"}},
        # THE OVERHANG: one block spanning the three face cells ALONG the diagonal, which is the roof's
        # `depth` trick pointed at the other axis.
        %{dx: 1, dy: 3, level: 2, label: "wall_stone_c", walkable: false, scale: 1.25, settings: lip_settings},
        # TREES GROWING OUT of the mound, seated on the tall back diagonal rather than floating over it.
        %{dx: 1, dy: 1, level: 3, label: "trunk_mid", walkable: false, scale: 0.32, settings: %{"scaleY" => 2.8}},
        %{dx: 1, dy: 1, level: 4, label: "leaf_center", walkable: false, scale: 1.15,
          settings: %{"scaleY" => 1.2, "shape" => "circle"}},
        %{dx: 2, dy: 1, level: 3, label: "trunk_mid", walkable: false, scale: 0.28, settings: %{"scaleY" => 2.2}},
        %{dx: 2, dy: 1, level: 4, label: "leaf_center", walkable: false, scale: 0.95,
          settings: %{"scaleY" => 1.2, "shape" => "circle"}},
        # SCATTER on the open ground, small enough that it never hides the mouth.
        rock.(0, 4, 0.5, 0.45),
        rock.(4, 1, 0.45, 0.4),
        rock.(3, 3, 0.4, 0.36),
        rock.(4, 2, 0.35, 0.32),
        # THE THRESHOLD you walk in on.
        %{dx: 2, dy: 3, level: 0, label: "path_dirt", walkable: true, scale: 1.0, settings: %{"scaleY" => 0.08}}
      ]
  end

  # A FOREST ENTRANCE IS A CORRIDOR, NOT A GATEWAY.
  #
  # Measured off his reference (`references/sheets/dense-forest-dark-entrance.webp`): the path is 0.25 of the
  # picture and foliage 0.41. The path is the SPINE and runs the full depth, three cells wide, which is
  # `WOODLAND.pathWidth`, so it continues the pathway it sits on. Two columns of wood crowd it each side.
  @forest_w 7
  @forest_h 5
  @forest_path 2..4

  # THE SPECIES, AS THIS ENGINE ACTUALLY BUILDS THEM. Read off the live `tree_*` compositions rather than
  # invented: `{trunk_scale, trunk_scaleY, crown_scale, crown_scaleY, crown_shape}`. This is the whole reason
  # the variants differ, and the first attempt ignored it and made up thirteen sets of numbers from the
  # generator NAMES instead.
  @species %{
    "tree_column" => {0.5, 5.0, 1.2, 2.2, "circle"},
    "tree_tall" => {0.6, 4.4, 1.35, 2.0, "circle"},
    "tree" => {0.6, 3.15, 1.35, 2.0, "circle"},
    "tree_round" => {0.6, 3.15, 1.35, 2.0, "circle"},
    "tree_big" => {0.7, 4.2, 1.9, 2.8, "circle"},
    "tree_giant" => {0.75, 5.8, 2.1, 2.8, "circle"},
    "tree_palm" => {0.4, 4.6, 1.15, 1.0, "circle"},
    "tree_coconut" => {0.38, 5.4, 1.3, 1.1, "circle"},
    "tree_mangrove" => {0.7, 2.2, 1.8, 1.5, "circle"},
    "tree_gnarled" => {0.6, 2.0, 1.85, 1.3, "circle"},
    "tree_broadleaf" => {0.55, 2.4, 1.75, 1.7, "circle"},
    # A CONIFER IS A CONE, and the renderer draws square or circle only, so it keeps its square crown. That is
    # what makes a mountain wood read as conifers rather than as more round trees.
    "tree_conifer" => {0.45, 3.8, 0.9, 3.4, "square"},
    "bush_round" => {0.0, 0.0, 1.35, 1.2, "circle"},
    "tree_banana" => {0.5, 1.6, 1.95, 1.6, "circle"},
    "tree_sapling" => {0.3, 1.6, 0.7, 1.0, "circle"},
    "tree_stub" => {0.55, 1.1, 0.0, 0.0, "circle"}
  }

  @doc """
  A FOREST ENTRANCE IS MADE OF THAT FOREST'S OWN TREES.

  *"forest entrance depends on type of firest ... each one must have their own tree guided entry"*, and
  *"you didn't analyzed the specific details that make each sub zone of each type of forest unique"*.

  Both are answered the same way: every generator already SERVES the species it grows, its palette and its
  canopy density, and an entrance is built from those rather than from numbers picked to match a name. A beech
  stand is `tree_column`, `tree_tall`, `tree`, so its way out is tall straight boles. An island is
  `tree_coconut`, `tree_palm`, `tree_banana`, `tree_mangrove`, so its way out is thin stems under flat crowns.
  A wood pasture is `tree_gnarled` and `tree_broadleaf`, so its way out is low and wide. None of that is a
  decision made here: it is the template's own data, drawn.

  `canopy` is the generator's served nature density, so a dense wood's way out is genuinely denser. `gloom` is
  the template's own canopy colour, darkened, so the dark you walk into is the colour of that wood's leaves.
  """
  def seed_forest_entrances do
    for {name, species, canopy, gloom, foot, wet} <- [
          # ── WOODLAND: its served species, its served canopy density, its palette canopy colour ──
          {"woodland_entrance", ~w(tree_column tree tree_tall tree_round tree_conifer tree_stub tree_sapling), 0.434, "#5d7340", "mushroom", 0},
          {"beech_entrance", ~w(tree_column tree_tall tree), 0.45, "#5d7340", "mushroom", 0},
          {"dense_woodland_entrance", ~w(tree_column tree_tall tree tree_big tree_sapling), 0.6, "#5d7340", "mushroom", 0},
          {"glades_entrance", ~w(tree tree_round tree_broadleaf tree_gnarled), 0.4, "#5d7340", "bouquet", 0},
          {"mountain_forest_entrance", ~w(tree_conifer tree_column tree_stub), 0.45, "#4a5f42", "rock", 0},
          # ── JUNGLE ──
          {"jungle_entrance", ~w(tree_round tree_big bush_round tree_giant tree_palm), 0.62, "#2e6b32", "mushroom", 1},
          {"dense_jungle_entrance", ~w(tree_giant tree_big tree_round bush_round), 0.72, "#2e6b32", "mushroom", 1},
          {"island_entrance", ~w(tree_coconut tree_palm tree_banana tree_mangrove bush_round), 0.62, "#4f9147", "bouquet", 2},
          {"jungle_ruins_entrance", ~w(tree_round tree_big tree_giant bush_round), 0.62, "#2e6b32", "rock", 1},
          {"swamp_entrance", ~w(tree_mangrove tree_gnarled tree_round bush_round), 0.62, "#2e6b32", "red-mushroom", 3},
          # ── MEADOW ──
          {"meadow_entrance", ~w(tree_gnarled tree_broadleaf tree_round tree_big bush_round), 0.2, "#6b8049", "bouquet", 0},
          {"open_meadow_entrance", ~w(tree_gnarled tree_broadleaf bush_round), 0.12, "#6b8049", "flower", 0},
          {"wood_pasture_entrance", ~w(tree_gnarled tree_broadleaf bush_round), 0.18, "#6b8049", "bouquet", 0}
        ] do
      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: @forest_w, footprint_h: @forest_h, category: "props"},
          forest_entrance_cells(species, canopy, gloom, foot, wet)
        )
    end

    :ok
  end

  # Darken a served palette colour toward black by `amount`, so the gloom is THAT wood's leaf colour in shadow
  # rather than a black invented here.
  defp shade(hex, amount) do
    <<?#, r::binary-2, g::binary-2, b::binary-2>> = hex
    # A negative `amount` LIGHTENS, which is how the alternate leaf tone is made from the same served colour.
    down = fn c ->
      c |> String.to_integer(16) |> then(&round(&1 * (1.0 - amount))) |> max(0) |> min(255)
    end
    "#" <> Enum.map_join([r, g, b], fn c -> c |> down.() |> Integer.to_string(16) |> String.pad_leading(2, "0") end)
  end

  defp forest_entrance_cells(species, canopy, gloom, foot, wet) do
    # THE CROWNS WEAR THIS WOOD'S OWN LEAF COLOUR. Every palette serves `canopy` and `canopyAlt` and they are
    # genuinely different numbers per template, and they were being used for the gloom ONLY. Every crown drew
    # the tile's default green, so thirteen objects came out as one pile of green blobs: *"they all suck,
    # there's no difference between none of them"*. Two tones, alternating, so a stand has depth.
    leaf = {gloom, shade(gloom, -0.22)}
    # ONE TREE, of a named species, at its OWN proportions. `vary` only scales the whole thing so a stand is
    # not an orchard; it never changes what the species IS.
    tree = fn dx, dy, kind, vary ->
      {tw, th, cw, ch, shape} = Map.fetch!(@species, kind)
      trunk_h = Float.round(th * vary, 2)
      top = max(0, round(tw * trunk_h))

      trunk =
        if tw > 0.0,
          do: [%{dx: dx, dy: dy, level: 0, label: "trunk_mid", walkable: false,
                 scale: Float.round(tw * vary, 2), settings: %{"scaleY" => trunk_h}}],
          else: []

      crown =
        if cw > 0.0,
          do: [%{dx: dx, dy: dy, level: top, label: "leaf_center", walkable: false,
                 scale: Float.round(cw * vary, 2),
                 settings: %{"scaleY" => ch, "shape" => shape,
                             "color" => elem(leaf, rem(dx + dy, 2))}}],
          else: []

      trunk ++ crown
    end

    # THE WOOD, both sides, full depth. The generator's served CANOPY density decides how much of it is filled,
    # so a dense woodland at 0.6 really is denser than a glade at 0.4 and an open meadow at 0.12 is nearly bare.
    wood =
      for dx <- 0..(@forest_w - 1),
          dx not in @forest_path,
          dy <- 0..(@forest_h - 1),
          rem(dx * 7 + dy * 5, 100) < round(canopy * 100) + 22 do
        kind = Enum.at(species, rem(dx * 3 + dy * 5, length(species)))
        tree.(dx, dy, kind, 0.85 + rem(dx * 3 + dy * 7, 4) * 0.1)
      end

    # THE CANOPY CLOSING OVER THE WAY, on cells that stay WALKABLE. The pathway is three cells wide and a
    # blocking cell on any of them walls up the exit, so the gap is tightened overhead, never on the ground.
    canopy_over =
      for dx <- @forest_path,
          dy <- 0..(@forest_h - 1),
          rem(dx + dy * 2, 3) == 0 do
        kind = Enum.at(species, rem(dx + dy, length(species)))
        {_, _, cw, ch, shape} = Map.fetch!(@species, kind)
        over = max(2, round(canopy * 6) + 2)
        %{dx: dx, dy: dy, level: over, label: "leaf_center", walkable: true,
          scale: Float.round(cw * 1.1, 2),
          settings: %{"scaleY" => ch, "shape" => shape, "color" => elem(leaf, rem(dx + dy, 2))}}
      end

    # THE WAY GOES DARK, running BACK into the wood and fading toward you, so it reads as a way that carries on
    # rather than a door. It is the cave mouth's form: a tall WALKABLE block, never a square on the floor.
    # *"the dark section is still bad because is not further down the path enough"*. It covered three cells of
    # five and stopped. It runs the WHOLE depth now, deepest where the path leaves the map and thinning to
    # almost nothing at the near end, so the way fades out of sight instead of ending at a wall.
    dark =
      for dx <- @forest_path,
          dy <- 0..(@forest_h - 1),
          deep = dy / (@forest_h - 1) do
        %{dx: dx, dy: dy, level: 0, label: "trunk_mid", walkable: true, scale: 1.0,
          settings: %{"scaleY" => 0.35 + deep * 2.9, "color" => shade(gloom, 0.35 + deep * 0.62)}}
      end

    verge =
      for dy <- 0..(@forest_h - 1),
          dx <- [Enum.min(@forest_path) - 1, Enum.max(@forest_path) + 1],
          rem(dx + dy * 3, 3) == 0,
          do: %{dx: dx, dy: dy, level: 1, label: foot, walkable: false,
                scale: 0.45 + rem(dy, 3) * 0.06, settings: %{"scaleY" => 0.5}}

    water =
      for dy <- 0..(@forest_h - 1),
          dx <- [Enum.min(@forest_path) - 1, Enum.max(@forest_path) + 1],
          wet > 0,
          rem(dx + dy * 2, 5) < wet - 1,
          do: %{dx: dx, dy: dy, level: 0, label: "water_c", walkable: false, scale: 1.0,
                settings: %{"scaleY" => 0.12}}

    List.flatten(wood) ++ canopy_over ++ verge ++ water ++ dark
  end

  def seed_entrances do
    entrances = %{
      # A wood opening onto somewhere else: a bare gnarled trunk one side, a full crown the other, a boulder
      # bridging them. The two uprights differ on purpose, which is what stops it reading as something built.
      "forest_entrance" => %{
        footprint_w: 3,
        footprint_h: 2,
        category: "props",
        cells: entrance_cells({"dead-tree", "oak-tree"}, "boulder", "path_dirt", "mushroom", "red-mushroom", [])
      },
      # Rock both sides and rock over the top, and the darkest mouth of the four.
      "cave_entrance" => %{
        footprint_w: 3,
        footprint_h: 2,
        category: "props",
        cells: entrance_cells({"cliff_face", "cliff_face"}, "boulder", "cave_floor", "boulder", "boulder", mouth: "#08080c")
      },
      # BUILT, not grown: dressed uprights, a real arch, and a lamp at each foot that lights the way at night
      # through the light setting it already carries.
      "town_entrance" => %{
        footprint_w: 3,
        footprint_h: 2,
        category: "props",
        cells: entrance_cells({"pillar", "pillar"}, "torii-gate", "path_stone", "lamp", "lamp", [])
      },
      # The town entrance, lighter: the same built frame with blooms at its feet and a softer floor.
      "park_entrance" => %{
        footprint_w: 3,
        footprint_h: 2,
        category: "props",
        cells: entrance_cells({"pillar", "pillar"}, "torii-gate", "path", "bouquet", "flower", [])
      }
    }

    for {name, %{footprint_w: w, footprint_h: h, cells: cells} = comp} <- entrances do
      {:ok, _} =
        Nebulith.Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: w, footprint_h: h, category: Map.get(comp, :category)},
          cells
        )
    end

    :ok
  end

end

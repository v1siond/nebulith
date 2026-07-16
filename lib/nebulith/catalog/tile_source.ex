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
    seed_building_tiles(ascii_id)
    seed_extra_tiles(ascii_id)
    seed_emoji_tiles(emoji, emoji_id)
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
  # that zone. No `image_url` (rendered from the glyph, no baked PNG).

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
    seed_building_tiles(ascii_id)
    IO.puts("seeded #{length(building_tiles())} type-specific building tiles")
    :ok
  end

  defp seed_building_tiles(tileset_id) do
    for %{label: label, base: base, color: color} <- building_tiles() do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
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
    end
  end

  # The type tiles: {label, base part it reskins, its recovered zone-independent colour}. Store =
  # blue roof + cream walls; hospital = green roof + white walls; houses vary (a/b/c) across
  # house_3/4/5. Colours come straight from the old frontend BUILDING_PALETTES / HOUSE_ROOFS /
  # HOUSE_WALLS.
  defp building_tiles do
    [
      %{label: "roof_store", base: "roof", color: "#235a96"},
      %{label: "roof_top_store", base: "roof_top", color: "#235a96"},
      %{label: "wall_store", base: "wall", color: "#e2dcc8"},
      %{label: "roof_hospital", base: "roof", color: "#2f7e50"},
      %{label: "roof_top_hospital", base: "roof_top", color: "#2f7e50"},
      %{label: "wall_hospital", base: "wall", color: "#f0f0ea"},
      %{label: "roof_house_a", base: "roof", color: "#6e2820"},
      %{label: "roof_top_house_a", base: "roof_top", color: "#6e2820"},
      %{label: "wall_house_a", base: "wall", color: "#e6d6b0"},
      %{label: "roof_house_b", base: "roof", color: "#33383f"},
      %{label: "roof_top_house_b", base: "roof_top", color: "#33383f"},
      %{label: "wall_house_b", base: "wall", color: "#b9c4a6"},
      %{label: "roof_house_c", base: "roof", color: "#2f4233"},
      %{label: "roof_top_house_c", base: "roof_top", color: "#2f4233"},
      %{label: "wall_house_c", base: "wall", color: "#aebfcc"}
    ]
  end

  # ── Extra map tiles (storefront / flat-roof / fountain parts) ──────────────
  # New per-part tiles the realistic sample compositions need: a store's display-window + striped
  # awning, the flat-roof deck + parapet lip + rooftop AC unit, and the fountain's stone rim + water
  # + jet. Each is JUST A TILE — its own glyph + a ZONE-INDEPENDENT colour in settings.colors (the
  # same across every season, like the type-specific building tiles) + its blocking/behavior. These
  # aren't remapped per building TYPE; the compositions reference them by label directly.
  @doc """
  Seeds ONLY the extra storefront/flat-roof/fountain part tiles into the ascii tileset.

  Safe + idempotent (upsert by label) — touches nothing else, so it can run on the shared dev DB
  without a full reseed.
  """
  def seed_extra do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    seed_extra_tiles(ascii_id)
    IO.puts("seeded #{length(extra_tiles())} extra map tiles")
    :ok
  end

  defp seed_extra_tiles(tileset_id) do
    for %{label: label, glyph: glyph, color: color, blocking: blocking, category: category} <-
          extra_tiles() do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset_id,
          label: label,
          glyph: glyph,
          color_role: nil,
          blocking: blocking,
          height: 1,
          category: category,
          settings:
            %{"colors" => Map.new(@all_zones, &{&1, color})}
            |> merge_behavior(label)
        })
    end
  end

  # {label, glyph, colour, blocking, sidebar category}. Colour is zone-independent (one tone every
  # season). Storefront/roof parts read as buildings; fountain parts read as nature.
  defp extra_tiles do
    [
      %{label: "display_window", glyph: "▦", color: "#86bcd6", blocking: true, category: "buildings"},
      %{label: "awning", glyph: "▨", color: "#b64a34", blocking: true, category: "buildings"},
      %{label: "flat_roof", glyph: "▬", color: "#8b9098", blocking: false, category: "buildings"},
      %{label: "parapet", glyph: "▀", color: "#70757c", blocking: true, category: "buildings"},
      %{label: "rooftop_unit", glyph: "▪", color: "#616870", blocking: true, category: "buildings"},
      %{label: "stone_rim", glyph: "▓", color: "#c2bba6", blocking: true, category: "nature"},
      %{label: "fountain_water", glyph: "≈", color: "#2f7fc9", blocking: true, category: "nature"},
      %{label: "water_jet", glyph: "|", color: "#dff0ff", blocking: true, category: "nature"}
    ]
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
  # Alexander's simple crown+row tree + trunkless bush. Unlike tree_small/
  # tree_dead (which stay JSON-sourced, untouched), these are authored
  # directly here per the tile-backend-migration doc's stated direction ("an
  # Elixir data module holds the canonical composition definitions") — a
  # 3-wide, 1-deep footprint with a single-column trunk and a 3-cell leaf row
  # topped by a crown cell.

  @doc """
  Reseeds ONLY the code-authored compositions — the tree/bush/fountain (seed_new_compositions) and
  the house/store/office/… buildings (seed_building_compositions) — plus the extra part tiles they
  reference. Safe on the shared dev DB: it upserts by natural key and NEVER touches the emoji tiles
  (so editor-tuned poses survive) or the ascii glyph/terrain rows.
  """
  def seed_sample do
    ascii_id = ensure_tileset("ascii", "ASCII").id
    seed_building_tiles(ascii_id)
    seed_extra_tiles(ascii_id)
    seed_new_compositions()
    seed_building_compositions()
    IO.puts("reseeded sample tiles + compositions")
    :ok
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
      "tree" => %{
        footprint_w: 3,
        footprint_h: 1,
        cells: [
          %{dx: 0, dy: 0, level: 0, label: "trunk_base", walkable: false},
          %{dx: -1, dy: 0, level: 1, label: "leaf_left", walkable: true},
          %{dx: 0, dy: 0, level: 1, label: "leaf_center", walkable: true},
          %{dx: 1, dy: 0, level: 1, label: "leaf_right", walkable: true},
          %{dx: 0, dy: 0, level: 2, label: "leaf_top", walkable: true}
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
      # The town-square fountain — a COMPOSITION like a building/tree, not a special prop (retires the
      # old `makeTownFountain` drawer): a 5×4 basin whose PERIMETER is a raised `stone_rim` wall (1
      # block), the interior floor is `fountain_water` at ground, and a few `water_jet` tiles rise 1–2
      # blocks at scattered interior points. Every cell blocks (you stroll the paved ring around it);
      # the generator stamps it centred on the plaza (stampComposition).
      "fountain" => %{footprint_w: 5, footprint_h: 4, cells: fountain_cells()}
    }
  end

  # 5×4 fountain: stone rim around the edge, water filling the interior floor, and jets rising from a
  # few interior points (a tall centre jet + two lower side jets). Pure data.
  defp fountain_cells do
    w = 5
    h = 4
    edge? = fn dx, dy -> dx == 0 or dx == w - 1 or dy == 0 or dy == h - 1 end

    rim =
      for dy <- 0..(h - 1), dx <- 0..(w - 1), edge?.(dx, dy),
        do: %{dx: dx, dy: dy, level: 0, label: "stone_rim", walkable: false}

    water =
      for dy <- 1..(h - 2), dx <- 1..(w - 2),
        do: %{dx: dx, dy: dy, level: 0, label: "fountain_water", walkable: false}

    jets = [
      %{dx: 2, dy: 1, level: 1, label: "water_jet", walkable: false},
      %{dx: 2, dy: 1, level: 2, label: "water_jet", walkable: false},
      %{dx: 1, dy: 2, level: 1, label: "water_jet", walkable: false},
      %{dx: 3, dy: 2, level: 1, label: "water_jet", walkable: false}
    ]

    rim ++ water ++ jets
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

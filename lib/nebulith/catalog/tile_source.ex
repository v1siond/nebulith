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
  alias Nebulith.Catalog.Tileset
  alias Nebulith.Repo

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
    seed_emoji_tiles(emoji, emoji_id)
    seed_compositions(ascii["compositions"])
    seed_new_compositions()

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
          settings: %{"variants" => %{"char" => char, "fg" => fg, "bg" => bg}}
        })
    end
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

  defp seed_new_compositions do
    for {name, %{footprint_w: w, footprint_h: h, cells: cells}} <- compositions() do
      {:ok, _} =
        Catalog.upsert_composition_with_cells(
          %{name: name, footprint_w: w, footprint_h: h},
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
      }
    }
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

  defp read_tileset(file) do
    :nebulith
    |> Application.app_dir("priv/repo/tilesets")
    |> Path.join(file)
    |> File.read!()
    |> Jason.decode!()
  end
end

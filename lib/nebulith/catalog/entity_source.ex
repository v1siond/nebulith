defmodule Nebulith.Catalog.EntitySource do
  @moduledoc """
  The canonical ENTITY resolution DATA — how a game entity (an enemy of some
  `enemyType`, or a person of some `variant`) resolves to a baked tile slug.

  Per the map model, *a unit is just a tile*: the actual entity ART already
  lives in the emoji tileset (the `units`-category rows served by `/api/tilesets`),
  keyed by slug (`goblin`, `wolf`, `man`, `robot`…). What was still missing from
  the backend was the small lookup that maps a gameplay tag → that slug:

    * `enemy_type_slug` — an enemy's `enemyType` tag → the slug whose baked tile it
      draws (so a `bandit` shows the ninja tile, a `wraith` the ghost tile…);
    * `variant_slug` — a person's `variant` → the figure slug (male → man, old →
      elder, robot → robot…);
    * `tiles` — the set of baked entity slugs (the map's KEYS), so the frontend
      can tell a slug that has a baked tile from one that doesn't; the emoji VALUE
      is the source glyph each slug was baked from (kept for parity with the bake
      pipeline, mirroring `TileSource`).

  This used to be a bundled frontend data file (`src/game/data/entityTiles.json`);
  it now lives here and is served by `GET /api/entities`, so the frontend holds no
  entity data — it fetches this at load time, exactly like it fetches the tilesets.
  It is static resolution DATA (not per-row tiles), so — like `BuildingCompositions`
  — it is authored as an Elixir module and served directly; there is no DB table to
  seed.
  """

  # The public URL prefix the baked entity PNGs live under. The frontend only uses
  # this to know a slug HAS a baked tile (a truthiness guard) — the actual render
  # resolves `emoji:<slug>` against the emoji tileset — but it is served so the
  # resolution stays fully backend-owned.
  @dir "/tiles/emoji/baked/entities"

  # slug → the source emoji it was baked from. The KEYS are the baked entity slug
  # set; the VALUES mirror the bake pipeline's input (like TileSource keeps `emoji`).
  @tiles %{
    "goblin" => "👺",
    "wolf" => "🐺",
    "ninja" => "🥷",
    "skeleton" => "💀",
    "bat" => "🦇",
    "spider" => "🕷️",
    "guardian" => "🗿",
    "ghost" => "👻",
    "ogre" => "👹",
    "zombie" => "🧟",
    "vampire" => "🧛",
    "dragon" => "🐉",
    "alien" => "👾",
    "person" => "🧍",
    "man" => "🧍‍♂️",
    "woman" => "🧍‍♀️",
    "adult" => "🧑",
    "boy" => "👦",
    "girl" => "👧",
    "old-man" => "👴",
    "old-woman" => "👵",
    "elder" => "🧓",
    "child" => "🧒",
    "grey-alien" => "👽",
    "robot" => "🤖"
  }

  # enemy `enemyType` tag → the baked slug it draws. Multiple types can share one
  # slug (orc/ogre → ogre, troll → guardian, slime → alien); unmapped types fall
  # back to the generic 👾 on the frontend.
  @enemy_type_slug %{
    "goblin" => "goblin",
    "wolf" => "wolf",
    "bandit" => "ninja",
    "skeleton" => "skeleton",
    "bat" => "bat",
    "spider" => "spider",
    "guardian" => "guardian",
    "wraith" => "ghost",
    "orc" => "ogre",
    "ogre" => "ogre",
    "ghost" => "ghost",
    "zombie" => "zombie",
    "vampire" => "vampire",
    "dragon" => "dragon",
    "troll" => "guardian",
    "slime" => "alien"
  }

  # person `variant` → the figure slug that variant renders.
  @variant_slug %{
    "male" => "man",
    "female" => "woman",
    "old" => "elder",
    "child" => "child",
    "alien" => "grey-alien",
    "robot" => "robot"
  }

  @doc """
  The full entity resolution map — the payload `GET /api/entities` serves.
  """
  def resolution do
    %{
      dir: @dir,
      tiles: @tiles,
      enemy_type_slug: @enemy_type_slug,
      variant_slug: @variant_slug
    }
  end
end

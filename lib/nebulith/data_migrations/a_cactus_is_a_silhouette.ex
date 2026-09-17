defmodule Nebulith.DataMigration.ACactusIsASilhouette do
  @moduledoc """
  Three cacti with art of their own, drawn as billboards rather than green boxes.

  ## What was wrong

  The `cactus` tile existed in the catalog and `priv/static/tiles/ascii/cactus.png` was a BLANK WHITE
  SQUARE. Nothing had ever drawn it, so nothing had noticed. Stamped as a composition cell it came out as a
  plain green cube, which is the "1:1:1 cube" failure `OBJECT-CONSTRUCTION.md` §6 names: a cube shell only
  reads as an object when it is not cube-shaped.

  ## What changed

  1. **Art, through the normal bake pipeline** (`priv/tilegen/tiles.json` then `bake.mjs --only=`), three
     silhouettes in white and grey so the served colour tints them and one drawing serves every biome:

         cactus         a saguaro: ribbed column with two elbowed arms
         cactus_barrel  a squat ribbed dome with radial spines
         cactus_pad     a prickly pear, overlapping pads with areoles

     Measured alpha coverage 27, 38 and 35 percent, so each is a shape with a transparent margin, which is
     what a billboard needs and the opposite of the full-bleed rule for a cube FACE.

  2. **`display: single` and `transparent`**, so a cactus draws as ONE centred picture with no cube around
     it. His rule for exactly this case: *"we don't really want to render ornaments as blocks, we want to use
     the single tile setting, like we do with flowers"*.

  3. **Each species gets its own drawing.** `cactus_column`, `cactus_barrel` and `cactus_prickly` name three
     different tiles instead of scaling one, because squashing a ribbed column into a squat dome reads as a
     squashed column.

  Idempotent: upserts by label and reseeds the compositions.
  """
  require Logger

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  # {label, ascii glyph, emoji, title}
  @cacti [
    {"cactus", "ǂ", "🌵", "Saguaro"},
    {"cactus_barrel", "◍", "🌵", "Barrel cactus"},
    {"cactus_pad", "❋", "🌵", "Prickly pear"}
  ]

  # A succulent is green all year in every climate it grows in, so it serves ONE colour rather than a
  # per-season array. It still carries `foliage` so the biome tint reaches it like any other plant.
  @green "#5f9e4a"

  def run do
    rows =
      for {label, glyph, emoji, title} <- @cacti,
          tileset <- Catalog.list_tilesets(),
          tileset.key in ["ascii", "emoji"],
          reduce: 0 do
        acc ->
          {:ok, _} =
            Catalog.upsert_tile(%{
              tileset_id: tileset.id,
              label: label,
              glyph: glyph,
              emoji: emoji,
              blocking: true,
              height: 1.0,
              category: "nature",
              title: title,
              image_url: "/tiles/#{tileset.key}/#{label}.png",
              settings: %{
                "color" => @green,
                # ONE centred picture, no cube shell. A cactus is a silhouette, like a flower.
                "display" => "single",
                "transparent" => true,
                # it is a plant, so the biome's foliage tint reaches it
                "foliage" => true
              }
            })

          acc + 1
      end

    TileSource.seed_compositions()
    drop_stale_settings()

    Logger.info("[data_migrate] #{rows} cactus tiles carry their own art, compositions rebuilt")

    :ok
  end

  # `upsert_tile` replaces the WHOLE settings map, so the per-zone `colors` the old flat-green cactus row
  # carried is gone by construction. Stated rather than assumed, because that same behaviour has silently
  # erased a field before.
  defp drop_stale_settings do
    Repo.query!("UPDATE tiles SET settings = settings - 'colors' WHERE label = ANY($1)", [
      Enum.map(@cacti, fn {label, _, _, _} -> label end)
    ])
  end
end

defmodule Nebulith.DataMigration.ACactusIsAnObject do
  @moduledoc """
  A cactus, built the way everything else in this catalog is built: as a composition of cells.

  *"I REQUESTED TREES, WHICH MEAN OBJECTS, COMPOSITIONS, AND YOU JUST USED A FUCKING TILE IN A FUCKING
  CELL."*

  The first attempt put one billboard TILE in one cell and called it a species. This follows `tree_dead`
  instead, which is the catalog's established shape for a plant with no canopy: a 1x1 footprint with one cell
  per LEVEL and a different tile per segment.

      cactus_saguaro   stem, stem, crown      a tall narrow column
      cactus_barrel    stem, crown            squat and wide
      cactus_prickly   pad, pad               a clump, wider at the bottom

  ## The art, and the style mistake it corrects

  Three segment tiles, authored through the normal bake pipeline. The first attempt drew detailed
  transparent SILHOUETTES at 27 percent alpha, which is not how anything else here is drawn. A plant MASS on
  a cube face is the `canopy_*` style: FULL BLEED, greyscale, one luminance band, tinted by the served
  colour. These measure 100 percent alpha against `canopy_c`'s 90.

  Per-zone colours copied from the shape of every other plant row, so a cactus takes the biome tint like any
  other foliage.

  ## Where they grow

  The deep desert and the open sand, which is where a cactus actually stands. The oasis keeps its palms.
  Added to the mixes rather than replacing them, so the scrub set from `ADesertGrowsDesertTrees` stays.

  Idempotent: upserts the tiles, reseeds the compositions, and sets stated mixes.
  """
  require Logger

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  # {label, ascii glyph, emoji, title}
  @segments [
    {"cactus_stem", "ǂ", "🌵", "Cactus stem"},
    {"cactus_crown", "Ω", "🌵", "Cactus crown"},
    {"cactus_arm_l", "Γ", "🌵", "Cactus arm, left"},
    {"cactus_arm_r", "Ꞁ", "🌵", "Cactus arm, right"},
    {"cactus_barrel", "◍", "🌵", "Barrel cactus"},
    {"cactus_pad", "❋", "🌵", "Cactus pad"}
  ]

  # A succulent is green in every season it lives through, so the per-zone map is one colour repeated. It is
  # still a MAP rather than a flat value, because that is the shape every other plant row uses and the
  # resolver reads.
  @zones ~w(spring summer autumn winter desert beach lava)
  @green "#5f9e4a"

  def run do
    rows = seed_segments()
    TileSource.seed_compositions()

    # The desert mixes that grow these are stated by `GeneratorSource`, which writes `generators.config`
    # whole. Setting them from here made the fact a second owner and the next seed discarded it.
    Logger.info("[data_migrate] #{rows} cactus segment tiles, three cactus compositions")

    :ok
  end

  defp seed_segments do
    for {label, glyph, emoji, title} <- @segments,
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
            occupies: true,
            # ONE BLOCK TALL, not a flat slab. Copying `tree_dead`'s 0.0 left a visible GAP between the
            # stacked segments, because a height-0 cell occupies no block and levels 0/1/2 then sit apart.
            height: 1.0,
            category: "nature",
            title: title,
            image_url: "/tiles/#{tileset.key}/#{label}.png",
            settings: %{
              "color" => @green,
              "colors" => Map.new(@zones, &{&1, @green})
              # NOT `foliage`. That tag hands a plant the biome's tint, and in a desert the biome tint is
              # ochre, which turned the cacti tan. A cactus is the one thing out there that stays GREEN, and
              # that is most of what makes it read as a cactus. It keeps its own colour.
            }
          })

        acc + 1
    end
  end
end

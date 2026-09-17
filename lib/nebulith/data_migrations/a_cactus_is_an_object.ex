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
  alias Nebulith.Repo

  # {label, ascii glyph, emoji, title}
  @segments [
    {"cactus_stem", "ǂ", "🌵", "Cactus stem"},
    {"cactus_crown", "Ω", "🌵", "Cactus crown"},
    {"cactus_pad", "❋", "🌵", "Cactus pad"}
  ]

  # A succulent is green in every season it lives through, so the per-zone map is one colour repeated. It is
  # still a MAP rather than a flat value, because that is the shape every other plant row uses and the
  # resolver reads.
  @zones ~w(spring summer autumn winter desert beach lava)
  @green "#5f9e4a"

  # The regions a cactus belongs in, and what each grows after this.
  @regions %{
    "deep" => [
      %{"kind" => "cactus_saguaro", "weight" => 30},
      %{"kind" => "tree_dead", "weight" => 26},
      %{"kind" => "cactus_barrel", "weight" => 22},
      %{"kind" => "tree_stub", "weight" => 22}
    ],
    "glade" => [
      %{"kind" => "cactus_barrel", "weight" => 28},
      %{"kind" => "cactus_prickly", "weight" => 26},
      %{"kind" => "tree_stub", "weight" => 24},
      %{"kind" => "tree_sapling", "weight" => 22}
    ],
    "thicket" => [
      %{"kind" => "cactus_prickly", "weight" => 34},
      %{"kind" => "bush_round", "weight" => 30},
      %{"kind" => "bush", "weight" => 20},
      %{"kind" => "tree_stub", "weight" => 16}
    ]
  }

  @environment [
    %{"kind" => "tree_gnarled", "weight" => 20},
    %{"kind" => "cactus_saguaro", "weight" => 20},
    %{"kind" => "tree_stub", "weight" => 18},
    %{"kind" => "cactus_prickly", "weight" => 16},
    %{"kind" => "tree_encina", "weight" => 14},
    %{"kind" => "tree_dead", "weight" => 12}
  ]

  def run do
    rows = seed_segments()
    TileSource.seed_compositions()
    set_mixes()

    Logger.info("[data_migrate] #{rows} cactus segment tiles, three cactus compositions, desert mixes grow them")

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
            blocking: true,
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

  defp set_mixes do
    Repo.query!(
      """
      UPDATE generators SET config = jsonb_set(config, '{trees}', $1::text::jsonb)
      WHERE (name = 'Desert' OR name LIKE 'Desert %') AND config->'trees' IS NOT NULL
      """,
      [Jason.encode!(@environment)]
    )

    Repo.query!(
      """
      UPDATE generators SET config = jsonb_set(config, '{subZones}', (
        SELECT jsonb_agg(
          CASE
            WHEN $1::text::jsonb ? (z->>'key') THEN jsonb_set(z, '{trees}', $1::text::jsonb -> (z->>'key'))
            ELSE z
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
      ))
      WHERE (name = 'Desert' OR name LIKE 'Desert %') AND config->'subZones' IS NOT NULL
      """,
      [Jason.encode!(@regions)]
    )

    :ok
  end
end

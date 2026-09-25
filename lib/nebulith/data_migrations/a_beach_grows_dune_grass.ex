defmodule Nebulith.DataMigration.ABeachGrowsDuneGrass do
  @moduledoc """
  A beach grows marram, not a woodland thicket.

  *"on beach/island we need a different type of grass, more 'beachy'"*.

  ## What was there

  Every beach template served `formation.understoryTile: "thicket"`, which is the dense low scrub of a wood.
  Nothing on a beach was beachy at floor level: the coconuts and palms above it were right and the thing
  between them was a woodland.

  ## The art

  Three forms, authored to `TILE-DESIGN.md` on the 128 viewBox in whites and greys so `color` does the
  tinting, read off `references/SOURCES.md`'s `beach-dunes-de-hoop-south-africa.jpg`, the dune half of his
  beach note, "scrub rather than canopy". Marram is long thin blades fanning from ONE clump at the base and
  arching over at the tip, airy rather than massed, which is what separates it from `tall_grass`.

      dune_grass         a mature clump, eleven blades, a wide fan
      dune_grass_young   five short blades, the new growth that colonises bare sand
      dune_grass_seed    the same clump carrying flowering spikes

  The variety comes from AGE and STATE, weighted across the regions, exactly as `NoTwoCactiAlike` got a stand
  of cacti to stop repeating one silhouette. Not from per-instance jitter, for the reason recorded there: it
  makes every clump a different size of the same shape, which reads as sloppy, and it hides a rule in the
  generator where the catalog cannot see it.

  ## Where they land, and why this needed no engine change

  `plantUndergrowth` reads `formation?.understoryTile ?? ctx.formation?.understoryTile`, the REGION's first.
  So which form grows where is a property of the region, which is the same answer the volcano's burn got:
  the regions are there to carry exactly this.

      edge        dune_grass_young   the seaward margin, bare sand just taking
      deep        dune_grass         the established back-dune
      glade       dune_grass_young   open sand between the palms
      thicket     thicket            left alone: the one region that IS scrub
      lakeside    dune_grass_seed    the damp hollow, in flower

  `foliage: true`, unlike the cacti, which deliberately refuse it. A cactus stays green in an ochre desert and
  that is most of what makes it read as a cactus. Dune grass is ordinary vegetation and should take its
  biome's and season's tint like every other plant.

  `display: single` and `transparent`, per *"all the grass should be of type single too"*: a grass PLANT is
  one picture standing in a cell, never a cube with grass painted on its faces.

  Walkable on purpose. A beach you cannot cross is not a beach, and `thicket` is the only nature tile in the
  catalog that blocks.

  Idempotent: upserts by label and writes stated region values.
  """
  require Logger

  alias Nebulith.Catalog

  @zones ~w(spring summer autumn winter desert)

  # A pale sandy green. The foliage tint moves it per biome and season; this is what it is with nothing served.
  @straw "#b9bd7a"

  @forms [
    {"dune_grass", "ѱ", "🌾", "Dune grass"},
    {"dune_grass_young", "ʬ", "🌾", "Dune grass, young"},
    {"dune_grass_seed", "ψ", "🌾", "Dune grass in seed"}
  ]

  def run do
    tiles = seed_tiles()

    # The beach formation and its region sets are stated by `GeneratorSource`, which writes
    # `generators.config` whole, so writing them here made them a second owner and the next seed decided
    # them. The tiles are this pass's own.
    Logger.info("[data_migrate] #{tiles} dune grass tiles")

    :ok
  end

  defp seed_tiles do
    for {label, glyph, emoji, title} <- @forms,
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
            occupies: false,
            height: 1.0,
            category: "nature",
            title: title,
            image_url: "/tiles/#{tileset.key}/#{label}.png",
            settings: %{
              "display" => "single",
              "transparent" => true,
              "foliage" => true,
              "color" => @straw,
              "colors" => Map.new(@zones, &{&1, @straw})
            }
          })

        acc + 1
    end
  end

  # The map-wide default, for anywhere that states no region of its own.
end

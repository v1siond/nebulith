defmodule Nebulith.Repo.Migrations.AsciiUnitArtFigures do
  @moduledoc """
  Gives every ascii UNIT its composed FIGURE instead of one character.

  Alexander, 2026-09-08 (Image #13 — a town whose entire cast was `♀` and `♂`):

    > all unit tiles are wrong … a dog is not a single character, is a set of characters combined to form a
    > dog, that was then converted to png to be a tile … we lost the unit ascii art and we must recover it
    > a correctly convert it to tile images and save them in thew elixir backend

  The cause was treating a unit like a terrain slab. `ensure_distinct_glyphs/0` makes every tile's picture
  distinct by giving it its own CHARACTER, which is right for a wall piece and wrong for a living thing:
  `man` became `♂`, `woman` `♀`, `dog` `d`, `bear` `B`. The figures themselves had never been backend data at
  all — they lived in the frontend (`engine/entityArt.ts`) and were drawn live, so when units moved onto
  baked tiles there was nothing to bake and the single character was all that was left.

  This runs the seeder that reads `priv/repo/tilesets/ascii_unit_art.json` (67 figures × 2 frames, the 11
  enemy figures recovered verbatim from the frontend) against the live DB. It writes only three settings
  keys per unit — `artFrames`, `frames`, `frameMs` — so editor-tuned poses, colours and per-view sizes survive.

  Reversible in the only sense that matters: `down` drops those three keys, which returns each unit to
  drawing its single glyph.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  @keys ~w(artFrames frames frameMs)

  def up do
    TileSource.apply_unit_art()
  end

  def down do
    repo().all(from(t in "tiles", select: {t.id, t.settings}))
    |> Enum.each(fn {id, settings} ->
      settings = settings || %{}

      if Enum.any?(@keys, &Map.has_key?(settings, &1)) do
        repo().update_all(
          from(t in "tiles", where: t.id == ^id),
          set: [settings: Map.drop(settings, @keys)]
        )
      end
    end)
  end
end

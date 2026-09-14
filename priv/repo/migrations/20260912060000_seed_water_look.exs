defmodule Nebulith.Repo.Migrations.SeedWaterLook do
  @moduledoc """
  Gives water its ART on a DB that already exists: frame pictures for the water surface, and the foam shoreline.

  Measured before writing it: `emoji/baked/water.png` was an 854 byte BLANK and both other bands pointed at
  `sq_blue.png`, a flat rounded square, so a river rendered as three flat tones with no texture anywhere. The
  pictures are authored as drawn art in `tiles.json` and baked per style.

  Runs the same `seed_water_look/0` that `seed/0` runs (idempotent upserts and per-key settings merges), plus
  `seed_water_color/0` and `point_tiles_at_own_image/0` so the rows stop pointing at the old blanks. Guarded on
  both tilesets already existing, so a test DB never gets tilesets it did not ask for.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if tilesets_present?() do
      TileSource.seed_water_color()
      TileSource.seed_water_look()
      TileSource.point_tiles_at_own_image()
    end
  end

  def down do
    # IRREVERSIBLE, and harmless: the previous pictures were a blank and a flat square, and the frames are
    # additive settings keys. There is no prior state worth restoring.
    :ok
  end

  defp tilesets_present? do
    repo().aggregate(from(t in "tilesets", where: t.key in ["ascii", "emoji"]), :count) == 2
  end
end

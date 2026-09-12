defmodule Nebulith.Repo.Migrations.AgreeLabelColors do
  @moduledoc """
  Gives every style's row for a label the SAME per-zone colours, on a DB that already exists.

  Alexander, 2026-09-12: *"seed the emoji colors first also"*.

  Measured on the live catalog first: 240 ascii rows carried `settings.colors` and TWO emoji rows did
  (`leaf_center`, `leaf_top`), whose values were already identical to their ascii twins. So this copies an
  existing precedent across 238 labels rather than inventing a palette, and a style that authored its own
  colours keeps them: the pass only fills a blank.

  Runs the same `normalize_label_colors/0` that `seed/0` runs, which merges one settings key per row and
  touches nothing else. Guarded on both tilesets already existing, so a test DB never gets tilesets it did
  not ask for (the mistake the flat-floor migration made first time round).
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if tilesets_present?(), do: TileSource.normalize_label_colors()
  end

  def down do
    # IRREVERSIBLE, and harmless. The filled colours are a copy of what the other style already held, so there
    # is no prior value to restore: before this, the row simply had no answer.
    :ok
  end

  defp tilesets_present? do
    repo().aggregate(from(t in "tilesets", where: t.key in ["ascii", "emoji"]), :count) == 2
  end
end

defmodule Nebulith.DataMigration.AgreeLabelColors do
  @moduledoc """
  Gives every style's row for a label the SAME per-zone colours.

  Measured on the live catalog first: 240 ascii rows carried `settings.colors` and TWO emoji rows did
  (`leaf_center`, `leaf_top`), whose values were already identical to their ascii twins. So this copies an
  existing precedent across 238 labels rather than inventing a palette, and a style that authored its own
  colours keeps them: the pass only fills a blank.

  Runs the same `normalize_label_facts/0` the catalog seed runs, which agrees every per-label fact and
  touches nothing else.
  """
  require Logger

  alias Nebulith.Catalog.TileSource

  def run do
    TileSource.normalize_label_facts()

    Logger.info("[data_migrate] per-label colours agreed across styles")
    :ok
  end
end

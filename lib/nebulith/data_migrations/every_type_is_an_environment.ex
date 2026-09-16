defmodule Nebulith.DataMigration.EveryTypeIsAnEnvironment do
  @moduledoc """
  The catalog says what a place IS, in both halves of its name.

  The CATEGORY is the terrain kind: wilderness, village, town, city, cave, temple. A village, a town and
  a city are fundamentally different places and the difference is architecture, not size, so they are
  three categories rather than three presets of one `settlement` bucket. Size is the number of columns
  and rows the grid rolls, which is why "small town" and "big city" are gone.

  The TYPE is the environment, and it is the SAME list for all four outdoor categories, so a swamp
  forest, a swamp village, a swamp town and a swamp city all exist and all mean the same thing about the
  climate, the ground, what grows and what people build out of. Swamp, beach and ruins were regions of
  the jungle and are environments now, because a swamp is a place you generate rather than a corner of a
  rainforest. Desert and volcanic get their rows here with the closest existing numbers behind them,
  marked as placeholders in the source, so the flavour pass has somewhere to start.

  The SUB-ZONE says where in the place you are. One region set for every wild environment, wearing that
  place's own floor tones, species and blooms, and three neighbourhoods by money in every city, each with
  its own wall material, roof and colours.

  Deleted: the rows that said nothing (`forest_woodland_beech`, `forest_woodland_glades`,
  `forest_meadow_open`, `forest_meadow_pasture`, `forest_jungle_dense`, all the same as the standard),
  the size indicator (`town_small`), and `city_modern`, which is the Futuristic city now and is nobody's
  parent. `forest_woodland_dense` folds into the deep wood region and `town_forest` into the woodland
  village.

  `seed/0` deletes any category and any generator the source no longer names, so nothing is left behind
  as a ghost row in the menu.
  """
  require Logger

  alias Nebulith.Catalog.GeneratorSource

  def run do
    GeneratorSource.seed()

    Logger.info("[data_migrate] category is the place, type is the environment")
    :ok
  end
end

defmodule Nebulith.DataMigration.BuiltInCatalog do
  @moduledoc """
  The built-in catalog: every tile, composition, item, ability, generator, zone, combat rule and UI element
  the app serves out of the box.

  This is what a fresh database used to get from `priv/repo/seeds.exs` directly. It is the FIRST data
  migration instead, so there is one path to the data: `seeds.exs` runs the data-migration runner, the runner
  runs this, and every later pass edits what this wrote. A live database that already holds the catalog
  records this as applied rather than running it, which is what `mix nebulith.data_migrate --baseline` is for.

  Each source's `seed/0` is idempotent: it upserts by the row's natural key. Running it again re-lands
  whatever the source says today, which also means it overwrites a row tuned by hand in the editor, so it is
  run deliberately and never on a boot path.
  """
  require Logger

  alias Nebulith.Catalog.AbilitySource
  alias Nebulith.Catalog.CombatSource
  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Catalog.ItemSource
  alias Nebulith.Catalog.TileSource
  alias Nebulith.Catalog.UiSource
  alias Nebulith.Catalog.ZoneSource

  def run do
    # Height normalisation across styles is part of seed/0, so a fresh catalog is correct on its own.
    TileSource.seed()

    items = ItemSource.seed()
    abilities = AbilitySource.seed()

    # Categories (wilderness/village/town/city/cave/temple) and the generators under them.
    {categories, generators} = GeneratorSource.seed()

    # The seasons and biomes, plus the season-independent rule bundles (trees, props) the generators read.
    # ZoneSource writes those bundles through CombatSource.put_rules/1.
    %{zones: zones, rules: zone_rules} = ZoneSource.seed()

    # Damage formulas, special-resource costs, per-kind base stats. These land under different `game_rules`
    # keys than the zone bundles above, so the two cannot clobber each other and their order does not matter.
    %{rules: combat_rules} = CombatSource.seed()

    # The action registry plus the default profile's bars, bindings and elements. Without this the Player UI
    # panel and every key binding serve empty.
    %{actions: ui_actions, elements: ui_elements, profile: ui_profile} = UiSource.seed()

    Logger.info(
      "[data_migrate] built-in catalog: #{items} items, #{abilities} abilities, " <>
        "#{categories} generator categories, #{generators} generators, #{zones} zones, " <>
        "#{zone_rules} zone rule bundles, #{combat_rules} combat rule bundles, " <>
        "#{ui_actions} ui actions, #{ui_elements} elements in profile '#{ui_profile}'"
    )

    :ok
  end
end

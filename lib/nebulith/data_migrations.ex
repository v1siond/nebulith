defmodule Nebulith.DataMigrations do
  @moduledoc """
  The registry and runner for DATA migrations.

  A schema migration changes the SHAPE of the database and runs on every boot path that calls
  `mix ecto.migrate`. A data migration changes the ROWS, and rows are expensive: seeding the tile catalog
  walks eight hundred upserts and re-bakes label facts across two styles. Putting that in `priv/repo/migrations`
  makes a fresh `ecto.migrate` slow enough to time out a deploy, and makes every test database pay for rows no
  test asked for. So the two are separated: schema in the migrations folder, data in
  `lib/nebulith/data_migrations/`, run BY HAND once the app is up.

      mix nebulith.data_migrate            # every pass that has not run yet
      mix nebulith.data_migrate --list     # what is registered, and what is pending
      mix nebulith.data_migrate --only SeedEntrances
      mix nebulith.data_migrate --baseline # record pending as run WITHOUT running it

  ## The ledger

  A pass that has run is recorded in the `data_migrations` table by its module's short name, so re-running
  the task does nothing. Every module's `run/0` is idempotent on top of that, which is what makes `--only`
  and a repeat run safe.

  ## Why the modules carry no "is the table populated yet" guard

  The versions in `priv/repo/migrations` each carried a `tilesets_present?` / `generators_present?` /
  `compositions_present?` guard, because a migration runs against a half-built schema on a database that may
  be empty, and a seeder firing there handed the test database tilesets it never asked for. None of that can
  happen here. A data migration runs only after the FULL schema exists and only when someone asks for it, and
  `BuiltInCatalog` is first in the list, so by the time any later pass runs the rows it edits are there.

  ## Order

  The list below is the order they run in, and it is not alphabetical or chronological by accident:

    * `BuiltInCatalog` is first. It is the seed a fresh database gets, and every pass after it edits what it
      wrote.
    * then the passes lifted out of `priv/repo/migrations`, in the order their migrations ran.
    * then the height and parity passes last. Their whole job is to settle what the seeders land, so any pass
      that re-runs a seeder has to come before them.

  `AllBlocksMinHeight1` is deliberately absent: it raised every tile below one block up to one block, and the
  live database carries that effect, but it was taken out of the runner when the ground went flat. Registering
  it now would raise heights the ground pass then has to lower again. The module is kept because
  `GroundTilesAreFlat` documents itself against it.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  @migrations [
    Nebulith.DataMigration.BuiltInCatalog,
    Nebulith.DataMigration.DistinctAsciiGlyphs,
    Nebulith.DataMigration.DistinctAsciiGlyphsRoundTwo,
    Nebulith.DataMigration.AsciiGlyphsResolveRemaining,
    Nebulith.DataMigration.StylePresentationForTilesets,
    Nebulith.DataMigration.AsciiUnitArtFigures,
    Nebulith.DataMigration.DropBagAndJournalButtons,
    Nebulith.DataMigration.BackfillLevelsFromGameTemplates,
    Nebulith.DataMigration.AddFlatFloorTile,
    Nebulith.DataMigration.FadeTreesAndExteriorNearHero,
    Nebulith.DataMigration.AddGrowthTiles,
    Nebulith.DataMigration.DeleteBigHouseComposition,
    Nebulith.DataMigration.AgreeLabelColors,
    Nebulith.DataMigration.SeedWaterLook,
    Nebulith.DataMigration.WaterSurfaceBelowTheBank,
    Nebulith.DataMigration.OneWaterColour,
    Nebulith.DataMigration.WaterBendTile,
    Nebulith.DataMigration.BridgeDeckAndPostsByZWidth,
    Nebulith.DataMigration.SeedGenerationLayers,
    Nebulith.DataMigration.SeedEntrances,
    Nebulith.DataMigration.GeneratorsNameTheirEntrance,
    Nebulith.DataMigration.ApprovedEntrancesNamedForWhatTheyAre,
    Nebulith.DataMigration.AJungleYouCanWalkAcross,
    Nebulith.DataMigration.TheSeedersThatNeverRan,
    Nebulith.DataMigration.APathwayIsAMaterialNotATint,
    Nebulith.DataMigration.TheLayersAreTheModel,
    Nebulith.DataMigration.APathIsLighterThanTheGround,
    Nebulith.DataMigration.BuildUpToALayer,
    Nebulith.DataMigration.TheLayersPanelIsTheFilter,
    Nebulith.DataMigration.ATownGatewayIsNotABlackHole,
    Nebulith.DataMigration.TheWayWearsItsOwnColour,
    Nebulith.DataMigration.TheWhiteLinesInTheMiddle,
    Nebulith.DataMigration.APathIsAFamilyOfPieces,
    Nebulith.DataMigration.ThePathPiecesCarryTheirColour,
    Nebulith.DataMigration.EveryTypeIsAnEnvironment,
    Nebulith.DataMigration.TheFieldComesOverTheWay,
    Nebulith.DataMigration.FlatTilesMinimalHeight,
    Nebulith.DataMigration.AsciiPathFloorHeight,
    Nebulith.DataMigration.AsciiEmojiBehaviorParity,
    Nebulith.DataMigration.AsciiEmojiVocabularyParity,
    Nebulith.DataMigration.BackfillCompositionCategories,
    Nebulith.DataMigration.FlatTilesZeroHeight,
    Nebulith.DataMigration.GroundTilesAreFlat,
    Nebulith.DataMigration.ABloomIsNotGroundCover,
    Nebulith.DataMigration.FlatDecorStacksAtTheBottomFace,
    Nebulith.DataMigration.GroundCoverNeedsRealArt,
    Nebulith.DataMigration.NothingIsStrewnAcrossTheWay,
    Nebulith.DataMigration.ABridgeIsAssembledNotStretched,
    Nebulith.DataMigration.ASolidBlockAndAStoneThatReadsAsStone,
    Nebulith.DataMigration.NoBridgeIsAChoice,
    Nebulith.DataMigration.TwoSetsOfWaterAndThreeCorrections,
    Nebulith.DataMigration.AWaterSetIsAChoice,
    Nebulith.DataMigration.YouWalkOverABridgeNotUnderIt,
    Nebulith.DataMigration.ATempleHasItsOwnMouth,
    Nebulith.DataMigration.AnOptionBelongsToAGroup,
    Nebulith.DataMigration.AnElementShowsWhatItDoes,
    Nebulith.DataMigration.AnOrnamentIsASingleTileAndARockStopsYou,
    Nebulith.DataMigration.ATownBuildsTheCrossingYouPicked,
    Nebulith.DataMigration.LiquidsLavaAndAMountainThatErupted,
    Nebulith.DataMigration.TreesGoBackToWhatWorked,
    Nebulith.DataMigration.AForestWearsItsOwnRegion,
    Nebulith.DataMigration.UndergrowthBelongsToItsBiome,
    Nebulith.DataMigration.FourSpeciesHeAskedFor,
    Nebulith.DataMigration.UndoTheDesertTiles,
    Nebulith.DataMigration.ADesertGrowsDesertTrees,
    Nebulith.DataMigration.HowMuchGrowsThere,
    Nebulith.DataMigration.ACactusIsAnObject,
    Nebulith.DataMigration.ATownGrowsWhatSurroundsIt,
    Nebulith.DataMigration.TheGroundBelongsToItsBiome,
    Nebulith.DataMigration.NoTwoCactiAlike,
    Nebulith.DataMigration.GrassIsASingleTileToo,
    Nebulith.DataMigration.ARegionFloorComesFromItsBiome,
    Nebulith.DataMigration.TheGroundAPlaceIsMadeOf,
    Nebulith.DataMigration.TwoBiomesOutOfOrder,
    Nebulith.DataMigration.AVolcanoBurnsInBands,
    Nebulith.DataMigration.ABeachGrowsDuneGrass,
    Nebulith.DataMigration.AVolcanoYouCanSee,
    Nebulith.DataMigration.EveryBiomeItsOwnRegions,
    Nebulith.DataMigration.AnOakIsNotAnEncina,
    Nebulith.DataMigration.TheRegionPickerOffersRealRegions,
    Nebulith.DataMigration.ABeachHasASea,
    Nebulith.DataMigration.EveryRegionIsAPlace,
    Nebulith.DataMigration.ARegionsWaterIsTheMapsWater,
    Nebulith.DataMigration.EachRegionIsItsOwnPlace,
    Nebulith.DataMigration.ReliefOnlyWhereItIsTheJourney,
    Nebulith.DataMigration.TheBloomsARegionLost,
    Nebulith.DataMigration.TheSpeciesARegionLost,
    Nebulith.DataMigration.AStreetIsTheOnlyPaintOnATown,
    Nebulith.DataMigration.ARegionGrowsItsOwnTrees,
    Nebulith.DataMigration.TheDesertKeepsItsCacti,
    Nebulith.DataMigration.TheHeartAloneStandsOnItsPlatform
  ]

  @doc "Every registered data migration module, in run order."
  def all, do: @migrations

  @doc "The short name a module is recorded under, e.g. `SeedEntrances`."
  def name(module), do: module |> Module.split() |> List.last()

  @doc "The names already recorded in the `data_migrations` table."
  def ran, do: Repo.all(from(d in "data_migrations", select: d.name, order_by: d.run_at))

  @doc "The registered modules with no row in the ledger, in run order."
  def pending do
    done = MapSet.new(ran())
    Enum.reject(@migrations, &MapSet.member?(done, name(&1)))
  end

  @doc """
  Runs every pending data migration in order and records each one. Returns the names it ran.
  """
  def run_pending, do: Enum.map(pending(), &apply_migration/1)

  @doc """
  Runs ONE data migration by short name, whether or not it has run before, and records it.

  The pass is idempotent, so re-running it by hand is how you re-apply a seeder after changing its source.
  """
  def run_one(wanted) when is_binary(wanted), do: wanted |> fetch() |> apply_migration()

  @doc """
  Records every pending data migration as run WITHOUT running it, and returns the names.

  This is how a database that already carries the effects adopts the ledger: the passes were applied by the
  migrations they used to live in, so running them again would be dead work at best and would overwrite
  settings tuned in the editor at worst.
  """
  def baseline, do: Enum.map(pending(), &record_only/1)

  defp apply_migration(module) do
    started = System.monotonic_time(:millisecond)
    module.run()
    record(module)
    elapsed = System.monotonic_time(:millisecond) - started
    Logger.info("[data_migrate] #{name(module)} ran in #{elapsed}ms")
    name(module)
  end

  defp record_only(module) do
    record(module)
    Logger.info("[data_migrate] #{name(module)} recorded as already applied")
    name(module)
  end

  defp record(module) do
    Repo.insert_all(
      "data_migrations",
      [%{name: name(module), run_at: DateTime.truncate(DateTime.utc_now(), :second)}],
      on_conflict: :nothing,
      conflict_target: :name
    )
  end

  defp fetch(wanted), do: @migrations |> Enum.find(&(name(&1) == wanted)) |> found(wanted)

  defp found(nil, wanted) do
    raise ArgumentError,
          "no data migration named #{inspect(wanted)}. Registered: " <>
            Enum.map_join(@migrations, ", ", &name/1)
  end

  defp found(module, _wanted), do: module
end

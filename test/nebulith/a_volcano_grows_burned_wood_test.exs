defmodule Nebulith.AVolcanoGrowsBurnedWoodTest do
  @moduledoc """
  A GENERATOR MAY ONLY ASK FOR SPECIES THAT EXIST.

  The volcanic mix has named `tree_burned_pine`, `tree_burned_birch`, `tree_burned_oak` and
  `tree_burned_encina` for as long as it has existed. The catalog has never contained any of them:
  measured, the string `tree_burned` appeared in two data migrations and ZERO times in the seeder. So
  the volcano has been asking for four species that resolve to nothing, and placing nothing, which is
  what "we no longer have zones with burned trees" looks like from the outside.

  `docs/OBJECT-CONSTRUCTION.md` checklist item 5 is this failure exactly: a composition naming a label
  nothing seeds places nothing, and it fails silently. So the check here is the general one, not four
  hardcoded names: EVERY species any generator asks for must be a composition the catalog serves, and
  every cell of that composition must name a tile the catalog serves.

  Written as the general law rather than as four names on purpose. Four names would go green the moment
  these four were added and say nothing about the fifth species somebody adds next.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog

  setup do
    Catalog.TileSource.seed()
    Catalog.GeneratorSource.seed()
    :ok
  end

  test "every species a generator asks for is a composition the catalog serves" do
    served = MapSet.new(Catalog.list_compositions(), & &1.name)

    missing =
      for {generator, kind} <- species_asked_for(),
          not MapSet.member?(served, kind),
          do: "#{generator} asks for #{kind}"

    assert missing == [],
           "a generator asks for a species nothing builds, so it places nothing and says nothing: " <>
             (missing |> Enum.uniq() |> Enum.join(", "))
  end

  test "every cell of every composition names a tile the catalog serves" do
    served = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)

    missing =
      for composition <- Catalog.list_compositions(),
          cell <- composition.cells,
          not MapSet.member?(served, cell.label),
          do: "#{composition.name} places #{cell.label}"

    assert missing == [],
           "a composition names a tile nothing seeds, so that cell draws nothing: " <>
             (missing |> Enum.uniq() |> Enum.take(10) |> Enum.join(", "))
  end

  test "the volcano's burned wood is charred, not the living wood recoloured by accident" do
    burned =
      for composition <- Catalog.list_compositions(),
          String.starts_with?(composition.name, "tree_burned"),
          do: composition

    assert length(burned) == 4,
           "the catalog serves #{length(burned)} burned species and the volcanic mix names four"

    living =
      for composition <- burned,
          cell <- composition.cells,
          cell.label in ["trunk_mid", "leaf_center"],
          do: "#{composition.name} still uses #{cell.label}"

    assert living == [],
           "a burned tree drawing the LIVING wood is a green tree in an ash field: " <>
             Enum.join(living, ", ")
  end

  # A FIRE STRIPS THE CROWN AND LEAVES THE TRUNK, so the trunk is the part that must NOT differ.
  # `tree_burned_birch` measures against `tree_column` because no `tree_birch` exists: `tree_column` is
  # the long straight bare trunk, which is what a birch is.
  @counterparts %{
    "tree_burned_pine" => "tree_conifer",
    "tree_burned_birch" => "tree_column",
    "tree_burned_oak" => "tree_oak",
    "tree_burned_encina" => "tree_encina"
  }

  test "a burned species stands on its living counterpart's trunk, to the number" do
    by_name = Map.new(Catalog.list_compositions(), &{&1.name, &1})

    drifted =
      for {burned, living} <- @counterparts,
          burned_trunk = trunk_of(by_name[burned]),
          living_trunk = trunk_of(by_name[living]),
          burned_trunk != living_trunk,
          do: "#{burned} #{inspect(burned_trunk)} against #{living} #{inspect(living_trunk)}"

    assert drifted == [],
           "a burned trunk was rewritten instead of inherited, so the wood no longer reads as the wood " <>
             "it used to be: " <> Enum.join(drifted, " | ")
  end

  # The trunk WITHOUT its label, because the label is the one thing that is MEANT to differ (charred wood
  # against living wood). Everything else is the species stating its proportions, and those are inherited.
  #
  # Dropped by subtraction rather than picked field by field: a named list of fields stops covering the
  # cell the day a field is added to it, which is the exact moment a drift check most needed to.
  @not_the_shape [
    :__struct__,
    :__meta__,
    :id,
    :label,
    :composition,
    :composition_id,
    :inserted_at,
    :updated_at
  ]

  defp trunk_of(nil), do: nil

  defp trunk_of(composition) do
    composition.cells
    |> Enum.find(&(&1.level == 0))
    |> case do
      nil -> nil
      cell -> cell |> Elixir.Map.from_struct() |> Elixir.Map.drop(@not_the_shape)
    end
  end

  test "the charred parts survive the whole seed and point at a picture that is on disk" do
    static = Path.join(:code.priv_dir(:nebulith), "static")

    parts =
      for style <- ["ascii", "emoji"],
          tile <- Catalog.list_tiles_for(style),
          tile.label in ["trunk_charred", "leaf_scorched"],
          do: {style, tile}

    assert length(parts) == 4,
           "both charred parts exist in both styles, found #{length(parts)}"

    # THE SEEDER-ORDERING TRAP. `upsert_tile` replaces the WHOLE settings map, so a pass running after
    # this one silently erases the tone and the wood comes out the colour of living bark. That is the
    # blossom defect exactly, and it cost a round trip, so it is a gate rather than a reading of the code.
    faded =
      for {style, tile} <- parts,
          (tile.settings || %{})["color"] not in ["#3b322c", "#4a423c"],
          do: "#{style}/#{tile.label} carries #{inspect((tile.settings || %{})["color"])}"

    assert faded == [],
           "a later seeder pass wiped the charred tone, so the burned wood draws as living bark: " <>
             Enum.join(faded, ", ")

    # A tile pointed at a PNG that is not there draws NOTHING and says nothing, which looks exactly like
    # the composition being absent. The charred parts deliberately reuse the living wood's baked art at a
    # darker tone, so this is the check that the reuse still resolves.
    absent =
      for {style, tile} <- parts,
          not File.exists?(Path.join(static, tile.image_url || "")),
          do: "#{style}/#{tile.label} points at #{tile.image_url}"

    assert absent == [],
           "a charred part points at a picture that is not on disk, so it draws nothing: " <>
             Enum.join(absent, ", ")
  end

  # EVERY SPECIES ANY GENERATOR NAMES, from the environment mix and from every region's own mix, because
  # a region states its own trees and a check that reads only the environment misses most of them.
  defp species_asked_for do
    for generator <- all_generators(),
        config = generator.config || %{},
        {_where, mix} <- [{"trees", config["trees"]} | region_mixes(config)],
        is_list(mix),
        entry <- mix,
        kind = entry["kind"],
        is_binary(kind),
        do: {generator.key, kind}
  end

  defp region_mixes(config) do
    case config["subZones"] do
      zones when is_list(zones) -> for zone <- zones, do: {zone["key"], zone["trees"]}
      _ -> []
    end
  end

  defp all_generators do
    Catalog.list_generator_categories() |> Enum.flat_map(& &1.generators)
  end
end

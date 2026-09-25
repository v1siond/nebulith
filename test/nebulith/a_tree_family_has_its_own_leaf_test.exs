defmodule Nebulith.ATreeFamilyHasItsOwnLeafTest do
  @moduledoc """
  A LEAF PER TREE FAMILY, AND A CROWN THAT COVERS ITS OWN TRUNK.

  His words: *"Fix trees, also, let's use different leaf tiles for the leaf section of the trees... a
  specific leaf tile per tree FAMILY, not per tree object"*, and on the same screenshot, *"small trees
  that look like bushes have trunks"*.

  ## What was measured before

  Every one of the sixteen species drew `leaf_center`, which is the three ascii characters `@&@` baked
  into a picture. A palm, a pine and a cherry were the same shape in three greens. The per-species
  `leaf_label` hook already existed in `tree_comp/1` and not one species used it.

  And three species stated a crown no WIDER than their own trunk, so the pole stuck out past the foliage
  on both sides: `tree_small` (1.0 trunk under a 0.95 crown), `tree_cypress` (1.3 under 1.3) and
  `tree_sapling` (0.8 under 0.7). That is the shape in the screenshot.

  ## The families are the references', not a taxonomy invented here

  `docs/references/SOURCES.md` records five images under `by-subject/trees/`, sent with *"we need to have
  more variance of trees, like we are using the same for all forest variations"*. They show a dry hillside
  of small rounded scrub, a dense needle slope, a beech avenue of round crowns, old growth conifer
  columns, and laurisilva with wide flat gnarled crowns. The palm and the blossom are the two the set does
  not cover, and both are distinct by form.

  This checks the DATA. `Nebulith.E2E.AForestHasMoreThanOneLeafTest` checks what a generated forest
  actually puts down, and the look is his, at :3000.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource

  setup do
    TileSource.seed()
    :ok
  end

  test "every family's leaf is a real tile in every style" do
    for style <- ~w(ascii emoji) do
      labels = MapSet.new(Catalog.list_tiles_for(style), & &1.label)

      missing =
        for leaf <- Enum.uniq(Elixir.Map.values(TileSource.species_families())),
            not MapSet.member?(labels, leaf),
            do: leaf

      assert missing == [],
             "#{style} names a family leaf nothing seeds, so those crowns draw nothing: " <>
               Enum.join(missing, ", ")
    end
  end

  test "species in one family share a leaf, and different families do not" do
    families = TileSource.species_families()

    assert map_size(families) > 10,
           "only #{map_size(families)} species are classified, so this proves little"

    by_leaf = Enum.group_by(families, fn {_species, leaf} -> leaf end)

    assert map_size(by_leaf) > 3,
           "every species resolved to #{map_size(by_leaf)} leaf, which is the defect this fixes: " <>
             inspect(Elixir.Map.keys(by_leaf))

    # …AND THE COMPOSITIONS ACTUALLY USE IT. A table nothing reads is the same as no table.
    comps = Elixir.Map.new(Catalog.list_compositions(), &{&1.name, &1})

    wrong =
      for {species, leaf} <- families,
          comp = comps[species],
          comp,
          leaves =
            for(cell <- comp.cells, String.starts_with?(cell.label, "leaf"), do: cell.label),
          leaves != [],
          Enum.any?(leaves, &(&1 != leaf)),
          do: "#{species} is #{leaf} and draws #{inspect(Enum.uniq(leaves))}"

    assert wrong == [],
           "a species does not draw its family's leaf: " <> Enum.join(wrong, ", ")
  end

  test "no tree is left drawing the shared leaf, classified or not" do
    unclassified =
      for comp <- Catalog.list_compositions(),
          Enum.any?(comp.cells, &(&1.label == "leaf_center")),
          do: comp.name

    assert unclassified == [],
           """
           #{length(unclassified)} composition(s) still draw the shared `leaf_center`, which is the three
           characters `@&@` baked into a picture:
             #{Enum.join(unclassified, "\n  ")}
           The family table only checks species it has been TOLD about, so an unclassified one is invisible
           to it. This asks the other way round: what is still drawing the old leaf.
           """
  end

  test "no two families draw the same picture, in either style" do
    families = Enum.uniq(Elixir.Map.values(TileSource.species_families()))

    for style <- ~w(ascii emoji) do
      by_label = Elixir.Map.new(Catalog.list_tiles_for(style), &{&1.label, &1.image_url})

      shared =
        families
        |> Enum.map(&{&1, by_label[&1]})
        |> Enum.filter(fn {_family, path} -> path end)
        |> Enum.map(fn {family, path} -> {family, digest(path)} end)
        |> Enum.group_by(&elem(&1, 1), &elem(&1, 0))
        |> Enum.filter(fn {_digest, names} -> length(names) > 1 end)

      assert shared == [],
             """
             In #{style} these families bake to a BYTE IDENTICAL picture, so they are one family wearing
             two names: #{inspect(Enum.map(shared, &elem(&1, 1)))}
             Measured the day this was written: the emoji leaves for the broad and the gnarled families
             were both a tree emoji, so ascii had six families and emoji had five. Nothing else catches
             this: both labels exist, both are seeded, both parity checks pass, and the map still draws
             the same crown twice.
             """
    end
  end

  test "no tree wears its trunk outside its crown" do
    comps = Elixir.Map.new(Catalog.list_compositions(), &{&1.name, &1})

    trees =
      for {name, comp} <- comps,
          String.starts_with?(name, "tree_"),
          # A BURNED TREE IS THE ONE CASE WHERE A NARROW CROWN IS RIGHT. The fire took the crown and left
          # the trunk, which is what those four species are FOR, and their builder says so. Exempting them
          # is the rule, not a hole in it: they state the shape on purpose.
          not String.starts_with?(name, "tree_burned"),
          trunk = Enum.find(comp.cells, &String.starts_with?(&1.label, "trunk")),
          leaf = Enum.find(comp.cells, &String.starts_with?(&1.label, "leaf")),
          trunk && leaf,
          do: {name, across(trunk), across(leaf)}

    refute trees == [], "no trunked tree was found, so this check would pass on an empty catalog"

    sticks =
      for {name, trunk_w, leaf_w} <- trees,
          leaf_w <= trunk_w,
          do: "#{name}: trunk #{trunk_w} under a crown of #{leaf_w}"

    assert sticks == [],
           """
           #{length(sticks)} tree(s) have a crown no wider than the trunk holding it up, so the pole
           shows on both sides and it reads as a bush on a stick:
             #{Enum.join(sticks, "\n  ")}
           """
  end

  # THE PICTURE ITSELF, not its path. Two labels can point at two files that hold the same image.
  defp digest(image_path) do
    path = Path.join(Application.app_dir(:nebulith, "priv/static"), image_path)

    case File.read(path) do
      {:ok, bytes} -> :erlang.md5(bytes)
      _ -> image_path
    end
  end

  # HOW WIDE A CELL DRAWS on the ground, which is what decides whether the crown covers the trunk.
  defp across(cell) do
    settings = cell.settings || %{}
    Float.round((settings["scaleX"] || 1.0) * 1.0 * (cell.scale || 1.0), 3)
  end
end

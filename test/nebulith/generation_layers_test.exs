defmodule Nebulith.GenerationLayersTest do
  @moduledoc """
  THE GENERATION LAYERS ARE ROWS, not a list in the engine.

  *"I think these layers should be backend based and I think we should be able to create them in the backend …
  at least we can seed the layers we have, add the crud … I just don't want anything hardcoded on the
  frontend … we're also hardcoding on the actual engine, that's where we need to update it"* (2026-09-14).

  So the things worth asserting are: the six we have are seeded in RUN ORDER, a new one can be created without
  a deploy (the fog layer he named is the example used here), and the order is what `position` says rather than
  insertion or alphabet.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Catalog
  alias Nebulith.Catalog.GeneratorSource

  setup do
    GeneratorSource.seed_generation_layers()
    :ok
  end

  defp keys, do: Enum.map(Catalog.list_generation_layers(), & &1.key)

  test "the layers we have are seeded, in the order generation runs them" do
    assert keys() ==
             ~w(terrain water pathways buildings nature decor units fog lightning shadow post_processing)
  end

  test "terrain leads, and the water is laid before the pathways that go around it" do
    # THE ORDER IS HIS, and this test used to assert the opposite of it. It said `ways` led, "because the
    # exits and paths are planned before anything is built around them", which is backwards: *"water (which
    # blocks pathways) > pathways (which adapts to available space left by water on grid)"*. A path cannot
    # adapt to water that has not been laid yet.
    order = keys()
    assert List.first(order) == "terrain"
    assert index(order, "water") < index(order, "pathways")
    assert index(order, "pathways") < index(order, "buildings")
  end

  test "a group is a NAME for a run of layers, not a layer of its own" do
    # `layout` and `objects` were both served as if they were layers. They are the names of the groups that
    # terrain/water/pathways and buildings/nature/decor form, which is why a SECOND pathways layer could be
    # added beside the first without anything noticing.
    by_key = Map.new(Catalog.list_generation_layers(), &{&1.key, &1})

    refute Map.has_key?(by_key, "layout"), "layout is a group, not a layer"
    refute Map.has_key?(by_key, "objects"), "objects is a group, not a layer"

    for key <- ~w(terrain water pathways), do: assert(by_key[key].group == "layout")
    for key <- ~w(buildings nature decor), do: assert(by_key[key].group == "objects")
    assert by_key["units"].group == nil
  end

  test "the layers he named and nobody built are rows, and offer no button" do
    by_key = Map.new(Catalog.list_generation_layers(), &{&1.key, &1})

    for key <- ~w(fog lightning shadow post_processing) do
      assert Map.has_key?(by_key, key), "#{key} is a layer he named and it has to be in the list"

      refute by_key[key].seedable,
             "#{key} has no pass yet, so the panel must not offer a re-roll for it"
    end
  end

  defp index(list, key), do: Enum.find_index(list, &(&1 == key))

  test "every seeded layer says what it is and what it does" do
    for layer <- Catalog.list_generation_layers() do
      assert layer.label not in [nil, ""]
      assert layer.hint not in [nil, ""]

      # BY CODEPOINT, because the literal is the thing under test. A sweep that replaced em dashes across the
      # repo rewrote this assertion's own needle into ", ", so it forbade COMMAS instead, which every hint
      # has. It never failed anyway: the seeder it depends on had been deleted, so the list was empty and the
      # loop body never ran. Two faults hiding each other, and restoring the seeder is what surfaced both.
      for dash <- [<<0x2014::utf8>>, <<0x2013::utf8>>] do
        refute String.contains?(layer.hint, dash),
               "#{layer.key}: no em dashes in anything user-facing"
      end
    end
  end

  describe "a layer that does not exist yet" do
    test "can be created, and lands in the run order its position asks for" do
      {:ok, added} =
        Catalog.create_generation_layer(%{
          "key" => "reflection",
          "label" => "Water reflection",
          "hint" => "what the water gives back, once there is water to give it",
          "position" => 35,
          "seedable" => true
        })

      assert added.key == "reflection"

      # 35 sits between pathways (30) and buildings (40), and the list says so without being re-sorted by hand
      assert keys() ==
               ~w(terrain water pathways reflection buildings nature decor units fog lightning shadow post_processing)
    end

    test "can be updated and deleted, so the list is edited rather than deployed" do
      {:ok, fog} =
        Catalog.create_generation_layer(%{"key" => "haze", "label" => "Haze", "position" => 75})

      {:ok, renamed} = Catalog.update_generation_layer(fog, %{"label" => "Haze and murk"})
      assert renamed.label == "Haze and murk"

      {:ok, _} = Catalog.delete_generation_layer(renamed)
      refute "haze" in keys()
    end
  end

  describe "what the table refuses" do
    test "two layers cannot share a key, because the engine binds its pass to that key" do
      assert {:error, changeset} =
               Catalog.create_generation_layer(%{
                 "key" => "pathways",
                 "label" => "Pathways again"
               })

      assert %{key: ["has already been taken"]} = errors_on(changeset)
    end

    test "a key the engine could not bind to is refused" do
      assert {:error, changeset} =
               Catalog.create_generation_layer(%{"key" => "Water Reflection", "label" => "x"})

      assert Map.has_key?(errors_on(changeset), :key)
    end

    test "a layer with no label is refused: the panel has nothing to show for it" do
      assert {:error, changeset} = Catalog.create_generation_layer(%{"key" => "reflection"})
      assert %{label: ["can't be blank"]} = errors_on(changeset)
    end
  end

  test "seeding twice changes nothing, so a migration can be re-run" do
    before = keys()
    GeneratorSource.seed_generation_layers()
    assert keys() == before
  end
end

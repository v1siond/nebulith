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
    assert keys() == ~w(ways layout buildings nature decor units)
  end

  test "ways leads, because the exits and paths are planned before anything is built around them" do
    assert List.first(keys()) == "ways"
  end

  test "every seeded layer says what it is and what it does" do
    for layer <- Catalog.list_generation_layers() do
      assert layer.label not in [nil, ""]
      assert layer.hint not in [nil, ""]
      refute String.contains?(layer.hint, "—"), "#{layer.key}: no em dashes in anything user-facing"
    end
  end

  describe "a layer that does not exist yet" do
    test "can be created, and lands in the run order its position asks for" do
      {:ok, fog} =
        Catalog.create_generation_layer(%{
          "key" => "fog",
          "label" => "Fog",
          "hint" => "a fog pass over the finished map",
          "position" => 35,
          "seedable" => true
        })

      assert fog.key == "fog"
      # 35 sits between buildings (30) and nature (40), and the list says so without being re-sorted by hand
      assert keys() == ~w(ways layout buildings fog nature decor units)
    end

    test "can be updated and deleted, so the list is edited rather than deployed" do
      {:ok, fog} = Catalog.create_generation_layer(%{"key" => "fog", "label" => "Fog", "position" => 70})
      {:ok, renamed} = Catalog.update_generation_layer(fog, %{"label" => "Fog and haze"})
      assert renamed.label == "Fog and haze"

      {:ok, _} = Catalog.delete_generation_layer(renamed)
      refute "fog" in keys()
    end
  end

  describe "what the table refuses" do
    test "two layers cannot share a key, because the engine binds its pass to that key" do
      assert {:error, changeset} = Catalog.create_generation_layer(%{"key" => "ways", "label" => "Ways again"})
      assert %{key: ["has already been taken"]} = errors_on(changeset)
    end

    test "a key the engine could not bind to is refused" do
      assert {:error, changeset} = Catalog.create_generation_layer(%{"key" => "Water Reflection", "label" => "x"})
      assert Map.has_key?(errors_on(changeset), :key)
    end

    test "a layer with no label is refused: the panel has nothing to show for it" do
      assert {:error, changeset} = Catalog.create_generation_layer(%{"key" => "shadow"})
      assert %{label: ["can't be blank"]} = errors_on(changeset)
    end
  end

  test "seeding twice changes nothing, so a migration can be re-run" do
    before = keys()
    GeneratorSource.seed_generation_layers()
    assert keys() == before
  end
end

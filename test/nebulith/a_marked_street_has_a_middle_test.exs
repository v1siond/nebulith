defmodule Nebulith.AMarkedStreetHasAMiddleTest do
  @moduledoc """
  A PATHWAY THAT CARRIES A LINE DOWN ITS MIDDLE HAS A MIDDLE.

  The reason is the rule, and the rule is checkable: a marking sits in the centre cell, and a pathway
  of even width has no centre cell. `city_street` was four across, which is why its line could only
  ever be drawn off centre.

  Written as "marked pathways are odd" rather than "city pathways are odd" because that is the actual
  constraint. A two plank boardwalk carries no line and has nothing to miss.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.Generator
  alias Nebulith.Repo

  setup do
    Catalog.GeneratorSource.seed()
    :ok
  end

  test "every pathway carrying a marking is an odd number of cells across" do
    even =
      for {key, way} <- served_pathways(),
          Elixir.Map.has_key?(way, "marking"),
          width = way["width"],
          is_integer(width),
          rem(width, 2) == 0,
          do: "#{key} is #{width} cells across and carries a marking"

    assert even == [],
           "a centre line cannot be centred on an even width: " <> Enum.join(even, ", ")
  end

  test "some pathway carries a marking, so the check above has something to check" do
    marked =
      for {key, way} <- served_pathways(), Elixir.Map.has_key?(way, "marking"), do: key

    assert marked != [], "no pathway carries a marking, so the odd width check proves nothing"
  end

  test "every pathway states a width at all" do
    silent = for {key, way} <- served_pathways(), not is_integer(way["width"]), do: key

    assert silent == [], "these pathways state no width: #{inspect(silent)}"
  end

  # AND AN EXISTING DATABASE, which the checks above cannot see: they read a fresh seed, so they passed
  # the whole time his database still had the four cell street.
  #
  # This used to run a data migration. There is no migration any more, and there does not need to be: the
  # seeder writes `generators.config` WHOLE, so re-seeding IS the repair for an existing row. That is the
  # same reason 29 passes that wrote this column were retired (`Nebulith.DataMigrations` moduledoc). What
  # is worth keeping is the case, so it is put to the thing that owns the fact now.
  test "re-seeding widens a street that an existing database left four cells across" do
    marked =
      Enum.find(Repo.all(Generator), fn g ->
        is_map(g.config["pathway"]) and Elixir.Map.has_key?(g.config["pathway"], "marking")
      end)

    assert marked, "no generator carries a marked pathway, so this proves nothing"

    narrowed = put_in(marked.config, ["pathway", "width"], 4)
    {:ok, _} = marked |> Ecto.Changeset.change(config: narrowed) |> Repo.update()

    Catalog.GeneratorSource.seed()

    assert Repo.get!(Generator, marked.id).config["pathway"]["width"] == 5,
           "a re-seed left a four cell marked street alone, so an existing database keeps it"
  end

  test "re-seeding widens nothing twice" do
    Catalog.GeneratorSource.seed()
    before = widths_by_key()
    Catalog.GeneratorSource.seed()

    assert widths_by_key() == before,
           "a second seed moved a width, so the seeder is not idempotent and re-running it is not safe"
  end

  defp widths_by_key do
    Elixir.Map.new(served_pathways(), fn {key, way} -> {key, way["width"]} end)
  end

  # `pathway`, SINGULAR: a generator carries ONE way. The first version of this read `pathways`,
  # plural, which is an OPTION key (how many ways to lay down) and never a set of way definitions, so
  # it returned an empty list and every check above passed over nothing. The data migration was
  # reading the same wrong key, which is why a fresh seed looked right and an existing database still
  # had the four cell street.
  defp served_pathways do
    Catalog.list_generator_categories()
    |> Enum.flat_map(& &1.generators)
    |> Enum.flat_map(&way_of/1)
    |> Enum.uniq()
  end

  defp way_of(generator) do
    case Elixir.Map.get(generator.config || %{}, "pathway") do
      way when is_map(way) -> [{generator.key, way}]
      _ -> []
    end
  end
end

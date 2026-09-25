defmodule Nebulith.RockIsNotVioletTest do
  @moduledoc """
  NOTHING A ROCK WEARS IS PURPLE.

  A cliff face takes its colour from `rockShades`, and that palette was five shades of dark violet
  standing in a forest. It went unnoticed because it lives in the props block beside the cave's own
  decor, where a violet looks like it belongs, and because nothing ever asked the question.

  Asked here, of every shade the zones actually serve, so the answer cannot go back to violet quietly.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog.{CombatSource, ZoneSource}

  # The palette as it was authored, the five dark violets a cliff face was actually wearing. Written
  # down here so a scenario can put a database back into the state his was in.
  @violet ["#443b50", "#3d3543", "#3a3340", "#4a4056", "#352e3b"]

  setup do
    ZoneSource.seed()
    :ok
  end

  # How purple a colour is, the same arithmetic the ground census probe uses: blue clearly ahead of
  # green, red not far behind blue. A grey has all three close together and scores zero.
  defp purpleness("#" <> hex) when byte_size(hex) == 6 do
    {r, g, b} =
      {String.to_integer(binary_part(hex, 0, 2), 16),
       String.to_integer(binary_part(hex, 2, 2), 16),
       String.to_integer(binary_part(hex, 4, 2), 16)}

    case b > g + 12 and r > g + 4 do
      true -> min(b - g, r - g)
      false -> 0
    end
  end

  defp purpleness(_), do: 0

  test "no rock shade any zone serves is purple" do
    violet =
      for {zone, shade} <- every_rock_shade(),
          purpleness(shade) > 0,
          do: "#{zone}: #{shade} (purpleness #{purpleness(shade)})"

    assert violet == [],
           "a rock face would draw purple, which is what a row of violet cubes standing in a wood is: " <>
             Enum.join(violet, ", ")
  end

  test "the zones actually serve rock shades at all, so the check above has something to check" do
    assert every_rock_shade() != [],
           "nothing serves rockShades, so the purple check proves nothing"
  end

  # AND THE MIGRATION, which is the half a freshly seeded check cannot see.
  #
  # The setup above reseeds from `ZoneSource`, so the row it then reads is grey because the SOURCE is
  # grey. That says nothing about a database that was seeded before the source changed, and that is
  # every database anybody is using. The migration is the only thing that reaches one.
  #
  # Worth having twice over: the street migration beside this one read a key no row has ever carried,
  # updated nothing, logged a success, and its source-level checks stayed green the whole time.
  test "the migration greys a props bundle that is already violet" do
    props = CombatSource.rule_map()["props"]

    assert is_map(props) and is_list(props["rockShades"]),
           "the props bundle serves no rockShades, so there is nothing for the migration to fix"

    CombatSource.put_rules(%{"props" => Elixir.Map.put(props, "rockShades", @violet)})

    assert CombatSource.rule_map()["props"]["rockShades"] == @violet,
           "could not put the old palette back, so this scenario never reached the state it is about"

    Nebulith.DataMigration.RockIsGreyNotViolet.run()

    still_violet =
      for shade <- CombatSource.rule_map()["props"]["rockShades"],
          purpleness(shade) > 0,
          do: shade

    assert still_violet == [],
           "the migration left a violet rock palette alone, so an existing database keeps its purple " <>
             "cliffs: #{inspect(still_violet)}"
  end

  # FOUND WHEREVER IT IS. The palette lives in a props block inside a zone's json, and a check written
  # against one path stops checking the day somebody moves it, without ever saying so.
  defp every_rock_shade do
    for {key, value} <- CombatSource.rule_map(),
        shade <- shades_in(value),
        do: {key, shade}
  end

  defp shades_in(%{} = node) do
    Enum.flat_map(node, fn
      {"rockShades", shades} when is_list(shades) -> shades
      {_key, value} -> shades_in(value)
    end)
  end

  defp shades_in(list) when is_list(list), do: Enum.flat_map(list, &shades_in/1)
  defp shades_in(_other), do: []
end

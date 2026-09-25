defmodule Nebulith.APickerCannotMissAValueTest do
  @moduledoc """
  PHASE 0'S GATE, second half: *"every value the engine accepts appears in its picker."* (`docs/SPEC.md`
  §8, phase 0.)

  Law 11 splits every list in two and this checks the seam between them: *"A list a person could extend
  without new code is data. A list the engine switches on is code, and is served (D17). Never a second
  copy either way."*

  The TYPE stays in TypeScript, because an exhaustive switch needs one at compile time. The LIST is served
  from `Nebulith.EngineLists`. That leaves exactly one way for them to drift, and this closes it: the
  union is read back out of the engine's own source and compared with what the backend serves.

  ## What it measured before

  Four `const` arrays sitting beside the `<select>` that rendered them, and one of them already wrong:
  `editorAnimation.tsx` carried its own trigger list whose comment admitted the drift, *"`flicker` and
  `night` were fully implemented and unreachable from the panel"*. A value the engine accepted, that no
  menu offered, for as long as nobody noticed.

  ## Why the source is parsed rather than the types imported

  There is no way to ask TypeScript for a union from Elixir, and a list typed out here to compare against
  would be the third copy of the same fact. Reading the union out of the file that declares it means this
  test has no copy of its own: it holds the two owners up against each other.
  """
  use ExUnit.Case, async: true

  alias Nebulith.EngineLists

  @engine "assets/game/engine/animation/tileAnimation.ts"
  @entity "assets/game/game/runtime/entityAnimation.ts"
  @water "assets/game/engine/riverNetwork.ts"
  @liquid "assets/game/engine/waterBody.ts"

  # served list => {the file that declares the type, the type's name}
  @unions %{
    "eases" => {@engine, "Ease"},
    "trigger_events" => {@engine, "TriggerEvent"},
    "views" => {@engine, "TileView"},
    "directions" => {@entity, "AnimDirection"},
    "river_courses" => {@water, "RiverCourse"},
    "liquids" => {@liquid, "Liquid"}
  }

  test "every list the engine switches on is served" do
    served = EngineLists.engine()

    for {list, _} <- @unions do
      assert Elixir.Map.has_key?(served, list),
             "the engine's #{list} are not served, so a picker has to hold its own copy"

      refute served[list] == [],
             "#{list} is served as an empty list, which is a picker with nothing in it"
    end
  end

  test "the served list and the type the engine switches on say exactly the same thing" do
    for {list, {file, type}} <- @unions do
      declared = union_in(file, type)
      served = EngineLists.engine()[list]

      assert MapSet.new(declared) == MapSet.new(served),
             """
             #{type} in #{file} and the served "#{list}" disagree.
               the engine accepts: #{inspect(Enum.sort(declared))}
               the backend serves: #{inspect(Enum.sort(served))}
             A value the engine accepts that nothing serves cannot be chosen; a value served that the
             engine does not accept can be chosen and then does nothing.
             """
    end
  end

  test "the generator offers every shape water can be painted in" do
    courses = EngineLists.engine()["river_courses"]

    offered =
      for row <- Nebulith.Catalog.GeneratorSource.generators(),
          option <- row.options || [],
          option["key"] == "river",
          choice <- option["choices"] || [],
          uniq: true,
          do: choice["key"]

    refute offered == [], "no generator offers a river option at all, so this proves nothing"

    missing = courses -- offered

    assert missing == [],
           """
           The engine paints #{inspect(missing)} and no generator offers it, so a person cannot ask for it.
           Measured when this was written: `shore` and `lake` were both fully built, `carveShore` and
           `carveBody`, and the only route to either was picking a biome whose regions happened to ask.
           The choices the panel draws carry LABELS, so they live in the catalog; what this checks is that
           the catalog covers every value the engine accepts (invariant 6).
           """
  end

  test "no picker holds a list of its own" do
    # The four that were here, by the names they had. A const array of engine values beside a `<select>`
    # is the defect, whatever it is called, and these are the ones that were measured.
    source = File.read!("assets/game/components/editorAnimation.tsx")

    for gone <-
          ~w(ANIM_EASES ANIM_DIRECTIONS ANIM_STYLES ANIM_VIEWS ANIM_TRIGGERS ANIM_TILE_TRIGGERS) do
      refute String.contains?(source, gone <> " ="),
             "#{gone} is a second copy of a list the backend serves, sitting beside the picker again"
    end
  end

  test "the styles offered are the tilesets, not a list of two" do
    source = File.read!("assets/game/engine/animation/tileAnimation.ts")

    refute source =~ ~r/TILE_STYLES\s*=/,
           "the art styles are rows in `tilesets`, so a constant naming two of them goes out of date " <>
             "the moment somebody adds a third"
  end

  # THE UNION, read out of the file that declares it. Handles both shapes the engine uses:
  # `export type X = 'a' | 'b'` and a field union inside an interface (`on: 'a' | 'b'`).
  defp union_in(file, type) do
    source = File.read!(file)

    case Regex.run(~r/type\s+#{type}\s*=\s*([^\n]+)/, source) do
      [_, body] -> quoted(body)
      nil -> flunk("no `type #{type}` in #{file}, so this test is checking nothing")
    end
  end

  defp quoted(body) do
    ~r/'([^']+)'/
    |> Regex.scan(body)
    |> Enum.map(fn [_, value] -> value end)
  end
end

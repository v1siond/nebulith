defmodule Nebulith.OneEngineManyStylesTest do
  @moduledoc """
  LAW 4: *"a tileset is a set of PNGs, all rules global, only pictures differ."*

  The engine may ask a style for a picture. It may not ask WHICH style it is and then decide something.
  Those are different acts and only the second one is banned, which is why this counts one exact shape:
  the active style's id compared against a style NAME.

  ## What it measured before

  Four, and all four assumed a world with exactly two styles in it:

    * `templates.tsx` set the hero's held weapon from `activeStyleId !== 'ascii'`, so every style that was
      not ascii got EMOJI's weapon art while claiming to be itself.
    * the same file picked the weapon pose with `activeStyleRef.current.id === 'ascii' ? 'ascii' : 'emoji'`,
      collapsing every future style onto emoji.
    * the pose card was offered only when the style was not ascii, so an ascii weapon's pose could be
      authored by nobody.
    * `combat.ts` asked for the muzzle under the literal `'emoji'`, so a shot fired in any other style
      measured its origin against a weapon it was not holding.

  ## Why a source check and not a render check

  A render check can only see the styles that exist. This defect is about the style that does not exist
  yet: two styles are seeded, so every one of the four read correctly today and would have been wrong the
  moment a third arrived. `Nebulith.E2E.AWeaponIsTheStylesOwnTest` covers what CAN be seen, that the hand
  follows the style being drawn.
  """
  use ExUnit.Case, async: true

  @engine "assets/game"

  # A style id held up against a style's NAME. `styleTile('ascii', x)` is not this: naming a style to ask
  # it for a picture is the whole point of having styles.
  @branch ~r/(activeStyleId|activeStyleRef\.current\.id|styleId|style\.id)\s*[!=]==\s*'[a-z]+'/

  # The other half of the same defect: a function that takes a style and is handed a literal.
  @literal ~r/weaponPose\([^)]*,\s*'(ascii|emoji)'\)|punchTile\('(ascii|emoji)'\)/

  test "nothing in the engine decides what to draw by comparing the style's name" do
    offenders =
      for path <- sources(),
          {line, number} <- Enum.with_index(File.read!(path) |> String.split("\n"), 1),
          code?(line),
          Regex.match?(@branch, line),
          do: "#{Path.relative_to(path, @engine)}:#{number}: #{String.trim(line)}"

    assert offenders == [],
           """
           #{length(offenders)} place(s) choose by the style's NAME rather than asking that style for its
           picture. A style is a set of pictures for the same labels (law 4), so a third one must not have
           to be added to a condition somewhere to be drawn:
             #{Enum.join(offenders, "\n  ")}
           """
  end

  test "nothing asks a style-taking function for one style by name" do
    offenders =
      for path <- sources(),
          {line, number} <- Enum.with_index(File.read!(path) |> String.split("\n"), 1),
          code?(line),
          Regex.match?(@literal, line),
          do: "#{Path.relative_to(path, @engine)}:#{number}: #{String.trim(line)}"

    assert offenders == [],
           "a style was named as a literal where the ACTIVE style belongs:\n  " <>
             Enum.join(offenders, "\n  ")
  end

  test "the engine still has styles to ask, so the checks above are not passing on an empty tree" do
    asks =
      for path <- sources(),
          line <- String.split(File.read!(path), "\n"),
          String.contains?(line, "styleTile(") or String.contains?(line, "styleCatalog("),
          do: line

    assert length(asks) > 10,
           "only #{length(asks)} place asks a style for anything, so this file is measuring nothing"
  end

  # A COMMENT IS NOT A BRANCH. Half of the first run's report was prose describing the very code that had
  # just been deleted, and a gate that cannot tell an explanation from a decision teaches you to skim it.
  defp code?(line) do
    trimmed = String.trim(line)

    not (String.starts_with?(trimmed, "//") or String.starts_with?(trimmed, "*") or
           String.starts_with?(trimmed, "/*"))
  end

  defp sources do
    "#{@engine}/**/*.{ts,tsx}"
    |> Path.wildcard()
    |> Enum.reject(&String.contains?(&1, "/node_modules/"))
    |> Enum.reject(&String.contains?(&1, "__tests__"))
    |> Enum.reject(&String.ends_with?(&1, ".test.ts"))
    |> Enum.reject(&String.ends_with?(&1, ".test.tsx"))
  end
end

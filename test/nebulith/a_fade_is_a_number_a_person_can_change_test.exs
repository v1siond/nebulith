defmodule Nebulith.AFadeIsANumberAPersonCanChangeTest do
  @moduledoc """
  THE RANGE TRANSPARENCY IS FOUR NUMBERS, AND A PERSON HAS TO BE ABLE TO CHANGE THEM.

  His words: *"we have like a range transparency on the units/elements but I don't see any place to manage
  or edit it, and It'd like to make the tree more opaque"*.

  ## Why there was nowhere

  There was nowhere because the four numbers were `export const` in `engine/render/roofReveal.ts`:

      APPROACH_RADIUS = 12        // beyond this the building is fully solid
      APPROACH_NEAR = 5           // within this it holds flat at its most transparent
      APPROACH_ALPHA = 0.35       // the close band
      INTERIOR_SHELL_ALPHA = 0.15 // standing inside

  A value invented in React has no control by construction, because there is no row to write a control
  against. That is law 7 (*"the backend decides values, the frontend renders them"*) and law 12 (*"The
  frontend sets no limits. No minimum, no maximum, no step invented in React"*) read together, and the
  missing panel is the symptom both laws predict.

  `game_settings` is where a game's own numbers already live (`map_size_max`, the discovery radius, the
  default view), so the fade's four go beside them: one row per game, a column per number, served with the
  game and read by the renderer.

  This checks both halves, because either alone still leaves him with nothing to edit: the columns exist
  and are served, AND the engine holds no band number of its own.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Games.GameSettings

  @engine "assets/game"

  # THE FOUR, by the column that owns each. A name here and not in the engine is the whole point.
  @bands ~w(fade_radius fade_full_radius fade_alpha interior_alpha)a

  test "every fade band is a column on game_settings" do
    columns = GameSettings.__schema__(:fields)

    missing = for band <- @bands, band not in columns, do: band

    assert missing == [],
           """
           #{length(missing)} fade band is not a column, so there is no row to point a control at:
             #{Enum.map_join(missing, "\n  ", &to_string/1)}
           """
  end

  test "each one has a default, so a game that states nothing still draws" do
    blank = %GameSettings{}

    unset = for band <- @bands, Elixir.Map.get(blank, band) in [nil, ""], do: band

    assert unset == [],
           "#{inspect(unset)} has no default, so the renderer would have to invent one after all"
  end

  test "the changeset accepts each one, so the control can write it" do
    changed =
      GameSettings.changeset(%GameSettings{}, %{
        "game_id" => Ecto.UUID.generate(),
        "fade_radius" => 20,
        "fade_full_radius" => 8,
        "fade_alpha" => "0.6",
        "interior_alpha" => "0.4"
      })

    assert changed.valid?, "the changeset refused the four numbers: #{inspect(changed.errors)}"

    for band <- @bands do
      assert Ecto.Changeset.get_change(changed, band),
             "`#{band}` was dropped by the changeset, which is a dead control: cast/3 does not raise on a " <>
               "key it does not know, it silently discards it"
    end
  end

  test "the engine invents no band of its own" do
    offenders =
      for path <- sources(),
          {line, number} <- Enum.with_index(File.read!(path) |> String.split("\n"), 1),
          code?(line),
          Regex.match?(
            ~r/(APPROACH_RADIUS|APPROACH_NEAR|APPROACH_ALPHA|INTERIOR_SHELL_ALPHA)\s*=\s*[\d.]/,
            line
          ),
          do: "#{Path.relative_to(path, @engine)}:#{number}: #{String.trim(line)}"

    assert offenders == [],
           """
           #{length(offenders)} fade band is still a literal in the engine. A number invented in React has
           nowhere to be edited, which is exactly the report:
             #{Enum.join(offenders, "\n  ")}
           """
  end

  # A COMMENT IS NOT A DECISION. The history of these numbers is written down beside them on purpose, and a
  # gate that reads prose as code teaches you to skim its report.
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
  end
end

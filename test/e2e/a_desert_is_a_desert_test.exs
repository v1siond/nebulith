defmodule Nebulith.E2E.ADesertIsADesertTest do
  @moduledoc """
  A DESERT STANDS ON SAND AND GROWS CACTUS.

  His words: *"Desert completely lost it's style... desert is not even showing cactuses anymore"*.

  ## What was measured before

  A 40 x 40 desert: `meadow 1512` of 1600 ground cells, `trunk_mid 66`, and not one cactus. Its own regions
  name six cactus species between them (`cactus_saguaro`, `cactus_barrel`, `cactus_prickly` and their
  variants), so the catalogue was asking for them and the map was not growing them.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase8
  @moduletag timeout: 900_000

  alias Nebulith.E2E.GeneratePanel

  @size %{cols: 40, rows: 40}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a desert stands on sand and grows cactus", %{session: session} do
    session
    |> GeneratePanel.choose_category("wilderness")
    |> GeneratePanel.choose_preset("Desert")
    |> GeneratePanel.build()

    Browser.wait_until(
      session,
      &(Canvas.tile_count(&1) > 0),
      "the desert to put something on the map",
      timeout: 180_000
    )

    counts =
      for label <- Canvas.tile_labels(session),
          reduce: %{} do
        seen -> Elixir.Map.update(seen, label, 1, &(&1 + 1))
      end

    IO.puts("\n  WHAT THE DESERT IS MADE OF\n")

    for {label, n} <- Enum.sort_by(counts, &(-elem(&1, 1))) |> Enum.take(22) do
      IO.puts("    #{String.pad_trailing(label, 24)} #{n}")
    end

    ground = for {label, n} <- counts, label in ~w(sand sand_dune red_earth outback_red sandstone), do: n

    refute Elixir.Map.has_key?(counts, "meadow"),
           "the desert is still standing on meadow grass, #{counts["meadow"]} cells of it"

    assert Enum.sum(ground) > 400,
           """
           The desert is standing on #{Enum.sum(ground)} cells of sand. Its regions name sand tones and the
           ground came from the season, so it is a meadow with a sand tint on it.
           """

    cactus = for {label, n} <- counts, String.contains?(label, "cactus"), do: n

    # MORE THAN A TOKEN ONE. A desert whose only growth is a dead tree and one barrel is not showing cactus in
    # any sense a person would agree with, so the bar is the sparse canopy its own regions state: `erg` asks
    # for 0.04 and `hardpan` 0.08, which over 1600 cells is dozens of plants and not a handful.
    # …AND EACH ONE ARRIVED BROAD ACROSS AND THIN INTO THE SCREEN. *"we used width instead of thickness to
    # make it, and looks too skynny"*. The catalogue is checked by `Nebulith.ACactusIsNotAStickTest` and the
    # picture by `Nebulith.E2E.ACactusDrawsAsWideAsItIsBuiltTest`; this is the shape that reached a GENERATED
    # map, since a stamp can scale a cell on its way down.
    #
    # It used to compare `width` against `depth`, and that reading is gone with the mistake it was written
    # for. `depth` is a SIZE whose column default is 1, and a bar is made thin by a `thickness` REACH instead,
    # so an upright now arrives 1 wide, 1 deep and pulled in on the into-screen pair. Comparing width to depth
    # now reads every correct cactus as a post, which is what it did.
    sticks =
      Browser.js(session, """
      (() => {
        const g = window.__nebulithGrid
        if (!g) return []
        // `reachGroundQuad` pairs these two on the +row axis, the one going into the screen.
        const thin = (t) => !!t && ['left-down', 'right-up'].every(d => typeof t[d] === 'number' && t[d] < 1)
        return g.assets
          .filter(a => String(a.label || a.tileKey || '').startsWith('cactus'))
          // AN UPRIGHT, defined exactly as `Nebulith.ACactusIsNotAStickTest` defines it, because the two
          // gates are the same rule asked of the catalogue and of a built map and must not drift apart. A
          // crossing bar is wide and short by design, and an ARM is 0.44 of its trunk in the reference plate
          // and about a third as tall, so neither is the thing he was looking at.
          .filter(a => (a.height ?? 1) > (a.width ?? 1) * 1.5 && (a.height ?? 1) > 1.5)
          .filter(a => (a.width ?? 1) < 0.9 || !thin(a.thickness))
          .map(a => `${a.label || a.tileKey} ${a.width} across, ${a.height} tall, reach ${JSON.stringify(a.thickness ?? null)}`)
      })()
      """) || []

    assert sticks == [],
           """
           #{length(sticks)} standing cactus on the map is narrowed by its width, or is not pulled in on the
           axis going into the screen, so it draws as a post:
             #{Enum.join(Enum.take(sticks, 6), "\n  ")}
           """

    assert Enum.sum(cactus) > 20,
           """
           Not one cactus grew, and the desert's own regions name six species of them. It grew
           #{inspect(Enum.take(Enum.sort_by(counts, &(-elem(&1, 1))), 8))}
           """
  end
end

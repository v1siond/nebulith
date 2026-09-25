defmodule Nebulith.EveryColumnHasAReaderTest do
  @moduledoc """
  INVARIANT 7: *"Every column is read by something."* (`docs/SPEC.md` §6.3.)

  The spec argues for this one at length because it is the easiest to wave away:

  > *"A column with no reader is not harmless: it is a knob a person turns that does nothing, and it is
  > indistinguishable from a broken feature."*

  ## What this catches, and what it does not

  A column is counted as read if its NAME appears anywhere outside the migration that created it. That is
  the FLOOR of invariant 7, not the whole of it: a column nothing anywhere even mentions is dead by any
  definition, and this is the check that can be made to hold without false alarms.

  It is worth being plain about the limit, because the invariant's own example escapes it.
  `tilesets.data` was *"written and never loaded"*, and it would have PASSED this: it had an Ecto field, a
  line in the serializer and a type in the engine's loader. It travelled all the way to the browser and
  nothing there read it. Proving that needs the reader's side, not the writer's, and no grep from here can
  see it. That one was found by following the value and is gone (`20260922120000`).

  So this holds the floor and the reading is still work somebody has to do. What it makes impossible is
  the easy half: a column created and then never spoken of again.

  ## Scope

  The tables due by the phase we are on, from the same marker every other compliance check reads. A later
  phase's table is not a violation, it is not started.

  ## What it measured on the day it was written: five, all on `game_settings`, and all five are gone

      game_settings.map_size_max
      game_settings.discovery_on
      game_settings.discovery_radius
      game_settings.discovery_remembers
      game_settings.default_view

  The spec declares every one of them (§3.1) and phase 1 created the table, then stopped: no schema, no
  context function, no serializer, and no row written when a game was made. Five declared columns and no
  reader anywhere.

  They are wired now (`Nebulith.AGameStatesItsOwnLimitsTest`). `map_size_max` was the sharpest of the
  five, annotated *"100 for now. a NUMBER, not a constant"*, and the shape it settled into is the one law
  12 demands: the ENGINE holds no maximum, the GAME states one, and raising it is what makes a bigger map
  possible. A map belonging to no game has no ceiling, because nothing states one, which is why
  `Nebulith.E2E.TheFrontendSetsNoLimitsTest` still types 120 x 104 into the panel and still gets it saved.

  The ceiling is 0 now. It may only go down, which means it may not move.
  """
  # DataCase for the sandbox: this asks the database which columns actually exist.
  use Nebulith.DataCase, async: false

  alias Nebulith.SpecSchema

  # Bookkeeping, not facts about the thing. Every table has them and nothing names them by hand.
  @plumbing ~w(id inserted_at updated_at)

  # THE DEBT, measured, and it may only go down. Five columns on `game_settings`, named in the moduledoc
  # with why each is still unwired.
  @measured 0

  # Where a reader could be. The migrations are excluded on purpose: naming a column while creating it is
  # not reading it, and that is the whole shape of a dead column.
  @searched ["lib", "assets/game", "test"]

  test "no table due by this phase carries a column nothing reads" do
    phase = SpecSchema.current_phase()
    tables = SpecSchema.declared(phase)

    refute tables == %{},
           "no tables are due by phase #{phase}, so this test is checking nothing"

    haystack = source()

    orphans =
      for {table, columns} <- tables,
          column <- columns,
          column not in @plumbing,
          exists?(table, column),
          not mentioned?(haystack, column),
          do: "#{table}.#{column}"

    assert length(orphans) <= @measured,
           """
           #{length(orphans)} column(s) exist in the database and are named nowhere in #{Enum.join(@searched, ", ")}, up from the #{@measured} measured:
             #{Enum.join(Enum.sort(orphans), "\n  ")}
           A column with no reader is a knob that does nothing. Either something should read it, or it
           should not be there. `docs/SPEC.md` §6.3 invariant 7.
           """

    IO.puts("spec: #{length(orphans)} columns nothing reads (ceiling #{@measured})")
  end

  # The database's own answer, so a column the spec declares but nothing has created yet is not reported
  # here: that is the missing-columns check's job, and reporting it twice buries both.
  defp exists?(table, column) do
    %{rows: [[count]]} =
      Nebulith.Repo.query!(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [table, column]
      )

    count > 0
  end

  defp mentioned?(haystack, column) do
    String.contains?(haystack, column)
  end

  # Read once. Forty tables times thirty columns is 1,200 greps otherwise, and the whole tree is smaller
  # than that.
  #
  # THIS FILE IS NOT PART OF THE HAYSTACK. Naming the five columns in the moduledoc above, to say why they
  # are still unwired, made the grep find them and the count dropped to zero: the test proved itself
  # right by writing the answer down. A gate that counts its own documentation as a reader is blind, which
  # is the same shape as any other degenerate oracle.
  defp source do
    @searched
    |> Enum.flat_map(&Path.wildcard("#{&1}/**/*.{ex,exs,ts,tsx,heex}"))
    |> Enum.reject(&String.contains?(&1, "/node_modules/"))
    |> Enum.reject(&String.ends_with?(&1, "every_column_has_a_reader_test.exs"))
    |> Enum.map_join("\n", &File.read!/1)
  end
end

defmodule Nebulith.SpecComplianceTest do
  @moduledoc """
  THE SPEC IS THE FIXTURE. `docs/SPEC.md` is read at run time and compared to the live schema, scoped to
  the phase section 8.0 says we are on.

  ## Why the phase scope is the whole thing

  The first version compared the database against all 74 tables section 3 declares and reported "54
  missing". That number is worse than useless. Most of those tables belong to phases 9 to 14, which are
  not due, so it counted unstarted work as defects and buried the real violations in noise. Measured
  again with the scope: 15 tables are due by phase 3.

  What binds a change is every GLOBAL rule always (section 1 laws, section 3 schema, section 6
  invariants), plus the phases up to and including the current one. A law is not something a phase turns
  on, and a later phase's table is not a defect.

  ## What this can and cannot see

  It checks the TABLES half of a phase. It cannot check REWIRE, which is the frontend giving up a fact it
  holds. That half is checked by driving the real page with Playwright from Elixir (`bin/e2e`), and by
  the Stop hook refusing a turn where `assets/` changed and no `test/e2e/*.exs` did.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Repo
  alias Nebulith.SpecSchema

  # MEASURED, not chosen, and every one is a defect count so every one may only go DOWN.
  @missing_tables 0
  @missing_columns 0
  @jsonb_columns 24

  # ZERO, measured from the spec itself: its nine ER diagrams declare 74 tables and 393 columns and not
  # ONE of them is jsonb. 19 was the count that existed when the audit was written, not a goal. Law 8
  # permits jsonb "where the payload is heterogeneous AND never queried", and the spec exercises that
  # permission nowhere.
  @jsonb_target 0

  test "every table due by the current phase exists" do
    phase = SpecSchema.current_phase()
    due = SpecSchema.declared()

    assert map_size(due) > 0, "no tables are due by phase #{phase}, so this check proves nothing"

    missing = for {t, _} <- due, not MapSet.member?(live_tables(), t), do: t

    assert length(missing) <= @missing_tables,
           """
           #{length(missing)} of the #{map_size(due)} tables due by PHASE #{phase} do not exist,
           up from the #{@missing_tables} measured.

           #{Enum.join(Enum.sort(missing), ", ")}
           """

    report("tables due by phase #{phase} still missing", length(missing), @missing_tables)
  end

  test "a table both sides have carries the columns the spec gives it" do
    live = live_columns()

    gaps =
      for {table, columns} <- SpecSchema.declared(),
          have = live[table],
          have != nil,
          missing = Enum.sort(columns -- have),
          missing != [],
          do: {table, missing}

    total = gaps |> Enum.map(fn {_t, m} -> length(m) end) |> Enum.sum()

    assert total <= @missing_columns,
           """
           #{total} declared columns missing across #{length(gaps)} tables, up from #{@missing_columns}.

           #{Enum.map_join(Enum.sort(gaps), "\n", fn {t, m} -> "  #{t}: #{Enum.join(m, ", ")}" end)}
           """

    report("declared columns missing", total, @missing_columns)
  end

  test "jsonb does not grow" do
    %{rows: rows} =
      Repo.query!("""
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('jsonb', 'json')
      ORDER BY table_name, column_name
      """)

    assert length(rows) <= @jsonb_columns,
           """
           #{length(rows)} jsonb columns, up from #{@jsonb_columns} and the #{@jsonb_target} the spec
           calls "how the schema became invisible". Law 8: jsonb only where the payload is heterogeneous
           AND never queried.

           #{Enum.map_join(rows, "\n", fn [t, c] -> "  #{t}.#{c}" end)}
           """

    report("jsonb columns", length(rows), @jsonb_columns)
  end

  defp live_tables do
    %{rows: rows} =
      Repo.query!("""
      SELECT lower(table_name) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      """)

    rows |> List.flatten() |> MapSet.new()
  end

  defp live_columns do
    %{rows: rows} =
      Repo.query!(
        "SELECT lower(table_name), column_name FROM information_schema.columns WHERE table_schema = 'public'"
      )

    Enum.group_by(rows, &Enum.at(&1, 0), &Enum.at(&1, 1))
  end

  # Printed on a PASS too: a ratchet that only speaks when it breaks hides how far there is to go.
  defp report(what, now, ceiling),
    do: IO.puts("spec: #{now} #{what} (ceiling #{ceiling})")
end

defmodule Nebulith.SpecSchema do
  @moduledoc """
  READS `docs/SPEC.md` AND RETURNS WHAT IT DECLARES, SCOPED TO THE PHASE BEING WORKED ON.

  The spec is not prose. Section 3 carries nine `mermaid erDiagram` blocks declaring 74 tables, and
  section 8 says which PHASE each table arrives in. Both are machine readable, so the document itself is
  the fixture, read at run time, with no second copy anywhere to drift.

  ## Why the phase scope is the whole point

  The first version of this compared the database against all 74 tables and reported "54 missing". That
  number is worthless and worse than worthless, because most of those tables belong to phases 9 to 14,
  which are not due. A compliance report that counts unwritten future work as defects cannot be acted on,
  and it buries the real violations among noise.

  What binds a change is: every GLOBAL rule, always, plus the phases up to and including the current one.
  Nothing from a later phase. `docs/SPEC.md` section 8.1 is explicit that the order is the schema's own
  dependency order, so phase N assumes 0 through N-1 and says nothing about N+1.

  ## What is global and what is phased

  Global, and therefore always binding: section 1 (the twelve laws), section 2 (architecture), section 3
  (the schema), section 6 (the invariants). A law is not something a phase turns on.

  Phased: section 8 only.
  """

  @spec_path "docs/SPEC.md"

  # WHERE THE CURRENT PHASE IS STATED, once. A number duplicated between a doc and a script is two owners
  # of one fact, which is the defect this whole module exists to catch.
  @phase_marker ~r/^\s*\*\*WE ARE ON PHASE (\d+)\.\*\*/m

  @doc "The phase currently being worked, read from SPEC.md section 8."
  def current_phase(path \\ @spec_path) do
    case Regex.run(@phase_marker, File.read!(path)) do
      [_, n] ->
        String.to_integer(n)

      _ ->
        raise "docs/SPEC.md states no current phase. Add `**WE ARE ON PHASE N.**` to section 8."
    end
  end

  @doc """
  Tables the spec declares, as `%{"table" => ["column", ...]}`, limited to phases up to `through`.

  A table a later phase introduces is not a violation today, it is unstarted work.
  """
  def declared(through \\ nil, path \\ @spec_path) do
    source = File.read!(path)
    through = through || current_phase(path)
    due = tables_due_by(source, through)

    source
    |> blocks()
    |> Enum.flat_map(&tables_in/1)
    |> Enum.reduce(%{}, fn {table, columns}, acc ->
      Map.update(acc, table, columns, &Enum.uniq(&1 ++ columns))
    end)
    |> Map.take(MapSet.to_list(due))
  end

  @doc "Every table each phase's TABLES line names, as `%{phase_number => MapSet}`."
  def tables_by_phase(path \\ @spec_path) do
    source = File.read!(path)

    ~r/^### Phase (\d+)[^\n]*\n(.*?)(?=^### Phase \d|\z)/ms
    |> Regex.scan(source)
    |> Map.new(fn [_, n, body] -> {String.to_integer(n), tables_named_in(body)} end)
  end

  @doc "The path the spec is read from, so a failure can name it."
  def spec_path, do: @spec_path

  defp tables_due_by(source, through) do
    source
    |> phase_bodies()
    |> Enum.filter(fn {n, _body} -> n <= through end)
    |> Enum.reduce(MapSet.new(), fn {_n, body}, acc ->
      MapSet.union(acc, tables_named_in(body))
    end)
  end

  defp phase_bodies(source) do
    ~r/^### Phase (\d+)[^\n]*\n(.*?)(?=^### Phase \d|\z)/ms
    |> Regex.scan(source)
    |> Enum.map(fn [_, n, body] -> {String.to_integer(n), body} end)
  end

  # THE `**TABLES**` LINE of a phase, which may wrap across several lines. Everything in backticks on it
  # is a table name; `**TABLES** none.` yields nothing, which is correct for a phase that adds no rows.
  defp tables_named_in(body) do
    case Regex.run(~r/^\*\*TABLES\*\*(.*?)(?=^\*\*[A-Z]|\z)/ms, body) do
      [_, line] ->
        ~r/`(\w+)`/
        |> Regex.scan(line)
        |> Enum.map(fn [_, name] -> String.downcase(name) end)
        |> MapSet.new()

      _ ->
        MapSet.new()
    end
  end

  defp blocks(source) do
    ~r/```mermaid\s*\n\s*erDiagram\n(.*?)```/s
    |> Regex.scan(source)
    |> Enum.map(&List.last/1)
  end

  defp tables_in(block) do
    ~r/^\s{2,}([A-Z][A-Z0-9_]*)\s*\{\n(.*?)^\s{2,}\}/ms
    |> Regex.scan(block)
    |> Enum.map(fn [_, name, body] -> {String.downcase(name), columns_in(body)} end)
  end

  defp columns_in(body) do
    for line <- String.split(body, "\n"),
        [_, name] <- [Regex.run(~r/^\s+[\w()]+\s+(\w+)/, line)],
        do: name
  end
end

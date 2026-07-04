defmodule Nebulith.Admin do
  @moduledoc """
  Read-only introspection over the shared `game_website` database.

  The database is shared with the frontend's Prisma tables; nebulith only owns a
  few of them. This context lists every public table with a live row count and a
  small preview of its rows, so the admin page can show everything at a glance
  without needing an Ecto schema per table.
  """

  alias Nebulith.Repo

  @nebulith_owned ~w(tilesets admin_users schema_migrations)
  @preview_limit 25
  @cell_limit 160

  @doc "All public base tables, each with a row count and owner tag, ordered by name."
  def list_tables do
    sql = """
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
    """

    %{rows: rows} = Repo.query!(sql)

    Enum.map(rows, fn [name] ->
      %{name: name, count: count_rows(name), owner: owner(name)}
    end)
  end

  @doc "Column names and up to `limit` rows for `table`, with every value stringified for display."
  def preview(table, limit \\ @preview_limit) do
    table = safe_identifier(table)
    %{columns: columns, rows: rows} = Repo.query!(~s|SELECT * FROM "#{table}" LIMIT $1|, [limit])
    %{columns: columns, rows: Enum.map(rows, fn row -> Enum.map(row, &display/1) end)}
  end

  defp count_rows(table) do
    table = safe_identifier(table)
    %{rows: [[count]]} = Repo.query!(~s|SELECT count(*) FROM "#{table}"|)
    count
  end

  defp owner(name) when name in @nebulith_owned, do: :nebulith
  defp owner(_name), do: :prisma

  # Table names come from information_schema, but we still refuse anything that
  # isn't a plain identifier before interpolating it into a query.
  defp safe_identifier(table) do
    if Regex.match?(~r/\A[A-Za-z_][A-Za-z0-9_]*\z/, table) do
      table
    else
      raise ArgumentError, "unsafe table identifier: #{inspect(table)}"
    end
  end

  defp display(nil), do: ""
  defp display(value) when is_boolean(value), do: to_string(value)
  defp display(value) when is_integer(value) or is_float(value), do: to_string(value)
  defp display(%Decimal{} = value), do: Decimal.to_string(value)
  defp display(%DateTime{} = value), do: to_string(value)
  defp display(%NaiveDateTime{} = value), do: to_string(value)
  defp display(%Date{} = value), do: to_string(value)
  defp display(value) when is_map(value) or is_list(value), do: truncate(Jason.encode!(value))

  defp display(value) when is_binary(value) do
    if String.valid?(value), do: truncate(value), else: truncate(inspect(value))
  end

  defp display(value), do: truncate(inspect(value))

  defp truncate(string) do
    if String.length(string) > @cell_limit do
      String.slice(string, 0, @cell_limit) <> "…"
    else
      string
    end
  end
end

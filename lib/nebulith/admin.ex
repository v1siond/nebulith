defmodule Nebulith.Admin do
  @moduledoc """
  THE DATABASE, BROWSABLE AND EDITABLE, WITHOUT AN ECTO SCHEMA PER TABLE.

  Every table in this database can be listed, searched, opened a row at a time, edited and deleted from
  `/admin`. It works by asking Postgres what the tables and columns ARE rather than by keeping a definition
  per table, so a table added by a migration appears here with no code change. A list that has to be
  remembered is a list that rots.

  ## What keeps it safe

  This module interpolates identifiers into SQL, which is the one thing that has to be got right:

    * A TABLE name is checked against the live list from `information_schema` before it is used. A name
      that is not a real table is refused, not queried.
    * A COLUMN name is checked against that table's real columns, the same way.
    * A VALUE is never interpolated. Values are bound parameters, always.

  ## Casting on the way in

  A form posts strings, and the column might be an integer, a uuid, a timestamp or jsonb. Each value is
  cast explicitly to the column's own type, and for jsonb that cast goes through text
  (`$1::text::jsonb`), because binding straight to jsonb encodes the string as a JSON string scalar: the
  statement then reports a row updated while writing something nobody meant. That has bitten this codebase
  in four separate data migrations.
  """

  alias Nebulith.Repo

  # THE LIST NAMES WHAT NEBULITH DOES NOT OWN, WHICH IS THE HALF THAT STOPS GROWING. It used to name what
  # nebulith DID own, so every table the rebuild adds had to be remembered here; it still said `admin_users`
  # after that table was folded into `users`. Prisma-era leftovers are capitalised and there are no new ones.
  @prisma_owned ~w(Template)
  @page_size 50
  @cell_limit 160

  # ── tables ─────────────────────────────────────────────────────────────

  @doc "All public base tables, each with a row count and owner tag, ordered by name."
  def list_tables do
    for name <- table_names() do
      %{name: name, count: count_rows(name), owner: owner(name)}
    end
  end

  @doc "Every public base table name."
  def table_names do
    %{rows: rows} =
      Repo.query!("""
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
      """)

    List.flatten(rows)
  end

  @doc "True when `table` is a real table in this database."
  def table?(name), do: is_binary(name) and name in table_names()

  @doc """
  A table's columns: name, type, whether it accepts NULL, and whether it is part of the primary key.

  The order is the table's own column order, so a form reads the way the table was written.
  """
  def columns(table) do
    table = safe_table(table)
    keys = primary_key(table)

    %{rows: rows} =
      Repo.query!(
        """
        SELECT column_name, data_type, is_nullable, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
        """,
        [table]
      )

    for [name, type, nullable, udt] <- rows do
      %{name: name, type: type, udt: udt, nullable: nullable == "YES", primary?: name in keys}
    end
  end

  @doc "The column names making up `table`'s primary key, or `[]` when it has none."
  def primary_key(table) do
    table = safe_table(table)

    %{rows: rows} =
      Repo.query!(
        """
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = to_regclass($1) AND i.indisprimary
        """,
        # to_regclass takes TEXT; `$1::regclass` makes Postgrex expect an oid and refuse a binary.
        # The name is quoted so a capitalised table (the Prisma leftovers) resolves.
        [~s("#{table}")]
      )

    List.flatten(rows)
  end

  # ── rows ───────────────────────────────────────────────────────────────

  @doc """
  A page of rows from `table`.

  `:search` matches anywhere in any column, by casting the whole row to text, which is the only search that
  works the same on a uuid, a jsonb blob and a name without the caller having to know which is which.
  """
  def rows(table, opts \\ []) do
    table = safe_table(table)
    search = opts |> Keyword.get(:search) |> normalise_search()
    page = max(Keyword.get(opts, :page, 1), 1)
    limit = Keyword.get(opts, :page_size, @page_size)
    offset = (page - 1) * limit

    {where, params} =
      case search do
        nil -> {"", []}
        term -> {~s|WHERE CAST(t.* AS text) ILIKE $1|, ["%#{term}%"]}
      end

    %{rows: [[total]]} =
      Repo.query!(~s|SELECT count(*) FROM "#{table}" t #{where}|, params)

    %{columns: columns, rows: rows} =
      Repo.query!(
        ~s|SELECT * FROM "#{table}" t #{where} ORDER BY #{order_clause(table)} LIMIT $#{length(params) + 1} OFFSET $#{length(params) + 2}|,
        params ++ [limit, offset]
      )

    %{
      columns: columns,
      rows: Enum.map(rows, &Enum.map(&1, fn value -> display(value) end)),
      ids: Enum.map(rows, &row_id(columns, &1, table)),
      total: total,
      page: page,
      pages: max(ceil(total / limit), 1),
      page_size: limit,
      search: search
    }
  end

  @doc "One row as `{:ok, %{column => displayed value}}`, or `:error` when nothing matches."
  def get_row(table, id) do
    table = safe_table(table)

    case primary_key(table) do
      [] ->
        :error

      [key | _] ->
        %{columns: columns, rows: rows} =
          Repo.query!(~s|SELECT * FROM "#{table}" WHERE "#{key}" = $1::text::#{key_type(table, key)}|, [
            to_string(id)
          ])

        case rows do
          [row] -> {:ok, columns |> Enum.zip(Enum.map(row, &display_full/1)) |> Map.new()}
          _ -> :error
        end
    end
  end

  @doc """
  Updates one row. `params` is a map of column name to string; anything that is not a real, editable
  column of this table is ignored rather than trusted.
  """
  def update_row(table, id, params) do
    table = safe_table(table)
    [key | _] = primary_key(table)
    editable = for c <- columns(table), not c.primary?, do: c

    changes = for c <- editable, Map.has_key?(params, c.name), do: {c, Map.fetch!(params, c.name)}

    if changes == [] do
      {:ok, 0}
    else
      {sets, values} =
        changes
        |> Enum.with_index(1)
        |> Enum.map(fn {{c, value}, i} -> {~s|"#{c.name}" = #{cast(i, c)}|, blank_to_nil(value, c)} end)
        |> Enum.unzip()

      sql =
        ~s|UPDATE "#{table}" SET #{Enum.join(sets, ", ")} WHERE "#{key}" = $#{length(values) + 1}::text::#{key_type(table, key)}|

      %{num_rows: n} = Repo.query!(sql, values ++ [to_string(id)])
      {:ok, n}
    end
  end

  @doc "Deletes one row by primary key."
  def delete_row(table, id) do
    table = safe_table(table)

    case primary_key(table) do
      [] ->
        {:error, :no_primary_key}

      [key | _] ->
        %{num_rows: n} =
          Repo.query!(~s|DELETE FROM "#{table}" WHERE "#{key}" = $1::text::#{key_type(table, key)}|, [
            to_string(id)
          ])

        {:ok, n}
    end
  end

  # ── internals ──────────────────────────────────────────────────────────

  defp owner(name) when name in @prisma_owned, do: :prisma
  defp owner(_name), do: :nebulith

  defp count_rows(table) do
    %{rows: [[count]]} = Repo.query!(~s|SELECT count(*) FROM "#{safe_table(table)}"|)
    count
  end

  # A table name reaches SQL only after it is checked against the tables that actually exist, so a crafted
  # name is refused rather than run. The shape check is kept as well, because it costs nothing.
  defp safe_table(table) do
    cond do
      not is_binary(table) -> raise ArgumentError, "unsafe table identifier: #{inspect(table)}"
      not Regex.match?(~r/\A[A-Za-z_][A-Za-z0-9_]*\z/, table) -> raise ArgumentError, "unsafe table identifier: #{inspect(table)}"
      table not in table_names() -> raise ArgumentError, "no such table: #{inspect(table)}"
      true -> table
    end
  end

  # Newest first where the table records when it was written, otherwise by primary key, otherwise by the
  # first column, so a page is at least stable between requests.
  defp order_clause(table) do
    names = for c <- columns(table), do: c.name

    cond do
      "inserted_at" in names -> ~s|t."inserted_at" DESC|
      "updated_at" in names -> ~s|t."updated_at" DESC|
      primary_key(table) != [] -> ~s|t."#{hd(primary_key(table))}"|
      names != [] -> ~s|t."#{hd(names)}"|
      true -> "1"
    end
  end

  defp key_type(table, key) do
    case Enum.find(columns(table), &(&1.name == key)) do
      %{udt: udt} -> udt
      nil -> "text"
    end
  end

  defp row_id(columns, row, table) do
    case primary_key(table) do
      [] -> nil
      [key | _] -> columns |> Enum.zip(row) |> Enum.find_value(fn {c, v} -> if c == key, do: display(v) end)
    end
  end

  # jsonb bound directly encodes a string as a JSON string scalar, so the write succeeds and stores the
  # wrong thing. Going through text makes Postgres parse it as JSON, which is what was meant.
  defp cast(i, %{udt: udt}) when udt in ~w(jsonb json), do: "$#{i}::text::#{udt}"
  defp cast(i, %{udt: udt}), do: "$#{i}::text::#{udt}"

  defp blank_to_nil("", %{nullable: true}), do: nil
  defp blank_to_nil(value, _), do: to_string(value)

  defp normalise_search(nil), do: nil
  defp normalise_search(term) when is_binary(term), do: (t = String.trim(term)) != "" && t || nil
  defp normalise_search(_), do: nil

  defp display(value), do: value |> display_full() |> truncate()

  defp display_full(nil), do: ""
  defp display_full(value) when is_boolean(value), do: to_string(value)
  defp display_full(value) when is_integer(value) or is_float(value), do: to_string(value)
  defp display_full(%Decimal{} = value), do: Decimal.to_string(value)
  defp display_full(%DateTime{} = value), do: to_string(value)
  defp display_full(%NaiveDateTime{} = value), do: to_string(value)
  defp display_full(%Date{} = value), do: to_string(value)
  defp display_full(value) when is_map(value) or is_list(value), do: Jason.encode!(value, pretty: true)

  # A uuid arrives as its raw 16 bytes, which are not valid UTF-8, so printing it as text gives a byte dump
  # and the link built from it points nowhere. Every 16-byte binary in this database is a uuid.
  defp display_full(<<_::128>> = value) do
    case Ecto.UUID.cast(value) do
      {:ok, uuid} -> uuid
      :error -> inspect(value)
    end
  end

  defp display_full(value) when is_binary(value) do
    if String.valid?(value), do: value, else: inspect(value)
  end

  defp display_full(value), do: inspect(value)

  defp truncate(string) do
    if String.length(string) > @cell_limit do
      String.slice(string, 0, @cell_limit) <> "…"
    else
      string
    end
  end
end

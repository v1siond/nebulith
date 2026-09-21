defmodule NebulithWeb.AdminController do
  @moduledoc """
  The database browser at `/admin`.

  Five screens: every table, one table's rows with a search, one row in full, that row in a form, and the
  writes behind them. There is no schema module per table; `Nebulith.Admin` asks Postgres what exists, so a
  table added by a migration shows up here with nothing to remember.
  """
  use NebulithWeb, :controller

  alias Nebulith.Admin

  def index(conn, _params) do
    render(conn, :index, tables: Admin.list_tables())
  end

  def table(conn, %{"table" => table} = params) do
    with_table(conn, table, fn ->
      page = params |> Map.get("page", "1") |> to_int(1)
      search = Map.get(params, "q")

      render(conn, :table,
        table: table,
        result: Admin.rows(table, search: search, page: page),
        tables: Admin.list_tables()
      )
    end)
  end

  def show(conn, %{"table" => table, "id" => id}) do
    with_table(conn, table, fn ->
      case Admin.get_row(table, id) do
        {:ok, row} ->
          render(conn, :show, table: table, id: id, row: row, columns: Admin.columns(table))

        :error ->
          conn |> put_flash(:error, "No row #{id} in #{table}.") |> redirect(to: ~p"/admin/#{table}")
      end
    end)
  end

  def edit(conn, %{"table" => table, "id" => id}) do
    with_table(conn, table, fn ->
      case Admin.get_row(table, id) do
        {:ok, row} ->
          render(conn, :edit, table: table, id: id, row: row, columns: Admin.columns(table))

        :error ->
          conn |> put_flash(:error, "No row #{id} in #{table}.") |> redirect(to: ~p"/admin/#{table}")
      end
    end)
  end

  def update(conn, %{"table" => table, "id" => id} = params) do
    with_table(conn, table, fn ->
      fields = Map.get(params, "row", %{})

      case Admin.update_row(table, id, fields) do
        {:ok, 0} ->
          conn |> put_flash(:info, "Nothing changed.") |> redirect(to: ~p"/admin/#{table}/#{id}")

        {:ok, _} ->
          conn |> put_flash(:info, "Saved.") |> redirect(to: ~p"/admin/#{table}/#{id}")
      end
    end)
  rescue
    error in [Postgrex.Error, ArgumentError] ->
      conn
      |> put_flash(:error, "Could not save: #{Exception.message(error)}")
      |> redirect(to: ~p"/admin/#{table_of(params)}/#{params["id"]}/edit")
  end

  def delete(conn, %{"table" => table, "id" => id}) do
    with_table(conn, table, fn ->
      case Admin.delete_row(table, id) do
        {:ok, 1} ->
          conn |> put_flash(:info, "Deleted.") |> redirect(to: ~p"/admin/#{table}")

        {:ok, 0} ->
          conn |> put_flash(:error, "Nothing to delete.") |> redirect(to: ~p"/admin/#{table}")

        {:error, :no_primary_key} ->
          conn
          |> put_flash(:error, "#{table} has no primary key, so a single row cannot be addressed.")
          |> redirect(to: ~p"/admin/#{table}")
      end
    end)
  rescue
    error in [Postgrex.Error, ArgumentError] ->
      conn
      |> put_flash(:error, "Could not delete: #{Exception.message(error)}")
      |> redirect(to: ~p"/admin/#{table_of(params_of(conn))}")
  end

  # A table name in the path is the one piece of user input that reaches SQL as an identifier, so it is
  # checked against the real tables here, once, before any action touches it.
  defp with_table(conn, table, fun) do
    if Admin.table?(table) do
      fun.()
    else
      conn |> put_flash(:error, "No such table: #{table}") |> redirect(to: ~p"/admin")
    end
  end

  defp table_of(%{"table" => table}), do: table
  defp table_of(_), do: ""
  defp params_of(conn), do: conn.params

  defp to_int(value, fallback) do
    case Integer.parse(to_string(value)) do
      {n, _} when n > 0 -> n
      _ -> fallback
    end
  end
end

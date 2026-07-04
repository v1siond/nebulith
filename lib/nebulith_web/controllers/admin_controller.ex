defmodule NebulithWeb.AdminController do
  use NebulithWeb, :controller

  alias Nebulith.Admin

  def index(conn, _params) do
    tables =
      for table <- Admin.list_tables() do
        Map.put(table, :preview, Admin.preview(table.name))
      end

    render(conn, :index, tables: tables)
  end
end

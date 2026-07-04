defmodule Nebulith.AdminTest do
  use Nebulith.DataCase, async: true

  alias Nebulith.Admin
  alias Nebulith.Accounts

  describe "list_tables/0" do
    test "lists tables with row counts and owner tags" do
      {:ok, _} = Accounts.create_admin_user(%{email: "x@y.com", password: "supersecret"})

      tables = Admin.list_tables()
      names = Enum.map(tables, & &1.name)

      assert "admin_users" in names
      assert "tilesets" in names

      admin_users = Enum.find(tables, &(&1.name == "admin_users"))
      assert admin_users.owner == :nebulith
      assert admin_users.count == 1
    end
  end

  describe "preview/2" do
    test "returns columns and stringified rows" do
      {:ok, _} = Accounts.create_admin_user(%{email: "z@y.com", password: "supersecret"})

      %{columns: columns, rows: rows} = Admin.preview("admin_users")

      assert "email" in columns
      assert "hashed_password" in columns
      assert [row] = rows
      assert Enum.all?(row, &is_binary/1)
      assert "z@y.com" in row
    end

    test "honors the row limit" do
      for i <- 1..3 do
        {:ok, _} = Accounts.create_admin_user(%{email: "u#{i}@y.com", password: "supersecret"})
      end

      assert %{rows: rows} = Admin.preview("admin_users", 2)
      assert length(rows) == 2
    end

    test "refuses a table name that is not a plain identifier" do
      assert_raise ArgumentError, fn ->
        Admin.preview("admin_users; drop table admin_users")
      end
    end
  end
end

defmodule Nebulith.AdminTest do
  @moduledoc """
  THE DATABASE BROWSER READS AND WRITES ANY TABLE, AND ONLY A REAL ONE.

  `Nebulith.Admin` interpolates identifiers into SQL, because a table name cannot be a bound parameter.
  That is the part worth pinning: a table or column name reaches a query only after being checked against
  what actually exists, and a VALUE is never interpolated at all.

  The rest covers what the admin is for: finding a row, opening it, changing it and removing it.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.{Accounts, Admin}

  defp seed_user(attrs \\ %{}) do
    email = "admin-#{System.unique_integer([:positive])}@nebulith.test"
    {:ok, user} = Accounts.create_user(Map.merge(%{email: email, password: "12345678"}, attrs))
    user
  end

  describe "list_tables/0" do
    test "lists tables with row counts and owner tags" do
      seed_user()
      tables = Admin.list_tables()
      names = Enum.map(tables, & &1.name)

      assert "users" in names
      assert "tilesets" in names

      users = Enum.find(tables, &(&1.name == "users"))
      assert users.owner == :nebulith
      assert users.count >= 1
    end

    test "a table added by a migration needs no registration to appear" do
      # game_settings arrived with phase 1 and nothing was added to this module for it.
      assert "game_settings" in Admin.table_names()
    end
  end

  describe "columns/1 and primary_key/1" do
    test "columns come back in the table's own order, typed, with the key marked" do
      columns = Admin.columns("users")
      names = Enum.map(columns, & &1.name)

      assert "email" in names
      assert "hashed_password" in names

      id = Enum.find(columns, &(&1.name == "id"))
      assert id.primary?

      email = Enum.find(columns, &(&1.name == "email"))
      refute email.primary?
      refute email.nullable
    end

    test "primary_key/1 names the key column" do
      assert Admin.primary_key("users") == ["id"]
    end
  end

  describe "rows/2" do
    test "returns a page of rows with their ids, so each one can be opened" do
      user = seed_user()
      result = Admin.rows("users")

      assert result.total >= 1
      assert "email" in result.columns
      assert to_string(user.id) in result.ids
    end

    test "search matches anywhere in the row, including a column the reader did not name" do
      user = seed_user()
      [prefix | _] = String.split(user.email, "@")

      found = Admin.rows("users", search: prefix)
      assert to_string(user.id) in found.ids

      missing = Admin.rows("users", search: "no-such-value-#{System.unique_integer()}")
      assert missing.total == 0
      assert missing.rows == []
    end

    test "paging reports how many pages there are and never goes below page 1" do
      for _ <- 1..3, do: seed_user()
      result = Admin.rows("users", page_size: 2)

      assert result.page == 1
      assert result.pages >= 2
      assert length(result.rows) <= 2

      assert Admin.rows("users", page: 0).page == 1
      assert Admin.rows("users", page: -5).page == 1
    end
  end

  describe "get_row/2" do
    test "returns every column of one row, with the value in full" do
      user = seed_user()
      assert {:ok, row} = Admin.get_row("users", user.id)

      assert row["email"] == user.email
      assert row["id"] == to_string(user.id)
    end

    test "an id nobody has is an error, not a crash" do
      assert Admin.get_row("users", Ecto.UUID.generate()) == :error
    end
  end

  describe "update_row/3" do
    test "changes the columns it is given and leaves the rest alone" do
      user = seed_user()
      before = Admin.get_row("users", user.id) |> elem(1)

      assert {:ok, 1} = Admin.update_row("users", user.id, %{"display_name" => "Renamed"})

      {:ok, after_} = Admin.get_row("users", user.id)
      assert after_["display_name"] == "Renamed"
      assert after_["email"] == before["email"]
      assert after_["hashed_password"] == before["hashed_password"]
    end

    test "a boolean column round-trips" do
      user = seed_user()
      assert {:ok, 1} = Admin.update_row("users", user.id, %{"is_admin" => "true"})
      assert Admin.get_row("users", user.id) |> elem(1) |> Map.get("is_admin") == "true"
    end

    test "an empty value on a nullable column writes NULL, not an empty string" do
      user = seed_user(%{display_name: "Somebody"})
      assert {:ok, 1} = Admin.update_row("users", user.id, %{"display_name" => ""})
      assert Admin.get_row("users", user.id) |> elem(1) |> Map.get("display_name") == ""

      %{rows: [[null?]]} =
        Nebulith.Repo.query!("SELECT display_name IS NULL FROM users WHERE id = $1", [
          Ecto.UUID.dump!(user.id)
        ])

      assert null?, "an empty form field stored an empty string where NULL was meant"
    end

    test "a key column cannot be edited, because changing it is how a row is lost" do
      user = seed_user()
      other = Ecto.UUID.generate()

      assert {:ok, 0} = Admin.update_row("users", user.id, %{"id" => other})
      assert {:ok, _} = Admin.get_row("users", user.id)
    end

    test "a column this table does not have is ignored rather than trusted" do
      user = seed_user()
      assert {:ok, 0} = Admin.update_row("users", user.id, %{"nonexistent_column" => "x"})
    end
  end

  describe "delete_row/2" do
    test "removes the row" do
      user = seed_user()
      assert {:ok, 1} = Admin.delete_row("users", user.id)
      assert Admin.get_row("users", user.id) == :error
    end

    test "deleting something already gone reports zero rather than raising" do
      assert {:ok, 0} = Admin.delete_row("users", Ecto.UUID.generate())
    end
  end

  describe "a table name is an identifier, and identifiers are checked" do
    test "a crafted name is refused before it reaches a query" do
      for crafted <- [
            "users; drop table users",
            "users--",
            ~s(users" ; select 1; --),
            "no_such_table_at_all"
          ] do
        assert_raise ArgumentError, fn -> Admin.rows(crafted) end
        assert_raise ArgumentError, fn -> Admin.columns(crafted) end
        assert_raise ArgumentError, fn -> Admin.delete_row(crafted, "1") end
      end

      # …and the table it tried to drop is still there.
      assert "users" in Admin.table_names()
    end

    test "table?/1 answers for the controller before any action runs" do
      assert Admin.table?("users")
      refute Admin.table?("users; drop table users")
      refute Admin.table?("nope")
      refute Admin.table?(nil)
    end

    test "a search term is a VALUE, so it is bound and never interpolated" do
      seed_user()
      result = Admin.rows("users", search: ~s(' OR 1=1 --))
      assert result.total == 0, "a quote in the search box was treated as SQL"
    end
  end
end

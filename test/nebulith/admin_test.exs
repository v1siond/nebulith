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

  describe "shape/1 says what a value IS" do
    test "a list of equal-length lists of scalars is a grid" do
      assert {:grid, 2, 3, _} = Admin.shape([[1, 2, 3], [4, 5, 6]])

      assert Admin.shape([[1, 2, 3], [4, 5, 6]]) |> Admin.shape_summary() ==
               "3 x 2 grid, one per cell"
    end

    test "ragged rows are not a grid, because they are not one value per cell" do
      refute match?({:grid, _, _, _}, Admin.shape([[1, 2], [3]]))
    end

    test "a list of objects is a collection, and reports the union of their fields" do
      assert {:collection, 2, keys, _} = Admin.shape([%{"a" => 1}, %{"b" => 2}])
      assert keys == ["a", "b"]
    end

    test "a flat list, an object and a scalar each say so" do
      assert {:list, 3, _} = Admin.shape([1, 2, 3])
      assert {:object, [{"a", "1"}]} = Admin.shape(%{"a" => 1})
      assert {:scalar, "hello"} = Admin.shape("hello")
      assert {:scalar, ""} = Admin.shape(nil)
    end

    test "an empty list is empty, not a grid" do
      assert {:list, 0, []} = Admin.shape([])
      assert Admin.shape([]) |> Admin.shape_summary() == "empty"
    end
  end

  describe "grid_groups/1 answers how the grids relate" do
    test "columns holding the same grid dimensions are reported together" do
      row = %{
        "groundData" => [["a", "b"], ["c", "d"]],
        "heightData" => [[0, 1], [2, 3]],
        "other" => [[1, 2, 3]],
        "name" => "not a grid"
      }

      groups = Admin.grid_groups(row)

      assert groups[{2, 2}] == ["groundData", "heightData"],
             "the two 2x2 grids were not reported as the same grid"

      assert groups[{3, 1}] == ["other"]
      refute Enum.any?(Map.values(groups), &("name" in &1))
    end

    test "the live template's ground and height are one grid" do
      case Nebulith.Repo.query!(~s|SELECT id FROM "Template" LIMIT 1|) do
        %{rows: [[id]]} ->
          {:ok, raw} = Admin.get_row_raw("Template", id)
          groups = Admin.grid_groups(raw)

          assert Enum.any?(groups, fn {_dims, names} ->
                   "groundData" in names and "heightData" in names
                 end),
                 "ground and height are stored per cell on the same grid and were not reported as such"

        _ ->
          :ok
      end
    end
  end

  describe "relations/1 reads the foreign keys both ways" do
    test "a game names what it points at and what points at it" do
      %{belongs_to: out, has_many: incoming} = Admin.relations("games")

      assert Enum.any?(out, &(&1.column == "owner_id" and &1.table == "users"))
      assert Enum.any?(out, &(&1.column == "default_tileset_id" and &1.table == "tilesets"))

      assert Enum.any?(incoming, &(&1.table == "levels" and &1.column == "game_id"))
      assert Enum.any?(incoming, &(&1.table == "game_settings" and &1.column == "game_id"))
    end

    test "a table nothing points at reports an empty side rather than failing" do
      %{belongs_to: out, has_many: incoming} = Admin.relations("users")
      assert out == []
      assert Enum.any?(incoming, &(&1.table == "games"))
    end
  end

  describe "count_where/3" do
    test "counts the rows pointing at one row, and refuses a column that is not real" do
      user = seed_user()
      assert Admin.count_where("games", "owner_id", user.id) == 0

      assert_raise ArgumentError, fn ->
        Admin.count_where("games", "owner_id; drop table games", user.id)
      end
    end
  end
end

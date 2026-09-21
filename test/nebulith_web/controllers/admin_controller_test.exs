defmodule NebulithWeb.AdminControllerTest do
  @moduledoc """
  THE ADMIN'S FIVE SCREENS, AND THE DOOR IN FRONT OF THEM.

  The admin can write to any table in the database, so the first thing pinned is that none of it answers
  without credentials. After that: the table list, one table's rows, a search, a row in full, the edit form
  and the two writes.

  The table name is the one piece of user input that reaches SQL as an identifier, so a request naming a
  table that does not exist has to be turned away by the controller rather than reaching the query.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.{Accounts, Admin}

  @email "admin@test.local"
  @password "supersecret"

  setup %{conn: conn} do
    {:ok, _} = Accounts.create_admin_user(%{email: @email, password: @password})

    {:ok, subject} =
      Accounts.create_user(%{
        email: "subject-#{System.unique_integer([:positive])}@nebulith.test",
        password: "12345678",
        display_name: "Before"
      })

    %{conn: conn, subject: subject}
  end

  defp as_admin(conn) do
    put_req_header(conn, "authorization", Plug.BasicAuth.encode_basic_auth(@email, @password))
  end

  describe "the door" do
    test "requires basic auth", %{conn: conn} do
      conn = get(conn, ~p"/admin")
      assert response(conn, 401)
      assert get_resp_header(conn, "www-authenticate") != []
    end

    test "rejects wrong credentials", %{conn: conn} do
      conn =
        conn
        |> put_req_header("authorization", Plug.BasicAuth.encode_basic_auth(@email, "wrongpassword"))
        |> get(~p"/admin")

      assert response(conn, 401)
    end

    test "every screen is behind it, not just the first", %{conn: conn, subject: subject} do
      for path <- [
            ~p"/admin",
            ~p"/admin/users",
            ~p"/admin/users/#{subject.id}",
            ~p"/admin/users/#{subject.id}/edit"
          ] do
        assert response(get(conn, path), 401), "#{path} answered without credentials"
      end
    end
  end

  describe "browsing" do
    test "lists all tables", %{conn: conn} do
      html = conn |> as_admin() |> get(~p"/admin") |> html_response(200)

      assert html =~ "users"
      assert html =~ "tilesets"
      assert html =~ "game_settings"
    end

    test "a table shows its rows", %{conn: conn, subject: subject} do
      html = conn |> as_admin() |> get(~p"/admin/users") |> html_response(200)

      assert html =~ subject.email
      assert html =~ "Search users"
    end

    test "search narrows to the matching row", %{conn: conn, subject: subject} do
      [prefix | _] = String.split(subject.email, "@")

      found = conn |> as_admin() |> get(~p"/admin/users?q=#{prefix}") |> html_response(200)
      assert found =~ subject.email

      missing = conn |> as_admin() |> get(~p"/admin/users?q=zzz-no-such-user") |> html_response(200)
      refute missing =~ subject.email
      assert missing =~ "Nothing here"
    end

    test "a row shows every column in full", %{conn: conn, subject: subject} do
      html = conn |> as_admin() |> get(~p"/admin/users/#{subject.id}") |> html_response(200)

      assert html =~ subject.email
      assert html =~ "hashed_password"
      assert html =~ "is_admin"
      assert html =~ "Edit"
      assert html =~ "Delete"
    end

    test "the edit form carries the current values", %{conn: conn, subject: subject} do
      html = conn |> as_admin() |> get(~p"/admin/users/#{subject.id}/edit") |> html_response(200)

      assert html =~ ~s(name="row[display_name]")
      assert html =~ "Before"
      # The key is shown but has no field: editing what addresses the row is how the row is lost.
      refute html =~ ~s(name="row[id]")
    end
  end

  describe "writing" do
    test "an edit saves and the row shows the new value", %{conn: conn, subject: subject} do
      conn =
        conn
        |> as_admin()
        |> put(~p"/admin/users/#{subject.id}", %{"row" => %{"display_name" => "After"}})

      assert redirected_to(conn) == ~p"/admin/users/#{subject.id}"
      assert Admin.get_row("users", subject.id) |> elem(1) |> Map.get("display_name") == "After"
    end

    test "a delete removes the row and returns to the table", %{conn: conn, subject: subject} do
      conn = conn |> as_admin() |> delete(~p"/admin/users/#{subject.id}")

      assert redirected_to(conn) == ~p"/admin/users"
      assert Admin.get_row("users", subject.id) == :error
    end
  end

  describe "a table name that is not a table" do
    test "is turned away rather than queried", %{conn: conn} do
      conn = conn |> as_admin() |> get(~p"/admin/#{"users; drop table users"}")

      assert redirected_to(conn) == ~p"/admin"
      assert "users" in Admin.table_names(), "the crafted name reached the database"
    end

    test "an unknown table redirects instead of raising", %{conn: conn} do
      conn = conn |> as_admin() |> get(~p"/admin/no_such_table")
      assert redirected_to(conn) == ~p"/admin"
    end
  end
end

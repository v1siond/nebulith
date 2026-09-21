defmodule NebulithWeb.SessionControllerTest do
  @moduledoc """
  THE DOOR IN FRONT OF THE ENGINE.

  Walks docs/AUTH.md §6 item by item: what a stranger gets, what a login does, where it lands, what a
  failure says, and what is still open to everyone on purpose.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Accounts

  @password "12345678"

  setup do
    {:ok, user} =
      Accounts.create_user(%{
        email: "player-#{System.unique_integer([:positive])}@nebulith.test",
        password: @password,
        display_name: "A Player"
      })

    {:ok, admin} =
      Accounts.create_admin_user(%{
        email: "boss-#{System.unique_integer([:positive])}@nebulith.test",
        password: @password
      })

    %{user: user, admin: admin}
  end

  defp log_in(conn, user) do
    post(conn, ~p"/login", %{"user" => %{"email" => user.email, "password" => @password}})
  end

  describe "a stranger" do
    test "cannot reach any engine page", %{conn: conn} do
      for path <- [
            ~p"/games",
            ~p"/games/1",
            ~p"/templates",
            ~p"/sprite-generator",
            ~p"/sprites-test"
          ] do
        answer = get(conn, path)

        assert redirected_to(answer) == ~p"/login", "#{path} served without a session"

        refute response(answer, 302) =~ ~s(id="game"),
               "#{path} sent the engine shell along with the redirect"
      end
    end

    test "is shown the login form", %{conn: conn} do
      html = conn |> get(~p"/login") |> html_response(200)

      assert html =~ "Log in"
      assert html =~ ~s(name="user[email]")
      assert html =~ ~s(name="user[password]")
    end

    test "still reads the docs, the home page and the health check", %{conn: conn} do
      assert conn |> get(~p"/") |> html_response(200)
      assert conn |> get(~p"/docs") |> html_response(200)
      assert conn |> get(~p"/health") |> json_response(200)
    end
  end

  describe "logging in" do
    test "opens the engine and says who is signed in", %{conn: conn, user: user} do
      conn = log_in(conn, user)
      assert redirected_to(conn) == ~p"/games"

      html = conn |> recycle() |> get(~p"/games") |> html_response(200)
      assert html =~ ~s(id="game")
      assert html =~ user.email
    end

    test "lands on the page that was asked for, not a fixed home page", %{conn: conn, user: user} do
      conn = get(conn, ~p"/templates")
      assert redirected_to(conn) == ~p"/login"

      conn = conn |> recycle() |> log_in(user)
      assert redirected_to(conn) == ~p"/templates"
    end

    test "writes a session row, so it can be taken back", %{conn: conn, user: user} do
      conn = log_in(conn, user)
      token = get_session(conn, "user_token")

      assert is_binary(token)
      assert Accounts.get_user_by_session_token(token).id == user.id
    end

    test "a wrong password and an unknown email say the same thing", %{conn: conn, user: user} do
      wrong_password =
        conn
        |> post(~p"/login", %{"user" => %{"email" => user.email, "password" => "not-it-at-all"}})
        |> html_response(200)

      unknown_email =
        conn
        |> recycle()
        |> post(~p"/login", %{
          "user" => %{"email" => "nobody@nowhere.test", "password" => @password}
        })
        |> html_response(200)

      assert wrong_password =~ "Wrong email or password"
      assert unknown_email =~ "Wrong email or password"
      refute unknown_email =~ "not found"
    end

    test "someone already signed in is kept off the form", %{conn: conn, user: user} do
      conn = conn |> log_in(user) |> recycle() |> get(~p"/login")
      assert redirected_to(conn) == ~p"/games"
    end
  end

  describe "logging out" do
    test "ends the session and the token stops working", %{conn: conn, user: user} do
      conn = log_in(conn, user)
      token = get_session(conn, "user_token")

      conn = conn |> recycle() |> post(~p"/logout")
      assert redirected_to(conn) == ~p"/login"

      refute get_session(conn, "user_token")
      refute Accounts.get_user_by_session_token(token)
    end

    test "the engine is shut again afterwards", %{conn: conn, user: user} do
      conn =
        conn
        |> log_in(user)
        |> recycle()
        |> post(~p"/logout")
        |> recycle()
        |> get(~p"/games")

      assert redirected_to(conn) == ~p"/login"
    end
  end

  describe "the admin, which is a different question from being signed in" do
    test "refuses a signed-in user who is not an admin", %{conn: conn, user: user} do
      conn = conn |> log_in(user) |> recycle() |> get(~p"/admin")

      assert response(conn, 401)
    end

    test "refuses a non-admin presenting their own correct credentials", %{conn: conn, user: user} do
      conn =
        conn
        |> put_req_header(
          "authorization",
          Plug.BasicAuth.encode_basic_auth(user.email, @password)
        )
        |> get(~p"/admin")

      assert response(conn, 401)
    end

    test "opens for an admin's session, with no second login", %{conn: conn, admin: admin} do
      conn = conn |> log_in(admin) |> recycle() |> get(~p"/admin")

      assert html_response(conn, 200) =~ "users"
    end

    test "still opens for HTTP Basic, which is what the end-to-end gate carries", %{
      conn: conn,
      admin: admin
    } do
      conn =
        conn
        |> put_req_header(
          "authorization",
          Plug.BasicAuth.encode_basic_auth(admin.email, @password)
        )
        |> get(~p"/admin")

      assert html_response(conn, 200) =~ "users"
    end
  end
end

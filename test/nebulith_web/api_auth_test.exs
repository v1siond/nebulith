defmodule NebulithWeb.ApiAuthTest do
  @moduledoc """
  THE API IS CLOSED.

  Two credentials open it, because two kinds of caller ask: a browser on this origin sends the session
  cookie with its fetches, and a script sends a bearer token. Everything behind it answers the same way
  either way, and answers nothing to a caller who is nobody.

  The liveness probe is the exception and has to stay open: a health check that needs a credential
  reports the app is down whenever the credential is wrong.

  Measured before this gate: every route under /api served the whole catalogue to anyone who asked.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Accounts

  @password "12345678"

  setup do
    {:ok, user} =
      Accounts.create_user(%{
        email: "caller-#{System.unique_integer([:positive])}@nebulith.test",
        password: @password
      })

    %{user: user, token: Accounts.create_user_api_token(user)}
  end

  defp with_token(conn, token), do: put_req_header(conn, "authorization", "Bearer " <> token)

  defp sign_in(conn, user) do
    conn
    |> post(~p"/login", %{"user" => %{"email" => user.email, "password" => @password}})
    |> recycle()
  end

  # One from each shape of route in the scope: a resource index, a plain read, and a nested resource.
  @routes [
    "/api/tilesets",
    "/api/entities",
    "/api/combat",
    "/api/zones",
    "/api/templates",
    "/api/games"
  ]

  describe "a caller who is nobody" do
    test "is refused everywhere, with JSON and not a redirect", %{conn: conn} do
      for route <- @routes do
        answer = get(conn, route)

        assert json_response(answer, 401) == %{"errors" => %{"detail" => "Unauthorized"}},
               "#{route} answered a stranger"
      end
    end

    test "is told how to identify itself", %{conn: conn} do
      conn = get(conn, ~p"/api/tilesets")

      assert [~s(Bearer realm="Nebulith API")] = get_resp_header(conn, "www-authenticate")
    end

    test "cannot write either", %{conn: conn} do
      assert conn |> post(~p"/api/templates", %{}) |> json_response(401)
      assert conn |> recycle() |> delete(~p"/api/templates/1") |> json_response(401)
    end

    test "is refused a token that is not a token", %{conn: conn} do
      assert conn
             |> with_token("not-base64-at-all!!")
             |> get(~p"/api/tilesets")
             |> json_response(401)

      assert conn |> recycle() |> with_token("") |> get(~p"/api/tilesets") |> json_response(401)
    end

    test "is refused a well-formed token nobody holds", %{conn: conn} do
      forged = Base.url_encode64(:crypto.strong_rand_bytes(32), padding: false)

      assert conn |> with_token(forged) |> get(~p"/api/tilesets") |> json_response(401)
    end

    test "still gets the health check, which must never need a credential", %{conn: conn} do
      assert conn |> get(~p"/health") |> json_response(200) == %{
               "status" => "ok",
               "app" => "nebulith"
             }
    end
  end

  describe "a bearer token" do
    test "opens every route in the scope", %{conn: conn, token: token} do
      for route <- @routes do
        answer = conn |> recycle() |> with_token(token) |> get(route)

        assert answer.status == 200, "#{route} refused a valid token with #{answer.status}"
      end
    end

    test "resolves to the person who holds it", %{user: user, token: token} do
      assert Accounts.get_user_by_api_token(token).id == user.id
    end

    test "stops working once revoked", %{conn: conn, token: token} do
      assert conn |> with_token(token) |> get(~p"/api/tilesets") |> json_response(200)

      :ok = Accounts.delete_user_api_token(token)

      assert conn
             |> recycle()
             |> with_token(token)
             |> get(~p"/api/tilesets")
             |> json_response(401)
    end

    test "survives signing out everywhere, because a script is not a browser", %{
      conn: conn,
      user: user,
      token: token
    } do
      :ok = Accounts.delete_all_user_session_tokens(user)

      assert conn |> with_token(token) |> get(~p"/api/tilesets") |> json_response(200)
    end
  end

  describe "a browser session" do
    test "opens the api with no token at all", %{conn: conn, user: user} do
      assert conn |> sign_in(user) |> get(~p"/api/tilesets") |> json_response(200)
    end

    test "closes again on log out", %{conn: conn, user: user} do
      conn = conn |> sign_in(user) |> post(~p"/logout") |> recycle()

      assert conn |> get(~p"/api/tilesets") |> json_response(401)
    end
  end

  describe "the two credentials are one identity" do
    test "a session and a token answer the same", %{conn: conn, user: user, token: token} do
      by_session = conn |> sign_in(user) |> get(~p"/api/tilesets") |> json_response(200)
      by_token = build_conn() |> with_token(token) |> get(~p"/api/tilesets") |> json_response(200)

      assert by_session == by_token
    end
  end
end

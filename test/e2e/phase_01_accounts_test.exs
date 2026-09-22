defmodule Nebulith.E2E.Phase01AccountsTest do
  @moduledoc """
  PHASE 1: the door, driven the way a person drives it.

  The Elixir controller tests prove the plugs redirect and the rows are written. That is the server's
  half. This is the other half: a real browser asking for a page it may not have, typing into the real
  form, and then actually being inside the application.

  Measured before any of this was gated: /games rendered the engine to anybody who asked for it.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1

  setup do
    World.seed_catalog()
    %{user: Account.an_admin()}
  end

  describe "a stranger" do
    test "is sent to the form and is given no engine on the way", %{conn: conn} do
      session = visit(conn, "/games")

      assert Browser.js(session, "window.location.pathname") == "/login",
             "/games served without a session"

      assert Browser.js(session, "!document.querySelector('#game')") == true,
             "the engine shell was rendered to a stranger"
    end

    test "is refused by the api, while the liveness probe stays open", %{conn: conn} do
      session = visit(conn, "/login")

      assert Browser.js(session, "fetch('/api/tilesets').then(r => r.status)") == 401,
             "/api/tilesets answered a request with no session"

      assert Browser.js(session, "fetch('/health').then(r => r.status)") == 200,
             "/health asked for a credential"
    end

    test "can still read the documentation", %{conn: conn} do
      session = visit(conn, "/docs")
      assert Browser.js(session, "window.location.pathname") == "/docs", "/docs asked for a login"
    end
  end

  describe "the wrong password" do
    test "is refused, and the page does not say which half was wrong", %{conn: conn, user: user} do
      session =
        conn
        |> visit("/login")
        |> fill_in("#user_email", "Email", with: user.email)
        |> fill_in("#user_password", "Password", with: "definitely-not-the-password")
        |> click_button("Log in")

      # Its own id: the app layout's flash toasts carry role="alert" too, so matching on the role
      # would pass against a completely unrelated message.
      assert_has(session, "#login-error", text: "Wrong email or password")

      assert Browser.js(session, "!document.querySelector('#game')") == true,
             "a wrong password still rendered the engine"
    end
  end

  describe "the right password" do
    test "opens the engine, says who is signed in, and shuts again on log out", %{conn: conn, user: user} do
      session = Account.sign_in(conn, user)

      assert_has(session, "#game", timeout: 20_000)
      assert_has(session, "body", text: user.email)

      # The signed-in page can read its own api, and the answer has something in it. A 200 carrying
      # an empty list would satisfy "the api is open" while proving the catalog never arrived.
      tilesets =
        Browser.js(session, "fetch('/api/tilesets').then(r => r.json()).then(b => b.data.length)")

      assert is_integer(tilesets) and tilesets > 0,
             "the api answered but served no tilesets: #{inspect(tilesets)}"

      session = click_button(session, "Log out")

      Browser.wait_for_js(session, "window.location.pathname === '/login'", "the log out to land")

      session = visit(session, "/games")

      assert Browser.js(session, "window.location.pathname") == "/login",
             "the engine was still open after logging out"
    end
  end
end

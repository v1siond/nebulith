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

      # EVERY DOOR, not one of them. Each of these was added at a different time and each one is a way
      # into the catalog: a scope is only closed if the routes actually inside it are.
      for path <- ~w(/api/tilesets /api/art_styles /api/enums /api/maps/schema) do
        assert Browser.js(session, "fetch('#{path}').then(r => r.status)") == 401,
               "#{path} answered a request with no session"
      end

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

  describe "signing up" do
    test "a new person creates an account and is inside the application", %{conn: conn} do
      {session, email} = Account.sign_up(conn)

      assert_has(session, "#game", timeout: 20_000)
      assert_has(session, "body", text: email)

      # A NEW ACCOUNT IS A PLAYER. is_admin is the whole difference between somebody who plays and
      # somebody who can write to every table in the database, so the public door must never open it.
      user = Nebulith.Accounts.get_user_by_email(email)
      assert user, "the signup form did not write a row"
      refute user.is_admin, "a person who signed up came out as an administrator"

      assert Browser.js(session, "fetch('/admin').then(r => r.status)") in [401, 403],
             "a player reached the admin"
    end

    test "the two doors point at each other", %{conn: conn} do
      login = visit(conn, "/login")

      assert Browser.true?(login, "!!document.querySelector('a[href=\\'/signup\\']')"),
             "the login page offers no way to create an account"

      signup = visit(conn, "/signup")

      assert Browser.true?(signup, "!!document.querySelector('a[href=\\'/login\\']')"),
             "the signup page offers no way back to logging in"
    end

    test "a password that is too short never becomes an account", %{conn: conn} do
      email = "e2e-short-#{System.unique_integer([:positive])}@nebulith.test"

      session =
        conn
        |> visit("/signup")
        |> Browser.fill("#user_email", email)
        |> Browser.fill("#user_password", "short")
        |> click_button("Create account")

      # THE BROWSER REFUSES IT FIRST. The field carries minlength, so the form never submits and the
      # page never moves, which is the better experience and is what a person actually meets. The
      # server's own refusal is gated in RegistrationControllerTest, because a caller that ignores the
      # markup has to be refused too and no browser will demonstrate that.
      Process.sleep(1_000)

      assert Browser.js(session, "window.location.pathname") == "/signup",
             "a seven character password submitted the form"

      refute Nebulith.Accounts.get_user_by_email(email),
             "a password under the minimum created an account"
    end
  end

  describe "the right password" do
    test "opens the engine, says who is signed in, and shuts again on log out", %{
      conn: conn,
      user: user
    } do
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

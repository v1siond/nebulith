defmodule Nebulith.E2E.Account do
  @moduledoc """
  Being somebody, through the real form.

  Every engine page is behind a session, so a scenario that never signs in never sees the editor at
  all: it is bounced to /login and then waits for a canvas that was never going to appear. That is not
  a hypothetical. Both of the first two browser tests were written without it and neither of them could
  ever have passed.

  ## Why the form, and not a forged cookie

  Filling the real inputs and pressing the real button is one more second per test, and it buys two
  things. The login form stays covered by every scenario that needs to be somebody, rather than by one
  test that could rot without anyone noticing. And the session the scenario runs under is built the way
  a person's is, so an auth change that breaks people breaks the suite too, instead of breaking only
  the people.
  """

  import PhoenixTest

  alias Nebulith.Accounts
  alias Nebulith.E2E.Browser

  @password "e2e-password-12345"

  @doc "An admin in the test database, with a known password, unique per call."
  def an_admin(attrs \\ %{}) do
    email = Map.get(attrs, :email, "e2e-#{System.unique_integer([:positive])}@nebulith.test")

    {:ok, user} =
      Accounts.create_admin_user(Map.merge(%{email: email, password: @password}, attrs))

    user
  end

  @doc "The password `an_admin/1` gives out, for a scenario that types it."
  def password, do: @password

  @doc """
  Creates an account by filling the signup form, the way a new person arrives.

  Gives back `{session, email}`: the caller usually wants to know who it just became, and the email is
  unique per call so two scenarios never fight over one account.
  """
  def sign_up(session, opts \\ []) do
    email =
      Keyword.get(opts, :email, "e2e-new-#{System.unique_integer([:positive])}@nebulith.test")

    session =
      session
      |> visit("/signup")
      |> fill_in("#user_email", "Email", with: email)
      |> fill_in("#user_password", "Password", with: Keyword.get(opts, :password, @password))
      |> click_button("Create account")
      |> Browser.wait_for_js(
        "!window.location.pathname.startsWith('/signup')",
        "the signup form to let #{email} through",
        timeout: 15_000
      )

    {session, email}
  end

  @doc """
  Signs in as `user` by filling the login form and pressing Log in.

  Waits for the form to be gone rather than for a fixed moment: the submit is a real navigation, and
  asserting on the next page before it has arrived is the flake this avoids.
  """
  def sign_in(session, user, opts \\ []) do
    session
    |> visit("/login")
    |> fill_in("#user_email", "Email", with: user.email)
    |> fill_in("#user_password", "Password", with: Keyword.get(opts, :password, @password))
    |> click_button("Log in")
    |> Browser.wait_for_js(
      "!window.location.pathname.startsWith('/login')",
      "the login form to let #{user.email} through",
      timeout: 15_000
    )
  end
end

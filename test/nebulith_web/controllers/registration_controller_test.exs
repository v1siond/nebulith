defmodule NebulithWeb.RegistrationControllerTest do
  @moduledoc """
  The public door: who it lets in, and what it refuses to hand out.

  The case that matters most is the one a person never performs. `User.changeset/2` casts `is_admin`,
  so a registration built on it would turn `user[is_admin]=true` in a form post into an administrator
  with write access to every table in the database. Registration goes through its own changeset, and
  that is gated here rather than trusted.
  """
  use NebulithWeb.ConnCase, async: true

  alias Nebulith.Accounts

  defp unique_email, do: "signup-#{System.unique_integer([:positive])}@nebulith.test"

  describe "the form" do
    test "renders, and offers a way back to logging in", %{conn: conn} do
      html = conn |> get(~p"/signup") |> html_response(200)

      assert html =~ "Create an account"
      assert html =~ ~s(id="user_email")
      assert html =~ ~s(id="user_password")
      assert html =~ "/login"
    end

    test "is not shown to somebody already signed in", %{conn: conn} do
      user = admin_fixture()

      conn =
        conn
        |> post(~p"/login", %{"user" => %{"email" => user.email, "password" => "12345678"}})
        |> get(~p"/signup")

      assert redirected_to(conn) != ~p"/signup"
    end
  end

  describe "creating an account" do
    test "makes the person, signs them in, and does not leave them on the form", %{conn: conn} do
      email = unique_email()

      conn =
        post(conn, ~p"/signup", %{"user" => %{"email" => email, "password" => "a-real-password"}})

      assert redirected_to(conn) =~ ~r"^/"
      assert get_session(conn, :user_token), "signing up did not sign the person in"
      assert Accounts.get_user_by_email(email), "no user row was written"
    end

    test "downcases the email, so one address is one account", %{conn: conn} do
      email = unique_email()
      upper = String.upcase(email)

      post(conn, ~p"/signup", %{"user" => %{"email" => upper, "password" => "a-real-password"}})

      assert %{email: stored} = Accounts.get_user_by_email(email)
      assert stored == String.downcase(email)
    end

    test "keeps a display name when one is given", %{conn: conn} do
      email = unique_email()

      post(conn, ~p"/signup", %{
        "user" => %{"email" => email, "password" => "a-real-password", "display_name" => "Ada"}
      })

      assert %{display_name: "Ada"} = Accounts.get_user_by_email(email)
    end
  end

  describe "what it refuses" do
    test "a crafted is_admin does NOT make an administrator", %{conn: conn} do
      email = unique_email()

      post(conn, ~p"/signup", %{
        "user" => %{"email" => email, "password" => "a-real-password", "is_admin" => "true"}
      })

      user = Accounts.get_user_by_email(email)
      assert user, "the account was not created, so this proves nothing about is_admin"

      refute user.is_admin,
             "a signup form minted an administrator, who can write to every table in the database"
    end

    test "a short password is refused, and says so", %{conn: conn} do
      refused =
        post(conn, ~p"/signup", %{"user" => %{"email" => unique_email(), "password" => "short"}})

      assert html_response(refused, 200) =~ "at least 8 characters"

      refute get_session(refused, :user_token),
             "a refused signup signed the person in anyway"
    end

    test "an address with no @ is refused", %{conn: conn} do
      html =
        conn
        |> post(~p"/signup", %{
          "user" => %{"email" => "not-an-address", "password" => "a-real-password"}
        })
        |> html_response(200)

      assert html =~ "must contain an @"
    end

    # THE ONE ERROR THAT MUST NOT BE HELPFUL. Saying "that email is taken" turns this page into a
    # question anyone can ask about anyone: it answers whether a given person has an account here.
    test "an email that already exists does not admit that it exists", %{conn: conn} do
      taken = admin_fixture().email

      html =
        conn
        |> post(~p"/signup", %{"user" => %{"email" => taken, "password" => "a-real-password"}})
        |> html_response(200)

      refute html =~ "already"
      refute html =~ "taken"
      refute html =~ "exists"
      assert html =~ "cannot be used"
    end

    test "an empty post does not raise", %{conn: conn} do
      assert conn |> post(~p"/signup", %{}) |> html_response(200) =~ "Create an account"
    end
  end

  defp admin_fixture do
    {:ok, user} =
      Accounts.create_user(%{email: unique_email(), password: "12345678", display_name: "Taken"})

    user
  end
end
